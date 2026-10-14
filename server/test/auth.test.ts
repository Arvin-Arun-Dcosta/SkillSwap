import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ApiErrorBody, AppConfig, SelfUser } from '@skillswap/shared';
import { User } from '../src/models';
import { DEMO_PASSWORD, seedDemoData } from '../src/seed/demo';
import { PASSWORD, type TestApp, createTestApp, signUp } from './helpers';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp({ env: { DEMO_MODE: 'true' } });
  await seedDemoData({ bcryptRounds: 4 });
});
afterAll(() => t.close());

const err = (body: unknown) => (body as ApiErrorBody).error;
const whoAmI = async (agent: { get: (url: string) => PromiseLike<{ body: unknown }> }) =>
  ((await agent.get('/api/auth/me')).body as { user: SelfUser | null }).user?.id ?? null;

describe('registration and sign-in', () => {
  it('creates an account, signs it in with an httpOnly cookie and never returns the password', async () => {
    const res = await request(t.app).post('/api/auth/register').send({
      name: 'Priya Sharma',
      username: 'Priya_Codes',
      email: 'Priya@Example.com',
      password: PASSWORD,
    });
    expect(res.status).toBe(201);
    const user = (res.body as { user: SelfUser }).user;
    expect(user).toMatchObject({
      username: 'priya_codes',
      email: 'priya@example.com',
      role: 'USER',
    });
    expect(JSON.stringify(res.body)).not.toContain('password');
    expect(res.body).not.toHaveProperty('token');

    const cookie = (res.headers['set-cookie'] as unknown as string[])[0] ?? '';
    // The session lives in a cookie scripts cannot read, not in localStorage.
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);

    const stored = await User.findOne({ username: 'priya_codes' }).select('+password');
    expect(stored?.password).toMatch(/^\$2[aby]\$/);
  });

  it('starts new members without invented reputation', async () => {
    const { user } = await signUp(t);
    expect(user.stats).toEqual({
      teachingRating: null,
      teachingReviews: 0,
      learningRating: null,
      learningReviews: 0,
      sessionsCompleted: 0,
    });
    expect(user.badges).toEqual([]);
    expect(user.avatar).toBe('');
  });

  it('reports duplicates per field', async () => {
    const first = await signUp(t);
    const sameEmail = await request(t.app).post('/api/auth/register').send({
      name: 'Other',
      username: 'someone_else',
      email: first.user.email,
      password: PASSWORD,
    });
    expect(sameEmail.status).toBe(409);
    expect(err(sameEmail.body).fields).toHaveProperty('email');
  });

  it('validates input on the server and answers 400, not 500', async () => {
    const weak = await request(t.app)
      .post('/api/auth/register')
      .send({ name: 'A', username: 'ok_name', email: 'a@b.co', password: '123456' });
    expect(weak.status).toBe(400);
    expect(err(weak.body).code).toBe('validation_failed');
    expect(err(weak.body).fields).toHaveProperty('password');

    const injected = await request(t.app)
      .post('/api/auth/login')
      .send({ identifier: { $ne: null }, password: { $ne: null } });
    expect(injected.status).toBe(400);

    const malformed = await request(t.app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"identifier":');
    expect(malformed.status).toBe(400);
    expect(err(malformed.body).code).toBe('bad_json');
  });

  it('signs in by email or username and rejects wrong passwords identically', async () => {
    const member = await signUp(t);
    const byEmail = await request(t.app)
      .post('/api/auth/login')
      .send({ identifier: member.user.email.toUpperCase(), password: PASSWORD });
    expect(byEmail.status).toBe(200);

    const wrongPassword = await request(t.app)
      .post('/api/auth/login')
      .send({ identifier: member.user.username, password: 'not-the-password' });
    const unknownUser = await request(t.app)
      .post('/api/auth/login')
      .send({ identifier: 'nobody_here', password: 'not-the-password' });
    expect(wrongPassword.status).toBe(401);
    expect(unknownUser.status).toBe(401);
    expect(err(wrongPassword.body).code).toBe('invalid_credentials');
    expect(err(wrongPassword.body).message).toBe(err(unknownUser.body).message);
  });

  it('reports who is signed in and clears the session on logout', async () => {
    expect(await whoAmI(request(t.app))).toBeNull();
    const member = await signUp(t);
    expect(await whoAmI(member.agent)).toBe(member.user.id);
    expect((await member.agent.post('/api/auth/logout')).status).toBe(204);
    expect(await whoAmI(member.agent)).toBeNull();
    // Protected resources still answer 401 without a session.
    expect((await member.agent.get('/api/dashboard')).status).toBe(401);
  });
});

