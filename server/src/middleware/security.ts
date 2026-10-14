import type { Request, RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import type { Env } from '../config/env';
import { AppError } from '../lib/errors';

export interface RateLimitSettings {
  /** Sign-in, sign-up and demo sign-in attempts per IP per 15 minutes. */
  authPer15Min: number;
  /** All other API requests per IP per minute. */
  apiPerMinute: number;
  /** File uploads per IP per 10 minutes. */
  uploadsPer10Min: number;
}

export const defaultRateLimits = (env: Pick<Env, 'isProduction'>): RateLimitSettings => ({
  authPer15Min: env.isProduction ? 20 : 200,
  apiPerMinute: env.isProduction ? 300 : 3000,
  uploadsPer10Min: 30,
});

const limiter = (windowMs: number, limit: number, message: string) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, _res, next) => next(new AppError(429, 'rate_limited', message)),
  });

export function createRateLimiters(settings: RateLimitSettings) {
  return {
    auth: limiter(
      15 * 60 * 1000,
      settings.authPer15Min,
      'Too many attempts. Please wait a few minutes and try again.',
    ),
    api: limiter(60 * 1000, settings.apiPerMinute, 'Too many requests. Please slow down.'),
    uploads: limiter(
      10 * 60 * 1000,
      settings.uploadsPer10Min,
      'Too many uploads. Please try again later.',
    ),
  };
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Origins that may send credentialed, state-changing requests. */
export function allowedOrigins(env: Pick<Env, 'clientOrigins' | 'publicUrl'>): Set<string> {
  const origins = new Set(env.clientOrigins);
  if (env.publicUrl) origins.add(new URL(env.publicUrl).origin);
  return origins;
}

export function isAllowedOrigin(
  origin: string | undefined,
  host: string | undefined,
  protocol: string,
  allowed: Set<string>,
): boolean {
  // Non-browser clients send no Origin; they also cannot carry a victim's cookie.
  if (!origin) return true;
  if (allowed.has(origin)) return true;
  return host !== undefined && origin === `${protocol}://${host}`;
}

/**
 * CSRF defence in addition to SameSite cookies: state-changing requests must come from this site.
 * Browsers attach `Origin` to every cross-origin request and to same-origin unsafe requests.
 */
export function originGuard(env: Pick<Env, 'clientOrigins' | 'publicUrl'>): RequestHandler {
  const allowed = allowedOrigins(env);
  return (req: Request, _res, next) => {
    if (SAFE_METHODS.has(req.method)) return next();
    const ok =
      isAllowedOrigin(req.get('origin'), req.get('host'), req.protocol, allowed) &&
      req.get('sec-fetch-site') !== 'cross-site';
    if (!ok) throw new AppError(403, 'bad_origin', 'This request came from an untrusted origin.');
    next();
  };
}

export function securityHeaders(env: Pick<Env, 'https' | 'publicUrl'>): RequestHandler {
  const connectSrc = ["'self'"];
  if (env.publicUrl) {
    const url = new URL(env.publicUrl);
    connectSrc.push(`${url.protocol === 'https:' ? 'wss' : 'ws'}://${url.host}`);
  }
  return helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        scriptSrc: ["'self'"],
        // CodeMirror injects its theme as a <style> element at runtime.
        styleSrc: ["'self'", "'unsafe-inline'"],
        // Members may point their avatar at any https image.
        imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
        fontSrc: ["'self'"],
        connectSrc,
        mediaSrc: ["'self'", 'blob:'],
        workerSrc: ["'self'", 'blob:'],
        frameSrc: ["'self'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
        objectSrc: ["'none'"],
        // Only when the site is known to be on HTTPS; otherwise a plain-HTTP trial run would break.
        ...(env.https ? { upgradeInsecureRequests: [] } : {}),
      },
    },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    strictTransportSecurity: env.https ? { maxAge: 15552000, includeSubDomains: true } : false,
  });
}

/** Camera, microphone and screen capture are only ever used by this site itself. */
export const permissionsPolicy: RequestHandler = (_req, res, next) => {
  res.setHeader(
    'Permissions-Policy',
    'camera=(self), microphone=(self), display-capture=(self), geolocation=(), payment=(), usb=()',
  );
  next();
};
