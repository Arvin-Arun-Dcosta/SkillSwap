import type { QueryFilter } from 'mongoose';
import {
  type DiscoverQuery,
  type DiscoverUser,
  OPEN_EXCHANGE_STATUSES,
  type Paginated,
  type ProfileResponse,
  type ReportCreateInput,
  type SkillOption,
  escapeRegExp,
} from '@skillswap/shared';
import type { AppContext } from '../context';
import { badRequest, conflict, notFound } from '../lib/errors';
import { isObjectId, pairKey, toObjectId } from '../lib/ids';
import { ExchangeRequest, type IUser, Report, Review, Skill, User, type UserDoc } from '../models';
import { toPublicUser, toReviewDTO } from '../serializers';
import { calculateMatch } from './matching';
import { skillRatingsFor } from './stats';

/** Upper bound on members ranked per discover request (the match score cannot be indexed). */
const MAX_CANDIDATES = 500;

const nullsLast = (a: number | null, b: number | null) => (b ?? -1) - (a ?? -1);

export async function discover(
  ctx: AppContext,
  viewer: UserDoc | undefined,
  query: DiscoverQuery,
): Promise<Paginated<DiscoverUser>> {
  const and: QueryFilter<IUser>[] = [{ status: 'ACTIVE', role: 'USER', onboardingCompleted: true }];
  if (viewer) and.push({ _id: { $ne: viewer._id } });
  if (query.q) {
    // The search text is matched literally; it is never interpreted as a pattern.
    const rx = new RegExp(escapeRegExp(query.q), 'i');
    and.push({
      $or: [
        { name: rx },
        { username: rx },
        { headline: rx },
        { location: rx },
        { 'skillsTeaching.skill': rx },
        { 'skillsLearning.skill': rx },
      ],
    });
  }
  if (query.proficiency) and.push({ 'skillsTeaching.proficiency': query.proficiency });
  if (query.day) and.push({ 'availability.days': query.day });
  if (query.minRating !== undefined) {
    and.push({ 'stats.teachingRating': { $gte: query.minRating } });
  }
  if (query.onlineOnly) {
    and.push({ _id: { $in: ctx.realtime.onlineUserIds().filter(isObjectId).map(toObjectId) } });
  }

  const candidates = await User.find({ $and: and })
    .sort({ 'stats.teachingRating': -1, createdAt: -1 })
    .limit(MAX_CANDIDATES)
    .lean();

  const sort = query.sort === 'match' && !viewer ? 'rating' : query.sort;
  const scored = candidates.map((user) => ({
    user,
    match: viewer ? calculateMatch(viewer, user) : null,
  }));
  scored.sort((a, b) => {
    if (sort === 'match') {
      return (
        (b.match?.score ?? 0) - (a.match?.score ?? 0) ||
        nullsLast(a.user.stats?.teachingRating ?? null, b.user.stats?.teachingRating ?? null)
      );
    }
    if (sort === 'sessions') {
      return (b.user.stats?.sessionsCompleted ?? 0) - (a.user.stats?.sessionsCompleted ?? 0);
    }
    if (sort === 'recent') {
      return new Date(b.user.createdAt).getTime() - new Date(a.user.createdAt).getTime();
    }
    return (
      nullsLast(a.user.stats?.teachingRating ?? null, b.user.stats?.teachingRating ?? null) ||
      (b.user.stats?.teachingReviews ?? 0) - (a.user.stats?.teachingReviews ?? 0)
    );
  });

  const total = scored.length;
  const start = (query.page - 1) * query.pageSize;
  const pageItems = scored.slice(start, start + query.pageSize);
  const ratings = await skillRatingsFor(pageItems.map((p) => p.user._id));

  return {
    items: pageItems.map(({ user, match }) => ({
      ...toPublicUser(user, {
        isOnline: ctx.realtime.isOnline(user._id.toString()),
        skillRatings: ratings.get(user._id.toString()),
      }),
      match,
    })),
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
  };
}

export async function topMatches(
  ctx: AppContext,
  viewer: UserDoc,
  limit: number,
): Promise<DiscoverUser[]> {
  const page = await discover(ctx, viewer, {
    sort: 'match',
    page: 1,
    pageSize: limit,
  });
  return page.items.filter((u) => (u.match?.score ?? 0) > 0);
}

