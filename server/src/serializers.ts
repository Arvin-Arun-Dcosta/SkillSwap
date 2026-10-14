import {
  type AdminUser,
  type Badge,
  type ChatMessageDTO,
  type ContractDTO,
  type ExchangeDTO,
  type ExchangeTerms,
  NOTIFICATION_TYPES,
  type NotificationDTO,
  type NotificationType,
  type PublicUser,
  type ReportDTO,
  type ReviewDTO,
  type SelfUser,
  type SessionDTO,
  type SessionDetail,
  type SharedFile,
  type UserStats,
  type UserSummary,
} from '@skillswap/shared';
import type {
  IExchangeRequest,
  ILearningContract,
  IMessage,
  INotification,
  IReport,
  IReview,
  ISession,
  IUser,
} from './models';

type Id = { toString(): string };
const id = (value: Id) => value.toString();
const iso = (value: Date | null | undefined) => (value ? new Date(value).toISOString() : null);

/** Per-skill teaching ratings for one member, keyed by lower-cased skill name. */
export type SkillRatings = Map<string, { rating: number; count: number }>;

type UserLike = Pick<IUser, '_id' | 'name' | 'username' | 'avatar' | 'headline'>;

const FORMER_MEMBER: UserSummary = {
  id: '000000000000000000000000',
  name: 'Former member',
  username: 'former-member',
  avatar: '',
  headline: '',
};

export function toSummary(user: UserLike | null | undefined): UserSummary {
  if (!user || typeof user !== 'object' || !('username' in user)) return FORMER_MEMBER;
  return {
    id: id(user._id),
    name: user.name,
    username: user.username,
    avatar: user.avatar ?? '',
    headline: user.headline ?? '',
  };
}

export function toStats(stats: IUser['stats'] | undefined): UserStats {
  return {
    teachingRating: stats?.teachingRating ?? null,
    teachingReviews: stats?.teachingReviews ?? 0,
    learningRating: stats?.learningRating ?? null,
    learningReviews: stats?.learningReviews ?? 0,
    sessionsCompleted: stats?.sessionsCompleted ?? 0,
  };
}

/** Badges are derived from real activity on every read, so they can never be stale or forged. */
export function computeBadges(stats: UserStats): Badge[] {
  const badges: Badge[] = [];
  if (stats.sessionsCompleted >= 1) {
    badges.push({
      id: 'first-swap',
      name: 'First swap',
      description: 'Completed a first learning session.',
    });
  }
  if (stats.sessionsCompleted >= 10) {
    badges.push({
      id: 'ten-sessions',
      name: 'Ten sessions',
      description: 'Completed ten or more learning sessions.',
    });
  }
  if (stats.teachingReviews >= 3 && (stats.teachingRating ?? 0) >= 4.5) {
    badges.push({
      id: 'well-reviewed',
      name: 'Well reviewed',
      description: 'Rated 4.5 or higher as a teacher across at least three reviews.',
    });
  }
  if (stats.teachingReviews >= 5 && (stats.teachingRating ?? 0) >= 4.8) {
    badges.push({
      id: 'top-mentor',
      name: 'Top mentor',
      description: 'Rated 4.8 or higher as a teacher across at least five reviews.',
    });
  }
  return badges;
}

export function toPublicUser(
  user: IUser,
  options: { isOnline: boolean; skillRatings?: SkillRatings },
): PublicUser {
  const stats = toStats(user.stats);
  return {
    ...toSummary(user),
    bio: user.bio ?? '',
    location: user.location ?? '',
    timezone: user.timezone ?? '',
    skillsTeaching: (user.skillsTeaching ?? []).map((s) => {
      const rated = options.skillRatings?.get(s.skill.toLowerCase());
      return {
        skill: s.skill,
        proficiency: s.proficiency,
        yearsExperience: s.yearsExperience ?? 0,
        description: s.description ?? '',
        rating: rated?.rating ?? null,
        reviewCount: rated?.count ?? 0,
      };
    }),
    skillsLearning: (user.skillsLearning ?? []).map((s) => ({
      skill: s.skill,
      targetProficiency: s.targetProficiency,
      priority: s.priority,
      notes: s.notes ?? '',
    })),
    availability: {
      days: user.availability?.days ?? [],
      timeSlots: user.availability?.timeSlots ?? [],
      hoursPerWeek: user.availability?.hoursPerWeek ?? 4,
    },
    preferences: {
      format: user.preferences?.format ?? [],
      sessionLength: user.preferences?.sessionLength ?? 60,
      languages: user.preferences?.languages ?? [],
    },
    stats,
    badges: computeBadges(stats),
    isOnline: options.isOnline,
    joinedAt: new Date(user.createdAt).toISOString(),
  };
}

export function toSelfUser(
  user: IUser,
  options: { isOnline: boolean; skillRatings?: SkillRatings },
): SelfUser {
  return {
    ...toPublicUser(user, options),
    email: user.email,
    role: user.role,
    onboardingCompleted: user.onboardingCompleted,
    isDemo: user.isDemo ?? false,
  };
}

