import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  ApiErrorBody,
  DiscoverUser,
  Paginated,
  ProfileResponse,
  SelfUser,
} from '@skillswap/shared';
import { Report, User } from '../src/models';
import { type Member, type TestApp, createTestApp, onboard, signUp } from './helpers';

let t: TestApp;
let ana: Member;
let ben: Member;
let cara: Member;

beforeAll(async () => {
  t = await createTestApp();
  ana = await signUp(t, { name: 'Ana Lopez' });
  ben = await signUp(t, { name: 'Ben Okafor' });
  cara = await signUp(t, { name: 'Cara (Design)' });
  await onboard(ana, ['Java'], ['Video Editing'], {
    availability: { days: ['Monday', 'Tuesday'], timeSlots: ['evening'], hoursPerWeek: 4 },
  });
  await onboard(ben, ['Video Editing'], ['Java'], {
    availability: { days: ['Monday'], timeSlots: ['evening'], hoursPerWeek: 4 },
  });
  await onboard(cara, ['Figma'], ['Spanish']);
});
afterAll(() => t.close());

describe('profile updates', () => {
  it('ignores ratings and rejects privileged fields', async () => {
    const withRating = await ana.agent.patch('/api/auth/me').send({
      skillsTeaching: [
        { skill: 'Java', proficiency: 'Expert', yearsExperience: 6, description: '', rating: 5 },
      ],
    });
    expect(withRating.status).toBe(200);
    const user = (withRating.body as { user: SelfUser }).user;
    expect(user.skillsTeaching[0]).toMatchObject({ skill: 'Java', rating: null, reviewCount: 0 });

    for (const payload of [
      { role: 'ADMIN' },
      { stats: { teachingRating: 5 } },
      { status: 'ACTIVE' },
      { isDemo: true },
    ]) {
      const res = await ana.agent.patch('/api/auth/me').send(payload);
      expect(res.status).toBe(400);
    }
    const stored = await User.findById(ana.user.id).lean();
    expect(stored?.role).toBe('USER');
    expect(stored?.stats.teachingRating).toBeNull();
  });

  it('requires skills before onboarding can be completed', async () => {
    const fresh = await signUp(t);
    const res = await fresh.agent.patch('/api/auth/me').send({ onboardingCompleted: true });
    expect(res.status).toBe(400);
  });

  it('rejects unsafe avatar addresses', async () => {
    const res = await ana.agent.patch('/api/auth/me').send({ avatar: 'javascript:alert(1)' });
    expect(res.status).toBe(400);
    expect((res.body as ApiErrorBody).error.fields).toHaveProperty('avatar');
  });
});

describe('public profiles', () => {
  it('never expose email, role or account status', async () => {
    const res = await request(t.app).get(`/api/users/${ana.user.username}`);
    expect(res.status).toBe(200);
    const body = res.body as ProfileResponse;
    expect(body.user.username).toBe(ana.user.username);
    expect(body.user).not.toHaveProperty('email');
    expect(body.user).not.toHaveProperty('role');
    expect(body.user).not.toHaveProperty('status');
    expect(JSON.stringify(res.body)).not.toContain(ana.user.email);
    expect(body.match).toBeNull();
  });

  it('include a match for signed-in viewers and flag the owner', async () => {
    const other = (await ben.agent.get(`/api/users/${ana.user.username}`)).body as ProfileResponse;
    expect(other.match?.breakdown.mutualSkill.score).toBe(50);
    expect(other.viewer).toEqual({ isSelf: false, openExchangeId: null });
    const mine = (await ana.agent.get(`/api/users/${ana.user.username}`)).body as ProfileResponse;
    expect(mine.viewer.isSelf).toBe(true);
    expect(mine.match).toBeNull();
  });

  it('hide suspended members', async () => {
    const gone = await signUp(t);
    await User.updateOne({ _id: gone.user.id }, { status: 'SUSPENDED' });
    expect((await request(t.app).get(`/api/users/${gone.user.username}`)).status).toBe(404);
  });
});