export async function getProfile(
  ctx: AppContext,
  viewer: UserDoc | undefined,
  identifier: string,
): Promise<ProfileResponse> {
  const user = isObjectId(identifier)
    ? await User.findById(identifier).lean()
    : await User.findOne({ username: identifier.toLowerCase() }).lean();
  const viewerIsAdmin = viewer?.role === 'ADMIN';
  if (!user || (user.status === 'SUSPENDED' && !viewerIsAdmin)) throw notFound('Member');

  const userId = user._id.toString();
  const isSelf = viewer?._id.toString() === userId;

  const [reviews, ratings, openExchange] = await Promise.all([
    Review.find({ reviewee: user._id })
      .populate<{ reviewer: IUser | null }>('reviewer', 'name username avatar headline')
      .sort({ createdAt: -1 })
      .limit(10)
      .lean(),
    skillRatingsFor([user._id]),
    viewer && !isSelf
      ? ExchangeRequest.findOne({
          openPairKey: pairKey(viewer._id.toString(), userId),
          status: { $in: OPEN_EXCHANGE_STATUSES },
        })
          .select('_id')
          .lean()
      : null,
  ]);

  return {
    // Email, role and account status are deliberately not part of a public profile.
    user: toPublicUser(user, {
      isOnline: ctx.realtime.isOnline(userId),
      skillRatings: ratings.get(userId),
    }),
    reviews: reviews.map(toReviewDTO),
    match: viewer && !isSelf && user.role === 'USER' ? calculateMatch(viewer, user) : null,
    viewer: { isSelf, openExchangeId: openExchange?._id.toString() ?? null },
  };
}

export async function reportUser(reporter: UserDoc, input: ReportCreateInput): Promise<void> {
  if (input.reportedUserId === reporter._id.toString()) {
    throw badRequest('You cannot report yourself.');
  }
  const target = await User.exists({ _id: input.reportedUserId });
  if (!target) throw notFound('Member');
  const duplicate = await Report.exists({
    reporter: reporter._id,
    reportedUser: input.reportedUserId,
    status: 'PENDING',
  });
  if (duplicate) {
    throw conflict('You already have an open report about this member. Our team is reviewing it.');
  }
  await Report.create({
    reporter: reporter._id,
    reportedUser: input.reportedUserId,
    reason: input.reason,
    details: input.details,
  });
}

let skillCache: { at: number; items: SkillOption[] } | null = null;
const SKILL_CACHE_MS = 60_000;

export function clearSkillCache(): void {
  skillCache = null;
}

/** Skill suggestions: the curated catalogue merged with what members actually teach and want. */
export async function listSkills(): Promise<SkillOption[]> {
  if (skillCache && Date.now() - skillCache.at < SKILL_CACHE_MS) return skillCache.items;

  const countBy = (field: 'skillsTeaching' | 'skillsLearning') =>
    User.aggregate<{ _id: string; name: string; count: number }>([
      { $match: { status: 'ACTIVE', role: 'USER' } },
      { $unwind: `$${field}` },
      {
        $group: {
          _id: { $toLower: `$${field}.skill` },
          name: { $first: `$${field}.skill` },
          count: { $sum: 1 },
        },
      },
    ]);

  const [catalogue, teachers, learners] = await Promise.all([
    Skill.find().select('name category').lean(),
    countBy('skillsTeaching'),
    countBy('skillsLearning'),
  ]);

  const byKey = new Map<string, SkillOption>();
  for (const s of catalogue) {
    byKey.set(s.name.toLowerCase(), {
      name: s.name,
      category: s.category,
      teachers: 0,
      learners: 0,
    });
  }
  const add = (
    rows: { _id: string; name: string; count: number }[],
    key: 'teachers' | 'learners',
  ) => {
    for (const row of rows) {
      const entry = byKey.get(row._id) ?? {
        name: row.name,
        category: 'Other',
        teachers: 0,
        learners: 0,
      };
      entry[key] = row.count;
      byKey.set(row._id, entry);
    }
  };
  add(teachers, 'teachers');
  add(learners, 'learners');

  const items = [...byKey.values()]
    .sort(
      (a, b) => b.teachers + b.learners - (a.teachers + a.learners) || a.name.localeCompare(b.name),
    )
    .slice(0, 200);
  skillCache = { at: Date.now(), items };
  return items;
}

export function profileCompleteness(user: IUser): { percent: number; missing: string[] } {
  const checks: [boolean, string][] = [
    [user.headline.trim() !== '', 'Add a headline'],
    [user.bio.trim() !== '', 'Write a short bio'],
    [user.location.trim() !== '', 'Add your location'],
    [user.skillsTeaching.length > 0, 'Add a skill you can teach'],
    [user.skillsLearning.length > 0, 'Add a skill you want to learn'],
    [user.availability.days.length > 0, 'Pick the days you are free'],
    [user.availability.timeSlots.length > 0, 'Pick your preferred times'],
  ];
  const done = checks.filter(([ok]) => ok).length;
  return {
    percent: Math.round((done / checks.length) * 100),
    missing: checks.filter(([ok]) => !ok).map(([, label]) => label),
  };
}
