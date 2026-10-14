import pino, { type Logger } from 'pino';
import type { Env } from './env';

export function createLogger(env: Pick<Env, 'logLevel' | 'isProduction' | 'isTest'>): Logger {
  return pino({
    level: env.logLevel,
    base: { service: 'skillswap-api' },
    redact: {
      paths: [
        'req.headers.cookie',
        'req.headers.authorization',
        'res.headers["set-cookie"]',
        '*.password',
        '*.currentPassword',
        '*.newPassword',
      ],
      censor: '[redacted]',
    },
    ...(env.isProduction || env.isTest
      ? {}
      : {
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname,service' },
          },
        }),
  });
}

export type { Logger };
