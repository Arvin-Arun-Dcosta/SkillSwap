import type {
  ContractStatus,
  Day,
  EditorLanguage,
  ExchangeStatus,
  NotificationType,
  Priority,
  Proficiency,
  ReportAction,
  ReportReason,
  ReportStatus,
  Role,
  SessionFormat,
  SessionStatus,
  TimeSlotId,
  UserStatus,
} from './constants';
import type { SignalPayload } from './schemas';

/* ---------- Users ---------- */

export interface UserSummary {
  id: string;
  name: string;
  username: string;
  avatar: string;
  headline: string;
}

export interface TeachingSkill {
  skill: string;
  proficiency: Proficiency;
  yearsExperience: number;
  description: string;
  /** Average of reviews received for teaching this skill, or null when there are none. */
  rating: number | null;
  reviewCount: number;
}

export interface LearningSkill {
  skill: string;
  targetProficiency: Proficiency;
  priority: Priority;
  notes: string;
}

export interface Availability {
  days: Day[];
  timeSlots: TimeSlotId[];
  hoursPerWeek: number;
}

export interface Preferences {
  format: SessionFormat[];
  sessionLength: number;
  languages: string[];
}

export interface UserStats {
  teachingRating: number | null;
  teachingReviews: number;
  learningRating: number | null;
  learningReviews: number;
  sessionsCompleted: number;
}

export interface Badge {
  id: 'top-mentor' | 'first-swap' | 'ten-sessions' | 'well-reviewed';
  name: string;
  description: string;
}

export interface PublicUser extends UserSummary {
  bio: string;
  location: string;
  timezone: string;
  skillsTeaching: TeachingSkill[];
  skillsLearning: LearningSkill[];
  availability: Availability;
  preferences: Preferences;
  stats: UserStats;
  badges: Badge[];
  isOnline: boolean;
  joinedAt: string;
}

export interface SelfUser extends PublicUser {
  email: string;
  role: Role;
  onboardingCompleted: boolean;
  isDemo: boolean;
}

/* ---------- Matching ---------- */

export type MatchDimension = 'mutualSkill' | 'availability' | 'level' | 'language' | 'preferences';

export interface MatchBreakdownItem {
  score: number;
  max: number;
  label: string;
}

export interface MatchResult {
  score: number;
  breakdown: Record<MatchDimension, MatchBreakdownItem>;
  reasons: string[];
  /** Best skill pairing found, from the viewer's side. */
  suggestedPair: { youTeach: string | null; theyTeach: string | null };
}

