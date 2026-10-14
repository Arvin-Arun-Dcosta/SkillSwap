import { describe, expect, it } from 'vitest';
import { EnvError, parseEnv } from '../src/config/env';

const valid = {
  NODE_ENV: 'production',
  JWT_SECRET: 'k9f3h2j5m8q1w4e7r0t6y3u2i5o8p1a4s7d0',
  MONGODB_URI: 'mongodb://db.internal:27017/skillswap',
};

const problemsOf = (source: Record<string, string>) => {
  try {
    parseEnv(source);
    return [];
  } catch (err) {
    if (err instanceof EnvError) return err.problems;
    throw err;
  }
};

describe('environment validation', () => {
  it('accepts a complete production configuration', () => {
    const env = parseEnv(valid);
    expect(env.isProduction).toBe(true);
    expect(env.demoMode).toBe(false);
    expect(env.bcryptRounds).toBe(12);
  });

  it('refuses to start in production without a JWT secret', () => {
    const { JWT_SECRET: _omitted, ...rest } = valid;
    expect(problemsOf(rest).join(' ')).toMatch(/JWT_SECRET is required/);
  });

  it('refuses the legacy hard-coded secret and placeholder values in production', () => {
    expect(
      problemsOf({ ...valid, JWT_SECRET: 'skillswap_super_secret_jwt_key_2026_xyz' }).join(' '),
    ).toMatch(/placeholder/);
    expect(
      problemsOf({
        ...valid,
        JWT_SECRET: 'change-me-to-a-long-random-string-of-at-least-32-chars',
      }).join(' '),
    ).toMatch(/placeholder/);
  });

  it('rejects short secrets everywhere', () => {
    expect(problemsOf({ NODE_ENV: 'development', JWT_SECRET: 'short' }).join(' ')).toMatch(
      /32 characters/,
    );
  });

  it('generates a random secret in development instead of using a fixed fallback', () => {
    const a = parseEnv({ NODE_ENV: 'development' });
    const b = parseEnv({ NODE_ENV: 'development' });
    expect(a.jwtSecretIsEphemeral).toBe(true);
    expect(a.jwtSecret.length).toBeGreaterThanOrEqual(32);
    expect(a.jwtSecret).not.toBe(b.jwtSecret);
  });

  it('requires a database in production and validates its scheme', () => {
    const { MONGODB_URI: _omitted, ...rest } = valid;
    expect(problemsOf(rest).join(' ')).toMatch(/MONGODB_URI is required/);
    expect(problemsOf({ ...valid, MONGODB_URI: 'postgres://x' }).join(' ')).toMatch(/mongodb:\/\//);
  });

  it('turns demo mode on by default only outside production', () => {
    expect(parseEnv({ NODE_ENV: 'development' }).demoMode).toBe(true);
    expect(parseEnv(valid).demoMode).toBe(false);
    expect(parseEnv({ ...valid, DEMO_MODE: 'true' }).demoMode).toBe(true);
  });

  it('seeds or resets demo data only when asked to', () => {
    expect(parseEnv(valid)).toMatchObject({ seedDemoData: false, demoResetHours: 0 });
    expect(parseEnv({ ...valid, SEED_DEMO_DATA: 'true' }).seedDemoData).toBe(true);
    // A reset interval implies seeding.
    expect(parseEnv({ ...valid, DEMO_RESET_HOURS: '24' })).toMatchObject({
      seedDemoData: true,
      demoResetHours: 24,
    });
    expect(problemsOf({ ...valid, DEMO_RESET_HOURS: '-1' }).join(' ')).toMatch(/DEMO_RESET_HOURS/);
  });

  it('secures the cookie in production and enables HTTPS-only headers when the site URL is https', () => {
    expect(parseEnv(valid)).toMatchObject({ cookieSecure: true, https: false });
    expect(parseEnv({ ...valid, PUBLIC_URL: 'https://skillswap.example/' })).toMatchObject({
      https: true,
      publicUrl: 'https://skillswap.example',
    });
    expect(parseEnv({ ...valid, COOKIE_SECURE: 'false' }).cookieSecure).toBe(false);
    expect(parseEnv({ NODE_ENV: 'development' }).cookieSecure).toBe(false);
  });

  it('validates ICE servers and origins', () => {
    expect(problemsOf({ ...valid, ICE_SERVERS: 'not json' }).join(' ')).toMatch(/ICE_SERVERS/);
    expect(problemsOf({ ...valid, CLIENT_ORIGINS: 'nope' }).join(' ')).toMatch(/CLIENT_ORIGINS/);
    const env = parseEnv({
      ...valid,
      ICE_SERVERS: '[{"urls":"turn:t.example:3478","username":"u","credential":"c"}]',
    });
    expect(env.iceServers[0]?.username).toBe('u');
  });
});
