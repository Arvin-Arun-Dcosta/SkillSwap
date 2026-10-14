import mongoose from 'mongoose';
import type { Env } from '../config/env';
import type { Logger } from '../config/logger';

export interface Database {
  uri: string;
  /** True when the server started its own throwaway MongoDB (development without MONGODB_URI). */
  inMemory: boolean;
  stop(): Promise<void>;
}

export async function connectDatabase(
  env: Pick<Env, 'mongodbUri' | 'isProduction'>,
  log: Logger,
): Promise<Database> {
  mongoose.set('strictQuery', true);

  if (env.mongodbUri) {
    await mongoose.connect(env.mongodbUri, { serverSelectionTimeoutMS: 8000 });
    log.info({ database: mongoose.connection.name }, 'connected to MongoDB');
    return {
      uri: env.mongodbUri,
      inMemory: false,
      stop: () => mongoose.disconnect(),
    };
  }

  if (env.isProduction) throw new Error('MONGODB_URI is required in production');

  // Development convenience: no database configured, so run a private in-memory one.
  const { MongoMemoryServer } = await import('mongodb-memory-server');
  log.warn(
    'MONGODB_URI is not set: starting an in-memory MongoDB. Data is lost when the server stops.',
  );
  const memory = await MongoMemoryServer.create();
  const uri = memory.getUri('skillswap_dev');
  await mongoose.connect(uri);
  return {
    uri,
    inMemory: true,
    stop: async () => {
      await mongoose.disconnect();
      await memory.stop();
    },
  };
}
