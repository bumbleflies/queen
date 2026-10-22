import { router, authedProcedure } from '../trpcInit';
import { ReconcileRun } from '../models/ReconcileRun';
import { runReconcile } from '../cron/reconcile';

export const reconcileRouter = router({
  /** The most recent reconcile run (successful or not). */
  status: authedProcedure.query(async () => ReconcileRun.findOne().sort({ startedAt: -1 })),

  /** Trigger a sync + match (+ auto-book) pass now and return the run; receipt reading stays with the cron (too slow for a request). */
  runNow: authedProcedure.mutation(async () => runReconcile({ readReceipts: false })),
});
