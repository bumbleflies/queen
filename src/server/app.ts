import express from 'express';
import cookieParser from 'cookie-parser';
import passport from 'passport';
import path from 'path';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import { healthHandler } from './health';
import { appRouter, buildContext } from './trpc';
import { AUTH_COOKIE, createAuthRouter, initPassport } from './routes/auth';

initPassport();

export function createApp() {
  const app = express();

  app.use(express.json());
  app.use(cookieParser());
  app.use(passport.initialize());

  app.get('/health', healthHandler);

  app.use('/auth', createAuthRouter());

  app.use(
    '/trpc',
    createExpressMiddleware({
      router: appRouter,
      createContext: ({ req }) =>
        buildContext({
          authHeader: req.headers.authorization,
          cookieToken: req.cookies?.[AUTH_COOKIE] as string | undefined,
          serviceToken: process.env.QUEEN_SERVICE_TOKEN,
        }),
    }),
  );

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
