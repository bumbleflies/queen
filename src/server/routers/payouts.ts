import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, adminProcedure } from '../trpcInit';
import { Payout, type PayoutDoc } from '../models/Payout';
import { ExpenseClaim } from '../models/ExpenseClaim';
import { Founder } from '../models/Founder';
import { JournalEntry } from '../models/JournalEntry';
import { claimFieldsOf } from '../lib/expenses/claimFields';
import { epcPayload, EpcError } from '../lib/payments/epcQr';
import { nextPayoutNumber, peekPayoutNumber } from '../lib/payouts/numbering';
import { resolvePayoutMailer } from '../lib/payouts/payoutMail';

const idInput = z.object({ id: z.string().min(1) });
const numberInput = z.object({ number: z.string().min(1) });

/** Period in the purpose only when every claim belongs to the same one. */
export function payoutPurpose(shortName: string, periods: string[], number: string): string {
  const unique = [...new Set(periods.filter(Boolean))].sort();
  return unique.length === 1
    ? `Spesen ${shortName} ${unique[0]} ${number}`
    : `Spesen ${shortName} ${number}`;
}

function grossOf(claim: InstanceType<typeof ExpenseClaim>): number {
  return claimFieldsOf(claim)?.grossCents ?? 0;
}

function sumOf(claims: InstanceType<typeof ExpenseClaim>[]): number {
  return claims.reduce((sum, claim) => sum + grossOf(claim), 0);
}

/**
 * Only booked claims with a *live* journal entry may be paid. A reversed or a
 * payout-pending claim can never be aggregated a second time.
 */
async function eligibleClaims(args: { founderId: string; claimIds?: string[] }): Promise<InstanceType<typeof ExpenseClaim>[]> {
  const filter: Record<string, unknown> = { founderId: args.founderId, status: 'booked' };
  if (args.claimIds) filter._id = { $in: args.claimIds };
  const claims = await ExpenseClaim.find(filter);
  const entryIds = claims.flatMap((claim) => (claim.journalEntryId ? [String(claim.journalEntryId)] : []));
  if (entryIds.length === 0) return [];
  const active = new Set(
    (await JournalEntry.find({ _id: { $in: entryIds }, active: true }).select('_id')).map((entry) => String(entry._id)),
  );
  return claims.filter((claim) => !!claim.journalEntryId && active.has(String(claim.journalEntryId)));
}

async function requireFounder(founderId: string): Promise<InstanceType<typeof Founder>> {
  const founder = await Founder.findById(founderId);
  if (!founder) throw new TRPCError({ code: 'NOT_FOUND', message: 'Gesellschafter nicht gefunden' });
  if (!founder.iban?.trim()) {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Für diesen Gesellschafter ist keine IBAN hinterlegt' });
  }
  return founder;
}

function qrPayload(
  founder: InstanceType<typeof Founder>,
  payout: { amountCents: number; purpose: string },
): string {
  try {
    return epcPayload({
      name: founder.name,
      iban: founder.iban,
      bic: founder.bic ?? '',
      amountCents: payout.amountCents,
      purpose: payout.purpose,
    });
  } catch (err) {
    const message = err instanceof EpcError ? err.message : (err as Error).message;
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message });
  }
}

function qrResponse(founder: InstanceType<typeof Founder>, payout: PayoutDoc) {
  return {
    payload: qrPayload(founder, payout),
    name: founder.name,
    iban: founder.iban,
    amountCents: payout.amountCents,
    purpose: payout.purpose,
  };
}

function view(payout: PayoutDoc) {
  return {
    id: String(payout._id),
    number: payout.number,
    reference: payout.reference,
    founderId: String(payout.founderId),
    claimIds: payout.claimIds.map(String),
    amountCents: payout.amountCents,
    purpose: payout.purpose,
    status: payout.status,
    releasedAt: payout.releasedAt ?? null,
    executedAt: payout.executedAt ?? null,
    transactionId: payout.transactionId ? String(payout.transactionId) : null,
  };
}

