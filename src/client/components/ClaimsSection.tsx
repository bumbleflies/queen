import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { trpc } from '../lib/trpc';
import { useToast } from './Toast';
import { useLanguage } from '../i18n/LanguageContext';
import { formatDate, formatEUR } from '../lib/format';
import { parseGermanAmount } from '../../server/lib/money';
import { claimStatusClass, claimStatusKey } from '../lib/expenseLabel';
import { ClaimCorrectDialog, type ClaimToCorrect } from './ClaimCorrectDialog';
import { Modal } from './FinanceDialogs';

interface ClaimParse {
  date?: string | Date | null;
  vendorName?: string;
  invoiceNumber?: string;
  grossCents?: number | null;
  netCents?: number | null;
  vatCents?: number | null;
  vatRate?: number | null;
  account?: string | null;
  reverseCharge?: boolean;
  addressedToCompany?: boolean;
  currency?: string;
}

interface ClaimRow {
  id: string;
  receivedAt: string | Date;
  period: string;
  from: string;
  subject: string;
  fileName: string;
  driveFileId: string;
  driveLink: string;
  status: string;
  error?: string | null;
  founder?: { id: string; name: string; shortName: string; active: boolean } | null;
  parse?: ClaimParse | null;
  corrected?: { at: string | Date | null; by: string } | null;
  payoutId?: string | null;
  autoBookable?: { ok: boolean; reasons: string[]; vatDeductible: boolean; grossOnly: boolean };
}

