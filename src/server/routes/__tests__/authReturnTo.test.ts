import { describe, it, expect } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { createApp } from '../../app';
import { User } from '../../models/User';
import { appRouter } from '../../trpc';
import { POST_LOGIN_COOKIE, safeNext } from '../auth';

const app = createApp();

function adminCaller() {
  return appRouter.createCaller({
    user: { sub: 'admin-id-1', email: 'admin@example.de', role: 'admin' },
    serviceAuth: false,
  });
}

async function makeInvite() {
  const res = await adminCaller().users.invite({ email: 'reader@example.de', role: 'user' });
  return res.url.split('#')[1]!;
}

describe('safeNext', () => {
  it('keeps a relative path with a query', () => {
    expect(safeNext('/expenses?claim=c1')).toBe('/expenses?claim=c1');
  });

  it.each([
    '',
    '   ',
    'expenses',
    '//evil.example/path',
    '/\\evil.example',
    'https://evil.example/',
    'javascript:alert(1)',
    '/ok\nLocation: https://evil.example',
    '/bad\u0000path',
    'x'.repeat(600),
    null,
    42,
  ])('rejects %j as a redirect target', (value) => {
    expect(safeNext(value)).toBeNull();
  });
});

describe('return-to after login', () => {
  it('remembers a safe path before the Google round trip', async () => {
    // The status depends on whether Google OAuth is configured in this env; the
    // cookie is what matters and is set before either outcome.
    const res = await request(app).get('/auth/google').query({ next: '/expenses?claim=c1' });
    const cookies = String(res.headers['set-cookie'] ?? '');
    expect(cookies).toContain(`${POST_LOGIN_COOKIE}=`);
    expect(cookies).toContain('HttpOnly');
    expect(cookies).toContain('Max-Age=600');
  });

  it('never stores a foreign origin in the return-to cookie', async () => {
    const res = await request(app).get('/auth/google').query({ next: '//evil.example/' });
    expect(String(res.headers['set-cookie'] ?? '')).not.toContain(POST_LOGIN_COOKIE);
  });

  it('echoes a validated return-to from an invite redeem', async (ctx) => {
    if (mongoose.connection.readyState !== 1) return ctx.skip();
    await User.deleteMany({});
    const token = await makeInvite();
    const res = await request(app)
      .post('/auth/invite/redeem')
      .send({ token, next: '/expenses?claim=c1' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, next: '/expenses?claim=c1' });
  });

  it('drops a foreign return-to from an invite redeem', async (ctx) => {
    if (mongoose.connection.readyState !== 1) return ctx.skip();
    await User.deleteMany({});
    const token = await makeInvite();
    const res = await request(app)
      .post('/auth/invite/redeem')
      .send({ token, next: 'https://evil.example/' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