export function toAdminUser(user: IUser): AdminUser {
  return {
    ...toSummary(user),
    email: user.email,
    role: user.role,
    status: user.status,
    isDemo: user.isDemo ?? false,
    teaching: (user.skillsTeaching ?? []).map((s) => s.skill),
    stats: toStats(user.stats),
    createdAt: new Date(user.createdAt).toISOString(),
  };
}

/* ---------- Exchanges ---------- */

export type PopulatedExchange = Omit<IExchangeRequest, 'sender' | 'receiver'> & {
  sender: UserLike | null;
  receiver: UserLike | null;
};

export function proposedTerms(
  exchange: Pick<
    IExchangeRequest,
    'proposedSessions' | 'proposedDurationMinutes' | 'learningGoals'
  >,
): ExchangeTerms {
  return {
    sessions: exchange.proposedSessions,
    durationMinutes: exchange.proposedDurationMinutes,
    schedule: '',
    goals: exchange.learningGoals ?? [],
  };
}

/** The terms that apply if the exchange is accepted now: the latest counter-offer, or the proposal. */
export function currentTerms(
  exchange: Pick<
    IExchangeRequest,
    'proposedSessions' | 'proposedDurationMinutes' | 'learningGoals' | 'counterOffer'
  >,
): ExchangeTerms {
  const counter = exchange.counterOffer;
  if (!counter) return proposedTerms(exchange);
  return {
    sessions: counter.sessions,
    durationMinutes: counter.durationMinutes,
    schedule: counter.schedule ?? '',
    goals: counter.goals?.length ? counter.goals : (exchange.learningGoals ?? []),
  };
}

/** Member whose response is awaited, or null when the exchange is settled. */
export function awaitingUserId(
  exchange: Pick<IExchangeRequest, 'status' | 'counterOffer'> & { sender: Id; receiver: Id },
): string | null {
  if (exchange.status === 'PENDING') return id(exchange.receiver);
  if (exchange.status === 'COUNTERED' && exchange.counterOffer) {
    const by = id(exchange.counterOffer.counteredBy);
    return by === id(exchange.sender) ? id(exchange.receiver) : id(exchange.sender);
  }
  return null;
}

export function toExchangeDTO(exchange: PopulatedExchange, viewerId: string): ExchangeDTO {
  const sender = toSummary(exchange.sender);
  const receiver = toSummary(exchange.receiver);
  const awaiting = awaitingUserId({
    status: exchange.status,
    counterOffer: exchange.counterOffer,
    sender: sender.id,
    receiver: receiver.id,
  });
  const isSender = viewerId === sender.id;
  const isParty = isSender || viewerId === receiver.id;
  const open = exchange.status === 'PENDING' || exchange.status === 'COUNTERED';
  const myTurn = open && awaiting === viewerId;
  const counter = exchange.counterOffer;

  return {
    id: id(exchange._id),
    sender,
    receiver,
    teachingSkill: exchange.teachingSkill,
    learningSkill: exchange.learningSkill,
    message: exchange.message,
    status: exchange.status,
    proposed: proposedTerms(exchange),
    counter: counter
      ? {
          sessions: counter.sessions,
          durationMinutes: counter.durationMinutes,
          schedule: counter.schedule ?? '',
          goals: counter.goals ?? [],
          message: counter.message ?? '',
          byUserId: id(counter.counteredBy),
          at: new Date(counter.counteredAt).toISOString(),
        }
      : null,
    currentTerms: currentTerms(exchange),
    awaitingUserId: awaiting,
    contractId: exchange.createdContract ? id(exchange.createdContract) : null,
    history: (exchange.statusHistory ?? []).map((h) => ({
      status: h.status,
      byUserId: h.changedBy ? id(h.changedBy) : null,
      note: h.note ?? '',
      at: new Date(h.timestamp).toISOString(),
    })),
    createdAt: new Date(exchange.createdAt).toISOString(),
    updatedAt: new Date(exchange.updatedAt).toISOString(),
    viewer: {
      isSender,
      canAccept: myTurn,
      canDecline: myTurn,
      canCounter: myTurn,
      // Whoever made the latest offer can withdraw it while it is unanswered.
      canCancel: isParty && open && awaiting !== viewerId,
    },
  };
}

/* ---------- Contracts ---------- */

export type PopulatedContract = Omit<ILearningContract, 'userA' | 'userB'> & {
  userA: UserLike | null;
  userB: UserLike | null;
};

export function toContractDTO(contract: PopulatedContract, scheduledSessions = 0): ContractDTO {
  return {
    id: id(contract._id),
    exchangeId: id(contract.exchangeRequest),
    userA: toSummary(contract.userA),
    userB: toSummary(contract.userB),
    skillA: contract.skillA,
    skillB: contract.skillB,
    totalSessions: contract.totalSessions,
    completedSessions: contract.completedSessions,
    scheduledSessions,
    sessionDurationMinutes: contract.sessionDurationMinutes,
    schedule: contract.schedule ?? '',
    goals: (contract.goals ?? []).map((g) => ({
      id: id(g._id),
      title: g.title,
      completed: g.completed,
      completedAt: iso(g.completedAt),
      completedByUserId: g.completedBy ? id(g.completedBy) : null,
    })),
    status: contract.status,
    startDate: new Date(contract.startDate).toISOString(),
    endedAt: iso(contract.endedAt),
  };
}

