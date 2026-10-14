import {
  type AdminStats,
  type AdminUser,
  type Paginated,
  type ReportDTO,
  type ReportResolveInput,
  type UserStatus,
  escapeRegExp,
} from '@skillswap/shared';
import type { AppContext } from '../context';
import { badRequest, conflict, notFound } from '../lib/errors';
import {
  ExchangeRequest,
  type IUser,
  LearningContract,
  Report,
  Session,
  User,
  type UserDoc,
} from '../models';
import { toAdminUser, toReportDTO } from '../serializers';
import { notify } from './notifications';

const ACTIVITY_DAYS = 14;
const dayKey = (date: Date) => date.toISOString().slice(0, 10);

/** Every number here is counted from the database; nothing is estimated or filled in. */
export async function getStats(): Promise<AdminStats> {
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  since.setUTCDate(since.getUTCDate() - (ACTIVITY_DAYS - 1));

  const perDay = (
    model: typeof User | typeof Session | typeof ExchangeRequest,
    field: string,
    match: object = {},
  ) =>
    (model as typeof User).aggregate<{ _id: string; count: number }>([
      { $match: { [field]: { $gte: since }, ...match } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: `$${field}` } },
          count: { $sum: 1 },
        },
      },
    ]);

  const skillCounts = (field: 'skillsTeaching' | 'skillsLearning') =>
    User.aggregate<{ _id: string; name: string; count: number }>([
      { $match: { role: 'USER' } },
      { $unwind: `$${field}` },
      {
        $group: {
          _id: { $toLower: `$${field}.skill` },
          name: { $first: `$${field}.skill` },
          count: { $sum: 1 },
        },
      },
    ]);

  const [
    users,
    activeUsers,
    sessions,
    completedSessions,
    cancelledSessions,
    exchanges,
    activeContracts,
    pendingReports,
    signupsByDay,
    sessionsByDay,
    exchangesByDay,
    teachers,
    learners,
  ] = await Promise.all([
    User.countDocuments(),
    User.countDocuments({ status: 'ACTIVE' }),
    Session.countDocuments(),
    Session.countDocuments({ status: 'COMPLETED' }),
    Session.countDocuments({ status: 'CANCELLED' }),
    ExchangeRequest.countDocuments(),
    LearningContract.countDocuments({ status: 'ACTIVE' }),
    Report.countDocuments({ status: 'PENDING' }),
    perDay(User, 'createdAt'),
    perDay(Session, 'actualEndTime', { status: 'COMPLETED' }),
    perDay(ExchangeRequest, 'createdAt'),
    skillCounts('skillsTeaching'),
    skillCounts('skillsLearning'),
  ]);

  const lookup = (rows: { _id: string; count: number }[]) =>
    new Map(rows.map((r) => [r._id, r.count]));
  const signups = lookup(signupsByDay);
  const done = lookup(sessionsByDay);
  const proposed = lookup(exchangesByDay);
  const activity = Array.from({ length: ACTIVITY_DAYS }, (_, i) => {
    const date = new Date(since);
    date.setUTCDate(since.getUTCDate() + i);
    const key = dayKey(date);
    return {
      date: key,
      sessions: done.get(key) ?? 0,
      exchanges: proposed.get(key) ?? 0,
      signups: signups.get(key) ?? 0,
    };
  });

  const skills = new Map<string, { skill: string; teachers: number; learners: number }>();
  for (const row of teachers)
    skills.set(row._id, { skill: row.name, teachers: row.count, learners: 0 });
  for (const row of learners) {
    const entry = skills.get(row._id) ?? { skill: row.name, teachers: 0, learners: 0 };
    entry.learners = row.count;
    skills.set(row._id, entry);
  }
  const topSkills = [...skills.values()]
    .sort(
      (a, b) =>
        b.teachers + b.learners - (a.teachers + a.learners) || a.skill.localeCompare(b.skill),
    )
    .slice(0, 8);

  const finished = completedSessions + cancelledSessions;
  return {
    totals: {
      users,
      activeUsers,
      suspendedUsers: users - activeUsers,
      sessions,
      completedSessions,
      exchanges,
      activeContracts,
      pendingReports,
    },
    completionRate: finished > 0 ? Math.round((completedSessions / finished) * 100) : null,
    activity,
    topSkills,
  };
}