describe('session tokens', () => {
  it('rejects tokens signed with the legacy hard-coded secret', async () => {
    const admin = await User.findOne({ username: 'admin' });
    const forged = jwt.sign(
      { sub: admin?._id.toString(), tv: 0 },
      'skillswap_super_secret_jwt_key_2026_xyz',
    );
    const legacyShape = jwt.sign(
      { id: admin?._id.toString() },
      'skillswap_super_secret_jwt_key_2026_xyz',
    );
    for (const token of [forged, legacyShape]) {
      const viaCookie = await request(t.app)
        .get('/api/admin/users')
        .set('Cookie', `skillswap_session=${token}`);
      const viaHeader = await request(t.app)
        .get('/api/admin/users')
        .set('Authorization', `Bearer ${token}`);
      expect(viaCookie.status).toBe(401);
      expect(viaHeader.status).toBe(401);
    }
  });

  it('rejects unsigned and wrong-algorithm tokens', async () => {
    const admin = await User.findOne({ username: 'admin' });
    const none = jwt.sign({ sub: admin?._id.toString(), tv: 0 }, '', { algorithm: 'none' });
    const res = await request(t.app).get('/api/auth/me').set('Cookie', `skillswap_session=${none}`);
    expect((res.body as { user: unknown }).user).toBeNull();
    const guarded = await request(t.app)
      .get('/api/dashboard')
      .set('Cookie', `skillswap_session=${none}`);
    expect(guarded.status).toBe(401);
  });

  it('invalidates every other session when the password changes', async () => {
    const member = await signUp(t);
    const otherDevice = request.agent(t.app);
    await otherDevice
      .post('/api/auth/login')
      .send({ identifier: member.user.username, password: PASSWORD });
    expect(await whoAmI(otherDevice)).toBe(member.user.id);

    const wrong = await member.agent
      .post('/api/auth/password')
      .send({ currentPassword: 'wrong', newPassword: 'N3w-password!' });
    expect(wrong.status).toBe(400);
    expect(err(wrong.body).fields).toHaveProperty('currentPassword');

    const changed = await member.agent
      .post('/api/auth/password')
      .send({ currentPassword: PASSWORD, newPassword: 'N3w-password!' });
    expect(changed.status).toBe(204);
    expect(await whoAmI(member.agent)).toBe(member.user.id);
    expect(await whoAmI(otherDevice)).toBeNull();
    expect((await otherDevice.get('/api/dashboard')).status).toBe(401);

    const login = await request(t.app)
      .post('/api/auth/login')
      .send({ identifier: member.user.username, password: 'N3w-password!' });
    expect(login.status).toBe(200);
  });
});