describe('discover', () => {
  const list = async (agent: Pick<Member['agent'], 'get'>, query = '') =>
    (await agent.get(`/api/users/discover${query}`)).body as Paginated<DiscoverUser>;

  it('treats search text literally, so pattern characters cannot break or stall it', async () => {
    for (const q of ['(', '[a-', '(a+)+$', '.*', '\\']) {
      const res = await request(t.app).get('/api/users/discover').query({ q });
      expect(res.status, `q=${q}`).toBe(200);
    }
    const dotStar = await list(request(t.app), '?q=.*');
    expect(dotStar.total).toBe(0);
    const literal = await list(request(t.app), `?q=${encodeURIComponent('(Design)')}`);
    expect(literal.items.map((u) => u.name)).toEqual(['Cara (Design)']);
  });

  it('ranks by match across all candidates before paginating', async () => {
    // Enough unrelated members that the best match would not be on page one by insertion order.
    for (let i = 0; i < 5; i += 1) {
      const filler = await signUp(t);
      await onboard(filler, ['Knitting'], ['Chess']);
    }
    const firstPage = await list(ana.agent, '?pageSize=2&sort=match');
    expect(firstPage.items[0]?.username).toBe(ben.user.username);
    expect(firstPage.items[0]?.match?.score).toBeGreaterThan(
      firstPage.items[1]?.match?.score ?? 100,
    );
    expect(firstPage.total).toBe(7);
    expect(firstPage.totalPages).toBe(4);

    const secondPage = await list(ana.agent, '?pageSize=2&sort=match&page=2');
    const ids = new Set([...firstPage.items, ...secondPage.items].map((u) => u.id));
    expect(ids.size).toBe(4);
    expect(ids.has(ana.user.id)).toBe(false);
  });

  it('gives logged-out visitors no invented match score', async () => {
    const page = await list(request(t.app));
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items.every((u) => u.match === null)).toBe(true);
    expect(page.items.every((u) => !('email' in u))).toBe(true);
  });

  it('filters by any day of the week and rejects unknown filters', async () => {
    const tuesday = await list(request(t.app), '?day=Tuesday');
    expect(tuesday.items.map((u) => u.username)).toEqual([ana.user.username]);
    expect((await request(t.app).get('/api/users/discover?day=Someday')).status).toBe(400);
    expect((await request(t.app).get('/api/users/discover?pageSize=5000')).status).toBe(400);
  });

  it('excludes members who have not finished onboarding', async () => {
    const lurker = await signUp(t, { name: 'Unfinished Profile' });
    const page = await list(request(t.app), '?q=Unfinished');
    expect(page.items.map((u) => u.id)).not.toContain(lurker.user.id);
  });
});

describe('skills', () => {
  it('lists skills with real teacher and learner counts', async () => {
    const res = await request(t.app).get('/api/skills');
    const java = (
      res.body as { items: { name: string; teachers: number; learners: number }[] }
    ).items.find((s) => s.name === 'Java');
    expect(java).toMatchObject({ teachers: 1, learners: 1 });
  });

  it('has no unauthenticated write endpoint', async () => {
    const res = await request(t.app).post('/api/skills').send({ name: 'probe-skill' });
    expect(res.status).toBe(404);
  });
});

describe('reporting a member', () => {
  it('requires sign-in, a real target and enough detail', async () => {
    const payload = {
      reportedUserId: ben.user.id,
      reason: 'Harassment',
      details: 'Sent abusive messages in chat.',
    };
    expect((await request(t.app).post('/api/users/report').send(payload)).status).toBe(401);
    expect(
      (await ana.agent.post('/api/users/report').send({ ...payload, details: 'bad' })).status,
    ).toBe(400);
    expect(
      (await ana.agent.post('/api/users/report').send({ ...payload, reportedUserId: ana.user.id }))
        .status,
    ).toBe(400);
    expect(
      (
        await ana.agent
          .post('/api/users/report')
          .send({ ...payload, reportedUserId: 'f'.repeat(24) })
      ).status,
    ).toBe(404);

    expect((await ana.agent.post('/api/users/report').send(payload)).status).toBe(201);
    expect((await ana.agent.post('/api/users/report').send(payload)).status).toBe(409);
    expect(await Report.countDocuments({ reporter: ana.user.id })).toBe(1);
  });
});
