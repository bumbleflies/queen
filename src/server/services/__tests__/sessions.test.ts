import { describe, it, expect, beforeEach, type TaskContext } from 'vitest';
import mongoose from 'mongoose';
import { User } from '../../models/User';
import { assertSessionValid, signToken, verifyToken } from '../AuthService';

function dbReady(ctx: TaskContext): boolean {
  if (mongoose.connection.readyState === 1) return true;
  ctx.skip();
  return false;
}

beforeEach(async () => {
  if (mongoose.connection.readyState === 1) await User.deleteMany({});
});

describe('session tokens', () => {
  it('google token has no tv and survives a bump', async (ctx) => {
    if (!dbReady(ctx)) return;
    const user = await User.create({ email: 'g@bumbleflies.de', role: 'admin', googleId: 'g1' });
    const payload = verifyToken(
      signToken({ sub: String(user._id), email: 'g@bumbleflies.de', role: 'admin' }),
    );
    expect(payload.tv).toBeUndefined();
    await assertSessionValid(payload); // never touches the DB
    await User.updateOne({ _id: user._id }, { $inc: { tokenVersion: 1 } });
    await expect(assertSessionValid(payload)).resolves.toBeUndefined();
  });

  it('invited token carries tv and is rejected after a bump', async (ctx) => {
    if (!dbReady(ctx)) return;
    const user = await User.create({ email: 'a@example.de', role: 'user' });
    const token = signToken(
      { sub: String(user._id), email: 'a@example.de', role: 'user', tv: 0 },
      { expiresInSeconds: 30 * 24 * 3600 },
    );
    const payload = verifyToken(token);
    expect(payload.tv).toBe(0);
    await expect(assertSessionValid(payload)).resolves.toBeUndefined();
    await User.updateOne({ _id: user._id }, { $inc: { tokenVersion: 1 } });
    await expect(assertSessionValid(payload)).rejects.toThrow(/revoked/);
  });

  it('invited token is rejected when the user is disabled', async (ctx) => {
    if (!dbReady(ctx)) return;
    const user = await User.create({ email: 'b@example.de', role: 'user', disabled: true });
    const payload = verifyToken(
      signToken({ sub: String(user._id), email: 'b@example.de', role: 'user', tv: 0 }),
    );
    await expect(assertSessionValid(payload)).rejects.toThrow(/revoked/);
  });

  it('rejects a token whose tv is not a non-negative integer', () => {
    expect(() =>
      verifyToken(signToken({ sub: 'x', email: 'x@y.de', role: 'user', tv: -1 })),
    ).toThrow(/invalid token payload/);
    expect(() =>
      verifyToken(signToken({ sub: 'x', email: 'x@y.de', role: 'user', tv: 1.5 })),
    ).toThrow(/invalid token payload/);
  });
});
