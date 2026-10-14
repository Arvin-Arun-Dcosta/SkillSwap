import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Express } from 'express';
import mongoose from 'mongoose';
import { type Socket, io as connect } from 'socket.io-client';
import request from 'supertest';
import { inject } from 'vitest';
import type {
  ClientToServerEvents,
  ContractDTO,
  ExchangeDTO,
  SelfUser,
  ServerToClientEvents,
  SessionDTO,
} from '@skillswap/shared';
import { type AppOptions, createApp } from '../src/app';
import { type Env, parseEnv } from '../src/config/env';
import { createLogger } from '../src/config/logger';
import { type AppContext, noopRealtime } from '../src/context';
import { Session } from '../src/models';
import { type Realtime, createRealtime } from '../src/realtime';

export const TEST_SECRET = 'test-secret-that-is-long-enough-for-hs256';
export const PASSWORD = 'Sup3r-secret!';

export type Agent = ReturnType<typeof request.agent>;
export type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export interface TestApp {
  app: Express;
  ctx: AppContext;
  env: Env;
  uploadDir: string;
  close(): Promise<void>;
}

export async function createTestApp(
  options: AppOptions & { env?: Record<string, string> } = {},
): Promise<TestApp> {
  const uploadDir = mkdtempSync(path.join(tmpdir(), 'skillswap-uploads-'));
  const dbName = `test_${randomBytes(6).toString('hex')}`;
  const base = inject('mongoUri');
  const uri = `${base}${dbName}`;
  const env = parseEnv({
    NODE_ENV: 'test',
    JWT_SECRET: TEST_SECRET,
    MONGODB_URI: uri,
    UPLOAD_DIR: uploadDir,
    MAX_UPLOAD_MB: '1',
    CLIENT_ORIGINS: 'http://localhost:5173',
    ...options.env,
  });
  await mongoose.connect(uri);
  // Unique indexes carry real guarantees in this app, so they must exist before any test runs.
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));

  const ctx: AppContext = { env, log: createLogger(env), realtime: noopRealtime };
  const app = createApp(ctx, {
    rateLimits: { authPer15Min: 1000, apiPerMinute: 10_000 },
    ...options,
  });
  return {
    app,
    ctx,
    env,
    uploadDir,
    close: async () => {
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
      rmSync(uploadDir, { recursive: true, force: true });
    },
  };
}

let counter = 0;

export interface Member {
  agent: Agent;
  user: SelfUser;
  cookie: string;
}

/** Registers a member and returns an agent that carries their session cookie. */
export async function signUp(
  t: TestApp,
  overrides: Partial<{ name: string; username: string; email: string }> = {},
): Promise<Member> {
  counter += 1;
  const username = overrides.username ?? `member${counter}_${randomBytes(3).toString('hex')}`;
  const agent = request.agent(t.app);
  const res = await agent.post('/api/auth/register').send({
    name: overrides.name ?? `Member ${counter}`,
    username,
    email: overrides.email ?? `${username}@example.com`,
    password: PASSWORD,
  });
  if (res.status !== 201) throw new Error(`sign-up failed: ${res.status} ${res.text}`);
  const setCookie = res.headers['set-cookie'] as unknown as string[] | undefined;
  const cookie = setCookie?.[0]?.split(';')[0] ?? '';
  return { agent, user: (res.body as { user: SelfUser }).user, cookie };
}

/** Completes onboarding with the given skills so the member is discoverable and can trade. */
export async function onboard(
  member: Member,
  teaches: string[],
  wants: string[],
  extra: Record<string, unknown> = {},
): Promise<SelfUser> {
  const res = await member.agent.patch('/api/auth/me').send({
    skillsTeaching: teaches.map((skill) => ({
      skill,
      proficiency: 'Advanced',
      yearsExperience: 3,
      description: '',
    })),
    skillsLearning: wants.map((skill) => ({
      skill,
      targetProficiency: 'Intermediate',
      priority: 'High',
      notes: '',
    })),
    onboardingCompleted: true,
    ...extra,
  });
  if (res.status !== 200) throw new Error(`onboarding failed: ${res.status} ${res.text}`);
  member.user = (res.body as { user: SelfUser }).user;
  return member.user;
}

