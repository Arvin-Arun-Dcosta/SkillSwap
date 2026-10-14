import { type HydratedDocument, Schema, type Types, model } from 'mongoose';
import { SKILL_CATEGORIES, type SkillCategory } from '@skillswap/shared';

/** Curated catalogue used for suggestions. Members can still enter skills that are not listed. */
export interface ISkill {
  _id: Types.ObjectId;
  name: string;
  category: SkillCategory;
  createdAt: Date;
  updatedAt: Date;
}

const skillSchema = new Schema<ISkill>(
  {
    name: { type: String, required: true, unique: true, trim: true },
    category: { type: String, enum: SKILL_CATEGORIES, default: 'Software & Tech' },
  },
  { timestamps: true },
);

export type SkillDoc = HydratedDocument<ISkill>;
export const Skill = model<ISkill>('Skill', skillSchema);
