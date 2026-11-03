import 'dotenv/config';
import { connectMongo, disconnectMongo } from '../db/mongo';
import { runEmailIntake } from '../jobs/emailIntake';

async function main(): Promise<void> {
  await connectMongo();
  try {
    await runEmailIntake();
  } finally {
    await disconnectMongo();
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error('Email intake failed:', err);
    process.exitCode = 1;
  });
}