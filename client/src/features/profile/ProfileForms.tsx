import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { type ReactNode, useId, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import {
  DAYS,
  type Day,
  LIMITS,
  type LearningSkillInput,
  PRIORITIES,
  PROFICIENCY_LEVELS,
  SESSION_FORMATS,
  SESSION_LENGTHS,
  type SessionFormat,
  type SkillOption,
  TIME_SLOTS,
  type TeachingSkillInput,
  type TimeSlotId,
  learningSkillSchema,
  profileBasicsSchema,
  teachingSkillSchema,
} from '@skillswap/shared';
import { SkillChip } from '@/components/domain/SkillChip';
import {
  Avatar,
  Button,
  ChoiceChips,
  IconButton,
  Input,
  Notice,
  Select,
  Textarea,
  useToast,
} from '@/components/ui';
import { useAuth } from '@/features/auth/AuthProvider';
import { api, errorMessage } from '@/lib/api';
import { applyServerErrors } from '@/lib/forms';
import { browserTimezone } from '@/lib/format';

interface SectionProps {
  submitLabel?: string;
  /** Extra control rendered next to the submit button, for example "Back". */
  secondary?: ReactNode;
  onSaved?: () => void;
}

function FormActions({
  submitLabel,
  secondary,
  loading,
}: {
  submitLabel: string;
  secondary?: ReactNode;
  loading: boolean;
}) {
  return (
    <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-between">
      <div>{secondary}</div>
      <Button type="submit" loading={loading}>
        {submitLabel}
      </Button>
    </div>
  );
}

/* ---------- About you ---------- */

export function BasicsForm({ submitLabel = 'Save changes', secondary, onSaved }: SectionProps) {
  const { user, updateProfile } = useAuth();
  const toast = useToast();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    control,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(profileBasicsSchema),
    defaultValues: {
      name: user?.name ?? '',
      headline: user?.headline ?? '',
      bio: user?.bio ?? '',
      location: user?.location ?? '',
      // Suggest the browser's zone the first time; the member can clear or change it.
      timezone: user?.timezone || browserTimezone(),
      avatar: user?.avatar ?? '',
    },
  });
  const avatarPreview = useWatch({ control, name: 'avatar' });
  if (!user) return null;

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={handleSubmit(async (values) => {
        setFormError(null);
        try {
          await updateProfile(values);
          toast.success('Profile saved.');
          onSaved?.();
        } catch (error) {
          setFormError(
            applyServerErrors(error, setError, [
              'name',
              'headline',
              'bio',
              'location',
              'timezone',
              'avatar',
            ]),
          );
        }
      })}
    >
      {formError && <Notice>{formError}</Notice>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label="Name"
          autoComplete="name"
          error={errors.name?.message}
          {...register('name')}
        />
        <Input
          label="Location"
          optional
          placeholder="City, country"
          autoComplete="address-level2"
          error={errors.location?.message}
          {...register('location')}
        />
      </div>
      <Input
        label="Headline"
        optional
        placeholder="One line about what you do"
        maxLength={LIMITS.headlineMax}
        error={errors.headline?.message}
        {...register('headline')}
      />
      <Textarea
        label="About you"
        optional
        rows={4}
        maxLength={LIMITS.bioMax}
        hint="What you can help with, and what you are hoping to learn."
        error={errors.bio?.message}
        {...register('bio')}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label="Time zone"
          optional
          placeholder="Europe/Berlin"
          hint="Shown on your profile so partners can plan."
          error={errors.timezone?.message}
          {...register('timezone')}
        />
        <div className="flex items-start gap-3">
          <Input
            label="Picture address"
            optional
            type="url"
            inputMode="url"
            placeholder="https://…"
            hint="A link to an image. Leave empty to use your initials."
            error={errors.avatar?.message}
            wrapperClassName="flex-1"
            {...register('avatar')}
          />
          <Avatar
            user={{ id: user.id, name: user.name, avatar: avatarPreview ?? '' }}
            size="md"
            className="mt-7"
            key={avatarPreview}
          />
        </div>
      </div>
      <FormActions submitLabel={submitLabel} secondary={secondary} loading={isSubmitting} />
    </form>
  );
}

