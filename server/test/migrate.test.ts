import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ProfileResponse, SessionDTO } from '@skillswap/shared';
import { type MigrationReport, migrateLegacyData } from '../src/migrate/v2';
import { ExchangeRequest, LearningContract, Review, Session, User } from '../src/models';
import { type TestApp, createTestApp } from './helpers';

const oid = () => new mongoose.Types.ObjectId();
let t: TestApp;
let report: MigrationReport;

const ids = {
  arjun: oid(),
  rahul: oid(),
  loner: oid(),
  exchange: oid(),
  duplicatePending: oid(),
  contract: oid(),
  done: oid(),
  upcoming: oid(),
  solo: oid(),
};

/** Documents shaped exactly as SkillSwap 1.x wrote them. */
async function insertLegacyData() {
  const db = mongoose.connection.db;
  if (!db) throw new Error('not connected');
  // The 1.x database had none of the new unique indexes.
  await Review.collection.dropIndexes();
  await ExchangeRequest.collection.dropIndexes();

  const password = await bcrypt.hash('Password123!', 4);
  const legacyUser = (_id: mongoose.Types.ObjectId, username: string, extra: object = {}) => ({
    _id,
    name: username[0]?.toUpperCase() + username.slice(1),
    username,
    email: `${username}@example.com`,
    password,
    avatar:
      'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
    headline: 'Passionate Skill Exchanger',
    bio: '',
    location: 'Remote / Global',
    timezone: 'UTC+05:30',
    skillsTeaching: [
      {
        _id: oid(),
        skill: 'Java',
        proficiency: 'Expert',
        yearsExperience: 6,
        description: 'Core Java',
        rating: 4.9,
      },
      {
        _id: oid(),
        skill: 'java',
        proficiency: 'Beginner',
        yearsExperience: 1,
        description: 'dup',
        rating: 5,
      },
    ],
    skillsLearning: [
      {
        _id: oid(),
        skill: 'Video Editing',
        targetProficiency: 'Intermediate',
        priority: 'High',
        notes: '',
      },
    ],
    availability: {
      days: ['Monday', 'Funday'],
      timeSlots: ['Evenings (6 PM - 9 PM)', 'Weekends Flexible', 'Mornings (9 AM - 12 PM)'],
      hoursPerWeek: 6,
      timezone: 'UTC+05:30',
    },
    preferences: {
      sessionType: ['One-to-one'],
      format: ['Video', 'Project-based', 'Telepathy'],
      pacing: 'Project-based',
      sessionLength: 'Long (90 min)',
      languages: ['English', 'Hindi'],
    },
    ratings: {
      teaching: 4.9,
      learning: 4.8,
      reliability: 99,
      responseRate: 98,
      sessionsCompleted: 24,
      reviewsCount: 18,
    },
    streakDays: 7,
    level: 1,
    badges: [{ id: 'top-mentor', name: 'Top Mentor', icon: '🏆', description: 'x' }],
    role: 'USER',
    status: 'ACTIVE',
    onboardingCompleted: true,
    isOnline: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...extra,
  });
  await db.collection('users').insertMany([
    legacyUser(ids.arjun, 'arjun'),
    legacyUser(ids.rahul, 'rahul', {
      avatar: 'https://cdn.example.org/me.png',
      timezone: 'Asia/Kolkata',
    }),
    legacyUser(ids.loner, 'loner', { password: await bcrypt.hash('something-else-1', 4) }),
  ]);

  await db.collection('exchangerequests').insertMany([
    {
      _id: ids.exchange,
      sender: ids.arjun,
      receiver: ids.rahul,
      teachingSkill: 'Java',
      learningSkill: 'Video Editing',
      message: 'Swap?',
      proposedSessions: 2,
      proposedDurationMinutes: 60,
      learningGoals: ['Basics'],
      status: 'IN_PROGRESS',
      statusHistory: [
        {
          status: 'PENDING',
          changedBy: ids.arjun,
          note: 'Request initialized',
          timestamp: new Date(),
        },
      ],
      createdContract: ids.contract,
      createdAt: new Date('2026-02-01'),
      updatedAt: new Date('2026-02-02'),
    },
    {
      _id: ids.duplicatePending,
      sender: ids.rahul,
      receiver: ids.arjun,
      teachingSkill: 'Video Editing',
      learningSkill: 'Java',
      message: 'Another one',
      proposedSessions: 4,
      proposedDurationMinutes: 60,
      learningGoals: [],
      status: 'PENDING',
      statusHistory: [],
      createdAt: new Date('2026-02-03'),
      updatedAt: new Date('2026-02-03'),
    },
  ]);

  await db.collection('learningcontracts').insertOne({
    _id: ids.contract,
    exchangeRequest: ids.exchange,
    userA: ids.arjun,
    userB: ids.rahul,
    skillA: 'Java',
    skillB: 'Video Editing',
    totalSessions: 2,
    // Inflated: the old code incremented this once per feedback submission.
    completedSessions: 3,
    sessionDurationMinutes: 60,
    goals: [{ _id: oid(), title: 'Basics', completed: false }],
    status: 'ACTIVE',
    agreementTerms: 'Both parties agree…',
    startDate: new Date('2026-02-02'),
    createdAt: new Date('2026-02-02'),
    updatedAt: new Date('2026-02-02'),
  });

  const legacySession = (
    _id: mongoose.Types.ObjectId,
    roomCode: string,
    status: string,
    extra: object = {},
  ) => ({
    _id,
    title: `Session ${roomCode}`,
    description: '',
    contract: ids.contract,
    participants: [ids.arjun, ids.rahul],
    host: ids.arjun,
    skillTaught: 'Java',
    scheduledStartTime: new Date('2026-03-01T10:00:00Z'),
    scheduledEndTime: new Date('2026-03-01T11:00:00Z'),
    durationMinutes: 60,
    status,
    roomCode,
    notes: '# Session Notes',
    codeEditorState: { language: 'brainfuck', code: '+++' },
    whiteboardState: '[]',
    sharedFiles: [
      {
        _id: oid(),
        name: 'Roadmap.pdf',
        url: '/uploads/1791451945332-993852314-Roadmap.pdf',
        size: 81014,
        type: 'application/pdf',
        uploader: ids.rahul,
        uploadedAt: new Date(),
      },
    ],
    feedback: [{ user: ids.rahul, role: 'STUDENT', rating: 5, review: 'Great' }],
    createdAt: new Date('2026-02-20'),
    updatedAt: new Date('2026-03-01'),
    ...extra,
  });
  await db.collection('sessions').insertMany([
    legacySession(ids.done, 'SWAP-LEGACY-DONE', 'COMPLETED'),
    legacySession(ids.upcoming, 'SWAP-LEGACY-NEXT', 'SCHEDULED', {
      sharedFiles: [],
      feedback: [],
    }),
    legacySession(ids.solo, 'SWAP-LEGACY-SOLO', 'SCHEDULED', {
      participants: [ids.loner],
      host: ids.loner,
      contract: null,
      sharedFiles: [],
      feedback: [],
    }),
  ]);

  const legacyReview = (
    rating: number,
    createdAt: string,
    reviewer = ids.rahul,
    reviewee = ids.arjun,
    role = 'TEACHER',
  ) => ({
    _id: oid(),
    session: ids.done,
    contract: ids.contract,
    reviewer,
    reviewee,
    role,
    skill: 'Java',
    rating,
    feedback: 'Great collaborative learning exchange!',
    communicationScore: 5,
    reliabilityScore: 5,
    createdAt: new Date(createdAt),
    updatedAt: new Date(createdAt),
  });
  await db.collection('reviews').insertMany([
    // Rahul "completed" the same session three times to push the average up.
    legacyReview(5, '2026-03-01T11:00:00Z'),
    legacyReview(5, '2026-03-01T11:01:00Z'),
    legacyReview(3, '2026-03-01T11:02:00Z'),
    legacyReview(4, '2026-03-01T11:05:00Z', ids.arjun, ids.rahul, 'STUDENT'),
  ]);
}

