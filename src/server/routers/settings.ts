import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, authedProcedure, adminProcedure } from '../trpcInit';
import {
  getInvoicesFolder,
  getReceiptsFolder,
  setDriveFolders,
  type FolderRef,
} from '../services/appSettings';
import { driveForUser } from '../services/driveForUser';

const folderSchema = z.object({
  id: z.string().min(1).max(512),
  name: z.string().max(512).nullable().optional(),
});

export const settingsRouter = router({
  getDriveFolders: authedProcedure.query(async () => {
    const [invoices, receipts] = await Promise.all([getInvoicesFolder(), getReceiptsFolder()]);
    return { invoices, receipts };
  }),

  /** Live subfolder listing for the folder picker. Uses the current user's Drive auth. */
  browseDriveFolders: authedProcedure
    .input(z.object({ parentId: z.string().min(1).max(512).default('root') }))
    .query(async ({ input, ctx }) => {
      const drive = await driveForUser(ctx.user.sub);
      try {
        const res = await drive.files.list({
          q:
            `'${input.parentId.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}' in parents` +
            ` and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
          fields: 'files(id, name)',
          spaces: 'drive',
          pageSize: 1000,
          // shared drives (if any) are visible too
          includeItemsFromAllDrives: true,
          supportsAllDrives: true,
        });
        return (res.data.files ?? [])
          .filter((f): f is { id: string; name: string } => !!f.id && !!f.name)
          .sort((a, b) => a.name.localeCompare(b.name));
      } catch (err) {
        throw new TRPCError({
          code: 'BAD_GATEWAY',
          message: `Drive nicht erreichbar: ${(err as Error).message}`,
        });
      }
    }),

  setDriveFolders: adminProcedure
    .input(z.object({
      invoices: folderSchema.nullable().optional(),
      receipts: folderSchema.nullable().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const pick = (f: { id: string; name?: string | null } | null | undefined): FolderRef | null | undefined =>
        f === undefined ? undefined : f ? { id: f.id, name: f.name ?? null } : null;
      await setDriveFolders(
        { invoices: pick(input.invoices), receipts: pick(input.receipts) },
        ctx.user.sub,
      );
      const [invoices, receipts] = await Promise.all([getInvoicesFolder(), getReceiptsFolder()]);
      return { invoices, receipts };
    }),
});
