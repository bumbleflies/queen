import express from 'express';
import path from 'path';
import { healthHandler } from './health';

// Scaffold app: health only. Auth, tRPC routers and job queues land in Task 2+.

export function createApp() {
  const app = express();

  app.use(express.json());

  app.get('/health', healthHandler);

  // Serve built client in production
  if (process.env.NODE_ENV === 'production') {
    const clientDir = path.join(__dirname, '../..');
    app.use(express.static(clientDir));
    app.get('/*splat', (req, res, next) => {
      if (req.url.startsWith('/trpc') || req.url.startsWith('/auth')) {
        return next();
      }
      res.sendFile(path.join(clientDir, 'index.html'));
    });
  }

  return app;
}
