import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { google } from 'googleapis';
import { router, adminProcedure } from '../trpcInit';
import { buildImportPlan } from '../lib/sheetImport';
import { applySheetImport, type DriveFileRef } from '../lib/applySheetImport';
import { getGoogleAccessTokenForUser } from '../services/AuthService';
import { createOAuth2Client } from '../services/DriveService';
import { createInvoicePdfFinder, type DriveListLike } from '../services/driveLookup';
import { Invoice } from '../models/Invoice';

const linkDriveFilesSchema = z.object({
  links: z
    .array(
      z.object({
        invoiceNumber: z.string().min(1),
        fileId: z.string().min(1),
        link: z.string().url().optional(),
        fileName: z.string().min(1).optional(),
      }),
    )
    .min(1),
  dryRun: z.boolean().default(true),
});

const importSheetSchema = z.object({
  clientsCsv: z.string().min(1),
  invoicesCsv: z.string().min(1),
  positionsCsv: z.string().min(1),
  dryRun: z.boolean().default(true),
});

/** Read-only Drive lookup in the invoices folder tree using the caller's refresh token. */
async function driveResolver(
  userId: string,
  folderId: string,
): Promise<(fileName: string) => Promise<DriveFileRef | null>> {
  const { accessToken, refreshToken } = await getGoogleAccessTokenForUser(userId);
  const auth = createOAuth2Client(refreshToken);
  auth.setCredentials({ refresh_token: refreshToken, access_token: accessToken });
  const drive = google.drive({ version: 'v3', auth });
  return createInvoicePdfFinder(drive as unknown as DriveListLike, folderId);
}

export const adminRouter = router({
  /** One-off migration from the ledger Sheet (CSV export per tab). Dry run by default. */
  importSheet: adminProcedure.input(importSheetSchema).mutation(async ({ input, ctx }) => {
    let plan;
    try {
      plan = buildImportPlan(input);
    } catch (err) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: (err as Error).message });
    }

    const folderId = process.env.GOOGLE_DRIVE_INVOICES_FOLDER_ID;
    const warnings = [...plan.warnings];
    let resolveDriveFile: ((fileName: string) => Promise<DriveFileRef | null>) | undefined;
    if (folderId) {
      try {
        resolveDriveFile = await driveResolver(ctx.user.sub, folderId);
      } catch (err) {
        warnings.push(`Drive lookup unavailable: ${(err as Error).message}`);
      }
    } else {
      warnings.push('Drive lookup skipped: GOOGLE_DRIVE_INVOICES_FOLDER_ID is not set');
    }

    if (!input.dryRun && plan.errors.length > 0) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Import plan has errors: ${plan.errors.join('; ')}`,
      });
    }
    const report = await applySheetImport(plan, {
      dryRun: input.dryRun,
      folderId,
      resolveDriveFile,
    });
    return { ...report, warnings, errors: plan.errors, mismatches: plan.mismatches };
  }),

  /**
   * Attach already-filed Drive PDFs to invoices (Sheet-import backfill; queen's
   * drive.file scope cannot see them). Never overwrites an existing fileId.
   */
  linkDriveFiles: adminProcedure.input(linkDriveFilesSchema).mutation(async ({ input }) => {
    const updated: string[] = [];
    const skipped: { invoiceNumber: string; reason: string }[] = [];
    for (const l of input.links) {
      const invoice = await Invoice.findOne({ invoiceNumber: l.invoiceNumber });
      if (!invoice) {
        skipped.push({ invoiceNumber: l.invoiceNumber, reason: 'not found' });
        continue;
      }
      if (invoice.driveMetadata?.fileId) {
        skipped.push({ invoiceNumber: l.invoiceNumber, reason: 'already linked' });
        continue;
      }
      updated.push(l.invoiceNumber);
      if (input.dryRun) continue;
      invoice.driveMetadata = {
        ...invoice.driveMetadata,
        fileId: l.fileId,
        link: l.link ?? `https://drive.google.com/file/d/${l.fileId}/view`,
        fileName: l.fileName ?? invoice.driveMetadata?.fileName,
      };
      await invoice.save();
    }
    return { dryRun: input.dryRun, updated, skipped };
  }),
});
