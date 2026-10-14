import {
  MATCH_WEIGHTS,
  type MatchResult,
  PROFICIENCY_LEVELS,
  type Proficiency,
  timeSlotLabel,
} from '@skillswap/shared';
import type { IUser } from '../models';

export type Matchable = Pick<
  IUser,
  'skillsTeaching' | 'skillsLearning' | 'availability' | 'preferences'
> & { _id: { toString(): string } };

const level = (p: Proficiency) => PROFICIENCY_LEVELS.indexOf(p);
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

function listNames(items: string[], max: number): string {
  const shown = items.slice(0, max);
  return shown.length < items.length ? `${shown.join(', ')} and more` : shown.join(', ');
}

/**
 * Scores how well `them` fits `me`, from `me`'s point of view, out of 100.
 *
 * The five dimensions and their weights are fixed (see MATCH_WEIGHTS). A dimension with nothing in
 * common scores zero, so two unrelated members get a low score instead of an arbitrary floor.
 */
export function calculateMatch(me: Matchable, them: Matchable): MatchResult {
  const reasons: string[] = [];

  // 1. Skills: does each side teach something the other wants?
  let theyTeach: { skill: string; proficiency: Proficiency; target: Proficiency } | null = null;
  for (const wanted of me.skillsLearning) {
    const offered = them.skillsTeaching.find((t) => same(t.skill, wanted.skill));
    if (offered) {
      theyTeach = {
        skill: offered.skill,
        proficiency: offered.proficiency,
        target: wanted.targetProficiency,
      };
      break;
    }
  }
  let youTeach: string | null = null;
  for (const offered of me.skillsTeaching) {
    if (them.skillsLearning.some((w) => same(w.skill, offered.skill))) {
      youTeach = offered.skill;
      break;
    }
  }

  let mutualSkill = 0;
  if (theyTeach && youTeach) {
    mutualSkill = MATCH_WEIGHTS.mutualSkill;
    reasons.push(`Two-way swap: you teach ${youTeach}, they teach ${theyTeach.skill}`);
  } else if (theyTeach) {
    mutualSkill = 30;
    reasons.push(`They teach ${theyTeach.skill}, which you want to learn`);
  } else if (youTeach) {
    mutualSkill = 20;
    reasons.push(`You teach ${youTeach}, which they want to learn`);
  }

  // 2. Availability: shared days and shared parts of the day.
  const commonDays = me.availability.days.filter((d) => them.availability.days.includes(d));
  const commonSlots = me.availability.timeSlots.filter((s) =>
    them.availability.timeSlots.includes(s),
  );
  let availability = 0;
  if (commonDays.length > 0 && commonSlots.length > 0) {
    availability = MATCH_WEIGHTS.availability;
    const slot = commonSlots[0];
    reasons.push(
      `Both free on ${listNames(commonDays, 3)}${slot ? ` (${timeSlotLabel(slot).toLowerCase()})` : ''}`,
    );
  } else if (commonDays.length > 0) {
    availability = 12;
    reasons.push(`Shared days: ${listNames(commonDays, 3)}`);
  } else if (commonSlots.length > 0) {
    availability = 8;
    reasons.push('Free at the same time of day');
  }

  // 3. Level: is the teacher at or above the level you are aiming for?
  let levelScore = 0;
  if (theyTeach) {
    const gap = level(theyTeach.proficiency) - level(theyTeach.target);
    if (gap >= 0) {
      levelScore = MATCH_WEIGHTS.level;
      reasons.push(`${theyTeach.proficiency} in ${theyTeach.skill}, at or above your target level`);
    } else if (gap === -1) {
      levelScore = 6;
    } else {
      levelScore = 3;
    }
  }

  // 4. Language.
  const theirLanguages = them.preferences.languages.map((l) => l.toLowerCase());
  const commonLanguages = me.preferences.languages.filter((l) =>
    theirLanguages.includes(l.toLowerCase()),
  );
  let language = 0;
  if (commonLanguages.length > 0) {
    language = MATCH_WEIGHTS.language;
    reasons.push(`You both speak ${listNames(commonLanguages, 2)}`);
  }

  // 5. Session preferences: format and length.
  const commonFormats = me.preferences.format.filter((f) => them.preferences.format.includes(f));
  let preferences = 0;
  if (commonFormats.length > 0) {
    preferences += 6;
    reasons.push(`Both like ${commonFormats.join(' and ').toLowerCase()} sessions`);
  }
  if (me.preferences.sessionLength === them.preferences.sessionLength) preferences += 4;

  const score = mutualSkill + availability + levelScore + language + preferences;

  return {
    score,
    breakdown: {
      mutualSkill: { score: mutualSkill, max: MATCH_WEIGHTS.mutualSkill, label: 'Skill fit' },
      availability: {
        score: availability,
        max: MATCH_WEIGHTS.availability,
        label: 'Availability',
      },
      level: { score: levelScore, max: MATCH_WEIGHTS.level, label: 'Experience level' },
      language: { score: language, max: MATCH_WEIGHTS.language, label: 'Language' },
      preferences: {
        score: preferences,
        max: MATCH_WEIGHTS.preferences,
        label: 'Session preferences',
      },
    },
    reasons,
    suggestedPair: { youTeach, theyTeach: theyTeach?.skill ?? null },
  };
}
