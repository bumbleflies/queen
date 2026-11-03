import 'dotenv/config';
import { connectMongo, disconnectMongo } from '../db/mongo';
import { isCliEntrypoint } from '../lib/reconcile';
import {
  intakeAppUrl,
  rematchBills,
  resolveBillIntakeDeps,
  runBillIntake,
  sendIntakeConfirmation,
} from '../jobs/billIntake';

/**
 * Bill-intake entrypoint for the scheduler (Ofelia job-exec, hourly). Reads the
 * `bills` mailbox, files each PDF as a receipt and stores what it said; never
 * books and never creates rules. After a run that filed something it mails a
 * short summary back to the same mailbox — that mail is a notification, so a
 * failure to send it never fails the intake.
 */
async function main(): Promise<void> {
  await connectMongo();
  try {
    const deps = await resolveBillIntakeDeps();
    const result = await runBillIntake(deps);
    console.log(
      `Bill intake done: messages=${result.messages} attachments=${result.attachments} ` +
        `created=${result.created} skipped=${result.skipped} noText=${result.noText} failed=${result.failed}`,
    );
    for (const error of result.errors) console.warn(`Bill intake: ${error}`);
    if (result.failed > 0) process.exitCode = 1;

    try {
      const mailId = await sendIntakeConfirmation(result, {
        gmail: deps.gmail,
        to: deps.mailbox,
        appUrl: intakeAppUrl(),
      });
      if (mailId) console.log(`Bill intake confirmation sent: ${mailId}`);
    } catch (err) {
      console.warn(`Bill intake confirmation not sent: ${err instanceof Error ? err.message : String(err)}`);
    }

    const rematch = await rematchBills();
    console.log(
      `Bill rematch done: linked=${rematch.linked} skipped=${rematch.skipped}`,
    );
    for (const error of rematch.errors) console.warn(`Bill rematch: ${error}`);
  } finally {
    await disconnectMongo();
  }
}

if (isCliEntrypoint(process.argv[1], 'billIntake')) {
  void main().catch((err: unknown) => {
    console.error(`Bill intake failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  });
}
