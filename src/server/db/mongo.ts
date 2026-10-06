import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

let mongod: MongoMemoryServer | null = null;

export async function connectMongo(): Promise<void> {
  if (mongoose.connection.readyState !== 0) {
    return; // already connected or connecting
  }

  const uri = process.env.MONGO_URI;

  if (uri) {
    const maxRetries = 10;
    let retries = 0;

    while (retries < maxRetries) {
      try {
        await mongoose.connect(uri, {
          serverSelectionTimeoutMS: 5000,
        });
        const host = new URL(uri).host;
        console.log('MongoDB connected:', host);
        return;
      } catch (err) {
        retries++;
        console.warn(`MongoDB connection attempt ${retries}/${maxRetries} failed: ${(err as any).message}. Retrying in 5s...`);
        if (retries >= maxRetries) {
          throw err;
        }
        await new Promise(res => setTimeout(res, 5000));
      }
    }
  } else {
    mongod = await MongoMemoryServer.create();
    const memUri = mongod.getUri();
    await mongoose.connect(memUri);
    console.log('MongoDB in-memory server started');
  }
}

export function supportsTransactions(): boolean {
  const isTest = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
  const isDev = process.env.NODE_ENV === 'development';
  if (isTest || isDev) return false;
  if (process.env.MONGODB_DISABLE_TRANSACTIONS === 'true') return false;
  return true;
}

export async function disconnectMongo(): Promise<void> {
  await mongoose.disconnect();
  if (mongod) {
    await mongod.stop();
    mongod = null;
  }
}
