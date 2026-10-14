import { type Response, Router } from 'express';
import {
  type AppConfig,
  changePasswordSchema,
  demoLoginSchema,
  loginSchema,
  profileUpdateSchema,
  registerSchema,
} from '@skillswap/shared';
import type { AppContext } from '../context';
import { cookieName, cookieOptions, signSession } from '../lib/session-token';
import { parse } from '../lib/validate';
import { currentUser, optionalAuth, requireAuth } from '../middleware/auth';
import type { createRateLimiters } from '../middleware/security';
import type { UserDoc } from '../models';
import { toSelfUser } from '../serializers';
import * as auth from '../services/auth';
import { skillRatingsFor } from '../services/stats';
import { clearSkillCache } from '../services/users';

export function authRoutes(
  ctx: AppContext,
  limiters: ReturnType<typeof createRateLimiters>,
): Router {
  const router = Router();

  const startSession = (res: Response, user: UserDoc) => {
    const token = signSession(ctx.env, { sub: user._id.toString(), tv: user.tokenVersion });
    res.cookie(cookieName(ctx.env), token, cookieOptions(ctx.env));
  };

  const self = async (user: UserDoc) => {
    const id = user._id.toString();
    const ratings = await skillRatingsFor([id]);
    return toSelfUser(user.toObject(), {
      isOnline: ctx.realtime.isOnline(id),
      skillRatings: ratings.get(id),
    });
  };

  router.get('/config', async (_req, res) => {
    const config: AppConfig = {
      demoMode: ctx.env.demoMode,
      demoAccounts: await auth.listDemoAccounts(ctx),
      demoResetHours: ctx.env.demoResetHours,
      iceServers: ctx.env.iceServers,
      maxUploadMb: Math.round(ctx.env.maxUploadBytes / (1024 * 1024)),
    };
    res.json(config);
  });

  router.post('/register', limiters.auth, async (req, res) => {
    const user = await auth.register(ctx, parse(registerSchema, req.body));
    startSession(res, user);
    res.status(201).json({ user: await self(user) });
  });

  router.post('/login', limiters.auth, async (req, res) => {
    const user = await auth.login(ctx, parse(loginSchema, req.body));
    startSession(res, user);
    res.json({ user: await self(user) });
  });

  router.post('/demo-login', limiters.auth, async (req, res) => {
    const { username } = parse(demoLoginSchema, req.body);
    const user = await auth.demoLogin(ctx, username);
    startSession(res, user);
    res.json({ user: await self(user) });
  });

  router.post('/logout', (_req, res) => {
    const { maxAge: _maxAge, ...options } = cookieOptions(ctx.env);
    res.clearCookie(cookieName(ctx.env), options);
    res.status(204).end();
  });

  // Answers 200 with `user: null` when signed out: "who am I?" is a question, not a protected
  // resource, and a 401 here would log an error in every anonymous visitor's console.
  router.get('/me', optionalAuth(ctx), async (req, res) => {
    res.json({ user: req.user ? await self(req.user) : null });
  });

  router.patch('/me', requireAuth(ctx), async (req, res) => {
    const user = await auth.updateProfile(currentUser(req), parse(profileUpdateSchema, req.body));
    clearSkillCache();
    res.json({ user: await self(user) });
  });

  router.post('/password', requireAuth(ctx), limiters.auth, async (req, res) => {
    const user = await auth.changePassword(
      ctx,
      currentUser(req),
      parse(changePasswordSchema, req.body),
    );
    // Other devices lose their session; this one gets a fresh cookie.
    ctx.realtime.disconnectUser(user._id.toString());
    startSession(res, user);
    res.status(204).end();
  });

  return router;
}