/* ---------- Skills ---------- */

function useSkillSuggestions() {
  const { data } = useQuery({
    queryKey: ['skills'],
    queryFn: async () => (await api.get<{ items: SkillOption[] }>('/skills')).items,
    staleTime: 10 * 60 * 1000,
  });
  return data ?? [];
}

function useSaveList(onSaved?: () => void) {
  const { updateProfile } = useAuth();
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (payload: Parameters<typeof updateProfile>[0]) => {
    setSaving(true);
    setError(null);
    try {
      await updateProfile(payload);
      toast.success('Skills saved.');
      onSaved?.();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };
  return { save, saving, error, setError };
}

export function TeachingForm({ submitLabel = 'Save changes', secondary, onSaved }: SectionProps) {
  const { user } = useAuth();
  const suggestions = useSkillSuggestions();
  const listId = useId();
  const [items, setItems] = useState<TeachingSkillInput[]>(
    () =>
      user?.skillsTeaching.map(({ skill, proficiency, yearsExperience, description }) => ({
        skill,
        proficiency,
        yearsExperience,
        description,
      })) ?? [],
  );
  const empty = { skill: '', proficiency: 'Intermediate', yearsExperience: '1', description: '' };
  const [draft, setDraft] = useState(empty);
  const [draftErrors, setDraftErrors] = useState<Record<string, string>>({});
  const { save, saving, error, setError } = useSaveList(onSaved);

  const add = (): TeachingSkillInput[] | null => {
    const parsed = teachingSkillSchema.safeParse(draft);
    if (!parsed.success) {
      setDraftErrors(
        Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])),
      );
      return null;
    }
    if (items.some((i) => i.skill.toLowerCase() === parsed.data.skill.toLowerCase())) {
      setDraftErrors({ skill: 'You already listed this skill.' });
      return null;
    }
    const next = [...items, parsed.data];
    setItems(next);
    setDraft(empty);
    setDraftErrors({});
    return next;
  };

  return (
    <form
      noValidate
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        // A filled-in but unsaved row is almost certainly meant to be included.
        const list = draft.skill.trim() ? add() : items;
        if (!list) return;
        if (list.length === 0) return setError('Add at least one skill you can teach.');
        void save({ skillsTeaching: list });
      }}
    >
      {error && <Notice>{error}</Notice>}
      {items.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <li
              key={item.skill}
              className="flex items-start justify-between gap-3 rounded-md border border-border p-3"
            >
              <div className="min-w-0">
                <SkillChip skill={item.skill} kind="teach" detail={item.proficiency} />
                <p className="mt-1.5 text-sm text-muted">
                  {item.yearsExperience} {item.yearsExperience === 1 ? 'year' : 'years'} of
                  experience
                  {item.description && ` · ${item.description}`}
                </p>
              </div>
              <IconButton
                label={`Remove ${item.skill}`}
                size="sm"
                onClick={() => setItems(items.filter((i) => i.skill !== item.skill))}
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </IconButton>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-md bg-surface-2 p-4 text-sm text-muted">
          Nothing here yet. Add the first skill you could teach someone.
        </p>
      )}

      {items.length < LIMITS.skillsPerList && (
        <fieldset className="flex flex-col gap-4 rounded-md border border-border p-4">
          <legend className="px-1 text-sm font-semibold">Add a skill you can teach</legend>
          <div className="grid gap-4 sm:grid-cols-3">
            <Input
              label="Skill"
              list={listId}
              placeholder="For example: Python"
              maxLength={LIMITS.skillNameMax}
              value={draft.skill}
              error={draftErrors.skill}
              onChange={(e) => setDraft({ ...draft, skill: e.target.value })}
            />
            <Select
              label="Your level"
              value={draft.proficiency}
              onChange={(e) => setDraft({ ...draft, proficiency: e.target.value })}
            >
              {PROFICIENCY_LEVELS.map((level) => (
                <option key={level}>{level}</option>
              ))}
            </Select>
            <Input
              label="Years of experience"
              type="number"
              inputMode="numeric"
              min={0}
              max={60}
              value={draft.yearsExperience}
              error={draftErrors.yearsExperience}
              onChange={(e) => setDraft({ ...draft, yearsExperience: e.target.value })}
            />
          </div>
          <Input
            label="What you would cover"
            optional
            maxLength={LIMITS.skillNoteMax}
            value={draft.description}
            error={draftErrors.description}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          />
          <datalist id={listId}>
            {suggestions.map((s) => (
              <option key={s.name} value={s.name} />
            ))}
          </datalist>
          <div>
            <Button
              variant="secondary"
              onClick={add}
              icon={<Plus className="size-4" aria-hidden="true" />}
            >
              Add skill
            </Button>
          </div>
        </fieldset>
      )}
      <FormActions submitLabel={submitLabel} secondary={secondary} loading={saving} />
    </form>
  );
}

