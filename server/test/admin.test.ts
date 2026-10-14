import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AdminStats, AdminUser, Paginated, ReportDTO } from '@skillswap/shared';
import { Notification, User } from '../src/models';
import {
  type Member,
  type TestApp,
  acceptedContract,
  createTestApp,
  markBothJoined,
  schedule,
  signUp,
  tradingPair,
} from './helpers';

let t: TestApp;
let admin: Member;

beforeAll(async () => {
  t = await createTestApp();
  admin = await signUp(t, { name: 'Site Admin' });
  await User.updateOne({ _id: admin.user.id }, { role: 'ADMIN' });
});
afterAll(() => t.close());

describe('admin access', () => {
  it('is refused to anonymous visitors and ordinary members on every route', async () => {
    const member = await signUp(t);
    const routes: ['get' | 'post', string][] = [
      ['get', '/api/admin/stats'],
      ['get', '/api/admin/users'],
      ['get', '/api/admin/reports'],
      ['post', `/api/admin/users/${member.user.id}/status`],
      ['post', `/api/admin/reports/${'a'.repeat(24)}/resolve`],
    ];
    for (const [method, url] of routes) {
      expect((await request(t.app)[method](url)).status, `anonymous ${url}`).toBe(401);
      expect((await member.agent[method](url)).status, `member ${url}`).toBe(403);
    }
  });
});

describe('admin statistics', () => {
  it('reports zeros and null for an empty platform instead of invented numbers', async () => {
    const stats = (await admin.agent.get('/api/admin/stats')).body as AdminStats;
    expect(stats.totals).toMatchObject({
      sessions: 0,
      completedSessions: 0,
      exchanges: 0,
      activeContracts: 0,
    });
    expect(stats.completionRate).toBeNull();
    expect(stats.activity).toHaveLength(14);
    expect(stats.activity.every((d) => d.sessions === 0 && d.exchanges === 0)).toBe(true);
  });

  it('counts real activity', async () => {
    const before = (await admin.agent.get('/api/admin/stats')).body as AdminStats;
    const { ana, ben } = await tradingPair(t);
    const { contract } = await acceptedContract(ana, ben);
    const session = await schedule(ana, contract.id);
    await markBothJoined(session);
    await ana.agent.post(`/api/sessions/${session.id}/end`);

    const after = (await admin.agent.get('/api/admin/stats')).body as AdminStats;
    expect(after.totals.users).toBe(before.totals.users + 2);
    expect(after.totals).toMatchObject({
      sessions: 1,
      completedSessions: 1,
      exchanges: 1,
      activeContracts: 1,
    });
    expect(after.completionRate).toBe(100);
    const today = after.activity[after.activity.length - 1];
    expect(today).toMatchObject({ sessions: 1, exchanges: 1 });
    expect(today?.signups).toBeGreaterThanOrEqual(2);
    expect(after.topSkills.find((s) => s.skill === 'Java')).toMatchObject({
      teachers: 1,
      learners: 1,
    });
  });
});

describe('member management', () => {
  it('lists members with search and pagination', async () => {
    const target = await signUp(t, { name: 'Zed Searchable' });
    const page = (await admin.agent.get('/api/admin/users?q=searchable'))
      .body as Paginated<AdminUser>;
    expect(page.items.map((u) => u.id)).toEqual([target.user.id]);
    expect(page.items[0]).toHaveProperty('email');
    expect(JSON.stringify(page)).not.toContain('password');
    expect((await admin.agent.get('/api/admin/users?q=(')).status).toBe(200);
  });

  it('suspending a member ends their session immediately and blocks sign-in', async () => {
    const member = await signUp(t);
    expect((await member.agent.get('/api/dashboard')).status).toBe(200);

    const res = await admin.agent
      .post(`/api/admin/users/${member.user.id}/status`)
      .send({ status: 'SUSPENDED' });
    expect((res.body as { user: AdminUser }).user.status).toBe('SUSPENDED');
    expect((await member.agent.get('/api/dashboard')).status).toBe(401);
    expect(((await member.agent.get('/api/auth/me')).body as { user: unknown }).user).toBeNull();
    const login = await request(t.app)
      .post('/api/auth/login')
      .send({ identifier: member.user.username, password: 'Sup3r-secret!' });
    expect(login.status).toBe(403);

    await admin.agent.post(`/api/admin/users/${member.user.id}/status`).send({ status: 'ACTIVE' });
    const again = await request(t.app)
      .post('/api/auth/login')
      .send({ identifier: member.user.username, password: 'Sup3r-secret!' });
    expect(again.status).toBe(200);
  });

  it('cannot suspend administrators or oneself', async () => {
    expect(
      (
        await admin.agent
          .post(`/api/admin/users/${admin.user.id}/status`)
          .send({ status: 'SUSPENDED' })
      ).status,
    ).toBe(400);
    expect(
      (
        await admin.agent
          .post(`/api/admin/users/${admin.user.id}/status`)
          .send({ status: 'BANNED' })
      ).status,
    ).toBe(400);
  });
});

describe('report moderation', () => {
  const file = async (reporter: Member, target: Member) => {
    const res = await reporter.agent.post('/api/users/report').send({
      reportedUserId: target.user.id,
      reason: 'Spam or Solicitation',
      details: 'Keeps sending links to a paid course.',
    });
    expect(res.status).toBe(201);
    const reports = ((await admin.agent.get('/api/admin/reports')).body as { items: ReportDTO[] })
      .items;
    const report = reports.find(
      (r) => r.reportedUser?.id === target.user.id && r.status === 'PENDING',
    );
    if (!report) throw new Error('report not found');
    return report;
  };

  it('shows filed reports and can suspend the reported member, once', async () => {
    const reporter = await signUp(t);
    const target = await signUp(t);
    const report = await file(reporter, target);
    expect(report).toMatchObject({
      reason: 'Spam or Solicitation',
      status: 'PENDING',
      action: 'NONE',
    });

    const resolved = await admin.agent
      .post(`/api/admin/reports/${report.id}/resolve`)
      .send({ status: 'RESOLVED', action: 'SUSPENDED', notes: 'Confirmed.' });
    expect((resolved.body as { report: ReportDTO }).report).toMatchObject({
      status: 'RESOLVED',
      action: 'SUSPENDED',
    });
    expect((await User.findById(target.user.id).lean())?.status).toBe('SUSPENDED');

    const again = await admin.agent
      .post(`/api/admin/reports/${report.id}/resolve`)
      .send({ status: 'DISMISSED' });
    expect(again.status).toBe(409);
  });

  it('can warn or dismiss without suspending', async () => {
    const reporter = await signUp(t);
    const warned = await signUp(t);
    const cleared = await signUp(t);

    const first = await file(reporter, warned);
    await admin.agent
      .post(`/api/admin/reports/${first.id}/resolve`)
      .send({ status: 'RESOLVED', action: 'WARNED' });
    expect((await User.findById(warned.user.id).lean())?.status).toBe('ACTIVE');
    expect(await Notification.countDocuments({ recipient: warned.user.id, type: 'SYSTEM' })).toBe(
      1,
    );

    const second = await file(reporter, cleared);
    const dismissed = await admin.agent
      .post(`/api/admin/reports/${second.id}/resolve`)
      .send({ status: 'DISMISSED', action: 'SUSPENDED' });
    // Dismissing never carries an action, whatever the client sent.
    expect((dismissed.body as { report: ReportDTO }).report).toMatchObject({
      status: 'DISMISSED',
      action: 'NONE',
    });
    expect((await User.findById(cleared.user.id).lean())?.status).toBe('ACTIVE');
  });
});
