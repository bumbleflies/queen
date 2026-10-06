import { router, publicProcedure, authedProcedure, adminProcedure, serviceProcedure } from './trpcInit';
import { clientsRouter } from './routers/clients';
import { invoicesRouter } from './routers/invoices';
import { bankRouter } from './routers/bank';
import { reconcileRouter } from './routers/reconcile';
import { reportsRouter } from './routers/reports';

export * from './trpcInit';

// Domain routers mount here (clients/invoices in Task 4; bank/reconcile/ext later).
export const appRouter = router({
  ping: publicProcedure.query(() => ({ ok: true as const })),
  me: authedProcedure.query(({ ctx }) => ({ user: ctx.user })),
  adminPing: adminProcedure.query(() => ({ ok: true as const })),
  servicePing: serviceProcedure.query(() => ({ ok: true as const })),
  clients: clientsRouter,
  invoices: invoicesRouter,
  bank: bankRouter,
  reconcile: reconcileRouter,
  reports: reportsRouter,
});

export type AppRouter = typeof appRouter;
