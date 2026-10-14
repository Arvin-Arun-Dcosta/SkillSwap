import type { CookieOptions } from 'express';
import jwt from 'jsonwebtoken';
import type { Env } from '../config/env';

export interface SessionClaims {
  sub: string;
  /** Token version of the user at the time of issue. */
  tv: number;
}

type TokenEnv = Pick<Env, 'jwtSecret' | 'sessionDays' | 'cookieSecure'>;

/** `__Host-` binds the cookie to this exact host over HTTPS; browsers reject it otherwise. */
export const cookieName = (env: Pick<Env, 'cookieSecure'>) =>
  env.cookieSecure ? '__Host-skillswap' : 'skillswap_session';

export function signSession(env: TokenEnv, claims: SessionClaims): string {
  return jwt.sign(claims, env.jwtSecret, {
    algorithm: 'HS256',
    expiresIn: `${env.sessionDays}d`,
  });
}

export function verifySession(env: TokenEnv, token: string | undefined): SessionClaims | null {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, env.jwtSecret, { algorithms: ['HS256'] });
    if (typeof payload !== 'object' || payload === null) return null;
    const { sub, tv } = payload as Record<string, unknown>;
    if (typeof sub !== 'string' || typeof tv !== 'number') return null;
    return { sub, tv };
  } catch {
    return null;
  }
}

export function cookieOptions(env: TokenEnv): CookieOptions {
  return {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: 'lax',
    path: '/',
    maxAge: env.sessionDays * 24 * 60 * 60 * 1000,
  };
}

/** Reads one cookie from a raw `Cookie` header (used for the WebSocket handshake). */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) {
      try {
        return decodeURIComponent(part.slice(index + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}
