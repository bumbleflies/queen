import { beforeAll, afterAll } from 'vitest';
import { connectMongo, disconnectMongo } from '../server/db/mongo';

// Connect to MongoDB before all tests (gracefully handle errors).
// MONGO_URI unset → mongodb-memory-server (in-memory, no external service needed).
beforeAll(async () => {
  try {
    await connectMongo();
  } catch (err: any) {
    console.warn('Failed to connect to MongoDB for tests:', err.message);
    // Continue anyway - some tests don't need the database
  }
});

// Disconnect from MongoDB after all tests
afterAll(async () => {
  try {
    await disconnectMongo();
  } catch (err: any) {
    // Ignore disconnect errors
  }
});
