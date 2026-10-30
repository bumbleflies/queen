import 'dotenv/config';
import { connectMongo } from './db/mongo';
import { setDbStatus } from './health';
import { createApp } from './app';
import { initFileInvoiceQueue } from './jobs/queue';
import { seedAccounts } from './lib/accounting/seedAccounts';

const app = createApp();
const PORT = Number(process.env.PORT ?? 3000);

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));

connectMongo()
  .then(() => {
    setDbStatus('connected');
    seedAccounts()
      .then((n) => n > 0 && console.log(`Seeded ${n} SKR04 accounts`))
      .catch((err) => console.error('Account seed failed:', err));
    if (process.env.REDIS_URL || process.env.VALKEY_URL) {
      initFileInvoiceQueue();
      console.log('File-invoice queue started');
    }
  })
  .catch(err => console.error('MongoDB connection failed:', err));
