import 'dotenv/config';
import { connectMongo, disconnectMongo } from '../db/mongo';
import { isCliEntrypoint } from '../lib/reconcile';
import { resolveBillIntakeDeps, runBillIntake } from '../jobs/billIntake';

/**
 * Bill-intake entrypoint for the scheduler (Ofelia job-exec, after the GLS
 * import). Reads the `bills` mailbox, files each PDF as a receipt and stores
 * what it said; never books and never creates rules.
 */
async function main(): Promise<void> {
  await connectMongo();
  try {
    const result = await runBillIntake(await resolveBillIntakeDeps());
    console.log(
      `Bill intake done: messages=${result.messages} attachments=${result.attachments} ` +
        `created=${result.created} skipped=${result.skipped} noText=${result.noText} failed=${result.failed}`,
    );
    for (const error of result.errors) console.warn(`Bill intake: ${error}`);
    if (result.failed > 0) process.exitCode = 1;
  } finally {
    await disconnectMongo();
  }
}

if (isCliEntrypoint(process.argv[1])) {
  void main().catch((err: unknown) => {
    console.error(`Bill intake failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  });
}
