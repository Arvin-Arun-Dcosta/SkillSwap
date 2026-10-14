import { readdirSync } from 'node:fs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  ApiErrorBody,
  ProfileResponse,
  SessionDTO,
  SessionDetail,
  SharedFile,
} from '@skillswap/shared';
import { ExchangeRequest, LearningContract, Review, Session, User } from '../src/models';
import { allowedExtension } from '../src/routes/sessions';
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
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());

const sessionOf = (res: { body: unknown }) => (res.body as { session: SessionDTO }).session;

async function runningSession(): Promise<{
  ana: Member;
  ben: Member;
  session: SessionDTO;
  contractId: string;
}> {
  const { ana, ben } = await tradingPair(t);
  const { contract } = await acceptedContract(ana, ben);
  const session = await schedule(ana, contract.id);
  await markBothJoined(session);
  return { ana, ben, session, contractId: contract.id };
}

describe('scheduling sessions', () => {
  it('lets either member schedule sessions for either skill, assigning teacher and learner', async () => {
    const { ana, ben } = await tradingPair(t);
    const { contract } = await acceptedContract(ana, ben);

    const java = await schedule(ana, contract.id, 'java');
    expect(java).toMatchObject({ skill: 'Java', status: 'SCHEDULED', durationMinutes: 60 });
    expect(java.teacher.id).toBe(ana.user.id);
    expect(java.learner.id).toBe(ben.user.id);
    expect(java.roomCode).toMatch(/^SWAP-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);

    const video = await schedule(ben, contract.id, 'Video Editing');
    expect(video.teacher.id).toBe(ben.user.id);
    expect(video.roomCode).not.toBe(java.roomCode);
  });

  it('cannot exceed the number of sessions agreed in the contract', async () => {
    const { ana, ben } = await tradingPair(t);
    const { contract } = await acceptedContract(ana, ben, { sessions: 2 });
    await schedule(ana, contract.id);
    await schedule(ben, contract.id, 'Video Editing');
    const third = await ana.agent.post('/api/sessions').send({
      contractId: contract.id,
      skill: 'Java',
      scheduledStartTime: new Date(Date.now() + 3600_000).toISOString(),
    });
    expect(third.status).toBe(409);
  });

  it('validates the skill, the time and membership', async () => {
    const { ana, ben } = await tradingPair(t);
    const outsider = await signUp(t);
    const { contract } = await acceptedContract(ana, ben);
    const body = {
      contractId: contract.id,
      skill: 'Java',
      scheduledStartTime: new Date(Date.now() + 3600_000).toISOString(),
    };

    expect((await outsider.agent.post('/api/sessions').send(body)).status).toBe(404);
    const wrongSkill = await ana.agent.post('/api/sessions').send({ ...body, skill: 'Cooking' });
    expect((wrongSkill.body as ApiErrorBody).error.fields).toHaveProperty('skill');
    const past = await ana.agent
      .post('/api/sessions')
      .send({ ...body, scheduledStartTime: '2020-01-01T10:00:00Z' });
    expect((past.body as ApiErrorBody).error.fields).toHaveProperty('scheduledStartTime');
    const garbage = await ana.agent
      .post('/api/sessions')
      .send({ ...body, scheduledStartTime: 'tomorrow-ish' });
    expect(garbage.status).toBe(400);
  });

  it('can be cancelled before it starts, by a participant only', async () => {
    const { ana, ben } = await tradingPair(t);
    const outsider = await signUp(t);
    const { contract } = await acceptedContract(ana, ben);
    const session = await schedule(ana, contract.id);
    expect((await outsider.agent.post(`/api/sessions/${session.id}/cancel`)).status).toBe(404);
    expect(sessionOf(await ben.agent.post(`/api/sessions/${session.id}/cancel`)).status).toBe(
      'CANCELLED',
    );
    expect((await ana.agent.post(`/api/sessions/${session.id}/cancel`)).status).toBe(409);
    // A cancelled session gives its slot back.
    await schedule(ana, contract.id);
    await schedule(ana, contract.id);
  });
});