export async function listUsers(query: {
  q?: string;
  page: number;
  pageSize: number;
}): Promise<Paginated<AdminUser>> {
  const filter = query.q
    ? (() => {
        const rx = new RegExp(escapeRegExp(query.q), 'i');
        return { $or: [{ name: rx }, { username: rx }, { email: rx }] };
      })()
    : {};
  const [total, rows] = await Promise.all([
    User.countDocuments(filter),
    User.find(filter)
      .sort({ createdAt: -1 })
      .skip((query.page - 1) * query.pageSize)
      .limit(query.pageSize)
      .lean(),
  ]);
  return {
    items: rows.map(toAdminUser),
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
  };
}

export async function setUserStatus(
  ctx: AppContext,
  admin: UserDoc,
  userId: string,
  status: UserStatus,
): Promise<AdminUser> {
  const user = await User.findById(userId);
  if (!user) throw notFound('Member');
  if (user._id.equals(admin._id))
    throw badRequest('You cannot change the status of your own account.');
  if (user.role === 'ADMIN') throw badRequest('Administrator accounts cannot be suspended here.');
  if (user.status !== status) {
    user.status = status;
    if (status === 'SUSPENDED') {
      // Invalidate their cookies and drop live connections right away.
      user.tokenVersion += 1;
    }
    await user.save();
    if (status === 'SUSPENDED') ctx.realtime.disconnectUser(userId);
    ctx.log.info({ adminId: admin._id.toString(), userId, status }, 'member status changed');
  }
  return toAdminUser(user.toObject());
}

export async function listReports(): Promise<ReportDTO[]> {
  const rows = await Report.find()
    .populate<{ reporter: IUser | null; reportedUser: IUser | null }>(
      'reporter reportedUser',
      'name username avatar headline status',
    )
    .sort({ status: 1, createdAt: -1 })
    .limit(200)
    .lean();
  // PENDING first, then the rest by date.
  return rows
    .sort((a, b) => Number(b.status === 'PENDING') - Number(a.status === 'PENDING'))
    .map(toReportDTO);
}

export async function resolveReport(
  ctx: AppContext,
  admin: UserDoc,
  reportId: string,
  input: ReportResolveInput,
): Promise<ReportDTO> {
  const action = input.status === 'DISMISSED' ? 'NONE' : input.action;
  const report = await Report.findOneAndUpdate(
    { _id: reportId, status: 'PENDING' },
    {
      $set: {
        status: input.status,
        actionTaken: action,
        resolutionNotes: input.notes,
        resolvedBy: admin._id,
        resolvedAt: new Date(),
      },
    },
    { returnDocument: 'after' },
  );
  if (!report) {
    const exists = await Report.exists({ _id: reportId });
    if (!exists) throw notFound('Report');
    throw conflict('This report has already been handled.');
  }

  const targetId = report.reportedUser.toString();
  if (action === 'SUSPENDED') {
    await setUserStatus(ctx, admin, targetId, 'SUSPENDED').catch((err: unknown) => {
      ctx.log.warn({ err, targetId }, 'could not suspend reported member');
    });
  } else if (action === 'WARNED') {
    await notify(ctx, {
      recipientId: targetId,
      type: 'SYSTEM',
      title: 'A note from the SkillSwap team',
      message:
        'We received a report about your conduct. Please review the community guidelines; further reports may lead to suspension.',
      link: '',
    });
  }

  const populated = await Report.findById(report._id)
    .populate<{ reporter: IUser | null; reportedUser: IUser | null }>(
      'reporter reportedUser',
      'name username avatar headline status',
    )
    .lean();
  if (!populated) throw notFound('Report');
  return toReportDTO(populated);
}
