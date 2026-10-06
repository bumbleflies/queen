import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { google } from 'googleapis';
import { router, adminProcedure } from '../trpcInit';
import { buildImportPlan } from '../lib/sheetImport';
import { applySheetImport, type DriveFileRef } from '../lib/applySheetImport';
import { getGoogleAccessTokenForUser } from '../services/AuthService';
import { createOAuth2Client } from '../services/DriveService';

const importSheetSchema = z.object({
  clientsCsv: z.string().min(1),
  invoicesCsv: z.string().min(1),
  positionsCsv: z.string().min(1),
  dryRun: z.boolean().default(true),
});

function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/** Read-only Drive lookup in the invoices folder using the caller's refresh token. */
async function driveResolver(
  userId: string,
  folderId: string,
): Promise<(fileName: string) => Promise<DriveFileRef | null>> {
  const { accessToken, refreshToken } = await getGoogleAccessTokenForUser(userId);
  const auth = createOAuth2Client(refreshToken);
  auth.setCredentials({ refresh_token: refreshToken, access_token: accessToken });
  const drive = google.drive({ version: 'v3', auth });
  return async (fileName) => {
    const res = await drive.files.list({
      q: `'${escapeDriveQueryValue(folderId)}' in parents and name = '${escapeDriveQueryValue(
        fileName,
      )}' and trashed = false`,
      fields: 'files(id, webViewLink)',
      spaces: 'drive',
    });
    const file = res.data.files?.[0];
    return file?.id ? { fileId: file.id, link: file.webViewLink ?? '' } : null;
  };
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
});