beforeAll(async () => {
  t = await createTestApp();
  await insertLegacyData();
  report = await migrateLegacyData();
});
afterAll(() => t.close());

describe('migrating a 1.x database', () => {
  it('reports what it did', () => {
    expect(report).toMatchObject({
      users: 3,
      sessionsUpdated: 3,
      duplicateReviewsRemoved: 2,
      exchangesClosedAsDuplicates: 1,
      contractsCompleted: 0,
    });
    // The two accounts that still use the password printed in the old README are flagged.
    expect(report.accountsWithPublishedPassword.sort()).toEqual(['arjun', 'rahul']);
  });

  it('replaces fabricated reputation with numbers derived from stored reviews', async () => {
    const arjun = await User.findById(ids.arjun).lean();
    expect(arjun?.stats).toEqual({
      teachingRating: 3,
      teachingReviews: 1,
      learningRating: null,
      learningReviews: 0,
      sessionsCompleted: 1,
    });
    const raw = await User.collection.findOne({ _id: ids.arjun });
    for (const field of ['ratings', 'streakDays', 'level', 'badges', 'isOnline']) {
      expect(raw, field).not.toHaveProperty(field);
    }
    expect(await Review.countDocuments({ session: ids.done })).toBe(2);
  });

  it('normalises profiles to the new vocabulary', async () => {
    const arjun = await User.findById(ids.arjun).lean();
    expect(arjun).toMatchObject({
      avatar: '',
      headline: '',
      location: '',
      timezone: '',
      availability: { days: ['Monday'], timeSlots: ['evening', 'morning'], hoursPerWeek: 6 },
      preferences: {
        format: ['Video', 'Project-based'],
        sessionLength: 90,
        languages: ['English', 'Hindi'],
      },
      tokenVersion: 0,
      isDemo: false,
    });
    expect(arjun?.skillsTeaching).toEqual([
      { skill: 'Java', proficiency: 'Expert', yearsExperience: 6, description: 'Core Java' },
    ]);
    const rahul = await User.findById(ids.rahul).lean();
    expect(rahul).toMatchObject({
      avatar: 'https://cdn.example.org/me.png',
      timezone: 'Asia/Kolkata',
    });
  });

  it('fixes contract counts and keeps one open exchange per pair', async () => {
    const contract = await LearningContract.findById(ids.contract).lean();
    expect(contract).toMatchObject({ completedSessions: 1, totalSessions: 2, status: 'ACTIVE' });

    const kept = await ExchangeRequest.findById(ids.exchange).lean();
    expect(kept?.status).toBe('ACCEPTED');
    expect(kept?.openPairKey).toBeDefined();
    const closed = await ExchangeRequest.findById(ids.duplicatePending).lean();
    expect(closed?.status).toBe('CANCELLED');
    expect(closed?.openPairKey).toBeUndefined();
  });

  it('gives sessions a teacher, a learner and private file references', async () => {
    const done = await Session.findById(ids.done).lean();
    expect(done?.teacher.toString()).toBe(ids.arjun.toString());
    expect(done?.learner.toString()).toBe(ids.rahul.toString());
    expect(done?.joinedBy).toHaveLength(2);
    expect(done?.reviewedBy.map(String).sort()).toEqual([ids.arjun, ids.rahul].map(String).sort());
    expect(done?.codeEditorState).toEqual({ language: 'javascript', code: '+++' });
    expect(done?.sharedFiles[0]).toMatchObject({
      name: 'Roadmap.pdf',
      storedName: '1791451945332-993852314-Roadmap.pdf',
    });
    const raw = await Session.collection.findOne({ _id: ids.done });
    expect(raw).not.toHaveProperty('host');
    expect(raw).not.toHaveProperty('feedback');
    expect((raw?.sharedFiles as object[])[0]).not.toHaveProperty('url');

    expect((await Session.findById(ids.solo).lean())?.status).toBe('CANCELLED');
  });

  it('is idempotent', async () => {
    const again = await migrateLegacyData();
    expect(again).toMatchObject({ duplicateReviewsRemoved: 0, exchangesClosedAsDuplicates: 0 });
    expect((await User.findById(ids.arjun).lean())?.stats.teachingRating).toBe(3);
    expect((await LearningContract.findById(ids.contract).lean())?.completedSessions).toBe(1);
    expect((await ExchangeRequest.findById(ids.exchange).lean())?.openPairKey).toBeDefined();
  });

  it('leaves a database the new application can serve', async () => {
    const login = request.agent(t.app);
    const res = await login
      .post('/api/auth/login')
      .send({ identifier: 'rahul', password: 'Password123!' });
    expect(res.status).toBe(200);

    const sessions = ((await login.get('/api/sessions')).body as { items: SessionDTO[] }).items;
    expect(sessions.map((s) => s.roomCode).sort()).toEqual([
      'SWAP-LEGACY-DONE',
      'SWAP-LEGACY-NEXT',
    ]);
    expect(sessions.find((s) => s.roomCode === 'SWAP-LEGACY-DONE')?.viewer.hasReviewed).toBe(true);

    const profile = (await request(t.app).get('/api/users/arjun')).body as ProfileResponse;
    expect(profile.user.stats.teachingRating).toBe(3);
    expect(profile.user.skillsTeaching[0]).toMatchObject({
      skill: 'Java',
      rating: 3,
      reviewCount: 1,
    });

    // The demo shortcut does not open migrated accounts: they were never flagged as demo accounts.
    const demo = await request(t.app).post('/api/auth/demo-login').send({ username: 'arjun' });
    expect(demo.status).toBe(404);
  });
});
