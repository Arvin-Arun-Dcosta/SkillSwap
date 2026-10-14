/**
 * Upgrades a SkillSwap 1.x database to the 2.0 data model, in place.
 *
 *   npm run migrate
 *
 * Back the database up first. The script is idempotent.
 */
import mongoose from 'mongoose';
import { loadDotEnv, parseEnv } from '../src/config/env';
import { migrateLegacyData } from '../src/migrate/v2';

loadDotEnv();
const env = parseEnv(process.env);
if (!env.mongodbUri) {
  console.error('MONGODB_URI is not set.');
  process.exit(1);
}

await mongoose.connect(env.mongodbUri, { autoIndex: false });
try {
  console.log(`Migrating database "${mongoose.connection.name}"...`);
  const report = await migrateLegacyData();
  console.log(`  members updated:                     ${report.users}`);
  console.log(`  sessions updated:                    ${report.sessionsUpdated}`);
  console.log(`  contracts marked completed:          ${report.contractsCompleted}`);
  console.log(`  duplicate open exchanges closed:     ${report.exchangesClosedAsDuplicates}`);
  console.log(`  duplicate reviews removed:           ${report.duplicateReviewsRemoved}`);
  if (report.accountsWithPublishedPassword.length > 0) {
    console.warn(
      `\nWARNING: these accounts still accept the password published in the old README:\n  ${report.accountsWithPublishedPassword.join(', ')}\n` +
        'Delete them or change their passwords before exposing this database to the internet.',
    );
  }
  console.log('\nDone.');
} finally {
  await mongoose.disconnect();
}