describe('demo sign-in', () => {
  it('signs in seeded demo accounts while demo mode is on', async () => {
    const res = await request(t.app).post('/api/auth/demo-login').send({ username: 'arjun' });
    expect(res.status).toBe(200);
    expect((res.body as { user: SelfUser }).user).toMatchObject({
      username: 'arjun',
      isDemo: true,
    });
  });

  it('never signs in a real account without a password', async () => {
    const real = await signUp(t);
    const res = await request(t.app)
      .post('/api/auth/demo-login')
      .send({ username: real.user.username });
    expect(res.status).toBe(404);
    expect(res.headers['set-cookie']).toBeUndefined();

    // Even an administrator account is unreachable unless it was created by the seed script.
    await User.updateOne({ username: real.user.username }, { role: 'ADMIN' });
    const admin = await request(t.app)
      .post('/api/auth/demo-login')
      .send({ username: real.user.username });
    expect(admin.status).toBe(404);
  });

  it('does not exist at all when demo mode is off', async () => {
    const off = await createTestAppWithSharedDb({ DEMO_MODE: 'false' });
    const res = await request(off).post('/api/auth/demo-login').send({ username: 'admin' });
    expect(res.status).toBe(404);
    const config = (await request(off).get('/api/auth/config')).body as AppConfig;
    expect(config).toMatchObject({ demoMode: false, demoAccounts: [] });
  });

  it('refuses to change the shared password of a demo account', async () => {
    const visitor = request.agent(t.app);
    await visitor.post('/api/auth/demo-login').send({ username: 'elena' });
    const res = await visitor
      .post('/api/auth/password')
      .send({ currentPassword: DEMO_PASSWORD, newPassword: 'N3w-password!' });
    expect(res.status).toBe(403);
    const login = await request(t.app)
      .post('/api/auth/login')
      .send({ identifier: 'elena', password: DEMO_PASSWORD });
    expect(login.status).toBe(200);
  });

  it('lists demo accounts in the public config only in demo mode', async () => {
    const config = (await request(t.app).get('/api/auth/config')).body as AppConfig;
    expect(config.demoMode).toBe(true);
    expect(config.demoAccounts.map((a) => a.username)).toContain('rahul');
    expect(JSON.stringify(config)).not.toContain(DEMO_PASSWORD);
  });
});

describe('abuse protection', () => {
  it('rate limits sign-in attempts', async () => {
    const limited = await createTestAppWithSharedDb({}, { authPer15Min: 5 });
    const statuses: number[] = [];
    for (let i = 0; i < 8; i += 1) {
      const res = await request(limited)
        .post('/api/auth/login')
        .send({ identifier: 'admin', password: 'wrong-password' });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(statuses.slice(5)).toEqual([429, 429, 429]);
  });

  it('refuses state-changing requests from other websites', async () => {
    const member = await signUp(t);
    const crossSite = await member.agent
      .patch('/api/auth/me')
      .set('Origin', 'https://evil.example')
      .send({ headline: 'pwned' });
    expect(crossSite.status).toBe(403);
    expect(err(crossSite.body).code).toBe('bad_origin');

    const fetchMetadata = await member.agent
      .patch('/api/auth/me')
      .set('Sec-Fetch-Site', 'cross-site')
      .send({ headline: 'pwned' });
    expect(fetchMetadata.status).toBe(403);

    const allowed = await member.agent
      .patch('/api/auth/me')
      .set('Origin', 'http://localhost:5173')
      .send({ headline: 'Hello' });
    expect(allowed.status).toBe(200);
  });

  it('answers errors in one shape without leaking internals', async () => {
    const res = await request(t.app).get('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(err(res.body)).toMatchObject({ code: 'not_found' });
    expect(err(res.body).requestId).toBe(res.headers['x-request-id']);
    expect(JSON.stringify(res.body)).not.toMatch(/stack|at .*\.ts/);
  });

  it('sends security headers on every response', async () => {
    const res = await request(t.app).get('/api/health');
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cross-origin-resource-policy']).toBe('same-origin');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['permissions-policy']).toContain('camera=(self)');
  });
});

describe('health checks', () => {
  it('reports liveness and database readiness', async () => {
    expect((await request(t.app).get('/api/health')).body).toMatchObject({ status: 'ok' });
    const ready = await request(t.app).get('/api/health/ready');
    expect(ready.status).toBe(200);
    expect(ready.body).toMatchObject({ status: 'ready', database: 'up' });
  });
});

/** A second app over the same database connection, with different settings. */
async function createTestAppWithSharedDb(
  envOverrides: Record<string, string>,
  rateLimits: { authPer15Min?: number } = {},
) {
  const { createApp } = await import('../src/app');
  const { parseEnv } = await import('../src/config/env');
  const env = parseEnv({
    NODE_ENV: 'test',
    JWT_SECRET: t.env.jwtSecret,
    MONGODB_URI: t.env.mongodbUri ?? '',
    UPLOAD_DIR: t.uploadDir,
    ...envOverrides,
  });
  return createApp({ ...t.ctx, env }, { rateLimits: { authPer15Min: 1000, ...rateLimits } });
}
