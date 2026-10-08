import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, authedProcedure } from '../trpcInit';
import { BankTransaction } from '../models/BankTransaction';
import { Supplier } from '../models/Supplier';
import { rankReceipts } from '../lib/accounting/receipts';
import { listReceiptFiles } from '../services/receiptsDrive';
import { driveForUser } from '../services/driveForUser';
import { getReceiptsFolder } from '../services/appSettings';

export const receiptsRouter = router({
  list: authedProcedure
    .input(z.object({ year: z.number().int().min(2000).max(2100), bankTxId: z.string().optional() }))
    .query(async ({ input, ctx }) => {
      const folder = await getReceiptsFolder();
      if (!folder) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Kein Belege-Ordner gewählt (Einstellungen)' });
      }
      let files;
      try {
        files = await listReceiptFiles(await driveForUser(ctx.user.sub), folder.id, input.year);
      } catch (err) {
        throw new TRPCError({ code: 'BAD_GATEWAY', message: `Drive nicht erreichbar: ${(err as Error).message}` });
      }
      const tx = input.bankTxId ? await BankTransaction.findById(input.bankTxId) : null;
      if (!tx) return files.map((f) => ({ ...f, score: 0 })).sort((a, b) => a.name.localeCompare(b.name));
      const supplier = tx.supplierId ? await Supplier.findById(tx.supplierId) : null;
      return rankReceipts(files, tx, supplier?.name);
    }),
});
