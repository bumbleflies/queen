import 'dotenv/config';
import { connectMongo, disconnectMongo } from '../db/mongo';
import { isCliEntrypoint } from '../lib/reconcile';
import { rematchBills, resolveBillIntakeDeps, runBillIntake } from '../jobs/billIntake';
import { resolveExpenseIntakeDeps, runExpenseIntake } from '../jobs/expenseIntake';

/**
 * Expense-intake pass: the same hourly slot as the bills pass, but a separate
 * mailbox (`expenses@`) and a separate failure domain — a broken expense read
 * must never stop bills from being filed.
 */
async function expensePass(): Promise<void> {
  try {
    const deps = await resolveExpenseIntakeDeps();
    const result = await runExpenseIntake(deps);
    console.log(
      `Expense intake done: messages=${result.messages} attachments=${result.attachments} ` +
        `created=${result.created} skipped=${result.skipped} noText=${result.noText} failed=${result.failed} ` +
        `notified=${result.notified}`,
    );
    for (const error of result.errors) console.warn(`Expense intake: ${error}`);
    if (result.failed > 0) process.exitCode = 1;

    if (result.notified > 0) {
      console.log(`Expense intake confirmation sent: ${result.notified}`);
    }
    for (const error of result.notifyErrors) {
      console.warn(`Expense intake confirmation not sent: ${error}`);
    }
  } catch (err) {
    // Not configured (no receipts folder / no Google access) is a warning here,
    // not a reason to mark the bills run red.
    console.warn(`Expense intake skipped: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Bill-intake entrypoint for the scheduler (Ofelia job-exec, hourly). Reads the
 * `bills` mailbox, files each PDF as a receipt and stores what it said; never
 * books and never creates rules. `runBillIntake` also answers every mail that
 * produced a bill, in that mail's own thread — the same job the "Jetzt abrufen"
 * button runs. A reply is a notification, so failing to send one only warns.
 */
async function main(): Promise<void> {
  await connectMongo();
  try {
    const deps = await resolveBillIntakeDeps();
    const result = await runBillIntake(deps);
    console.log(
      `Bill intake done: messages=${result.messages} attachments=${result.attachments} ` +
        `created=${result.created} skipped=${result.skipped} noText=${result.noText} failed=${result.failed} ` +
        `notified=${result.notified}`,
    );
    for (const error of result.errors) console.warn(`Bill intake: ${error}`);
    if (result.failed > 0) process.exitCode = 1;

    if (result.notified > 0) {
      console.log(`Bill intake confirmation sent: ${result.notified}`);
    }
    for (const error of result.notifyErrors) {
      console.warn(`Bill intake confirmation not sent: ${error}`);
    }

    await expensePass();

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