/* ---------- Sessions ---------- */

export type PopulatedSession = Omit<ISession, 'teacher' | 'learner'> & {
  teacher: UserLike | null;
  learner: UserLike | null;
};

export function toSessionDTO(session: PopulatedSession, viewerId: string): SessionDTO {
  const isParticipant = session.participants.some((p) => id(p) === viewerId);
  const hasReviewed = (session.reviewedBy ?? []).some((r) => id(r) === viewerId);
  const open = session.status === 'SCHEDULED' || session.status === 'ACTIVE';
  return {
    id: id(session._id),
    roomCode: session.roomCode,
    title: session.title,
    description: session.description ?? '',
    contractId: session.contract ? id(session.contract) : null,
    skill: session.skillTaught,
    teacher: toSummary(session.teacher),
    learner: toSummary(session.learner),
    scheduledStartTime: new Date(session.scheduledStartTime).toISOString(),
    scheduledEndTime: new Date(session.scheduledEndTime).toISOString(),
    durationMinutes: session.durationMinutes,
    status: session.status,
    actualStartTime: iso(session.actualStartTime),
    actualEndTime: iso(session.actualEndTime),
    viewer: {
      canJoin: isParticipant && open,
      canCancel: isParticipant && session.status === 'SCHEDULED',
      canReview: isParticipant && session.status === 'COMPLETED' && !hasReviewed,
      hasReviewed,
    },
  };
}

export function toSharedFile(file: ISession['sharedFiles'][number]): SharedFile {
  return {
    id: id(file._id),
    name: file.name,
    size: file.size,
    mimeType: file.type,
    uploadedByUserId: id(file.uploader),
    uploadedAt: new Date(file.uploadedAt).toISOString(),
  };
}

export function toSessionDetail(
  session: PopulatedSession,
  viewerId: string,
  contract: ContractDTO | null,
): SessionDetail {
  return {
    ...toSessionDTO(session, viewerId),
    notes: session.notes ?? '',
    code: session.codeEditorState?.code ?? '',
    codeLanguage: session.codeEditorState?.language ?? 'javascript',
    files: (session.sharedFiles ?? []).map(toSharedFile),
    contract,
  };
}

/* ---------- Messages, notifications, reviews, reports ---------- */

export function toChatMessage(
  message: Omit<IMessage, 'sender'> & { sender: UserLike | null },
): ChatMessageDTO {
  return {
    id: id(message._id),
    sender: toSummary(message.sender),
    text: message.text,
    createdAt: new Date(message.createdAt).toISOString(),
  };
}

export function toNotificationDTO(
  notification: Omit<INotification, 'sender'> & { sender?: UserLike | Id | null },
): NotificationDTO {
  const known = (NOTIFICATION_TYPES as readonly string[]).includes(notification.type);
  const sender =
    notification.sender &&
    typeof notification.sender === 'object' &&
    'username' in notification.sender
      ? toSummary(notification.sender)
      : null;
  // Links are only ever followed inside the app.
  const link =
    notification.link?.startsWith('/') && !notification.link.startsWith('//')
      ? notification.link
      : '';
  return {
    id: id(notification._id),
    type: known ? notification.type : ('SYSTEM' satisfies NotificationType),
    title: notification.title,
    message: notification.message,
    link,
    read: notification.read,
    createdAt: new Date(notification.createdAt).toISOString(),
    sender,
  };
}

export function toReviewDTO(
  review: Omit<IReview, 'reviewer'> & { reviewer: UserLike | null },
): ReviewDTO {
  return {
    id: id(review._id),
    reviewer: toSummary(review.reviewer),
    role: review.role,
    skill: review.skill,
    rating: review.rating,
    feedback: review.feedback ?? '',
    createdAt: new Date(review.createdAt).toISOString(),
  };
}

export function toReportDTO(
  report: Omit<IReport, 'reporter' | 'reportedUser'> & {
    reporter: UserLike | null;
    reportedUser: (UserLike & Pick<IUser, 'status'>) | null;
  },
): ReportDTO {
  return {
    id: id(report._id),
    reporter: report.reporter ? toSummary(report.reporter) : null,
    reportedUser: report.reportedUser
      ? { ...toSummary(report.reportedUser), status: report.reportedUser.status }
      : null,
    reason: report.reason,
    details: report.details,
    status: report.status,
    action: report.actionTaken,
    notes: report.resolutionNotes ?? '',
    createdAt: new Date(report.createdAt).toISOString(),
    resolvedAt: iso(report.resolvedAt),
  };
}