/** `"Test Person" <tp@example.org>` → `Test Person`. */
function senderName(from: string): string {
  const name = from.replace(/<[^>]*>/g, '').replace(/["']/g, '').trim();
  return name || from;
}

/** "12,14" → 1214; "" → null; anything else → 'bad' (never a guessed amount). */
function centsFromInput(raw: string): number | null | 'bad' {
  const value = raw.trim();
  if (!value) return null;
  try {
    return parseGermanAmount(value);
  } catch {
    return 'bad';
  }
}

/** 0.19 → "19"; null stays empty. */
function rateFromInput(raw: string): number | null | 'bad' {
  const value = raw.trim().replace(',', '.');
  if (!value) return null;
  const percent = Number(value);
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) return 'bad';
  return percent / 100;
}

/** `<input type="date">` → local business date (never UTC midnight). */
function localDate(value: string): Date | null {
  if (!value) return null;
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/**
 * A paper receipt the founder cannot forward: entered by hand so it shows up in
 * the same review list. It books nothing — like every claim.
 */
export function ManualClaimDialog({ onClose }: { onClose: () => void }) {
  const { t } = useLanguage();
  const toast = useToast();
  const utils = trpc.useUtils();
  const founders = trpc.founders.list.useQuery();
  const createManual = trpc.expenses.claims.createManual.useMutation();

  const today = new Date();
  const [founderId, setFounderId] = useState('');
  const [date, setDate] = useState(
    `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`,
  );
  const [vendorName, setVendorName] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [gross, setGross] = useState('');
  const [net, setNet] = useState('');
  const [vat, setVat] = useState('');
  const [rate, setRate] = useState('');
  const [account, setAccount] = useState('');
  const [driveLink, setDriveLink] = useState('');

  async function save() {
    if (!founderId) {
      toast.error(t('expenses.manual.founderMissing'));
      return;
    }
    const receiptDate = localDate(date);
    if (!receiptDate) {
      toast.error(t('expenses.manual.badDate'));
      return;
    }
    const grossCents = centsFromInput(gross);
    if (grossCents === 'bad' || grossCents === null) {
      toast.error(t('expenses.correct.badAmount').replace('{raw}', gross.trim()));
      return;
    }
    const netCents = centsFromInput(net);
    const vatCents = centsFromInput(vat);
    const vatRate = rateFromInput(rate);
    if (netCents === 'bad' || vatCents === 'bad' || vatRate === 'bad') {
      toast.error(t('expenses.correct.badAmount').replace('{raw}', [net, vat, rate].find((v) => v.trim() && centsFromInput(v) === 'bad')?.trim() ?? ''));
      return;
    }
    try {
      await createManual.mutateAsync({
        founderId,
        date: receiptDate,
        vendorName: vendorName.trim(),
        ...(invoiceNumber.trim() ? { invoiceNumber: invoiceNumber.trim() } : {}),
        grossCents,
        ...(netCents !== null ? { netCents } : {}),
        ...(vatCents !== null ? { vatCents } : {}),
        ...(vatRate !== null ? { vatRate } : {}),
        ...(account.trim() ? { account: account.trim() } : {}),
        ...(driveLink.trim() ? { driveLink: driveLink.trim() } : {}),
      });
      await utils.expenses.claims.list.invalidate();
      toast.show(t('expenses.manual.created'));
      onClose();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <Modal title={t('expenses.manual.title')} sub={t('expenses.manual.sub')} onClose={onClose}>
      <div style={{ padding: 16, display: 'grid', gap: 10 }}>
        <label className="lab">
          {t('expenses.manual.founder')}
          <select className="field" value={founderId} onChange={(e) => setFounderId(e.target.value)}>
            <option value="">—</option>
            {(founders.data ?? []).map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
        </label>
        <label className="lab">
          {t('expenses.manual.date')}
          <input className="field" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="lab">
          {t('expenses.manual.vendor')}
          <input className="field" autoFocus value={vendorName} onChange={(e) => setVendorName(e.target.value)} />
        </label>
        <label className="lab">
          {t('expenses.manual.invoiceNumber')}
          <input className="field" value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} />
        </label>
        <label className="lab">
          {t('expenses.manual.gross')}
          <input className="field" inputMode="decimal" value={gross} onChange={(e) => setGross(e.target.value)} />
        </label>
        <label className="lab">
          {t('expenses.manual.net')}
          <input className="field" inputMode="decimal" value={net} onChange={(e) => setNet(e.target.value)} />
        </label>
        <label className="lab">
          {t('expenses.manual.vat')}
          <input className="field" inputMode="decimal" value={vat} onChange={(e) => setVat(e.target.value)} />
        </label>
        <label className="lab">
          {t('expenses.manual.vatRate')}
          <input className="field" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
        </label>
        <label className="lab">
          {t('expenses.manual.account')}
          <input className="field" inputMode="numeric" value={account} onChange={(e) => setAccount(e.target.value)} />
        </label>
        <label className="lab">
          {t('expenses.manual.driveLink')}
          <input className="field" value={driveLink} onChange={(e) => setDriveLink(e.target.value)} />
        </label>
      </div>
      <div className="row acts" style={{ padding: 16 }}>
        <button type="button" className="btn ghost" onClick={onClose}>{t('common.cancel')}</button>
        <button type="button" className="btn" disabled={createManual.isPending} onClick={save}>
          {createManual.isPending ? t('expenses.manual.saving') : t('expenses.manual.save')}
        </button>
      </div>
    </Modal>
  );
}

/**
 * Founder expenses: what arrived in `expenses@`, who paid it, whether the read is
 * complete enough to book itself later — and a way to book or correct it.
 *
 * Booking a claim posts the expense against the founder's liability (3500), not
 * against the bank; the payout is a separate booking from the bank transaction.
 */
export function ClaimsSection({ year, remember = true }: { year: number; remember?: boolean }) {
  const { t } = useLanguage();
  const toast = useToast();
  const utils = trpc.useUtils();
  const me = trpc.me.useQuery();
  const isAdmin = me.data?.user?.role === 'admin';
  const [searchParams] = useSearchParams();
  const highlighted = searchParams.get('claim');

  const claims = trpc.expenses.claims.list.useQuery({ year });
  const founders = trpc.founders.list.useQuery(undefined, { enabled: isAdmin });
  const setIgnored = trpc.expenses.claims.setIgnored.useMutation();
  const assignFounder = trpc.expenses.claims.assignFounder.useMutation();
  const confirm = trpc.expenses.claims.confirm.useMutation();

  const [correcting, setCorrecting] = useState<ClaimToCorrect | null>(null);

  const rows = (claims.data ?? []) as unknown as ClaimRow[];

  /** One click books the claim; on a booked claim this applies a saved correction. */
  async function book(row: ClaimRow) {
    try {
      const result = await confirm.mutateAsync({ id: row.id });
      await utils.expenses.claims.list.invalidate();
      toast.show(t(result.rebooked ? 'expenses.rebooked' : 'expenses.booked'));
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function toggleIgnored(row: ClaimRow) {
    try {
      await setIgnored.mutateAsync({ id: row.id, ignored: row.status !== 'ignored' });
      await utils.expenses.claims.list.invalidate();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function assign(row: ClaimRow, founderId: string) {
    if (!founderId) return;
    try {
      await assignFounder.mutateAsync({ id: row.id, founderId, rememberEmail: remember });
      await utils.expenses.claims.list.invalidate();
      toast.show(t('expenses.assigned'));
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  /** Prefill from what the claim says now — the read, or an earlier correction. */
  function startCorrecting(row: ClaimRow) {
    const parsed = row.parse ?? {};
    setCorrecting({
      id: row.id,
      fileName: row.fileName,
      status: row.status,
      date: parsed.date ?? null,
      vendorName: parsed.vendorName ?? senderName(row.from),
      invoiceNumber: parsed.invoiceNumber ?? '',
      grossCents: parsed.grossCents ?? null,
      netCents: parsed.netCents ?? null,
      vatCents: parsed.vatCents ?? null,
      vatRate: parsed.vatRate ?? null,
      account: parsed.account ?? null,
    });
  }

  return (
    <section className="card flush">
      {claims.isLoading ? (
        <p className="empty">{t('common.loading')}</p>
      ) : rows.length === 0 ? (
        <div className="empty-band">
          <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 2h12v20l-3-2-3 2-3-2-3 2zM9 7h6M9 11h6M9 15h4" />
          </svg>
          <strong>{t('expenses.empty')}</strong>
          <p>{t('expenses.emptyHint')}</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="resp">
            <thead>
              <tr>
                <th>{t('expenses.col.received')}</th>
                <th>{t('expenses.col.founder')}</th>
                <th>{t('expenses.col.receipt')}</th>
                <th>{t('expenses.col.period')}</th>
                <th className="right">{t('expenses.col.amount')}</th>
                <th>{t('expenses.col.file')}</th>
                <th>{t('expenses.col.check')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const parsed = row.parse ?? {};
                const isHighlighted = highlighted === row.id;
                return (
                  <tr
                    key={row.id}
                    id={`claim-${row.id}`}
                    style={{
                      ...(row.status === 'ignored' ? { opacity: 0.55 } : {}),
                      ...(isHighlighted ? { background: 'var(--accent-soft, rgba(255, 214, 0, 0.12))' } : {}),
                    }}
                  >
                    <td data-l={t('expenses.col.received')} className="num">{formatDate(row.receivedAt)}</td>
                    <td data-l={t('expenses.col.founder')}>
                      {row.founder ? (
                        <strong>{row.founder.name}</strong>
                      ) : isAdmin ? (
                        <select
                          className="field"
                          style={{ width: 'auto', minWidth: 140 }}
                          value=""
                          onChange={(e) => assign(row, e.target.value)}
                          aria-label={t('expenses.col.founder')}
                        >
                          <option value="">{t('expenses.assign')}</option>
                          {(founders.data ?? [])
                            .filter((f) => f.active)
                            .map((f) => (
                              <option key={f.id} value={f.id}>{f.name}</option>
                            ))}
                        </select>
                      ) : (
                        <span className="muted">{t('expenses.unknownFounder')}</span>
                      )}
                    </td>
                    <td data-l={t('expenses.col.receipt')} className="w">
                      <div>
                        <strong>{parsed.vendorName || senderName(row.from)}</strong>
                        {parsed.invoiceNumber ? <span className="muted"> · {parsed.invoiceNumber}</span> : null}
                      </div>
                      <div className="rc" style={{ fontSize: 12 }} title={row.subject}>{row.subject}</div>
                      <div>
                        <span className={`badge ${claimStatusClass(row.status)}`}>{t(claimStatusKey(row.status))}</span>
                        {row.corrected ? (
                          <span
                            className="muted"
                            style={{ marginLeft: 8, fontSize: 12 }}
                            title={row.corrected.at ? formatDate(row.corrected.at) : undefined}
                          >
                            {t('expenses.corrected')}
                          </span>
                        ) : null}
                      </div>
                      {row.error ? <div className="rc" style={{ fontSize: 12 }}>{row.error}</div> : null}
                    </td>
                    <td data-l={t('expenses.col.period')} className="num">{row.period}</td>
                    <td data-l={t('expenses.col.amount')} className="num right" style={{ whiteSpace: 'nowrap' }}>
                      {typeof parsed.grossCents === 'number' ? formatEUR(parsed.grossCents) : '—'}
                      {parsed.reverseCharge ? <div className="rc" style={{ fontSize: 12 }}>{t('expenses.reverseCharge')}</div> : null}
                      {typeof parsed.vatCents === 'number' && parsed.vatCents > 0 ? (
                        <div className="rc" style={{ fontSize: 12 }}>
                          {parsed.addressedToCompany ? t('expenses.vatDeductible') : t('expenses.grossOnly')}
                        </div>
                      ) : null}
                    </td>
                    <td data-l={t('expenses.col.file')}>
                      {row.driveLink ? (
                        <a href={row.driveLink} target="_blank" rel="noreferrer">{row.fileName}</a>
                      ) : (
                        <span className="muted">{row.fileName}</span>
                      )}
                    </td>
                    <td data-l={t('expenses.col.check')}>
                      {row.autoBookable?.ok ? (
                        <span className="badge b-paid">{t('expenses.autoBookable')}</span>
                      ) : (
                        <span className="badge b-draft" title={(row.autoBookable?.reasons ?? []).join(' · ')}>
                          {t('expenses.notAutoBookable')}
                        </span>
                      )}
                      {!row.autoBookable?.ok && (row.autoBookable?.reasons?.length ?? 0) > 0 ? (
                        <div className="rc" style={{ fontSize: 12 }}>{row.autoBookable?.reasons.join(' · ')}</div>
                      ) : null}
                    </td>
                    <td>
                      {isAdmin && row.status !== 'payoutPending' && row.status !== 'settled' ? (
                        <>
                          {row.status === 'received' ? (
                            <>
                              <button
                                type="button"
                                className="btn ghost sm"
                                onClick={() => startCorrecting(row)}
                                title={t('expenses.correct')}
                              >
                                {t('expenses.correctLabel')}
                              </button>
                              <button
                                type="button"
                                className="btn sm"
                                disabled={confirm.isPending}
                                onClick={() => book(row)}
                                // A queued claim can still be booked by hand: say why it queued.
                                title={row.autoBookable?.ok ? undefined : (row.autoBookable?.reasons ?? []).join(' · ')}
                              >
                                {confirm.isPending ? t('expenses.booking') : t('expenses.book')}
                              </button>
                            </>
                          ) : null}
                          {row.status === 'booked' ? (
                            <button type="button" className="btn sm" onClick={() => startCorrecting(row)}>
                              {t('expenses.rebook')}
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="btn ghost sm"
                            onClick={() => toggleIgnored(row)}
                            disabled={setIgnored.isPending || row.status === 'payoutPending' || row.status === 'settled'}
                          >
                            {row.status === 'ignored' ? t('expenses.unignore') : t('expenses.ignore')}
                          </button>
                        </>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="hint-strip">{t('expenses.hint')}</p>
      {correcting ? (
        <ClaimCorrectDialog
          claim={correcting}
          booked={correcting.status === 'booked'}
          onClose={() => setCorrecting(null)}
        />
      ) : null}
    </section>
  );
}