/** Two onboarded members with complementary skills. */
export async function tradingPair(t: TestApp): Promise<{ ana: Member; ben: Member }> {
  const ana = await signUp(t, { name: 'Ana Teacher' });
  const ben = await signUp(t, { name: 'Ben Learner' });
  await onboard(ana, ['Java'], ['Video Editing']);
  await onboard(ben, ['Video Editing'], ['Java']);
  return { ana, ben };
}

export async function propose(from: Member, to: Member, overrides: Record<string, unknown> = {}) {
  return from.agent.post('/api/exchanges').send({
    receiverId: to.user.id,
    teachingSkill: 'Java',
    learningSkill: 'Video Editing',
    message: 'I would love to swap skills with you.',
    sessions: 2,
    durationMinutes: 60,
    goals: ['Learn the basics'],
    ...overrides,
  });
}

/** Proposes and accepts an exchange, returning the resulting contract. */
export async function acceptedContract(
  ana: Member,
  ben: Member,
  overrides: Record<string, unknown> = {},
): Promise<{ exchange: ExchangeDTO; contract: ContractDTO }> {
  const created = await propose(ana, ben, overrides);
  if (created.status !== 201) throw new Error(`proposal failed: ${created.status} ${created.text}`);
  const exchangeId = (created.body as { exchange: ExchangeDTO }).exchange.id;
  const accepted = await ben.agent
    .post(`/api/exchanges/${exchangeId}/action`)
    .send({ action: 'accept' });
  if (accepted.status !== 200)
    throw new Error(`accept failed: ${accepted.status} ${accepted.text}`);
  const exchange = (accepted.body as { exchange: ExchangeDTO }).exchange;
  const contract = await ana.agent.get(`/api/contracts/${exchange.contractId}`);
  return { exchange, contract: (contract.body as { contract: ContractDTO }).contract };
}

export async function schedule(
  member: Member,
  contractId: string,
  skill = 'Java',
): Promise<SessionDTO> {
  const res = await member.agent.post('/api/sessions').send({
    contractId,
    skill,
    scheduledStartTime: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  });
  if (res.status !== 201) throw new Error(`scheduling failed: ${res.status} ${res.text}`);
  return (res.body as { session: SessionDTO }).session;
}

/** Puts a session into the state it has after both members entered the room. */
export async function markBothJoined(session: SessionDTO): Promise<void> {
  await Session.updateOne(
    { _id: session.id },
    {
      $set: { status: 'ACTIVE', actualStartTime: new Date() },
      $addToSet: { joinedBy: { $each: [session.teacher.id, session.learner.id] } },
    },
  );
}

/* ---------- Real-time helpers ---------- */

export interface LiveServer {
  url: string;
  realtime: Realtime;
  close(): Promise<void>;
}

export async function startLiveServer(t: TestApp): Promise<LiveServer> {
  const server = http.createServer(t.app);
  const realtime = createRealtime({ env: t.env, log: t.ctx.log }, server);
  t.ctx.realtime = realtime;
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    realtime,
    close: async () => {
      await realtime.shutdown();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

export function openSocket(
  live: LiveServer,
  cookie: string | null,
  extraHeaders: Record<string, string> = {},
): ClientSocket {
  return connect(live.url, {
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
    extraHeaders: { ...(cookie ? { cookie } : {}), ...extraHeaders },
  });
}

export function connected(socket: ClientSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once('connect', () => resolve());
    socket.once('connect_error', (err) => reject(err));
  });
}

export function once<E extends keyof ServerToClientEvents>(
  socket: ClientSocket,
  event: E,
  timeoutMs = 3000,
): Promise<Parameters<ServerToClientEvents[E]>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${event}`)), timeoutMs);
    (socket as unknown as { once(e: string, cb: (...a: unknown[]) => void): void }).once(
      event,
      (...args: unknown[]) => {
        clearTimeout(timer);
        resolve(args as Parameters<ServerToClientEvents[E]>);
      },
    );
  });
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
