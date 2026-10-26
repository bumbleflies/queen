import { describe, it, expect, beforeEach, type TaskContext } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { createApp } from '../../app';
import { User } from '../../models/User';
import { AUTH_COOKIE } from '../auth';
import { appRouter } from '../../trpc';

function dbReady(ctx: TaskContext): boolean {
  if (mongoose.connection.readyState === 1) return true;
  ctx.skip();
  return false;
}

function adminCaller() {
  return appRouter.createCaller({
    user: { sub: 'admin-id-1', email: 'admin@example.de', role: 'admin' },
    serviceAuth: false,
  });
}

async function makeInvite(email = 'steuer@example.de') {
  const res = await adminCaller().users.invite({ email, role: 'user' });
  return { token: res.url.split('#')[1]!, id: res.id };
}

const app = createApp();

beforeEach(async () => {
  if (mongoose.connection.readyState === 1) await User.deleteMany({});
});

describe('POST /auth/invite/redeem', () => {
  it('sets a 30-day cookie, clears the hash and stamps lastLoginAt', async (ctx) => {
    if (!dbReady(ctx)) return;
    const { token, id } = await makeInvite();
    const res = await request(app).post('/auth/invite/redeem').send({ token });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toContain(`${AUTH_COOKIE}=`);
    expect(cookie).toContain('Max-Age=2592000');
    expect(cookie).toContain('HttpOnly');

    const user = await User.findById(id);
    expect(user?.get('inviteTokenHash')).toBeUndefined();
    expect(user?.get('lastLoginAt')).toBeInstanceOf(Date);

    const me = await request(app)
      .get('/auth/me')
      .set('Cookie', cookie.split(';')[0]!);
    expect(me.status).toBe(200);
    expect(me.body.user).toMatchObject({ email: 'steuer@example.de', role: 'user', tv: 0 });
  });

  it('rejects a second redeem of the same token', async (ctx) => {
    if (!dbReady(ctx)) return;
    const { token } = await makeInvite();
    expect((await request(app).post('/auth/invite/redeem').send({ token })).status).toBe(200);
    expect((await request(app).post('/auth/invite/redeem').send({ token })).status).toBe(400);
  });

  it('mints exactly one session for concurrent clicks', async (ctx) => {
    if (!dbReady(ctx)) return;
    const { token } = await makeInvite();
    const results = await Promise.all([
      request(app).post('/auth/invite/redeem').send({ token }),
      request(app).post('/auth/invite/redeem').send({ token }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
  });

  it('rejects an expired invite', async (ctx) => {
    if (!dbReady(ctx)) return;
    const { token, id } = await makeInvite();
    await User.updateOne({ _id: id }, { $set: { inviteExpiresAt: new Date(Date.now() - 1000) } });
    expect((await request(app).post('/auth/invite/redeem').send({ token })).status).toBe(400);
  });

  it('rejects a disabled user and an unknown token', async (ctx) => {
    if (!dbReady(ctx)) return;
    const { token, id } = await makeInvite();
    await User.updateOne({ _id: id }, { $set: { disabled: true } });
    expect((await request(app).post('/auth/invite/redeem').send({ token })).status).toBe(400);
    expect((await request(app).post('/auth/invite/redeem').send({ token: 'nope' })).status).toBe(400);
    expect((await request(app).post('/auth/invite/redeem').send({})).status).toBe(400);
  });

  it('a session dies as soon as the user is disabled', async (ctx) => {
    if (!dbReady(ctx)) return;
    const { token, id } = await makeInvite();
    const login = await request(app).post('/auth/invite/redeem').send({ token });
    const cookie = String(login.headers['set-cookie']).split(';')[0]!;
    expect((await request(app).get('/auth/me').set('Cookie', cookie)).status).toBe(200);

    await adminCaller().users.setDisabled({ id, disabled: true });

    expect((await request(app).get('/auth/me').set('Cookie', cookie)).status).toBe(401);
  });
});
