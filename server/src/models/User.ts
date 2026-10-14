import { type HydratedDocument, Schema, type Types, model } from 'mongoose';
import {
  DAYS,
  type Day,
  PRIORITIES,
  PROFICIENCY_LEVELS,
  type Priority,
  type Proficiency,
  ROLES,
  type Role,
  SESSION_FORMATS,
  type SessionFormat,
  TIME_SLOT_IDS,
  type TimeSlotId,
  USER_STATUSES,
  type UserStatus,
} from '@skillswap/shared';

export interface ITeachingSkill {
  skill: string;
  proficiency: Proficiency;
  yearsExperience: number;
  description: string;
}

export interface ILearningSkill {
  skill: string;
  targetProficiency: Proficiency;
  priority: Priority;
  notes: string;
}

export interface IUserStats {
  teachingRating: number | null;
  teachingReviews: number;
  learningRating: number | null;
  learningReviews: number;
  sessionsCompleted: number;
}

export interface IUser {
  _id: Types.ObjectId;
  name: string;
  username: string;
  email: string;
  password: string;
  avatar: string;
  headline: string;
  bio: string;
  location: string;
  timezone: string;
  skillsTeaching: ITeachingSkill[];
  skillsLearning: ILearningSkill[];
  availability: { days: Day[]; timeSlots: TimeSlotId[]; hoursPerWeek: number };
  preferences: { format: SessionFormat[]; sessionLength: number; languages: string[] };
  stats: IUserStats;
  role: Role;
  status: UserStatus;
  isDemo: boolean;
  onboardingCompleted: boolean;
  /** Incremented to invalidate every session cookie issued so far. */
  tokenVersion: number;
  lastActive: Date;
  createdAt: Date;
  updatedAt: Date;
}

const teachingSkillSchema = new Schema<ITeachingSkill>(
  {
    skill: { type: String, required: true, trim: true, maxlength: 40 },
    proficiency: { type: String, enum: PROFICIENCY_LEVELS, default: 'Intermediate' },
    yearsExperience: { type: Number, default: 1, min: 0, max: 60 },
    description: { type: String, default: '', maxlength: 300 },
  },
  { _id: false },
);

const learningSkillSchema = new Schema<ILearningSkill>(
  {
    skill: { type: String, required: true, trim: true, maxlength: 40 },
    targetProficiency: { type: String, enum: PROFICIENCY_LEVELS, default: 'Intermediate' },
    priority: { type: String, enum: PRIORITIES, default: 'High' },
    notes: { type: String, default: '', maxlength: 300 },
  },
  { _id: false },
);

const userSchema = new Schema<IUser>(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    username: { type: String, required: true, unique: true, lowercase: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true, select: false },
    avatar: { type: String, default: '' },
    headline: { type: String, default: '', maxlength: 120 },
    bio: { type: String, default: '', maxlength: 1000 },
    location: { type: String, default: '', maxlength: 80 },
    timezone: { type: String, default: '' },
    skillsTeaching: { type: [teachingSkillSchema], default: [] },
    skillsLearning: { type: [learningSkillSchema], default: [] },
    availability: {
      days: { type: [String], enum: DAYS, default: [] },
      timeSlots: { type: [String], enum: TIME_SLOT_IDS, default: [] },
      hoursPerWeek: { type: Number, default: 4, min: 1, max: 40 },
    },
    preferences: {
      format: { type: [String], enum: SESSION_FORMATS, default: ['Video'] },
      sessionLength: { type: Number, default: 60 },
      languages: { type: [String], default: ['English'] },
    },
    stats: {
      teachingRating: { type: Number, default: null },
      teachingReviews: { type: Number, default: 0 },
      learningRating: { type: Number, default: null },
      learningReviews: { type: Number, default: 0 },
      sessionsCompleted: { type: Number, default: 0 },
    },
    role: { type: String, enum: ROLES, default: 'USER' },
    status: { type: String, enum: USER_STATUSES, default: 'ACTIVE' },
    isDemo: { type: Boolean, default: false },
    onboardingCompleted: { type: Boolean, default: false },
    tokenVersion: { type: Number, default: 0 },
    lastActive: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

userSchema.index({ 'skillsTeaching.skill': 1 });
userSchema.index({ 'skillsLearning.skill': 1 });
userSchema.index({ status: 1, onboardingCompleted: 1, 'stats.teachingRating': -1 });

export type UserDoc = HydratedDocument<IUser>;
export const User = model<IUser>('User', userSchema);
