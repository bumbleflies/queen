import { router, adminProcedure } from '../trpcInit';
import { ReconcileRun } from '../models/ReconcileRun';
import { runReconcile } from '../cron/reconcile';

export const reconcileRouter = router({
  /** The most recent reconcile run (successful or not). */
  status: adminProcedure.query(async () => ReconcileRun.findOne().sort({ startedAt: -1 })),

  /** Trigger a sync + match pass now and return the resulting run. */
  runNow: adminProcedure.mutation(async () => runReconcile()),
});
