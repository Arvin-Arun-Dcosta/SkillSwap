import { Router } from 'express';
import { discoverQuerySchema, reportCreateSchema } from '@skillswap/shared';
import type { AppContext } from '../context';
import { parse } from '../lib/validate';
import { currentUser, optionalAuth, requireAuth } from '../middleware/auth';
import { getDashboard } from '../services/dashboard';
import * as users from '../services/users';

export function userRoutes(ctx: AppContext): Router {
  const router = Router();

  router.get('/users/discover', optionalAuth(ctx), async (req, res) => {
    res.json(await users.discover(ctx, req.user, parse(discoverQuerySchema, req.query)));
  });

  router.post('/users/report', requireAuth(ctx), async (req, res) => {
    await users.reportUser(currentUser(req), parse(reportCreateSchema, req.body));
    res.status(201).json({ ok: true });
  });

  router.get('/users/:identifier', optionalAuth(ctx), async (req, res) => {
    const identifier = String(req.params.identifier ?? '').slice(0, 64);
    res.json(await users.getProfile(ctx, req.user, identifier));
  });

  router.get('/skills', async (_req, res) => {
    res.set('Cache-Control', 'public, max-age=60');
    res.json({ items: await users.listSkills() });
  });

  router.get('/dashboard', requireAuth(ctx), async (req, res) => {
    res.json(await getDashboard(ctx, currentUser(req)));
  });

  return router;
}
