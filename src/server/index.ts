import 'dotenv/config';
import { connectMongo } from './db/mongo';
import { setDbStatus } from './health';
import { createApp } from './app';

const app = createApp();
const PORT = Number(process.env.PORT ?? 3000);

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));

connectMongo()
  .then(() => { setDbStatus('connected'); })
  .catch(err => console.error('MongoDB connection failed:', err));
