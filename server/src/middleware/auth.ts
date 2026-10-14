import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { AppContext } from '../context';
import { AppError, forbidden, unauthorized } from '../lib/errors';
import { isObjectId } from '../lib/ids';
import { cookieName, verifySession } from '../lib/session-token';
import { User, type UserDoc } from '../models';

declare module 'express-serve-static-core' {
  interface Request {
    user?: UserDoc;
  }
}

/** Resolves the signed-in member from the session cookie, or null. Never throws for bad tokens. */
export async function resolveUser(
  ctx: AppContext,
  token: string | undefined,
): Promise<UserDoc | null> {
  const claims = verifySession(ctx.env, token);
  if (!claims || !isObjectId(claims.sub)) return null;
  const user = await User.findById(claims.sub);
  if (!user || user.tokenVersion !== claims.tv) return null;
  return user;
}

const SUSPENDED = () =>
  new AppError(
    403,
    'account_suspended',
    'This account has been suspended. Contact support if you think this is a mistake.',
  );

export function requireAuth(ctx: AppContext): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const cookies = req.cookies as Record<string, string | undefined> | undefined;
    const user = await resolveUser(ctx, cookies?.[cookieName(ctx.env)]);
    if (!user) throw unauthorized();
    if (user.status === 'SUSPENDED') throw SUSPENDED();
    req.user = user;
    next();
  };
}

/** Attaches the member when a valid session exists; anonymous requests continue untouched. */
export function optionalAuth(ctx: AppContext): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const cookies = req.cookies as Record<string, string | undefined> | undefined;
    const user = await resolveUser(ctx, cookies?.[cookieName(ctx.env)]);
    if (user && user.status === 'ACTIVE') req.user = user;
    next();
  };
}

export const requireAdmin: RequestHandler = (req, _res, next) => {
  if (req.user?.role !== 'ADMIN') throw forbidden('Administrator access is required.');
  next();
};

/** The authenticated member. Only call from routes behind `requireAuth`. */
export function currentUser(req: Request): UserDoc {
  if (!req.user) throw unauthorized();
  return req.user;
}
