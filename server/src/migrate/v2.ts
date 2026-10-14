import path from 'node:path';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import {
  DAYS,
  EDITOR_LANGUAGE_IDS,
  PRIORITIES,
  PROFICIENCY_LEVELS,
  SESSION_FORMATS,
  type TimeSlotId,
} from '@skillswap/shared';
import { pairKey } from '../lib/ids';
import {
  ExchangeRequest,
  LearningContract,
  Message,
  Notification,
  Report,
  Review,
  Session,
  Skill,
  User,
} from '../models';
import { recomputeUserStats } from '../services/stats';

export interface MigrationReport {
  users: number;
  exchangesClosedAsDuplicates: number;
  contractsCompleted: number;
  sessionsUpdated: number;
  duplicateReviewsRemoved: number;
  /** Accounts that still accept the password published in the old README. */
  accountsWithPublishedPassword: string[];
}

type Raw = Record<string, unknown>;
const LEGACY_SEED_PASSWORD = 'Password123!';
const HOTLINKED_AVATAR = /images\.unsplash\.com|api\.dicebear\.com/;
const LEGACY_PLACEHOLDERS = new Set(['Passionate Skill Exchanger', 'Remote / Global']);

const asString = (value: unknown, max: number) =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const oneOf = <T extends string>(allowed: readonly T[], value: unknown, fallback: T): T =>
  (allowed as readonly unknown[]).includes(value) ? (value as T) : fallback;

function validTimezone(value: unknown): string {
  if (typeof value !== 'string' || value === '') return '';
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    // "UTC+05:30"-style offsets are accepted by some runtimes but are not IANA zone names.
    return /^[A-Za-z_]+(\/[A-Za-z_+-]+)*$/.test(value) ? value : '';
  } catch {
    return '';
  }
}

function mapSlot(value: unknown): TimeSlotId | null {
  if (typeof value !== 'string') return null;
  const v = value.toLowerCase();
  if (['morning', 'afternoon', 'evening', 'night'].includes(v)) return v as TimeSlotId;
  if (v.includes('morning')) return 'morning';
  if (v.includes('afternoon')) return 'afternoon';
  if (v.includes('evening')) return 'evening';
  if (v.includes('night')) return 'night';
  return null;
}

function mapSessionLength(value: unknown): number {
  if (typeof value === 'number' && [30, 45, 60, 90].includes(value)) return value;
  const text = typeof value === 'string' ? value.toLowerCase() : '';
  if (text.includes('90') || text.includes('long')) return 90;
  if (text.includes('30') || text.includes('45') || text.includes('short')) return 45;
  return 60;
}

