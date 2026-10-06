import 'dotenv/config';
import { connectMongo } from './db/mongo';
import { setDbStatus } from './health';
import { createApp } from './app';
import { initFileInvoiceQueue } from './jobs/queue';

const app = createApp();
const PORT = Number(process.env.PORT ?? 3000);

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));

connectMongo()
  .then(() => {
    setDbStatus('connected');
    if (process.env.REDIS_URL || process.env.VALKEY_URL) {
      initFileInvoiceQueue();
      console.log('File-invoice queue started');
    }
  })
  .catch(err => console.error('MongoDB connection failed:', err));
