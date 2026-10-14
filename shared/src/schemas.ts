import { z } from 'zod';
import {
  DAYS,
  DISCOVER_SORTS,
  EDITOR_LANGUAGE_IDS,
  EXCHANGE_ACTIONS,
  LIMITS,
  PRIORITIES,
  PROFICIENCY_LEVELS,
  REPORT_ACTIONS,
  REPORT_REASONS,
  SESSION_FORMATS,
  SESSION_LENGTHS,
  TIME_SLOT_IDS,
  USER_STATUSES,
} from './constants';

// Zod normally probes whether it may compile validators with `new Function`. The app's
// Content-Security-Policy forbids eval, and the probe alone is reported as a violation by browsers,
// so the interpreter path is selected explicitly.
z.config({ jitless: true });

const text = (max: number) => z.string().trim().max(max, `Keep this under ${max} characters`);
const requiredText = (max: number, label: string) =>
  z.string().trim().min(1, `${label} is required`).max(max, `Keep this under ${max} characters`);

export const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(LIMITS.usernameMin, `Use at least ${LIMITS.usernameMin} characters`)
  .max(LIMITS.usernameMax, `Use at most ${LIMITS.usernameMax} characters`)
  .regex(/^[a-z0-9_]+$/, 'Use only letters, numbers and underscores');

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, 'Email is too long')
  .pipe(z.email('Enter a valid email address'));

const byteLength = (value: string) => new TextEncoder().encode(value).length;

export const passwordSchema = z
  .string()
  .min(LIMITS.passwordMin, `Use at least ${LIMITS.passwordMin} characters`)
  .refine((v) => byteLength(v) <= LIMITS.passwordMaxBytes, 'Password is too long')
  .refine((v) => /[a-zA-Z]/.test(v) && /[^a-zA-Z]/.test(v), {
    message: 'Include at least one letter and one number or symbol',
  });