function uniqueBySkill<T extends { skill: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.skill.toLowerCase();
    if (item.skill === '' || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function migrateUsers(): Promise<number> {
  const users = User.collection;
  let count = 0;
  for await (const doc of users.find({})) {
    const user = doc as Raw;
    const availability = (user.availability ?? {}) as Raw;
    const preferences = (user.preferences ?? {}) as Raw;
    const avatar = asString(user.avatar, 500);
    const headline = asString(user.headline, 120);
    const location = asString(user.location, 80);
    const languages = asArray(preferences.languages)
      .map((l) => asString(l, 40))
      .filter(Boolean)
      .slice(0, 8);

    await users.updateOne(
      { _id: doc._id },
      {
        $set: {
          avatar: /^https:\/\//.test(avatar) && !HOTLINKED_AVATAR.test(avatar) ? avatar : '',
          headline: LEGACY_PLACEHOLDERS.has(headline) ? '' : headline,
          location: LEGACY_PLACEHOLDERS.has(location) ? '' : location,
          bio: asString(user.bio, 1000),
          timezone: validTimezone(user.timezone),
          skillsTeaching: uniqueBySkill(
            asArray(user.skillsTeaching).map((s) => {
              const skill = (s ?? {}) as Raw;
              const years = Number(skill.yearsExperience);
              return {
                skill: asString(skill.skill, 40),
                proficiency: oneOf(PROFICIENCY_LEVELS, skill.proficiency, 'Intermediate'),
                yearsExperience: Number.isFinite(years)
                  ? Math.min(60, Math.max(0, Math.round(years)))
                  : 1,
                description: asString(skill.description, 300),
              };
            }),
          ).slice(0, 12),
          skillsLearning: uniqueBySkill(
            asArray(user.skillsLearning).map((s) => {
              const skill = (s ?? {}) as Raw;
              return {
                skill: asString(skill.skill, 40),
                targetProficiency: oneOf(
                  PROFICIENCY_LEVELS,
                  skill.targetProficiency,
                  'Intermediate',
                ),
                priority: oneOf(PRIORITIES, skill.priority, 'High'),
                notes: asString(skill.notes, 300),
              };
            }),
          ).slice(0, 12),
          availability: {
            days: asArray(availability.days).filter((d) =>
              (DAYS as readonly unknown[]).includes(d),
            ),
            timeSlots: [...new Set(asArray(availability.timeSlots).map(mapSlot).filter(Boolean))],
            hoursPerWeek: Math.min(
              40,
              Math.max(1, Math.round(Number(availability.hoursPerWeek) || 4)),
            ),
          },
          preferences: {
            format: asArray(preferences.format).filter((f) =>
              (SESSION_FORMATS as readonly unknown[]).includes(f),
            ),
            sessionLength: mapSessionLength(preferences.sessionLength),
            languages: languages.length > 0 ? languages : ['English'],
          },
          tokenVersion: typeof user.tokenVersion === 'number' ? user.tokenVersion : 0,
          isDemo: user.isDemo === true,
          onboardingCompleted: user.onboardingCompleted === true,
        },
        // Fabricated or unused fields from the previous version.
        $unset: {
          ratings: '',
          streakDays: '',
          level: '',
          badges: '',
          portfolio: '',
          certificates: '',
          isOnline: '',
        },
      },
    );
    count += 1;
  }
  return count;
}

async function migrateSessions(): Promise<number> {
  const sessions = Session.collection;
  let count = 0;
  for await (const doc of sessions.find({})) {
    const session = doc as Raw;
    const participants = asArray(session.participants) as mongoose.Types.ObjectId[];
    const teacher = (session.teacher ?? session.host ?? participants[0]) as mongoose.Types.ObjectId;
    const learner = (session.learner ??
      participants.find((p) => String(p) !== String(teacher)) ??
      teacher) as mongoose.Types.ObjectId;
    const status = String(session.status);
    const reviewers = await Review.collection.distinct('reviewer', { session: doc._id });
    const editor = (session.codeEditorState ?? {}) as Raw;

    await sessions.updateOne(
      { _id: doc._id },
      {
        $set: {
          teacher,
          learner,
          // A session that never had two people cannot be joined or completed.
          status: participants.length < 2 && status !== 'COMPLETED' ? 'CANCELLED' : status,
          joinedBy: Array.isArray(session.joinedBy)
            ? session.joinedBy
            : status === 'COMPLETED'
              ? participants
              : [],
          reviewedBy: Array.isArray(session.reviewedBy) ? session.reviewedBy : reviewers,
          roomCode: String(session.roomCode).toUpperCase(),
          notes: asString(session.notes, 200_000),
          description: asString(session.description, 500),
          codeEditorState: {
            language: oneOf(EDITOR_LANGUAGE_IDS, editor.language, 'javascript'),
            code: typeof editor.code === 'string' ? editor.code.slice(0, 200_000) : '',
          },
          sharedFiles: asArray(session.sharedFiles)
            .map((f) => {
              const file = (f ?? {}) as Raw;
              const stored =
                typeof file.storedName === 'string'
                  ? file.storedName
                  : typeof file.url === 'string'
                    ? path.basename(file.url)
                    : '';
              return {
                _id: file._id ?? new mongoose.Types.ObjectId(),
                name: asString(file.name, 200) || 'file',
                storedName: path.basename(stored),
                size: Number(file.size) || 0,
                type: asString(file.type, 100) || 'application/octet-stream',
                uploader: file.uploader ?? teacher,
                uploadedAt: file.uploadedAt ?? new Date(),
              };
            })
            .filter((f) => f.storedName !== ''),
        },
        $unset: { host: '', feedback: '', whiteboardState: '' },
      },
    );
    count += 1;
  }
  return count;
}

/** Older versions let one member review the same session repeatedly. Keep the latest only. */
async function removeDuplicateReviews(): Promise<number> {
  const groups = await Review.collection
    .aggregate<{ ids: mongoose.Types.ObjectId[] }>([
      { $match: { session: { $type: 'objectId' } } },
      { $sort: { createdAt: -1 } },
      { $group: { _id: { session: '$session', reviewer: '$reviewer' }, ids: { $push: '$_id' } } },
      { $match: { 'ids.1': { $exists: true } } },
    ])
    .toArray();
  const extra = groups.flatMap((g) => g.ids.slice(1));
  if (extra.length > 0) await Review.collection.deleteMany({ _id: { $in: extra } });
  return extra.length;
}

async function migrateContracts(): Promise<number> {
  let completed = 0;
  for await (const doc of LearningContract.collection.find({})) {
    const done = await Session.collection.countDocuments({
      contract: doc._id,
      status: 'COMPLETED',
    });
    const total = Math.max(1, Number(doc.totalSessions) || 1);
    const finish = doc.status === 'ACTIVE' && done >= total;
    await LearningContract.collection.updateOne(
      { _id: doc._id },
      {
        $set: {
          // The old counter went up once per feedback submission, not once per session.
          completedSessions: Math.min(done, total),
          totalSessions: total,
          schedule: typeof doc.schedule === 'string' ? doc.schedule : '',
          ...(finish ? { status: 'COMPLETED', endedAt: new Date() } : {}),
        },
        $unset: { agreementTerms: '', endDate: '' },
      },
    );
    if (finish) completed += 1;
  }
  return completed;
}

async function migrateExchanges(): Promise<number> {
  const exchanges = ExchangeRequest.collection;
  await exchanges.updateMany({ status: 'IN_PROGRESS' }, { $set: { status: 'ACCEPTED' } });
  await exchanges.updateMany(
    { status: 'COUNTERED', 'counterOffer.counteredBy': { $exists: false } },
    { $set: { status: 'PENDING' }, $unset: { counterOffer: '' } },
  );

  let closed = 0;
  const taken = new Set<string>();
  const cursor = exchanges
    .find({ status: { $in: ['PENDING', 'COUNTERED', 'ACCEPTED'] } })
    .sort({ status: 1, updatedAt: -1 });
  for await (const doc of cursor) {
    const key = pairKey(String(doc.sender), String(doc.receiver));
    const contract = doc.createdContract
      ? await LearningContract.collection.findOne({
          _id: doc.createdContract as mongoose.Types.ObjectId,
        })
      : null;

    if (doc.status === 'ACCEPTED' && contract && contract.status !== 'ACTIVE') {
      await exchanges.updateOne(
        { _id: doc._id },
        {
          $set: { status: contract.status === 'COMPLETED' ? 'COMPLETED' : 'CANCELLED' },
          $unset: { openPairKey: '' },
        },
      );
      continue;
    }
    if (!taken.has(key)) {
      taken.add(key);
      await exchanges.updateOne({ _id: doc._id }, { $set: { openPairKey: key } });
      continue;
    }
    // A second open exchange for the same two members: only one can stay open.
    if (doc.status === 'ACCEPTED') {
      await exchanges.updateOne({ _id: doc._id }, { $unset: { openPairKey: '' } });
    } else {
      await exchanges.updateOne(
        { _id: doc._id },
        {
          $set: { status: 'CANCELLED' },
          $unset: { openPairKey: '' },
          $push: {
            statusHistory: {
              status: 'CANCELLED',
              note: 'Closed during upgrade: another exchange between these members is open',
              timestamp: new Date(),
            },
          } as never,
        },
      );
      closed += 1;
    }
  }
  await exchanges.updateMany(
    { status: { $nin: ['PENDING', 'COUNTERED', 'ACCEPTED'] } },
    { $unset: { openPairKey: '' } },
  );
  return closed;
}

/** Checks every account: 1.0 databases are small, and members may have reused the password. */
async function findPublishedPasswordAccounts(): Promise<string[]> {
  const found: string[] = [];
  const candidates = await User.find({ isDemo: { $ne: true } })
    .select('+password username')
    .lean();
  for (const user of candidates) {
    if (await bcrypt.compare(LEGACY_SEED_PASSWORD, user.password)) found.push(user.username);
  }
  return found;
}

/**
 * Upgrades a database written by SkillSwap 1.x in place. Safe to run more than once: every step
 * either recomputes from source data or only touches documents still in the old shape.
 */
export async function migrateLegacyData(): Promise<MigrationReport> {
  // Unique indexes from the new schema must not be built before duplicates are cleaned up.
  const users = await migrateUsers();
  const duplicateReviewsRemoved = await removeDuplicateReviews();
  const sessionsUpdated = await migrateSessions();
  const contractsCompleted = await migrateContracts();
  await ExchangeRequest.collection.dropIndex('openPairKey_1').catch(() => undefined);
  const exchangesClosedAsDuplicates = await migrateExchanges();

  await Skill.collection.updateMany(
    {},
    { $unset: { icon: '', color: '', popularity: '', description: '' } },
  );
  await Message.collection.updateMany(
    {},
    { $unset: { fileAttachment: '', readBy: '', isSystem: '' } },
  );

  for (const model of [
    User,
    Skill,
    ExchangeRequest,
    LearningContract,
    Session,
    Message,
    Notification,
    Review,
    Report,
  ]) {
    await model.syncIndexes();
  }

  const ids = await User.distinct('_id');
  for (const id of ids) await recomputeUserStats(id.toString());

  return {
    users,
    exchangesClosedAsDuplicates,
    contractsCompleted,
    sessionsUpdated,
    duplicateReviewsRemoved,
    accountsWithPublishedPassword: await findPublishedPasswordAccounts(),
  };
}
