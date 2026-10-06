import crypto from 'crypto';
import { initTRPC, TRPCError } from '@trpc/server';
import type { JwtPayload } from '../shared/types';
import { verifyToken } from './services/AuthService';

export interface Context {
  user?: JwtPayload;
  serviceAuth: boolean;
}

// Constant-time service-token compare — never plain === on secrets.
export function isServiceTokenValid(
  provided: string | undefined,
  expected: string | undefined,
): boolean {
  if (!provided || !expected) {
    return false;
  }
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) {
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

function bearerToken(authHeader: string | undefined): string | undefined {
  if (!authHeader) {
    return undefined;
  }
  const [scheme, token] = authHeader.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    return undefined;
  }
  return token;
}

// Pure, unit-testable context builder. The bearer token is either the
// QUEEN_SERVICE_TOKEN (→ serviceAuth) or a user JWT (→ user).
export function buildContext(options: {
  authHeader?: string;
  cookieToken?: string;
  serviceToken?: string;
}): Context {
  const bearer = bearerToken(options.authHeader);
  if (bearer && isServiceTokenValid(bearer, options.serviceToken)) {
    return { user: undefined, serviceAuth: true };
  }
  const jwt = bearer ?? options.cookieToken;
  if (jwt) {
    try {
      return { user: verifyToken(jwt), serviceAuth: false };
    } catch {
      return { user: undefined, serviceAuth: false };
    }
  }
  return { user: undefined, serviceAuth: false };
}

const t = initTRPC.context<Context>().create();

export const router = t.router;
export const publicProcedure = t.procedure;

export const authedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: 'UNAUTHORIZED' });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});

export const adminProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: 'UNAUTHORIZED' });
  }
  if (ctx.user.role !== 'admin') {
    throw new TRPCError({ code: 'FORBIDDEN' });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});

export const serviceProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.serviceAuth) {
    throw new TRPCError({ code: 'UNAUTHORIZED' });
  }
  return next({ ctx });
});

// Minimal app router; domain routers land in later tasks.
export const appRouter = router({
  ping: publicProcedure.query(() => ({ ok: true as const })),
  me: authedProcedure.query(({ ctx }) => ({ user: ctx.user })),
  adminPing: adminProcedure.query(() => ({ ok: true as const })),
  servicePing: serviceProcedure.query(() => ({ ok: true as const })),
});

export type AppRouter = typeof appRouter;