export function LearningForm({ submitLabel = 'Save changes', secondary, onSaved }: SectionProps) {
  const { user } = useAuth();
  const suggestions = useSkillSuggestions();
  const listId = useId();
  const [items, setItems] = useState<LearningSkillInput[]>(() => user?.skillsLearning ?? []);
  const empty = { skill: '', targetProficiency: 'Intermediate', priority: 'High', notes: '' };
  const [draft, setDraft] = useState(empty);
  const [draftErrors, setDraftErrors] = useState<Record<string, string>>({});
  const { save, saving, error, setError } = useSaveList(onSaved);

  const add = (): LearningSkillInput[] | null => {
    const parsed = learningSkillSchema.safeParse(draft);
    if (!parsed.success) {
      setDraftErrors(
        Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])),
      );
      return null;
    }
    if (items.some((i) => i.skill.toLowerCase() === parsed.data.skill.toLowerCase())) {
      setDraftErrors({ skill: 'You already listed this skill.' });
      return null;
    }
    const next = [...items, parsed.data];
    setItems(next);
    setDraft(empty);
    setDraftErrors({});
    return next;
  };

  return (
    <form
      noValidate
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        const list = draft.skill.trim() ? add() : items;
        if (!list) return;
        if (list.length === 0) return setError('Add at least one skill you want to learn.');
        void save({ skillsLearning: list });
      }}
    >
      {error && <Notice>{error}</Notice>}
      {items.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <li
              key={item.skill}
              className="flex items-start justify-between gap-3 rounded-md border border-border p-3"
            >
              <div className="min-w-0">
                <SkillChip
                  skill={item.skill}
                  kind="learn"
                  detail={`aiming for ${item.targetProficiency}`}
                />
                <p className="mt-1.5 text-sm text-muted">
                  {item.priority} priority{item.notes && ` · ${item.notes}`}
                </p>
              </div>
              <IconButton
                label={`Remove ${item.skill}`}
                size="sm"
                onClick={() => setItems(items.filter((i) => i.skill !== item.skill))}
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </IconButton>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-md bg-surface-2 p-4 text-sm text-muted">
          Nothing here yet. Add something you would like to learn.
        </p>
      )}

      {items.length < LIMITS.skillsPerList && (
        <fieldset className="flex flex-col gap-4 rounded-md border border-border p-4">
          <legend className="px-1 text-sm font-semibold">Add a skill you want to learn</legend>
          <div className="grid gap-4 sm:grid-cols-3">
            <Input
              label="Skill"
              list={listId}
              placeholder="For example: Figma"
              maxLength={LIMITS.skillNameMax}
              value={draft.skill}
              error={draftErrors.skill}
              onChange={(e) => setDraft({ ...draft, skill: e.target.value })}
            />
            <Select
              label="Level you are aiming for"
              value={draft.targetProficiency}
              onChange={(e) => setDraft({ ...draft, targetProficiency: e.target.value })}
            >
              {PROFICIENCY_LEVELS.map((level) => (
                <option key={level}>{level}</option>
              ))}
            </Select>
            <Select
              label="Priority"
              value={draft.priority}
              onChange={(e) => setDraft({ ...draft, priority: e.target.value })}
            >
              {PRIORITIES.map((priority) => (
                <option key={priority}>{priority}</option>
              ))}
            </Select>
          </div>
          <Input
            label="What you want to be able to do"
            optional
            maxLength={LIMITS.skillNoteMax}
            value={draft.notes}
            error={draftErrors.notes}
            onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
          />
          <datalist id={listId}>
            {suggestions.map((s) => (
              <option key={s.name} value={s.name} />
            ))}
          </datalist>
          <div>
            <Button
              variant="secondary"
              onClick={add}
              icon={<Plus className="size-4" aria-hidden="true" />}
            >
              Add skill
            </Button>
          </div>
        </fieldset>
      )}
      <FormActions submitLabel={submitLabel} secondary={secondary} loading={saving} />
    </form>
  );
}

