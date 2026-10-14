import { randomUUID } from 'node:crypto';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import express, { type Express, type RequestHandler } from 'express';
import { pinoHttp } from 'pino-http';
import type { AppContext } from './context';
import { apiNotFound, errorHandler } from './middleware/error';
import {
  type RateLimitSettings,
  allowedOrigins,
  createRateLimiters,
  defaultRateLimits,
  originGuard,
  permissionsPolicy,
  securityHeaders,
} from './middleware/security';
import { authRoutes } from './routes/auth';
import { exchangeRoutes } from './routes/exchanges';
import { adminRoutes, healthRoutes, notificationRoutes } from './routes/misc';
import { sessionRoutes } from './routes/sessions';
import { userRoutes } from './routes/users';
import { mountWeb } from './web';

export interface AppOptions {
  rateLimits?: Partial<RateLimitSettings>;
  /** Directory of the built client, or null to serve the API only. */
  clientDir?: string | null;
}

/** CORS for a client hosted on another origin of the same site. Same-origin requests skip it. */
function cors(ctx: AppContext): RequestHandler {
  const allowed = allowedOrigins(ctx.env);
  return (req, res, next) => {
    const origin = req.get('origin');
    if (origin && allowed.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.vary('Origin');
      if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        res.setHeader('Access-Control-Max-Age', '600');
        res.status(204).end();
        return;
      }
    }
    next();
  };
}

export function createApp(ctx: AppContext, options: AppOptions = {}): Express {
  const { env, log } = ctx;
  const app = express();
  app.disable('x-powered-by');
  if (env.trustProxy) app.set('trust proxy', 1);

  app.use(
    pinoHttp({
      logger: log,
      genReqId: (_req, res) => {
        const id = randomUUID();
        res.setHeader('X-Request-Id', id);
        return id;
      },
      autoLogging: { ignore: (req) => (req.url ?? '').startsWith('/api/health') },
      customLogLevel: (_req, res, err) => {
        if (err || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
      serializers: {
        req: (req: { id: string; method: string; url: string }) => ({
          id: req.id,
          method: req.method,
          url: req.url,
        }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
    }),
  );
  app.use(securityHeaders(env));
  app.use(permissionsPolicy);
  app.use(compression());

  const limiters = createRateLimiters({ ...defaultRateLimits(env), ...options.rateLimits });

  const api = express.Router();
  api.use(healthRoutes());
  api.use(cors(ctx));
  api.use(limiters.api);
  api.use(express.json({ limit: '100kb' }));
  api.use(cookieParser());
  api.use(originGuard(env));
  api.use((_req, res, next) => {
    // API responses are per-member and must never be stored by shared caches.
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  api.use('/auth', authRoutes(ctx, limiters));
  api.use(userRoutes(ctx));
  api.use(exchangeRoutes(ctx));
  api.use(sessionRoutes(ctx, limiters));
  api.use(notificationRoutes(ctx));
  api.use('/admin', adminRoutes(ctx));
  api.use(apiNotFound);
  app.use('/api', api);

  mountWeb(app, ctx, options.clientDir ?? null);

  app.use(errorHandler(log));
  return app;
}
