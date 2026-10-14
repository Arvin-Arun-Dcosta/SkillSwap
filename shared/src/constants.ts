export const PROFICIENCY_LEVELS = ['Beginner', 'Intermediate', 'Advanced', 'Expert'] as const;
export type Proficiency = (typeof PROFICIENCY_LEVELS)[number];

export const PRIORITIES = ['High', 'Medium', 'Low'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const DAYS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;
export type Day = (typeof DAYS)[number];

export const TIME_SLOTS = [
  { id: 'morning', label: 'Mornings', hint: '6am to 12pm' },
  { id: 'afternoon', label: 'Afternoons', hint: '12pm to 5pm' },
  { id: 'evening', label: 'Evenings', hint: '5pm to 9pm' },
  { id: 'night', label: 'Late nights', hint: 'after 9pm' },
] as const;
export const TIME_SLOT_IDS = ['morning', 'afternoon', 'evening', 'night'] as const;
export type TimeSlotId = (typeof TIME_SLOT_IDS)[number];

export const SESSION_FORMATS = ['Video', 'Chat', 'Project-based'] as const;
export type SessionFormat = (typeof SESSION_FORMATS)[number];

export const SESSION_LENGTHS = [30, 45, 60, 90] as const;
export type SessionLength = (typeof SESSION_LENGTHS)[number];

export const SKILL_CATEGORIES = [
  'Software & Tech',
  'Design & Creative',
  'Data & AI',
  'Languages & Culture',
  'Business & Finance',
  'Music & Audio',
  'Video & Animation',
  'Writing & Marketing',
  'Personal Development',
] as const;
export type SkillCategory = (typeof SKILL_CATEGORIES)[number];

export const ROLES = ['USER', 'ADMIN'] as const;
export type Role = (typeof ROLES)[number];

export const USER_STATUSES = ['ACTIVE', 'SUSPENDED'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const EXCHANGE_STATUSES = [
  'PENDING',
  'COUNTERED',
  'ACCEPTED',
  'REJECTED',
  'CANCELLED',
  'COMPLETED',
] as const;
export type ExchangeStatus = (typeof EXCHANGE_STATUSES)[number];

/** Statuses in which two members are still negotiating or working together. */
export const OPEN_EXCHANGE_STATUSES: readonly ExchangeStatus[] = [
  'PENDING',
  'COUNTERED',
  'ACCEPTED',
];

export const EXCHANGE_ACTIONS = ['accept', 'decline', 'cancel'] as const;
export type ExchangeAction = (typeof EXCHANGE_ACTIONS)[number];

export const CONTRACT_STATUSES = ['ACTIVE', 'COMPLETED', 'TERMINATED'] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

export const SESSION_STATUSES = ['SCHEDULED', 'ACTIVE', 'COMPLETED', 'CANCELLED'] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export const REPORT_REASONS = [
  'Inappropriate Behavior',
  'No-show / Abandoned Session',
  'Spam or Solicitation',
  'Harassment',
  'Skill Misrepresentation',
  'Other',
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export const REPORT_STATUSES = ['PENDING', 'RESOLVED', 'DISMISSED'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const REPORT_ACTIONS = ['NONE', 'WARNED', 'SUSPENDED'] as const;
export type ReportAction = (typeof REPORT_ACTIONS)[number];

export const NOTIFICATION_TYPES = [
  'EXCHANGE_REQUEST',
  'REQUEST_ACCEPTED',
  'REQUEST_REJECTED',
  'REQUEST_CANCELLED',
  'COUNTER_OFFER',
  'UPCOMING_SESSION',
  'SESSION_CANCELLED',
  'SESSION_COMPLETED',
  'REVIEW_RECEIVED',
  'CONTRACT_COMPLETED',
  'CONTRACT_ENDED',
  'SYSTEM',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const EDITOR_LANGUAGES = [
  { id: 'javascript', label: 'JavaScript', runnable: true },
  { id: 'typescript', label: 'TypeScript', runnable: false },
  { id: 'python', label: 'Python', runnable: false },
  { id: 'java', label: 'Java', runnable: false },
  { id: 'cpp', label: 'C++', runnable: false },
  { id: 'html', label: 'HTML', runnable: false },
] as const;
export const EDITOR_LANGUAGE_IDS = [
  'javascript',
  'typescript',
  'python',
  'java',
  'cpp',
  'html',
] as const;
export type EditorLanguage = (typeof EDITOR_LANGUAGE_IDS)[number];

export const DISCOVER_SORTS = ['match', 'rating', 'sessions', 'recent'] as const;
export type DiscoverSort = (typeof DISCOVER_SORTS)[number];

/** Weights of the match score. They add up to 100. */
export const MATCH_WEIGHTS = {
  mutualSkill: 50,
  availability: 20,
  level: 10,
  language: 10,
  preferences: 10,
} as const;

export const LIMITS = {
  nameMax: 80,
  usernameMin: 3,
  usernameMax: 24,
  passwordMin: 8,
  /** bcrypt only reads the first 72 bytes of a password. */
  passwordMaxBytes: 72,
  headlineMax: 120,
  bioMax: 1000,
  locationMax: 80,
  skillNameMax: 40,
  skillNoteMax: 300,
  skillsPerList: 12,
  languagesMax: 8,
  messageMax: 1000,
  goalMax: 140,
  goalsMax: 8,
  scheduleMax: 140,
  sessionsMin: 1,
  sessionsMax: 12,
  titleMax: 120,
  descriptionMax: 500,
  feedbackMax: 1000,
  chatMax: 2000,
  searchMax: 80,
  reportDetailsMin: 10,
  reportDetailsMax: 1000,
  pageSizeMax: 48,
  /** Size cap for the collaborative document of one session, in bytes. */
  collabDocMaxBytes: 2 * 1024 * 1024,
} as const;

/** Minutes before the scheduled start from which a session room can be opened. */
export const SESSION_EARLY_JOIN_MINUTES = 15;

/** File extensions that can be shared in a session. Active content (html, svg) is excluded on purpose. */
export const ALLOWED_UPLOAD_EXTENSIONS = [
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'pdf',
  'txt',
  'md',
  'csv',
  'json',
  'js',
  'jsx',
  'ts',
  'tsx',
  'py',
  'java',
  'c',
  'cpp',
  'h',
  'css',
  'zip',
] as const;

/** Names of the shared types inside a session's Yjs document. Client and server must agree. */
export const COLLAB = {
  code: 'code',
  notes: 'notes',
  meta: 'meta',
  strokes: 'strokes',
  /** Key inside `meta` holding the editor language. */
  languageKey: 'language',
} as const;

/** Largest single collaborative update the server relays, in bytes. */
export const COLLAB_UPDATE_MAX_BYTES = 256 * 1024;
