import { router, authedProcedure } from '../trpcInit';
import { ReconcileRun } from '../models/ReconcileRun';
import { runReconcile } from '../cron/reconcile';

export const reconcileRouter = router({
  /** The most recent reconcile run (successful or not). */
  status: authedProcedure.query(async () => ReconcileRun.findOne().sort({ startedAt: -1 })),

  /** Trigger a sync + match pass now and return the resulting run. */
  runNow: authedProcedure.mutation(async () => runReconcile()),
});
