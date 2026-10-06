import { describe, it, expect } from 'vitest';
import { TRPCError } from '@trpc/server';
import { appRouter, buildContext, isServiceTokenValid } from '../trpc';

async function expectTrpcCode(promise: Promise<unknown>, code: string) {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(TRPCError);
    expect((err as TRPCError).code).toBe(code);
    return;
  }
  throw new Error(`expected TRPCError ${code}, but call succeeded`);
}

describe('tRPC auth procedures', () => {
  it('unauthenticated caller → UNAUTHORIZED', async () => {
    const caller = appRouter.createCaller({ user: undefined, serviceAuth: false });
    await expectTrpcCode(caller.me(), 'UNAUTHORIZED');
  });

  it("non-admin user calling adminProcedure → FORBIDDEN (admin → OK)", async () => {
    const userCaller = appRouter.createCaller({
      user: { sub: 'user-id-1', email: 'user@example.de', role: 'user' },
      serviceAuth: false,
    });
    await expectTrpcCode(userCaller.adminPing(), 'FORBIDDEN');

    const adminCaller = appRouter.createCaller({
      user: { sub: 'admin-id-1', email: 'admin@example.de', role: 'admin' },
      serviceAuth: false,
    });
    await expect(adminCaller.adminPing()).resolves.toEqual({ ok: true });
  });

  it('wrong service token → UNAUTHORIZED', async () => {
    expect(isServiceTokenValid('wrong-token', 'correct-token')).toBe(false);
    const caller = appRouter.createCaller({ user: undefined, serviceAuth: false });
    await expectTrpcCode(caller.servicePing(), 'UNAUTHORIZED');
  });

  it('correct service token → OK', async () => {
    expect(isServiceTokenValid('correct-token', 'correct-token')).toBe(true);
    const caller = appRouter.createCaller({ user: undefined, serviceAuth: true });
    await expect(caller.servicePing()).resolves.toEqual({ ok: true });
  });

  it.each([
    ['wrong token', 'Bearer wrong-token'],
    ['empty header', undefined],
    ['empty bearer', 'Bearer '],
    ['mismatched length', 'Bearer short'],
  ])('buildContext with %s → serviceAuth false + servicePing UNAUTHORIZED', async (_label, authHeader) => {
    const ctx = buildContext({ authHeader, serviceToken: 'correct-token-long-enough' });
    expect(ctx.serviceAuth).toBe(false);
    const caller = appRouter.createCaller(ctx);
    await expectTrpcCode(caller.servicePing(), 'UNAUTHORIZED');
  });
});
