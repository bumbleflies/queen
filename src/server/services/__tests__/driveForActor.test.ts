import { describe, it, expect, beforeEach, vi, type TaskContext } from 'vitest';
import mongoose from 'mongoose';
import { User } from '../../models/User';
import { Setting } from '../../models/Setting';
import { driveAccessForActor } from '../driveForUser';

const getGoogleAccessTokenForUser = vi.hoisted(() =>
  vi.fn(async (userId: string) => ({
    accessToken: `at-${userId}`,
    refreshToken: `rt-${userId}`,
  })),
);

vi.mock('../AuthService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../AuthService')>();
  return { ...actual, getGoogleAccessTokenForUser };
});

function dbReady(ctx: TaskContext): boolean {
  if (mongoose.connection.readyState === 1) return true;
  ctx.skip();
  return false;
}

beforeEach(async () => {
  if (mongoose.connection.readyState !== 1) return;
  await User.deleteMany({});
  await Setting.deleteMany({});
  getGoogleAccessTokenForUser.mockClear();
  getGoogleAccessTokenForUser.mockImplementation(async (userId: string) => ({
    accessToken: `at-${userId}`,
    refreshToken: `rt-${userId}`,
  }));
});

describe('driveAccessForActor', () => {
  it("uses the user's own token when present", async (ctx) => {
    if (!dbReady(ctx)) return;
    const user = await User.create({
      email: 'a@bumbleflies.de',
      role: 'admin',
      googleId: 'g',
      refreshToken: 'rt-own',
    });
    const access = await driveAccessForActor(String(user._id));
    expect(access).toEqual({
      accessToken: `at-${user._id}`,
      refreshToken: `rt-${user._id}`,
    });
    expect(getGoogleAccessTokenForUser).toHaveBeenCalledWith(String(user._id));
  });

  it('falls back to the Drive-settings admin for a user without a refresh token', async (ctx) => {
    if (!dbReady(ctx)) return;
    const invited = await User.create({ email: 'steuer@example.de', role: 'user' });
    await Setting.create({ key: 'drive', updatedBy: 'admin-id-1' });
    const access = await driveAccessForActor(String(invited._id));
    expect(access.refreshToken).toBe('rt-admin-id-1');
    expect(getGoogleAccessTokenForUser).toHaveBeenCalledWith('admin-id-1');
  });

  it('raises PRECONDITION_FAILED when nothing is configured', async (ctx) => {
    if (!dbReady(ctx)) return;
    const invited = await User.create({ email: 'steuer@example.de', role: 'user' });
    await expect(driveAccessForActor(String(invited._id))).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });
  });

  it('does not fall back when the user has a token that fails', async (ctx) => {
    if (!dbReady(ctx)) return;
    const user = await User.create({
      email: 'a@bumbleflies.de',
      role: 'admin',
      googleId: 'g',
      refreshToken: 'rt-own',
    });
    await Setting.create({ key: 'drive', updatedBy: 'admin-id-1' });
    getGoogleAccessTokenForUser.mockRejectedValueOnce(new Error('invalid_grant'));
    await expect(driveAccessForActor(String(user._id))).rejects.toThrow(/invalid_grant/);
    expect(getGoogleAccessTokenForUser).toHaveBeenCalledTimes(1);
  });

  it('raises PRECONDITION_FAILED when the fallback admin token is dead', async (ctx) => {
    if (!dbReady(ctx)) return;
    const invited = await User.create({ email: 'steuer@example.de', role: 'user' });
    await Setting.create({ key: 'drive', updatedBy: 'admin-id-1' });
    getGoogleAccessTokenForUser.mockRejectedValueOnce(new Error('invalid_grant'));
    await expect(driveAccessForActor(String(invited._id))).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });
  });
});
