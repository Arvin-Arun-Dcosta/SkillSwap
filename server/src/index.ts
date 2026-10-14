import { existsSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { EnvError, findRepoRoot, loadDotEnv, parseEnv } from './config/env';
import { createLogger } from './config/logger';
import { type AppContext, noopRealtime } from './context';
import { createApp } from './app';
import { connectDatabase } from './db/connect';
import { createRealtime } from './realtime';
import { refreshDemoData } from './seed/demo';

async function main(): Promise<void> {
  loadDotEnv();
  let env;
  try {
    env = parseEnv(process.env);
  } catch (err) {
    if (err instanceof EnvError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }

  const log = createLogger(env);
  if (env.jwtSecretIsEphemeral) {
    log.warn(
      'JWT_SECRET is not set: using a random secret for this run. Sign-ins reset on restart.',
    );
  }

  // Connect before listening so the server never accepts requests it cannot serve.
  const database = await connectDatabase(env, log);
  const demoData = {
    bcryptRounds: env.bcryptRounds,
    resetHours: env.demoResetHours,
    uploadDir: env.uploadDir,
    log,
  };
  if (database.inMemory || env.seedDemoData) {
    const result = await refreshDemoData(demoData);
    if (result !== 'unchanged') log.info({ result }, 'demo data ready');
  }

  const ctx: AppContext = { env, log, realtime: noopRealtime };
  const clientDir = path.join(findRepoRoot(), 'client', 'dist');
  const app = createApp(ctx, { clientDir: existsSync(clientDir) ? clientDir : null });
  const server = http.createServer(app);
  const realtime = createRealtime({ env, log }, server);
  ctx.realtime = realtime;

  if (env.demoResetHours > 0) {
    // Checked hourly; skipped while anyone is connected so nobody loses a live session.
    const timer = setInterval(() => {
      if (realtime.onlineUserIds().length > 0) return;
      refreshDemoData(demoData).then(
        (result) => {
          if (result === 'reset') log.info('demo data reset');
        },
        (err: unknown) => log.error({ err }, 'could not reset demo data'),
      );
    }, 60 * 60_000);
    timer.unref();
  }

  server.listen(env.port, () => {
    log.info(
      {
        port: env.port,
        env: env.nodeEnv,
        demoMode: env.demoMode,
        servingClient: existsSync(clientDir),
      },
      `SkillSwap API listening on http://localhost:${env.port}`,
    );
  });

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info({ signal }, 'shutting down');
    const force = setTimeout(() => {
      log.error('shutdown timed out; exiting');
      process.exit(1);
    }, 10_000);
    force.unref();
    void (async () => {
      try {
        // Saves open shared documents, then closes sockets and the HTTP server.
        await realtime.shutdown();
        await new Promise<void>((resolve) => server.close(() => resolve()));
        await database.stop();
        process.exit(0);
      } catch (err) {
        log.error({ err }, 'error during shutdown');
        process.exit(1);
      }
    })();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => {
    log.error({ err: reason }, 'unhandled promise rejection');
  });
}

main().catch((err: unknown) => {
  console.error('Failed to start the server:', err);
  process.exit(1);
});