export const payoutsRouter = router({
  /** Recent payouts for the Expenses → Auszahlungen tab. */
  list: adminProcedure.query(async () => {
    const payouts = await Payout.find().sort({ createdAt: -1 }).limit(100);
    const founderIds = [...new Set(payouts.map((payout) => String(payout.founderId)))];
    const founders = await Founder.find({ _id: { $in: founderIds } }).select('name shortName');
    const byId = new Map(founders.map((founder) => [String(founder._id), founder]));
    return payouts.map((payout) => {
      const founder = byId.get(String(payout.founderId));
      return {
        ...view(payout),
        createdAt: payout.createdAt,
        founder: founder
          ? { name: founder.name, shortName: founder.shortName }
          : { name: '', shortName: '' },
      };
    });
  }),

  /** Everything needed to offer a payout, without reserving a number. */
  preview: adminProcedure
    .input(z.object({ founderId: z.string().min(1) }))
    .query(async ({ input }) => {
      const founder = await requireFounder(input.founderId);
      const claims = await eligibleClaims({ founderId: input.founderId });
      const amountCents = sumOf(claims);
      const number = await peekPayoutNumber(new Date().getFullYear());
      const purpose = payoutPurpose(founder.shortName, claims.map((claim) => claim.period), number);
      const payload = amountCents > 0 ? qrPayload(founder, { amountCents, purpose }) : null;
      return {
        number,
        amountCents,
        purpose,
        payload,
        periods: [...new Set(claims.map((claim) => claim.period))].sort(),
        founder: {
          id: String(founder._id),
          name: founder.name,
          shortName: founder.shortName,
          iban: founder.iban,
          bic: founder.bic ?? '',
        },
        claims: claims.map((claim) => ({
          id: String(claim._id),
          period: claim.period,
          grossCents: grossOf(claim),
          vendorName: claimFieldsOf(claim)?.vendorName ?? '',
          date: claimFieldsOf(claim)?.date ?? null,
        })),
      };
    }),

  /**
   * One draft per founder. A second call while a draft exists adds claims to it;
   * after release a fresh draft is required. Adding is idempotent per claim.
   */
  create: adminProcedure
    .input(
      z.object({
        founderId: z.string().min(1),
        claimIds: z.array(z.string().min(1)).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const founder = await requireFounder(input.founderId);
      const requested = input.claimIds ? [...new Set(input.claimIds)] : undefined;
      let claims = await eligibleClaims({ founderId: input.founderId, claimIds: requested });
      if (requested && claims.length !== requested.length) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Ein Beleg ist nicht mehr zur Auszahlung offen' });
      }
      if (claims.length === 0) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Keine gebuchten Belege zur Auszahlung vorhanden' });
      }

      let payout = await Payout.findOne({ founderId: founder._id, status: 'draft' });
      if (payout) {
        const ids = [...new Set([...payout.claimIds.map(String), ...claims.map((claim) => String(claim._id))])];
        claims = await eligibleClaims({ founderId: input.founderId, claimIds: ids });
        payout.claimIds = claims.map((claim) => claim._id);
        payout.amountCents = sumOf(claims);
        payout.purpose = payoutPurpose(founder.shortName, claims.map((claim) => claim.period), payout.number);
        await payout.save();
      } else {
        const number = await nextPayoutNumber(new Date().getFullYear());
        payout = await Payout.create({
          number,
          reference: number,
          founderId: founder._id,
          claimIds: claims.map((claim) => claim._id),
          amountCents: sumOf(claims),
          purpose: payoutPurpose(founder.shortName, claims.map((claim) => claim.period), number),
          status: 'draft',
          createdBy: ctx.user.sub,
        });
      }
      await ExpenseClaim.updateMany({ _id: { $in: payout.claimIds } }, { $set: { payoutId: payout._id } });
      return view(payout);
    }),

  /** Payout page: admin-only, and no payload before the release. */
  get: adminProcedure.input(numberInput).query(async ({ input }) => {
    const payout = await Payout.findOne({ number: input.number });
    if (!payout) throw new TRPCError({ code: 'NOT_FOUND', message: 'Auszahlung nicht gefunden' });
    const [founder, claims] = await Promise.all([
      Founder.findById(payout.founderId),
      ExpenseClaim.find({ _id: { $in: payout.claimIds } }).sort({ receivedAt: 1 }),
    ]);
    if (!founder) throw new TRPCError({ code: 'NOT_FOUND', message: 'Gesellschafter nicht gefunden' });
    const showQr = payout.status === 'released' || payout.status === 'executed';
    return {
      ...view(payout),
      settledAt: payout.updatedAt ?? payout.createdAt,
      founder: {
        id: String(founder._id),
        name: founder.name,
        shortName: founder.shortName,
        loginEmail: founder.loginEmail,
      },
      claims: claims.map((claim) => ({
        id: String(claim._id),
        period: claim.period,
        status: claim.status,
        grossCents: grossOf(claim),
        vendorName: claimFieldsOf(claim)?.vendorName ?? '',
        fileName: claim.fileName,
        driveLink: claim.driveLink ?? '',
        driveFileId: claim.driveFileId ?? '',
      })),
      qr: showQr ? qrPayload(founder, payout) : null,
    };
  }),

  /** Approval step: lock the claims and post the deep-link mail into the claim thread. */
  release: adminProcedure.input(idInput).mutation(async ({ input, ctx }) => {
    const payout = await Payout.findById(input.id);
    if (!payout) throw new TRPCError({ code: 'NOT_FOUND', message: 'Auszahlung nicht gefunden' });
    if (payout.status !== 'draft') {
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Auszahlung ist nicht mehr freigabefähig' });
    }
    const founder = await requireFounder(String(payout.founderId));
    const claims = await eligibleClaims({
      founderId: String(payout.founderId),
      claimIds: payout.claimIds.map(String),
    });
    if (claims.length !== payout.claimIds.length) {
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Ein Beleg ist nicht mehr buchbar — Auszahlung neu erstellen' });
    }

    payout.amountCents = sumOf(claims);
    payout.purpose = payoutPurpose(founder.shortName, claims.map((claim) => claim.period), payout.number);
    payout.status = 'released';
    payout.releasedBy = ctx.user.sub;
    payout.releasedAt = new Date();
    await payout.save();
    await ExpenseClaim.updateMany({ _id: { $in: payout.claimIds } }, { $set: { status: 'payoutPending' } });

    // A mail problem only warns: the release itself stands.
    try {
      const newest = [...claims].sort((a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime())[0];
      const mailer = await resolvePayoutMailer();
      await mailer({
        payout: { number: payout.number, amountCents: payout.amountCents, purpose: payout.purpose },
        founder: { name: founder.name, loginEmail: founder.loginEmail },
        newestClaim: { messageId: newest?.messageId ?? null, subject: newest?.subject ?? null },
      });
    } catch (err) {
      console.warn(`Auszahlung ${payout.number}: Freigabe-Mail fehlgeschlagen: ${(err as Error).message}`);
    }
    return view(payout);
  }),

  /** Fallback for a late bank row; the happy path is the reconcile settlement. */
  markExecuted: adminProcedure.input(idInput).mutation(async ({ input, ctx }) => {
    const payout = await Payout.findById(input.id);
    if (!payout) throw new TRPCError({ code: 'NOT_FOUND', message: 'Auszahlung nicht gefunden' });
    if (payout.status !== 'released') {
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Nur freigegebene Auszahlungen können überwiesen werden' });
    }
    payout.status = 'executed';
    payout.executedBy = ctx.user.sub;
    payout.executedAt = new Date();
    await payout.save();
    return view(payout);
  }),

  cancel: adminProcedure.input(idInput).mutation(async ({ input }) => {
    const payout = await Payout.findById(input.id);
    if (!payout) throw new TRPCError({ code: 'NOT_FOUND', message: 'Auszahlung nicht gefunden' });
    if (payout.status !== 'draft' && payout.status !== 'released') {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'Abgebrochen ist nur vor der Überweisung möglich — danach Bankzeile und Journaleintrag stornieren',
      });
    }
    payout.status = 'canceled';
    await payout.save();
    await ExpenseClaim.updateMany(
      { payoutId: payout._id, status: 'payoutPending' },
      { $set: { status: 'booked' }, $unset: { payoutId: '' } },
    );
    await ExpenseClaim.updateMany({ payoutId: payout._id, status: 'booked' }, { $unset: { payoutId: '' } });
    return view(payout);
  }),

  /** Exact EPC string only — the server never renders a QR image. */
  qr: adminProcedure.input(idInput).query(async ({ input }) => {
    const payout = await Payout.findById(input.id);
    if (!payout) throw new TRPCError({ code: 'NOT_FOUND', message: 'Auszahlung nicht gefunden' });
    if (payout.status === 'draft' || payout.status === 'canceled') {
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'QR erst nach Freigabe verfügbar' });
    }
    if (payout.status === 'settled') {
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Auszahlung ist bereits ausgeglichen' });
    }
    const founder = await Founder.findById(payout.founderId);
    if (!founder) throw new TRPCError({ code: 'NOT_FOUND', message: 'Gesellschafter nicht gefunden' });
    return qrResponse(founder, payout);
  }),
});
