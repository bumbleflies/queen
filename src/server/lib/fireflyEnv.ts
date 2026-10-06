import { ReconcileRun } from '../models/ReconcileRun';

export interface FireflyEnv {
  baseUrl: string;
  pat: string;
  glsAccountId: string;
  bankStart: Date;
}

/** Read and validate the Firefly/GLS environment. Throws with a clear message when unset. */
export function readFireflyEnv(): FireflyEnv {
  const baseUrl = process.env.FIREFLY_URL;
  const pat = process.env.FIREFLY_PAT;
  const glsAccountId = process.env.FIREFLY_GLS_ACCOUNT_ID;
  const bankStartRaw = process.env.QUEEN_BANK_START;
  if (!baseUrl || !pat || !glsAccountId || !bankStartRaw) {
    throw new Error(
      'Firefly not configured (FIREFLY_URL, FIREFLY_PAT, FIREFLY_GLS_ACCOUNT_ID, QUEEN_BANK_START)',
    );
  }
  const bankStart = new Date(bankStartRaw);
  if (Number.isNaN(bankStart.getTime())) {
    throw new Error(`QUEEN_BANK_START is not a valid date: ${bankStartRaw}`);
  }
  return { baseUrl, pat, glsAccountId, bankStart };
}

/** Most recent run that finished without an error. */
export async function findLastSuccessfulRun() {
  return ReconcileRun.findOne({
    finishedAt: { $ne: null },
    $or: [{ error: { $exists: false } }, { error: null }],
  }).sort({ finishedAt: -1 });
}
