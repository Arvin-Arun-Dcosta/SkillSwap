import type mongoose from 'mongoose';
import { roundRating } from '@skillswap/shared';
import { toObjectId } from '../lib/ids';
import { Review, Session, User } from '../models';
import type { SkillRatings } from '../serializers';

/**
 * Recomputes a member's reputation from the source of truth: stored reviews and completed sessions.
 * Recomputing (instead of nudging a running average) keeps the numbers correct under retries.
 */
export async function recomputeUserStats(userId: string): Promise<void> {
  const _id = toObjectId(userId);
  const [byRole, sessionsCompleted] = await Promise.all([
    Review.aggregate<{ _id: 'TEACHER' | 'STUDENT'; avg: number; count: number }>([
      { $match: { reviewee: _id } },
      { $group: { _id: '$role', avg: { $avg: '$rating' }, count: { $sum: 1 } } },
    ]),
    Session.countDocuments({ participants: _id, status: 'COMPLETED' }),
  ]);
  const teaching = byRole.find((r) => r._id === 'TEACHER');
  const learning = byRole.find((r) => r._id === 'STUDENT');
  await User.updateOne(
    { _id },
    {
      $set: {
        stats: {
          teachingRating: teaching ? roundRating(teaching.avg) : null,
          teachingReviews: teaching?.count ?? 0,
          learningRating: learning ? roundRating(learning.avg) : null,
          learningReviews: learning?.count ?? 0,
          sessionsCompleted,
        },
      },
    },
  );
}

/** Teaching ratings per skill for a set of members, from reviews of sessions they taught. */
export async function skillRatingsFor(
  userIds: (string | mongoose.Types.ObjectId)[],
): Promise<Map<string, SkillRatings>> {
  const out = new Map<string, SkillRatings>();
  if (userIds.length === 0) return out;
  const rows = await Review.aggregate<{
    _id: { reviewee: mongoose.Types.ObjectId; skill: string };
    avg: number;
    count: number;
  }>([
    {
      $match: { reviewee: { $in: userIds.map((u) => toObjectId(u.toString())) }, role: 'TEACHER' },
    },
    {
      $group: {
        _id: { reviewee: '$reviewee', skill: { $toLower: '$skill' } },
        avg: { $avg: '$rating' },
        count: { $sum: 1 },
      },
    },
  ]);
  for (const row of rows) {
    const key = row._id.reviewee.toString();
    const ratings = out.get(key) ?? new Map<string, { rating: number; count: number }>();
    ratings.set(row._id.skill, { rating: roundRating(row.avg), count: row.count });
    out.set(key, ratings);
  }
  return out;
}