describe('session access control', () => {
  it('hides a session and everything in it from non-participants', async () => {
    const { ana, session } = await runningSession();
    const outsider = await signUp(t);

    const mine = await ana.agent.get(`/api/sessions/room/${session.roomCode}`);
    expect(mine.status).toBe(200);
    expect((mine.body as { session: SessionDetail }).session.viewer.canJoin).toBe(true);

    expect((await outsider.agent.get(`/api/sessions/room/${session.roomCode}`)).status).toBe(404);
    expect((await outsider.agent.post(`/api/sessions/${session.id}/end`)).status).toBe(404);
    expect(
      (await outsider.agent.post(`/api/sessions/${session.id}/review`).send({ rating: 1 })).status,
    ).toBe(404);
    expect(
      (
        await outsider.agent
          .post(`/api/sessions/${session.id}/files`)
          .attach('file', Buffer.from('x'), 'a.txt')
      ).status,
    ).toBe(404);
    expect(
      ((await outsider.agent.get('/api/sessions')).body as { items: SessionDTO[] }).items,
    ).toEqual([]);
    expect((await request(t.app).get(`/api/sessions/room/${session.roomCode}`)).status).toBe(401);

    // The legacy write endpoints for notes and code no longer exist over HTTP at all.
    expect(
      (await outsider.agent.put(`/api/sessions/${session.id}/notes`).send({ notes: 'x' })).status,
    ).toBe(404);
    expect((await Session.findById(session.id).lean())?.status).toBe('ACTIVE');
  });
});

