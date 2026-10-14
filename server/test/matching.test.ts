import { describe, expect, it } from 'vitest';
import { MATCH_WEIGHTS } from '@skillswap/shared';
import { type Matchable, calculateMatch } from '../src/services/matching';

const member = (overrides: Partial<Matchable> = {}): Matchable => ({
  _id: 'a',
  skillsTeaching: [],
  skillsLearning: [],
  availability: { days: [], timeSlots: [], hoursPerWeek: 4 },
  preferences: { format: [], sessionLength: 60, languages: [] },
  ...overrides,
});

const java = { skill: 'Java', proficiency: 'Expert' as const, yearsExperience: 5, description: '' };
const video = {
  skill: 'Video Editing',
  proficiency: 'Advanced' as const,
  yearsExperience: 3,
  description: '',
};
const wants = (
  skill: string,
  targetProficiency: 'Beginner' | 'Intermediate' | 'Expert' = 'Intermediate',
) => ({
  skill,
  targetProficiency,
  priority: 'High' as const,
  notes: '',
});

describe('match score', () => {
  it('weights add up to 100', () => {
    expect(Object.values(MATCH_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
  });

  it('gives a perfect two-way swap with full overlap 100', () => {
    const me = member({
      skillsTeaching: [java],
      skillsLearning: [wants('video editing')],
      availability: { days: ['Monday'], timeSlots: ['evening'], hoursPerWeek: 4 },
      preferences: { format: ['Video'], sessionLength: 60, languages: ['English'] },
    });
    const them = member({
      _id: 'b',
      skillsTeaching: [video],
      skillsLearning: [wants('JAVA')],
      availability: { days: ['Monday', 'Friday'], timeSlots: ['evening'], hoursPerWeek: 4 },
      preferences: { format: ['Video', 'Chat'], sessionLength: 60, languages: ['english'] },
    });
    const result = calculateMatch(me, them);
    expect(result.score).toBe(100);
    expect(result.suggestedPair).toEqual({ youTeach: 'Java', theyTeach: 'Video Editing' });
    expect(result.reasons[0]).toMatch(/Two-way swap/);
  });

  it('scores unrelated members zero instead of an invented floor', () => {
    const result = calculateMatch(member(), member({ _id: 'b' }));
    // Both default to the same session length, which is the only thing they share.
    expect(result.score).toBe(4);
    expect(result.breakdown.mutualSkill.score).toBe(0);
    expect(result.breakdown.level.score).toBe(0);
    expect(result.suggestedPair).toEqual({ youTeach: null, theyTeach: null });
  });

  it('distinguishes one-way matches by direction', () => {
    const iWant = calculateMatch(
      member({ skillsLearning: [wants('Java')] }),
      member({ _id: 'b', skillsTeaching: [java] }),
    );
    const theyWant = calculateMatch(
      member({ skillsTeaching: [java] }),
      member({ _id: 'b', skillsLearning: [wants('Java')] }),
    );
    expect(iWant.breakdown.mutualSkill.score).toBe(30);
    expect(theyWant.breakdown.mutualSkill.score).toBe(20);
  });

  it('lowers the level score when the teacher is below the target level', () => {
    const teacher = member({ _id: 'b', skillsTeaching: [{ ...java, proficiency: 'Beginner' }] });
    expect(
      calculateMatch(member({ skillsLearning: [wants('Java', 'Beginner')] }), teacher).breakdown
        .level.score,
    ).toBe(10);
    expect(
      calculateMatch(member({ skillsLearning: [wants('Java', 'Intermediate')] }), teacher).breakdown
        .level.score,
    ).toBe(6);
    expect(
      calculateMatch(member({ skillsLearning: [wants('Java', 'Expert')] }), teacher).breakdown.level
        .score,
    ).toBe(3);
  });

  it('never exceeds any dimension maximum', () => {
    const rich = member({
      skillsTeaching: [java, video],
      skillsLearning: [wants('Java'), wants('Video Editing')],
      availability: {
        days: ['Monday', 'Tuesday'],
        timeSlots: ['morning', 'evening'],
        hoursPerWeek: 10,
      },
      preferences: {
        format: ['Video', 'Chat', 'Project-based'],
        sessionLength: 90,
        languages: ['English', 'Hindi'],
      },
    });
    const result = calculateMatch(rich, { ...rich, _id: 'b' });
    for (const item of Object.values(result.breakdown))
      expect(item.score).toBeLessThanOrEqual(item.max);
    expect(result.score).toBeLessThanOrEqual(100);
  });
});
