import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { IceServer } from '@skillswap/shared';

const bool = (fallback: boolean | undefined) =>
  z
    .string()
    .optional()
    .transform((v) => {
      if (v === undefined || v.trim() === '') return fallback;
      return ['1', 'true', 'yes', 'on'].includes(v.trim().toLowerCase());
    });

const iceServerSchema = z.object({
  urls: z.union([z.string(), z.array(z.string())]),
  username: z.string().optional(),
  credential: z.string().optional(),
});

const rawSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(0).max(65535).default(5000),
  MONGODB_URI: z.string().trim().optional(),
  JWT_SECRET: z.string().trim().optional(),
  SESSION_DAYS: z.coerce.number().int().min(1).max(90).default(7),
  CLIENT_ORIGINS: z.string().default('http://localhost:5173'),
  PUBLIC_URL: z.string().trim().optional(),
  DEMO_MODE: bool(undefined),
  SEED_DEMO_DATA: bool(false),
  DEMO_RESET_HOURS: z.coerce.number().int().min(0).max(720).default(0),
  ICE_SERVERS: z.string().optional(),
  UPLOAD_DIR: z.string().default('./server/uploads'),
  MAX_UPLOAD_MB: z.coerce.number().min(1).max(100).default(10),
  TRUST_PROXY: bool(false),
  COOKIE_SECURE: bool(undefined),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).optional(),
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).optional(),
});

export interface Env {
  nodeEnv: 'development' | 'test' | 'production';
  isProduction: boolean;
  isTest: boolean;
  port: number;
  mongodbUri: string | null;
  jwtSecret: string;
  /** True when the secret was generated at boot because none was configured (development only). */
  jwtSecretIsEphemeral: boolean;
  sessionDays: number;
  clientOrigins: string[];
  publicUrl: string | null;
  demoMode: boolean;
  /** Seed demo data at startup when the database has no members (always on for in-memory MongoDB). */
  seedDemoData: boolean;
  /** Replace all data with fresh demo data once it is this many hours old; 0 never resets. */
  demoResetHours: number;
  iceServers: IceServer[];
  uploadDir: string;
  maxUploadBytes: number;
  trustProxy: boolean;
  /** Send the session cookie only over HTTPS. On by default in production. */
  cookieSecure: boolean;
  /** True when the site is known to be served over HTTPS (PUBLIC_URL starts with https://). */
  https: boolean;
  logLevel: string;
  bcryptRounds: number;
}

export class EnvError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Invalid environment configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'EnvError';
  }
}

/** The repository root: the nearest ancestor of the working directory that has a `shared` folder. */
export function findRepoRoot(start = process.cwd()): string {
  let dir = path.resolve(start);
  for (let i = 0; i < 4; i += 1) {
    if (existsSync(path.join(dir, 'shared')) && existsSync(path.join(dir, 'server'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(start);
}

/** Loads `.env` from the repository root when present. Existing variables win. */
export function loadDotEnv(): void {
  const file = path.join(findRepoRoot(), '.env');
  if (existsSync(file)) process.loadEnvFile(file);
}

const PLACEHOLDER_SECRET = /change-me|your_jwt_secret|skillswap_super_secret/i;

export function parseEnv(source: NodeJS.ProcessEnv): Env {
  const parsed = rawSchema.safeParse(source);
  if (!parsed.success) {
    throw new EnvError(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
  }
  const raw = parsed.data;
  const problems: string[] = [];
  const isProduction = raw.NODE_ENV === 'production';
  const isTest = raw.NODE_ENV === 'test';

  let jwtSecret = raw.JWT_SECRET ?? '';
  let jwtSecretIsEphemeral = false;
  if (jwtSecret === '') {
    if (isProduction) {
      problems.push(
        'JWT_SECRET is required in production (generate one with: openssl rand -base64 48)',
      );
    } else {
      jwtSecret = randomBytes(48).toString('base64');
      jwtSecretIsEphemeral = true;
    }
  } else if (jwtSecret.length < 32) {
    problems.push('JWT_SECRET must be at least 32 characters long');
  } else if (isProduction && PLACEHOLDER_SECRET.test(jwtSecret)) {
    problems.push('JWT_SECRET is still a placeholder value; set a real random secret');
  }

  const mongodbUri = raw.MONGODB_URI && raw.MONGODB_URI !== '' ? raw.MONGODB_URI : null;
  if (mongodbUri === null && isProduction) {
    problems.push('MONGODB_URI is required in production');
  }
  if (mongodbUri !== null && !/^mongodb(\+srv)?:\/\//.test(mongodbUri)) {
    problems.push('MONGODB_URI must start with mongodb:// or mongodb+srv://');
  }

  const clientOrigins = raw.CLIENT_ORIGINS.split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean);
  for (const origin of clientOrigins) {
    if (!URL.canParse(origin))
      problems.push(`CLIENT_ORIGINS contains an invalid origin: ${origin}`);
  }

  let publicUrl: string | null = null;
  if (raw.PUBLIC_URL && raw.PUBLIC_URL !== '') {
    if (URL.canParse(raw.PUBLIC_URL)) publicUrl = raw.PUBLIC_URL.replace(/\/$/, '');
    else problems.push('PUBLIC_URL must be an absolute URL such as https://skillswap.example');
  }

  let iceServers: IceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
  if (raw.ICE_SERVERS && raw.ICE_SERVERS.trim() !== '') {
    try {
      iceServers = z.array(iceServerSchema).parse(JSON.parse(raw.ICE_SERVERS));
    } catch {
      problems.push('ICE_SERVERS must be a JSON array like [{"urls":"stun:stun.example.org"}]');
    }
  }

  if (problems.length > 0) throw new EnvError(problems);

  const uploadDir = path.isAbsolute(raw.UPLOAD_DIR)
    ? raw.UPLOAD_DIR
    : path.resolve(findRepoRoot(), raw.UPLOAD_DIR);

  return {
    nodeEnv: raw.NODE_ENV,
    isProduction,
    isTest,
    port: raw.PORT,
    mongodbUri,
    jwtSecret,
    jwtSecretIsEphemeral,
    sessionDays: raw.SESSION_DAYS,
    clientOrigins,
    publicUrl,
    demoMode: raw.DEMO_MODE ?? !isProduction,
    seedDemoData: raw.SEED_DEMO_DATA || raw.DEMO_RESET_HOURS > 0,
    demoResetHours: raw.DEMO_RESET_HOURS,
    iceServers,
    uploadDir,
    maxUploadBytes: Math.round(raw.MAX_UPLOAD_MB * 1024 * 1024),
    trustProxy: raw.TRUST_PROXY ?? false,
    cookieSecure: raw.COOKIE_SECURE ?? isProduction,
    https: publicUrl?.startsWith('https://') ?? false,
    logLevel: raw.LOG_LEVEL ?? (isTest ? 'silent' : isProduction ? 'info' : 'debug'),
    bcryptRounds: raw.BCRYPT_ROUNDS ?? (isTest ? 4 : 12),
  };
}