/* ---------- Availability and preferences ---------- */

export function AvailabilityForm({
  submitLabel = 'Save changes',
  secondary,
  onSaved,
  completeOnboarding = false,
}: SectionProps & { completeOnboarding?: boolean }) {
  const { user, updateProfile } = useAuth();
  const toast = useToast();
  const [days, setDays] = useState<Day[]>(() => user?.availability.days ?? []);
  const [slots, setSlots] = useState<TimeSlotId[]>(() => user?.availability.timeSlots ?? []);
  const [hours, setHours] = useState(() => user?.availability.hoursPerWeek ?? 4);
  const [format, setFormat] = useState<SessionFormat[]>(
    () => user?.preferences.format ?? ['Video'],
  );
  const [length, setLength] = useState(() => user?.preferences.sessionLength ?? 60);
  const [languages, setLanguages] = useState(() =>
    (user?.preferences.languages ?? ['English']).join(', '),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [languageError, setLanguageError] = useState<string | undefined>();

  return (
    <form
      noValidate
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        const languageList = [
          ...new Set(
            languages
              .split(',')
              .map((l) => l.trim())
              .filter(Boolean),
          ),
        ];
        if (languageList.length === 0) return setLanguageError('Add at least one language.');
        if (languageList.length > LIMITS.languagesMax) {
          return setLanguageError(`Add at most ${LIMITS.languagesMax} languages.`);
        }
        setLanguageError(undefined);
        setError(null);
        setSaving(true);
        updateProfile({
          availability: { days, timeSlots: slots, hoursPerWeek: hours },
          preferences: { format, sessionLength: length, languages: languageList },
          ...(completeOnboarding ? { onboardingCompleted: true as const } : {}),
        })
          .then(() => {
            toast.success(completeOnboarding ? 'Your profile is live.' : 'Preferences saved.');
            onSaved?.();
          })
          .catch((err: unknown) => setError(errorMessage(err)))
          .finally(() => setSaving(false));
      }}
    >
      {error && <Notice>{error}</Notice>}
      <ChoiceChips
        legend="Days you are usually free"
        options={DAYS.map((day) => ({ value: day, label: day }))}
        value={days}
        onChange={setDays}
      />
      <ChoiceChips
        legend="Times of day"
        options={TIME_SLOTS.map((slot) => ({ value: slot.id, label: slot.label, hint: slot.hint }))}
        value={slots}
        onChange={setSlots}
        hint="Availability is used to rank matches. You agree exact times with each partner."
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label="Hours per week you can commit"
          type="number"
          inputMode="numeric"
          min={1}
          max={40}
          value={hours}
          onChange={(e) => setHours(Math.min(40, Math.max(1, Number(e.target.value) || 1)))}
        />
        <Input
          label="Languages you can learn in"
          value={languages}
          error={languageError}
          hint="Separate with commas."
          onChange={(e) => setLanguages(e.target.value)}
        />
      </div>
      <ChoiceChips
        legend="How you like to work"
        options={SESSION_FORMATS.map((f) => ({ value: f, label: f }))}
        value={format}
        onChange={setFormat}
      />
      <ChoiceChips
        legend="Preferred session length"
        mode="single"
        options={SESSION_LENGTHS.map((n) => ({ value: n, label: `${n} minutes` }))}
        value={[length]}
        onChange={(next) => setLength(next[0] ?? 60)}
      />
      <FormActions submitLabel={submitLabel} secondary={secondary} loading={saving} />
    </form>
  );
}
