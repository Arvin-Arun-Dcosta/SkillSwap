import { Router } from 'express';
import {
  exchangeActionSchema,
  exchangeCounterSchema,
  exchangeCreateSchema,
  exchangeListQuerySchema,
} from '@skillswap/shared';
import type { AppContext } from '../context';
import { parse, parseId } from '../lib/validate';
import { currentUser, requireAuth } from '../middleware/auth';
import * as contracts from '../services/contracts';
import * as exchanges from '../services/exchanges';

export function exchangeRoutes(ctx: AppContext): Router {
  const router = Router();
  router.use(['/exchanges', '/contracts'], requireAuth(ctx));

  router.get('/exchanges', async (req, res) => {
    const { box } = parse(exchangeListQuerySchema, req.query);
    res.json({ items: await exchanges.listExchanges(currentUser(req), box) });
  });

  router.post('/exchanges', async (req, res) => {
    const exchange = await exchanges.createExchange(
      ctx,
      currentUser(req),
      parse(exchangeCreateSchema, req.body),
    );
    res.status(201).json({ exchange });
  });

  router.post('/exchanges/:id/action', async (req, res) => {
    const { action } = parse(exchangeActionSchema, req.body);
    const exchange = await exchanges.actOnExchange(
      ctx,
      currentUser(req),
      parseId(req.params.id, 'Exchange'),
      action,
    );
    res.json({ exchange });
  });

  router.post('/exchanges/:id/counter', async (req, res) => {
    const exchange = await exchanges.counterExchange(
      ctx,
      currentUser(req),
      parseId(req.params.id, 'Exchange'),
      parse(exchangeCounterSchema, req.body),
    );
    res.json({ exchange });
  });

  router.get('/contracts', async (req, res) => {
    res.json({ items: await contracts.listContracts(currentUser(req)) });
  });

  router.get('/contracts/:id', async (req, res) => {
    res.json({
      contract: await contracts.getContract(currentUser(req), parseId(req.params.id, 'Contract')),
    });
  });

  router.post('/contracts/:id/goals/:goalId/toggle', async (req, res) => {
    const contract = await contracts.toggleGoal(
      currentUser(req),
      parseId(req.params.id, 'Contract'),
      parseId(req.params.goalId, 'Goal'),
    );
    res.json({ contract });
  });

  router.post('/contracts/:id/end', async (req, res) => {
    const contract = await contracts.endContract(
      ctx,
      currentUser(req),
      parseId(req.params.id, 'Contract'),
    );
    res.json({ contract });
  });

  return router;
}
