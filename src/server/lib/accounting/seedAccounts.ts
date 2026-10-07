import { Account } from '../../models/Account';
import { SKR04_ACCOUNTS } from './skr04';

/** Insert missing seed accounts; never touches existing ones (renames survive). */
export async function seedAccounts(): Promise<number> {
  const res = await Account.bulkWrite(
    SKR04_ACCOUNTS.map((a) => ({
      updateOne: {
        filter: { number: a.number },
        update: { $setOnInsert: { ...a, archived: false } },
        upsert: true,
      },
    })),
  );
  return res.upsertedCount;
}
