import { describe, it, expect, beforeAll, beforeEach, type TaskContext } from 'vitest';
import mongoose from 'mongoose';
import { appRouter } from '../../trpc';
import { User } from '../../models/User';
import { hashInviteToken } from '../../lib/inviteToken';

function adminCaller() {
  return appRouter.createCaller({
    user: { sub: 'admin-id-1', email: 'admin@example.de', role: 'admin' },
    serviceAuth: false,
  });
}

function userCaller(id = 'user-id-1') {
  return appRouter.createCaller({
    user: { sub: id, email: 'user@example.de', role: 'user' },
    serviceAuth: false,
  });
}

function dbReady(ctx: TaskContext): boolean {
  if (mongoose.connection.readyState === 1) return true;
  ctx.skip();
  return false;
}

beforeAll(() => {
  process.env.CLIENT_URL = 'https://queen.example.de';
});

beforeEach(async () => {
  if (mongoose.connection.readyState === 1) await User.deleteMany({});
});

describe('users router', () => {
  it('is admin-only', async (ctx) => {
    if (!dbReady(ctx)) return;
    await expect(userCaller().users.list()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(userCaller().users.invite({ email: 'x@example.de' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('creates an invite and stores only the hash', async (ctx) => {
    if (!dbReady(ctx)) return;
    const res = await adminCaller().users.invite({ email: 'Steuer@Example.de', role: 'user' });
    expect(res.url).toMatch(/^https:\/\/queen\.example\.de\/invite#[A-Za-z0-9_-]{43}$/);
    const token = res.url.split('#')[1]!;
    const user = await User.findOne({ email: 'steuer@example.de' });
    expect(user?.get('inviteTokenHash')).toBe(hashInviteToken(token));
    expect(JSON.stringify(user?.toObject())).not.toContain(token);
    expect(user?.get('inviteExpiresAt')).toBeInstanceOf(Date);
    expect(user?.get('invitedBy')).toBe('admin-id-1');
    expect(user?.get('role')).toBe('user');
    expect(res.ttlHours).toBe(168);
  });

  it('re-inviting replaces the hash and kills the old link', async (ctx) => {
    if (!dbReady(ctx)) return;
    const first = await adminCaller().users.invite({ email: 'a@example.de' });
    const second = await adminCaller().users.invite({ email: 'a@example.de' });
    const user = await User.findOne({ email: 'a@example.de' });
    const oldToken = first.url.split('#')[1]!;
    const newToken = second.url.split('#')[1]!;
    expect(user?.get('inviteTokenHash')).toBe(hashInviteToken(newToken));
    expect(user?.get('inviteTokenHash')).not.toBe(hashInviteToken(oldToken));
    expect(await User.countDocuments({ email: 'a@example.de' })).toBe(1);
  });

  it('does not wipe an existing Google user', async (ctx) => {
    if (!dbReady(ctx)) return;
    await User.create({
      email: 'g@bumbleflies.de',
      role: 'admin',
      googleId: 'g1',
      refreshToken: 'rt',
    });
    await adminCaller().users.invite({ email: 'g@bumbleflies.de', role: 'admin' });
    const user = await User.findOne({ email: 'g@bumbleflies.de' });
    expect(user?.get('googleId')).toBe('g1');
    expect(user?.get('refreshToken')).toBe('rt');
    expect(user?.get('inviteTokenHash')).toBeTruthy();
  });

  it('revokeInvite clears the hash', async (ctx) => {
    if (!dbReady(ctx)) return;
    const res = await adminCaller().users.invite({ email: 'a@example.de' });
    await adminCaller().users.revokeInvite({ id: res.id });
    const user = await User.findOne({ email: 'a@example.de' });
    expect(user?.get('inviteTokenHash')).toBeUndefined();
    expect(user?.get('inviteExpiresAt')).toBeUndefined();
  });

  it('setDisabled bumps tokenVersion and refuses self-disable', async (ctx) => {
    if (!dbReady(ctx)) return;
    const res = await adminCaller().users.invite({ email: 'a@example.de' });
    await adminCaller().users.setDisabled({ id: res.id, disabled: true });
    let user = await User.findById(res.id);
    expect(user?.get('disabled')).toBe(true);
    expect(user?.get('tokenVersion')).toBe(1);

    await expect(
      adminCaller().users.setDisabled({ id: 'admin-id-1', disabled: true }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    await adminCaller().users.setDisabled({ id: res.id, disabled: false });
    user = await User.findById(res.id);
    expect(user?.get('disabled')).toBe(false);
  });

  it('setRole refuses to demote the caller', async (ctx) => {
    if (!dbReady(ctx)) return;
    await expect(
      adminCaller().users.setRole({ id: 'admin-id-1', role: 'user' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    const res = await adminCaller().users.invite({ email: 'a@example.de' });
    await adminCaller().users.setRole({ id: res.id, role: 'admin' });
    expect((await User.findById(res.id))?.get('role')).toBe('admin');
  });

  it('list reports sessions and Drive state without leaking hashes', async (ctx) => {
    if (!dbReady(ctx)) return;
    await User.create({
      email: 'g@bumbleflies.de',
      role: 'admin',
      googleId: 'g1',
      refreshToken: 'rt',
    });
    const invited = await adminCaller().users.invite({ email: 'a@example.de' });
    const rows = await adminCaller().users.list();
    const invitedRow = rows.find((r) => r.id === invited.id);
    expect(invitedRow).toMatchObject({
      email: 'a@example.de',
      role: 'user',
      disabled: false,
      hasGoogle: false,
      hasDrive: false,
    });
    expect(JSON.stringify(rows)).not.toContain('inviteTokenHash');
    expect(rows.find((r) => r.email === 'g@bumbleflies.de')?.hasDrive).toBe(true);
  });
});
