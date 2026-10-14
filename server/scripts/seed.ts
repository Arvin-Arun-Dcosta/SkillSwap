/**
 * Seeds demo data into the database named by MONGODB_URI.
 *
 *   npm run seed              seed an empty database
 *   npm run seed -- --reset   delete all SkillSwap data first (asks for --force in production)
 */
import mongoose from 'mongoose';
import { loadDotEnv, parseEnv } from '../src/config/env';
import { createLogger } from '../src/config/logger';
import { DEMO_PASSWORD, clearDatabase, isDatabaseEmpty, seedDemoData } from '../src/seed/demo';

loadDotEnv();
const env = parseEnv(process.env);
const args = new Set(process.argv.slice(2));

if (!env.mongodbUri) {
  console.error(
    'MONGODB_URI is not set. Without it the dev server seeds its in-memory database itself.',
  );
  process.exit(1);
}
if (env.isProduction && !args.has('--force')) {
  console.error('Refusing to seed a production database. Pass --force if you really mean it.');
  process.exit(1);
}

await mongoose.connect(env.mongodbUri);
try {
  if (args.has('--reset')) {
    console.log(`Deleting all SkillSwap data in "${mongoose.connection.name}"...`);
    await clearDatabase();
  } else if (!(await isDatabaseEmpty())) {
    console.error(
      `Database "${mongoose.connection.name}" already has users. Run with --reset to replace everything.`,
    );
    process.exitCode = 1;
  }
  if (process.exitCode !== 1) {
    await seedDemoData({ bcryptRounds: env.bcryptRounds, log: createLogger(env) });
    console.log(
      `Seeded. Demo accounts: arjun, rahul, alex, elena, marcus, admin (password: ${DEMO_PASSWORD})`,
    );
  }
} finally {
  await mongoose.disconnect();
}