export const registerSchema = z.object({
  name: requiredText(LIMITS.nameMax, 'Name'),
  username: usernameSchema,
  email: emailSchema,
  password: passwordSchema,
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  identifier: z.string().trim().min(1, 'Enter your email or username').max(254),
  password: z.string().min(1, 'Enter your password').max(1000),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const demoLoginSchema = z.object({ username: usernameSchema });

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password').max(1000),
  newPassword: passwordSchema,
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

const skillName = requiredText(LIMITS.skillNameMax, 'Skill');

export const teachingSkillSchema = z.object({
  skill: skillName,
  proficiency: z.enum(PROFICIENCY_LEVELS),
  yearsExperience: z.coerce.number().int().min(0).max(60),
  description: text(LIMITS.skillNoteMax).default(''),
});
export type TeachingSkillInput = z.infer<typeof teachingSkillSchema>;

export const learningSkillSchema = z.object({
  skill: skillName,
  targetProficiency: z.enum(PROFICIENCY_LEVELS),
  priority: z.enum(PRIORITIES),
  notes: text(LIMITS.skillNoteMax).default(''),
});
export type LearningSkillInput = z.infer<typeof learningSkillSchema>;

const uniqueSkills = <T extends { skill: string }>(items: T[]) =>
  new Set(items.map((i) => i.skill.toLowerCase())).size === items.length;

export const avatarSchema = z
  .string()
  .trim()
  .max(500)
  .refine((v) => v === '' || /^https:\/\/[^\s]+$/.test(v), 'Use an https:// image address')
  .refine((v) => v === '' || URL.canParse(v), 'Enter a valid web address');

export const timezoneSchema = z
  .string()
  .trim()
  .max(64)
  .refine((v) => {
    if (v === '') return true;
    try {
      new Intl.DateTimeFormat('en', { timeZone: v });
      return true;
    } catch {
      return false;
    }
  }, 'Unknown time zone');

export const availabilitySchema = z.object({
  days: z.array(z.enum(DAYS)).max(7),
  timeSlots: z.array(z.enum(TIME_SLOT_IDS)).max(4),
  hoursPerWeek: z.coerce.number().int().min(1).max(40),
});
export type AvailabilityInput = z.infer<typeof availabilitySchema>;

export const preferencesSchema = z.object({
  format: z.array(z.enum(SESSION_FORMATS)).max(SESSION_FORMATS.length),
  sessionLength: z.coerce
    .number()
    .refine((v) => (SESSION_LENGTHS as readonly number[]).includes(v), 'Pick a session length'),
  languages: z
    .array(requiredText(40, 'Language'))
    .min(1, 'Add at least one language')
    .max(LIMITS.languagesMax),
});
export type PreferencesInput = z.infer<typeof preferencesSchema>;

export const profileBasicsSchema = z.object({
  name: requiredText(LIMITS.nameMax, 'Name'),
  headline: text(LIMITS.headlineMax),
  bio: text(LIMITS.bioMax),
  location: text(LIMITS.locationMax),
  timezone: timezoneSchema,
  avatar: avatarSchema,
});
export type ProfileBasicsInput = z.infer<typeof profileBasicsSchema>;

export const teachingListSchema = z
  .array(teachingSkillSchema)
  .max(LIMITS.skillsPerList, `Add at most ${LIMITS.skillsPerList} skills`)
  .refine(uniqueSkills, 'Each skill can only be listed once');

export const learningListSchema = z
  .array(learningSkillSchema)
  .max(LIMITS.skillsPerList, `Add at most ${LIMITS.skillsPerList} skills`)
  .refine(uniqueSkills, 'Each skill can only be listed once');

/** Every field is optional: clients send only what changed. Ratings and roles are not accepted here. */
export const profileUpdateSchema = z
  .object({
    ...profileBasicsSchema.shape,
    skillsTeaching: teachingListSchema,
    skillsLearning: learningListSchema,
    availability: availabilitySchema,
    preferences: preferencesSchema,
    onboardingCompleted: z.literal(true),
  })
  .partial()
  .strict();
export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;

const booleanQuery = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1')
  .optional();

export const discoverQuerySchema = z.object({
  q: text(LIMITS.searchMax).optional(),
  proficiency: z.enum(PROFICIENCY_LEVELS).optional(),
  day: z.enum(DAYS).optional(),
  minRating: z.coerce.number().min(1).max(5).optional(),
  onlineOnly: booleanQuery,
  sort: z.enum(DISCOVER_SORTS).default('match'),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(1).max(LIMITS.pageSizeMax).default(12),
});
export type DiscoverQuery = z.infer<typeof discoverQuerySchema>;

const sessionsCount = z.coerce
  .number()
  .int()
  .min(LIMITS.sessionsMin, 'Plan at least one session')
  .max(LIMITS.sessionsMax, `Plan at most ${LIMITS.sessionsMax} sessions`);

const duration = z.coerce
  .number()
  .refine((v) => (SESSION_LENGTHS as readonly number[]).includes(v), 'Pick a session length');

const goals = z
  .array(requiredText(LIMITS.goalMax, 'Goal'))
  .max(LIMITS.goalsMax, `Add at most ${LIMITS.goalsMax} goals`);

export const exchangeCreateSchema = z.object({
  receiverId: objectIdSchema,
  teachingSkill: skillName,
  learningSkill: skillName,
  message: z
    .string()
    .trim()
    .min(10, 'Write a short note (at least 10 characters)')
    .max(LIMITS.messageMax, `Keep this under ${LIMITS.messageMax} characters`),
  sessions: sessionsCount,
  durationMinutes: duration,
  goals: goals.default([]),
});
export type ExchangeCreateInput = z.infer<typeof exchangeCreateSchema>;

export const exchangeCounterSchema = z.object({
  sessions: sessionsCount,
  durationMinutes: duration,
  schedule: text(LIMITS.scheduleMax).default(''),
  message: z
    .string()
    .trim()
    .min(1, 'Add a short note explaining the change')
    .max(LIMITS.messageMax, `Keep this under ${LIMITS.messageMax} characters`),
});
export type ExchangeCounterInput = z.infer<typeof exchangeCounterSchema>;

export const exchangeActionSchema = z.object({
  action: z.enum(EXCHANGE_ACTIONS),
});
export type ExchangeActionInput = z.infer<typeof exchangeActionSchema>;

export const exchangeListQuerySchema = z.object({
  box: z.enum(['received', 'sent', 'all']).default('all'),
});

export const sessionCreateSchema = z.object({
  contractId: objectIdSchema,
  skill: skillName,
  title: text(LIMITS.titleMax).default(''),
  description: text(LIMITS.descriptionMax).default(''),
  scheduledStartTime: z.coerce
    .date({ error: 'Pick a date and time' })
    .refine((d) => d.getTime() > Date.now() - 60_000, 'Pick a time in the future')
    .refine(
      (d) => d.getTime() < Date.now() + 365 * 24 * 60 * 60 * 1000,
      'Pick a time within the next year',
    ),
});
export type SessionCreateInput = z.infer<typeof sessionCreateSchema>;

export const sessionReviewSchema = z.object({
  rating: z.coerce.number().int().min(1, 'Pick a rating').max(5),
  feedback: text(LIMITS.feedbackMax).default(''),
});
export type SessionReviewInput = z.infer<typeof sessionReviewSchema>;

export const reportCreateSchema = z.object({
  reportedUserId: objectIdSchema,
  reason: z.enum(REPORT_REASONS, { error: 'Pick a reason' }),
  details: z
    .string()
    .trim()
    .min(
      LIMITS.reportDetailsMin,
      `Describe what happened (at least ${LIMITS.reportDetailsMin} characters)`,
    )
    .max(LIMITS.reportDetailsMax, `Keep this under ${LIMITS.reportDetailsMax} characters`),
});
export type ReportCreateInput = z.infer<typeof reportCreateSchema>;

export const reportResolveSchema = z.object({
  status: z.enum(['RESOLVED', 'DISMISSED']),
  action: z.enum(REPORT_ACTIONS).default('NONE'),
  notes: text(1000).default(''),
});
export type ReportResolveInput = z.infer<typeof reportResolveSchema>;

export const adminUserStatusSchema = z.object({ status: z.enum(USER_STATUSES) });

export const adminUsersQuerySchema = z.object({
  q: text(LIMITS.searchMax).optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const roomCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9-]{6,40}$/, 'Invalid room code');

export const chatMessageSchema = z.object({
  text: z.string().trim().min(1).max(LIMITS.chatMax),
});

export const editorLanguageSchema = z.enum(EDITOR_LANGUAGE_IDS);

/** WebRTC signaling payloads are relayed, never interpreted, so they are only bounded in size. */
export const signalSchema = z
  .object({
    description: z
      .object({
        type: z.enum(['offer', 'answer', 'pranswer', 'rollback']),
        sdp: z.string().max(200_000).optional(),
      })
      .optional(),
    candidate: z
      .object({
        candidate: z.string().max(2000),
        sdpMid: z.string().max(64).nullable().optional(),
        sdpMLineIndex: z.number().int().min(0).max(64).nullable().optional(),
        usernameFragment: z.string().max(256).nullable().optional(),
      })
      .nullable()
      .optional(),
  })
  .refine((v) => v.description !== undefined || v.candidate !== undefined, 'Empty signal');
export type SignalPayload = z.infer<typeof signalSchema>;

/** Turns a zod error into `{ field: message }`, keeping the first message per field. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    out[key] ??= issue.message;
  }
  return out;
}
