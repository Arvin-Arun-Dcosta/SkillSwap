import { describe, expect, it } from 'vitest';
import {
  avatarSchema,
  exchangeCreateSchema,
  fieldErrors,
  passwordSchema,
  profileUpdateSchema,
  registerSchema,
  signalSchema,
  timezoneSchema,
  usernameSchema,
} from './schemas';
import { escapeRegExp, initials } from './util';

describe('account schemas', () => {
  it('normalises usernames and emails', () => {
    const parsed = registerSchema.parse({
      name: '  Priya Sharma ',
      username: 'Priya_Codes',
      email: ' Priya@Example.COM ',
      password: 'correct horse 9',
    });
    expect(parsed).toMatchObject({
      name: 'Priya Sharma',
      username: 'priya_codes',
      email: 'priya@example.com',
    });
  });

  it('rejects usernames with unsupported characters', () => {
    expect(usernameSchema.safeParse('a b').success).toBe(false);
    expect(usernameSchema.safeParse('ab').success).toBe(false);
    expect(usernameSchema.safeParse('{"$ne":null}').success).toBe(false);
  });

  it('enforces password rules on the server side too', () => {
    expect(passwordSchema.safeParse('short1!').success).toBe(false);
    expect(passwordSchema.safeParse('onlyletters').success).toBe(false);
    expect(passwordSchema.safeParse('Password123!').success).toBe(true);
    expect(passwordSchema.safeParse('a1' + 'x'.repeat(80)).success).toBe(false);
  });

  it('rejects non-string login-style payloads instead of throwing', () => {
    const result = registerSchema.safeParse({
      name: { $ne: null },
      username: 1,
      email: [],
      password: {},
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(Object.keys(fieldErrors(result.error)).sort()).toEqual([
        'email',
        'name',
        'password',
        'username',
      ]);
    }
  });
});

describe('profile update schema', () => {
  it('does not accept ratings, roles or other privileged fields', () => {
    expect(profileUpdateSchema.safeParse({ role: 'ADMIN' }).success).toBe(false);
    expect(profileUpdateSchema.safeParse({ stats: { teachingRating: 5 } }).success).toBe(false);
    const parsed = profileUpdateSchema.parse({
      skillsTeaching: [
        { skill: 'Java', proficiency: 'Expert', yearsExperience: 4, description: '', rating: 5 },
      ],
    });
    expect(parsed.skillsTeaching?.[0]).not.toHaveProperty('rating');
  });

  it('rejects duplicate skills regardless of case', () => {
    const result = profileUpdateSchema.safeParse({
      skillsLearning: [
        { skill: 'Figma', targetProficiency: 'Beginner', priority: 'High', notes: '' },
        { skill: 'figma', targetProficiency: 'Expert', priority: 'Low', notes: '' },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('only allows https avatars', () => {
    expect(avatarSchema.safeParse('').success).toBe(true);
    expect(avatarSchema.safeParse('https://example.com/a.png').success).toBe(true);
    expect(avatarSchema.safeParse('http://example.com/a.png').success).toBe(false);
    expect(avatarSchema.safeParse('javascript:alert(1)').success).toBe(false);
  });

  it('validates IANA time zones', () => {
    expect(timezoneSchema.safeParse('Asia/Kolkata').success).toBe(true);
    expect(timezoneSchema.safeParse('').success).toBe(true);
    expect(timezoneSchema.safeParse('Mars/Olympus').success).toBe(false);
  });
});

describe('exchange schema', () => {
  const base = {
    receiverId: 'a'.repeat(24),
    teachingSkill: 'Java',
    learningSkill: 'Video Editing',
    message: 'Happy to swap skills with you.',
    sessions: 4,
    durationMinutes: 60,
  };

  it('accepts a well-formed proposal and defaults goals', () => {
    expect(exchangeCreateSchema.parse(base).goals).toEqual([]);
  });

  it('rejects malformed ids and unsupported durations', () => {
    expect(exchangeCreateSchema.safeParse({ ...base, receiverId: 'nope' }).success).toBe(false);
    expect(exchangeCreateSchema.safeParse({ ...base, durationMinutes: 61 }).success).toBe(false);
    expect(exchangeCreateSchema.safeParse({ ...base, sessions: 0 }).success).toBe(false);
  });
});

describe('signal schema', () => {
  it('requires a description or a candidate', () => {
    expect(signalSchema.safeParse({}).success).toBe(false);
    expect(signalSchema.safeParse({ description: { type: 'offer', sdp: 'v=0' } }).success).toBe(
      true,
    );
    expect(signalSchema.safeParse({ candidate: null }).success).toBe(true);
  });
});

describe('utilities', () => {
  it('escapes regular expression metacharacters', () => {
    const hostile = '(a+)+$';
    expect(new RegExp(escapeRegExp(hostile)).test(hostile)).toBe(true);
    expect(() => new RegExp(escapeRegExp('('))).not.toThrow();
  });

  it('derives initials', () => {
    expect(initials('Arjun Mehta')).toBe('AM');
    expect(initials('  elena ')).toBe('E');
    expect(initials('')).toBe('?');
  });
});