describe('ending and reviewing a session', () => {
  it('completes once, counts once towards the contract and updates both members', async () => {
    const { ana, ben, session, contractId } = await runningSession();

    const [first, second] = await Promise.all([
      ana.agent.post(`/api/sessions/${session.id}/end`),
      ben.agent.post(`/api/sessions/${session.id}/end`),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    expect((await ana.agent.post(`/api/sessions/${session.id}/end`)).status).toBe(409);

    expect((await LearningContract.findById(contractId).lean())?.completedSessions).toBe(1);
    for (const id of [ana.user.id, ben.user.id]) {
      expect((await User.findById(id).lean())?.stats.sessionsCompleted).toBe(1);
    }
  });

  it('accepts one review per member, derives ratings from stored reviews and cannot be farmed', async () => {
    const { ana, ben, session } = await runningSession();
    // Reviews are only possible after completion.
    expect(
      (await ben.agent.post(`/api/sessions/${session.id}/review`).send({ rating: 5 })).status,
    ).toBe(409);
    await ana.agent.post(`/api/sessions/${session.id}/end`);

    const reviews = await Promise.all([
      ben.agent
        .post(`/api/sessions/${session.id}/review`)
        .send({ rating: 4, feedback: 'Clear and patient.' }),
      ben.agent.post(`/api/sessions/${session.id}/review`).send({ rating: 5, feedback: 'Again!' }),
    ]);
    expect(reviews.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(
      (await ben.agent.post(`/api/sessions/${session.id}/review`).send({ rating: 5 })).status,
    ).toBe(409);
    expect(await Review.countDocuments({ session: session.id, reviewer: ben.user.id })).toBe(1);

    // Ana taught, so Ben's review counts towards her teaching rating.
    const teacher = await User.findById(ana.user.id).lean();
    const stored = await Review.findOne({ session: session.id, reviewer: ben.user.id }).lean();
    expect([4, 5]).toContain(stored?.rating);
    expect(teacher?.stats.teachingRating).toBe(stored?.rating);
    expect(teacher?.stats.teachingReviews).toBe(1);
    expect(teacher?.stats.learningReviews).toBe(0);

    // Ana reviews Ben, who was the learner.
    expect(
      (await ana.agent.post(`/api/sessions/${session.id}/review`).send({ rating: 3 })).status,
    ).toBe(201);
    const learner = await User.findById(ben.user.id).lean();
    expect(learner?.stats).toMatchObject({
      learningRating: 3,
      learningReviews: 1,
      teachingRating: null,
    });

    const profile = (await request(t.app).get(`/api/users/${ana.user.username}`))
      .body as ProfileResponse;
    expect(profile.reviews).toHaveLength(1);
    expect(profile.reviews[0]).toMatchObject({ role: 'TEACHER', skill: 'Java' });
    expect(profile.user.skillsTeaching[0]).toMatchObject({ skill: 'Java', reviewCount: 1 });
    expect(profile.user.badges.map((b) => b.id)).toEqual(['first-swap']);
  });

  it('validates the rating', async () => {
    const { ana, ben, session } = await runningSession();
    await ana.agent.post(`/api/sessions/${session.id}/end`);
    for (const rating of [0, 6, 4.5, 'five']) {
      expect(
        (await ben.agent.post(`/api/sessions/${session.id}/review`).send({ rating })).status,
      ).toBe(400);
    }
  });

  it('does not count a session only one member attended', async () => {
    const { ana, ben } = await tradingPair(t);
    const { contract } = await acceptedContract(ana, ben);
    const session = await schedule(ana, contract.id);
    expect((await ana.agent.post(`/api/sessions/${session.id}/end`)).status).toBe(409);

    await Session.updateOne(
      { _id: session.id },
      { $set: { status: 'ACTIVE' }, $addToSet: { joinedBy: ana.user.id } },
    );
    const ended = sessionOf(await ana.agent.post(`/api/sessions/${session.id}/end`));
    expect(ended.status).toBe('CANCELLED');
    expect(ended.viewer.canReview).toBe(false);
    expect(
      (await ana.agent.post(`/api/sessions/${session.id}/review`).send({ rating: 5 })).status,
    ).toBe(409);
    expect((await LearningContract.findById(contract.id).lean())?.completedSessions).toBe(0);
    expect((await User.findById(ana.user.id).lean())?.stats.sessionsCompleted).toBe(0);
  });

  it('completes the contract and the exchange after the last agreed session', async () => {
    const { ana, ben } = await tradingPair(t);
    const { contract, exchange } = await acceptedContract(ana, ben, { sessions: 1 });
    const session = await schedule(ana, contract.id);
    await markBothJoined(session);
    await ben.agent.post(`/api/sessions/${session.id}/end`);

    expect((await LearningContract.findById(contract.id).lean())?.status).toBe('COMPLETED');
    const closed = await ExchangeRequest.findById(exchange.id).lean();
    expect(closed?.status).toBe('COMPLETED');
    expect(closed?.openPairKey).toBeUndefined();
  });
});

describe('shared files', () => {
  const upload = (
    member: Member,
    sessionId: string,
    name: string,
    content: string | Buffer = 'hello',
  ) =>
    member.agent
      .post(`/api/sessions/${sessionId}/files`)
      .attach('file', Buffer.isBuffer(content) ? content : Buffer.from(content), name);

  it('only accepts allow-listed file types', () => {
    expect(allowedExtension('notes.PDF')).toBe('pdf');
    expect(allowedExtension('diagram.png')).toBe('png');
    for (const name of [
      'page.html',
      'vector.svg',
      'run.exe',
      'noextension',
      'x.htmlpng.html',
      'trick.png.html',
    ]) {
      expect(allowedExtension(name), name).toBeNull();
    }
  });

  it('rejects active content and oversized files', async () => {
    const { ana, session } = await runningSession();
    const html = await upload(ana, session.id, 'evil.html', '<script>alert(1)</script>');
    expect(html.status).toBe(400);
    expect((html.body as ApiErrorBody).error.code).toBe('file_type');
    expect((await upload(ana, session.id, 'evil.svg', '<svg onload="alert(1)"/>')).status).toBe(
      400,
    );
    const big = await upload(ana, session.id, 'big.txt', Buffer.alloc(1024 * 1024 + 10, 'a'));
    expect(big.status).toBe(413);
    expect(readdirSync(t.uploadDir)).toEqual([]);
  });

  it('stores files privately under random names and serves them only to participants, as downloads', async () => {
    const { ana, ben, session } = await runningSession();
    const outsider = await signUp(t);

    const res = await upload(ana, session.id, '../../etc/passwd.txt', 'shared notes');
    expect(res.status).toBe(201);
    const file = (res.body as { file: SharedFile }).file;
    expect(file.name).toBe('passwd.txt');
    expect(JSON.stringify(res.body)).not.toMatch(/storedName|uploads\//);

    const onDisk = readdirSync(t.uploadDir);
    expect(onDisk).toHaveLength(1);
    expect(onDisk[0]).toMatch(/^[0-9a-f]{32}\.txt$/);

    // No public static mount: the stored name cannot be fetched directly.
    expect((await request(t.app).get(`/uploads/${onDisk[0]}`)).status).toBe(404);

    const url = `/api/sessions/${session.id}/files/${file.id}`;
    expect((await request(t.app).get(url)).status).toBe(401);
    expect((await outsider.agent.get(url)).status).toBe(404);

    const download = await ben.agent.get(url).buffer(true);
    expect(download.status).toBe(200);
    expect(download.headers['content-disposition']).toMatch(
      /^attachment; filename="?passwd\.txt"?/,
    );
    expect(download.headers['content-type']).toBe('application/octet-stream');
    expect(download.headers['x-content-type-options']).toBe('nosniff');
    expect((download.body as Buffer).toString()).toBe('shared notes');

    const detail = (await ben.agent.get(`/api/sessions/room/${session.roomCode}`)).body as {
      session: SessionDetail;
    };
    expect(detail.session.files).toHaveLength(1);

    // Only the uploader can remove a file.
    expect((await ben.agent.delete(url)).status).toBe(403);
    expect((await ana.agent.delete(url)).status).toBe(204);
    expect(readdirSync(t.uploadDir)).toEqual([]);
  });

  it('refuses uploads once the session is over', async () => {
    const { ana, session } = await runningSession();
    await ana.agent.post(`/api/sessions/${session.id}/end`);
    expect((await upload(ana, session.id, 'late.txt')).status).toBe(409);
  });
});