export interface DiscoverUser extends PublicUser {
  match: MatchResult | null;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ReviewDTO {
  id: string;
  reviewer: UserSummary;
  /** The role the reviewed member had in the session. */
  role: 'TEACHER' | 'STUDENT';
  skill: string;
  rating: number;
  feedback: string;
  createdAt: string;
}

export interface ProfileResponse {
  user: PublicUser;
  reviews: ReviewDTO[];
  match: MatchResult | null;
  viewer: { isSelf: boolean; openExchangeId: string | null };
}

export interface SkillOption {
  name: string;
  category: string;
  teachers: number;
  learners: number;
}

/* ---------- Exchanges and contracts ---------- */

export interface ExchangeTerms {
  sessions: number;
  durationMinutes: number;
  schedule: string;
  goals: string[];
}

export interface ExchangeHistoryEntry {
  status: ExchangeStatus;
  byUserId: string | null;
  note: string;
  at: string;
}

export interface ExchangeDTO {
  id: string;
  sender: UserSummary;
  receiver: UserSummary;
  /** What the sender offers to teach. */
  teachingSkill: string;
  /** What the sender wants to learn from the receiver. */
  learningSkill: string;
  message: string;
  status: ExchangeStatus;
  proposed: ExchangeTerms;
  counter: (ExchangeTerms & { message: string; byUserId: string; at: string }) | null;
  /** The terms that would apply if the exchange were accepted now. */
  currentTerms: ExchangeTerms;
  /** Member whose response is awaited, or null when the exchange is settled. */
  awaitingUserId: string | null;
  contractId: string | null;
  history: ExchangeHistoryEntry[];
  createdAt: string;
  updatedAt: string;
  viewer: {
    isSender: boolean;
    canAccept: boolean;
    canDecline: boolean;
    canCounter: boolean;
    canCancel: boolean;
  };
}

export interface ContractGoal {
  id: string;
  title: string;
  completed: boolean;
  completedAt: string | null;
  completedByUserId: string | null;
}

export interface ContractDTO {
  id: string;
  exchangeId: string;
  /** userA teaches skillA; userB teaches skillB. */
  userA: UserSummary;
  userB: UserSummary;
  skillA: string;
  skillB: string;
  totalSessions: number;
  completedSessions: number;
  scheduledSessions: number;
  sessionDurationMinutes: number;
  schedule: string;
  goals: ContractGoal[];
  status: ContractStatus;
  startDate: string;
  endedAt: string | null;
}

/* ---------- Sessions ---------- */

export interface SessionDTO {
  id: string;
  roomCode: string;
  title: string;
  description: string;
  contractId: string | null;
  skill: string;
  teacher: UserSummary;
  learner: UserSummary;
  scheduledStartTime: string;
  scheduledEndTime: string;
  durationMinutes: number;
  status: SessionStatus;
  actualStartTime: string | null;
  actualEndTime: string | null;
  viewer: {
    /** The room can be opened now (scheduled soon or already active). */
    canJoin: boolean;
    canCancel: boolean;
    canReview: boolean;
    hasReviewed: boolean;
  };
}

export interface SharedFile {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  uploadedByUserId: string;
  uploadedAt: string;
}

export interface SessionDetail extends SessionDTO {
  notes: string;
  code: string;
  codeLanguage: EditorLanguage;
  files: SharedFile[];
  contract: ContractDTO | null;
}

export interface ChatMessageDTO {
  id: string;
  sender: UserSummary;
  text: string;
  createdAt: string;
}

/* ---------- Notifications ---------- */

export interface NotificationDTO {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  link: string;
  read: boolean;
  createdAt: string;
  sender: UserSummary | null;
}

export interface NotificationList {
  items: NotificationDTO[];
  unreadCount: number;
}

/* ---------- Dashboard ---------- */

export interface DashboardResponse {
  nextSessions: SessionDTO[];
  awaitingMe: ExchangeDTO[];
  activeContracts: ContractDTO[];
  matches: DiscoverUser[];
  profileCompleteness: { percent: number; missing: string[] };
}

/* ---------- Admin ---------- */

export interface AdminStats {
  totals: {
    users: number;
    activeUsers: number;
    suspendedUsers: number;
    sessions: number;
    completedSessions: number;
    exchanges: number;
    activeContracts: number;
    pendingReports: number;
  };
  /** Completed sessions as a share of sessions that are no longer upcoming; null when there are none. */
  completionRate: number | null;
  activity: { date: string; sessions: number; exchanges: number; signups: number }[];
  topSkills: { skill: string; teachers: number; learners: number }[];
}

export interface AdminUser extends UserSummary {
  email: string;
  role: Role;
  status: UserStatus;
  isDemo: boolean;
  teaching: string[];
  stats: UserStats;
  createdAt: string;
}

export interface ReportDTO {
  id: string;
  reporter: UserSummary | null;
  reportedUser: (UserSummary & { status: UserStatus }) | null;
  reason: ReportReason;
  details: string;
  status: ReportStatus;
  action: ReportAction;
  notes: string;
  createdAt: string;
  resolvedAt: string | null;
}

/* ---------- App config and errors ---------- */

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface DemoAccount {
  username: string;
  name: string;
  blurb: string;
  role: Role;
}

export interface AppConfig {
  demoMode: boolean;
  demoAccounts: DemoAccount[];
  /** Hours after which all data is replaced with fresh demo data; 0 when it never resets. */
  demoResetHours: number;
  iceServers: IceServer[];
  maxUploadMb: number;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
    requestId?: string;
  };
}

/* ---------- Real-time events ---------- */

export interface RoomPeer {
  user: UserSummary;
  media: MediaState;
}

export interface MediaState {
  audio: boolean;
  video: boolean;
  screen: boolean;
}

export type RoomJoinResult =
  | {
      ok: true;
      peers: RoomPeer[];
      messages: ChatMessageDTO[];
      /** Encoded Yjs state of the session's shared document. */
      doc: Uint8Array;
      /** True for the participant who should send the WebRTC offer when both sides collide. */
      polite: boolean;
    }
  | { ok: false; code: string; message: string };

export type Ack<T = { ok: true } | { ok: false; code: string; message: string }> = (
  result: T,
) => void;

export interface ClientToServerEvents {
  'room:join': (roomCode: string, ack: Ack<RoomJoinResult>) => void;
  'room:leave': () => void;
  'rtc:signal': (payload: SignalPayload) => void;
  'media:state': (state: MediaState) => void;
  'chat:send': (payload: { text: string }, ack: Ack) => void;
  'chat:typing': (isTyping: boolean) => void;
  'doc:update': (update: Uint8Array) => void;
}

export interface ServerToClientEvents {
  'presence:sync': (onlineUserIds: string[]) => void;
  'presence:changed': (payload: { userId: string; online: boolean }) => void;
  'room:peer-joined': (peer: RoomPeer) => void;
  'room:peer-left': (payload: { userId: string }) => void;
  'room:replaced': () => void;
  'room:ended': (payload: { byUserId: string; status: SessionStatus }) => void;
  'rtc:signal': (payload: SignalPayload & { fromUserId: string }) => void;
  'media:state': (payload: MediaState & { userId: string }) => void;
  'chat:message': (message: ChatMessageDTO) => void;
  'chat:typing': (payload: { userId: string; isTyping: boolean }) => void;
  'doc:update': (update: Uint8Array) => void;
  'files:changed': () => void;
  'notification:new': (notification: NotificationDTO) => void;
}
