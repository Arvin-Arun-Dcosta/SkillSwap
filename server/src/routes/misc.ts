import { Router } from 'express';
import mongoose from 'mongoose';
import {
  adminUserStatusSchema,
  adminUsersQuerySchema,
  reportResolveSchema,
} from '@skillswap/shared';
import type { AppContext } from '../context';
import { parse, parseId } from '../lib/validate';
import { currentUser, requireAdmin, requireAuth } from '../middleware/auth';
import * as admin from '../services/admin';
import * as notifications from '../services/notifications';

export function notificationRoutes(ctx: AppContext): Router {
  const router = Router();
  router.use('/notifications', requireAuth(ctx));

  router.get('/notifications', async (req, res) => {
    res.json(await notifications.listNotifications(currentUser(req)._id.toString()));
  });

  router.post('/notifications/read-all', async (req, res) => {
    await notifications.markAllRead(currentUser(req)._id.toString());
    res.status(204).end();
  });

  router.post('/notifications/:id/read', async (req, res) => {
    await notifications.markRead(
      currentUser(req)._id.toString(),
      parseId(req.params.id, 'Notification'),
    );
    res.status(204).end();
  });

  return router;
}

export function adminRoutes(ctx: AppContext): Router {
  const router = Router();
  router.use(requireAuth(ctx), requireAdmin);

  router.get('/stats', async (_req, res) => {
    res.json(await admin.getStats());
  });

  router.get('/users', async (req, res) => {
    res.json(await admin.listUsers(parse(adminUsersQuerySchema, req.query)));
  });

  router.post('/users/:id/status', async (req, res) => {
    const { status } = parse(adminUserStatusSchema, req.body);
    const user = await admin.setUserStatus(
      ctx,
      currentUser(req),
      parseId(req.params.id, 'Member'),
      status,
    );
    res.json({ user });
  });

  router.get('/reports', async (_req, res) => {
    res.json({ items: await admin.listReports() });
  });

  router.post('/reports/:id/resolve', async (req, res) => {
    const report = await admin.resolveReport(
      ctx,
      currentUser(req),
      parseId(req.params.id, 'Report'),
      parse(reportResolveSchema, req.body),
    );
    res.json({ report });
  });

  return router;
}

export function healthRoutes(): Router {
  const router = Router();

  /** Liveness: the process is up and able to answer. */
  router.get('/health', (_req, res) => {
    res.json({ status: 'ok', uptimeSeconds: Math.round(process.uptime()) });
  });

  /** Readiness: the database answers a ping. Load balancers should use this one. */
  router.get('/health/ready', async (_req, res) => {
    try {
      if (
        mongoose.connection.readyState !== mongoose.ConnectionStates.connected ||
        !mongoose.connection.db
      ) {
        throw new Error('not connected');
      }
      await mongoose.connection.db.admin().ping();
      res.json({ status: 'ready', database: 'up' });
    } catch {
      res.status(503).json({ status: 'unavailable', database: 'down' });
    }
  });

  return router;
}
