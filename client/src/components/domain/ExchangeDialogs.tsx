import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router';
import {
  type ExchangeDTO,
  LIMITS,
  type PublicUser,
  SESSION_LENGTHS,
  exchangeCounterSchema,
  exchangeCreateSchema,
} from '@skillswap/shared';
import {
  Button,
  Dialog,
  IconButton,
  Input,
  Notice,
  Select,
  Textarea,
  useToast,
} from '@/components/ui';
import { useAuth } from '@/features/auth/AuthProvider';
import { api } from '@/lib/api';
import { applyServerErrors } from '@/lib/forms';

const SESSION_COUNTS = [1, 2, 3, 4, 6, 8, 10, 12];

export function invalidateExchangeData(queryClient: ReturnType<typeof useQueryClient>) {
  for (const key of ['exchanges', 'contracts', 'dashboard', 'sessions', 'profile']) {
    void queryClient.invalidateQueries({ queryKey: [key] });
  }
}

/** Proposes a swap: one skill each way, a plan and a note. */
export function ProposeExchangeDialog({
  target,
  onClose,
}: {
  target: PublicUser;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const mine = user?.skillsTeaching.map((s) => s.skill) ?? [];
  const theirs = target.skillsTeaching.map((s) => s.skill);
  // Start from the pairing that makes the exchange two-way, when there is one.
  const theyWant = target.skillsLearning.map((s) => s.skill.toLowerCase());
  const iWant = user?.skillsLearning.map((s) => s.skill.toLowerCase()) ?? [];
  const firstName = target.name.split(' ')[0] ?? target.name;

  const [goals, setGoals] = useState<string[]>([]);
  const [goalDraft, setGoalDraft] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(exchangeCreateSchema),
    defaultValues: {
      receiverId: target.id,
      teachingSkill: mine.find((s) => theyWant.includes(s.toLowerCase())) ?? mine[0] ?? '',
      learningSkill: theirs.find((s) => iWant.includes(s.toLowerCase())) ?? theirs[0] ?? '',
      message: '',
      sessions: 4,
      durationMinutes: user?.preferences.sessionLength ?? 60,
      goals: [] as string[],
    },
  });

  const create = useMutation({
    mutationFn: (values: unknown) => api.post<{ exchange: ExchangeDTO }>('/exchanges', values),
    onSuccess: () => {
      invalidateExchangeData(queryClient);
      toast.success(`Proposal sent to ${firstName}.`);
      onClose();
    },
    onError: (error) =>
      setFormError(
        applyServerErrors(error, setError, [
          'teachingSkill',
          'learningSkill',
          'message',
          'sessions',
          'durationMinutes',
        ]),
      ),
  });

  const addGoal = () => {
    const text = goalDraft.trim().slice(0, LIMITS.goalMax);
    if (!text || goals.length >= LIMITS.goalsMax) return;
    setGoals([...goals, text]);
    setGoalDraft('');
  };

  if (mine.length === 0 || theirs.length === 0) {
    return (
      <Dialog
        open
        onClose={onClose}
        title="Not ready to swap yet"
        size="sm"
        footer={
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        }
      >
        <p className="text-sm">
          {mine.length === 0 ? (
            <>
              An exchange needs a skill from each side. Add at least one skill you can teach in{' '}
              <Link to="/settings" className="font-semibold text-primary underline">
                your settings
              </Link>
              .
            </>
          ) : (
            `${target.name} has not listed any skills to teach yet.`
          )}
        </p>
      </Dialog>
    );
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Propose an exchange with ${firstName}`}
      description="Pick one skill each way and suggest a plan. They can accept, decline or counter."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={create.isPending}>
            Cancel
          </Button>
          <Button type="submit" form="propose-form" loading={create.isPending}>
            Send proposal
          </Button>
        </>
      }
    >
      <form
        id="propose-form"
        noValidate
        className="flex flex-col gap-4"
        onSubmit={handleSubmit((values) => {
          setFormError(null);
          create.mutate({ ...values, goals });
        })}
      >
        {formError && <Notice>{formError}</Notice>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="You teach"
            error={errors.teachingSkill?.message}
            {...register('teachingSkill')}
          >
            {mine.map((skill) => (
              <option key={skill}>{skill}</option>
            ))}
          </Select>
          <Select
            label={`${firstName} teaches`}
            error={errors.learningSkill?.message}
            {...register('learningSkill')}
          >
            {theirs.map((skill) => (
              <option key={skill}>{skill}</option>
            ))}
          </Select>
          <Select
            label="Number of sessions"
            error={errors.sessions?.message}
            {...register('sessions')}
          >
            {SESSION_COUNTS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
          <Select
            label="Length of each session"
            error={errors.durationMinutes?.message}
            {...register('durationMinutes')}
          >
            {SESSION_LENGTHS.map((n) => (
              <option key={n} value={n}>
                {n} minutes
              </option>
            ))}
          </Select>
        </div>

        <Textarea
          label="Your note"
          hint="Say what you hope to learn and how you like to work."
          rows={3}
          maxLength={LIMITS.messageMax}
          error={errors.message?.message}
          {...register('message')}
        />

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1.5 text-sm font-semibold">
            Goals <span className="font-normal text-muted">(optional)</span>
          </legend>
          {goals.length > 0 && (
            <ul className="flex flex-col gap-1.5">
              {goals.map((goal, index) => (
                <li
                  key={`${goal}-${index}`}
                  className="flex items-center justify-between gap-2 rounded-md bg-surface-2 py-1 pl-3 pr-1 text-sm"
                >
                  <span className="min-w-0 break-words">{goal}</span>
                  <IconButton
                    label={`Remove goal: ${goal}`}
                    size="sm"
                    onClick={() => setGoals(goals.filter((_, i) => i !== index))}
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </IconButton>
                </li>
              ))}
            </ul>
          )}
          {goals.length < LIMITS.goalsMax && (
            <div className="flex items-end gap-2">
              <Input
                label="Add a goal"
                hideLabel
                placeholder="For example: build a small REST service"
                value={goalDraft}
                maxLength={LIMITS.goalMax}
                onChange={(event) => setGoalDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    addGoal();
                  }
                }}
                wrapperClassName="flex-1"
              />
              <Button
                variant="secondary"
                onClick={addGoal}
                icon={<Plus className="size-4" aria-hidden="true" />}
              >
                Add
              </Button>
            </div>
          )}
        </fieldset>
      </form>
    </Dialog>
  );
}

/** Suggests different terms for an open exchange. */
export function CounterOfferDialog({
  exchange,
  onClose,
}: {
  exchange: ExchangeDTO;
  onClose: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(exchangeCounterSchema),
    defaultValues: {
      sessions: exchange.currentTerms.sessions,
      durationMinutes: exchange.currentTerms.durationMinutes,
      schedule: exchange.currentTerms.schedule,
      message: '',
    },
  });

  const counter = useMutation({
    mutationFn: (values: unknown) =>
      api.post<{ exchange: ExchangeDTO }>(`/exchanges/${exchange.id}/counter`, values),
    onSuccess: () => {
      invalidateExchangeData(queryClient);
      toast.success('Counter-offer sent.');
      onClose();
    },
    onError: (error) =>
      setFormError(
        applyServerErrors(error, setError, ['sessions', 'durationMinutes', 'schedule', 'message']),
      ),
  });

  return (
    <Dialog
      open
      onClose={onClose}
      title="Suggest different terms"
      description="Your counter-offer replaces the current terms. The other member then decides."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={counter.isPending}>
            Cancel
          </Button>
          <Button type="submit" form="counter-form" loading={counter.isPending}>
            Send counter-offer
          </Button>
        </>
      }
    >
      <form
        id="counter-form"
        noValidate
        className="flex flex-col gap-4"
        onSubmit={handleSubmit((values) => {
          setFormError(null);
          counter.mutate(values);
        })}
      >
        {formError && <Notice>{formError}</Notice>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Number of sessions"
            type="number"
            inputMode="numeric"
            min={LIMITS.sessionsMin}
            max={LIMITS.sessionsMax}
            error={errors.sessions?.message}
            {...register('sessions')}
          />
          <Select
            label="Length of each session"
            error={errors.durationMinutes?.message}
            {...register('durationMinutes')}
          >
            {SESSION_LENGTHS.map((n) => (
              <option key={n} value={n}>
                {n} minutes
              </option>
            ))}
          </Select>
        </div>
        <Input
          label="When works for you"
          optional
          placeholder="For example: weekend mornings"
          maxLength={LIMITS.scheduleMax}
          error={errors.schedule?.message}
          {...register('schedule')}
        />
        <Textarea
          label="Why the change"
          rows={3}
          maxLength={LIMITS.messageMax}
          error={errors.message?.message}
          {...register('message')}
        />
      </form>
    </Dialog>
  );
}
