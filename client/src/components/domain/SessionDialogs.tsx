import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import {
  type ContractDTO,
  LIMITS,
  REPORT_REASONS,
  type SessionDTO,
  type UserSummary,
  reportCreateSchema,
  sessionReviewSchema,
} from '@skillswap/shared';
import {
  Button,
  Dialog,
  Input,
  Notice,
  Select,
  StarRatingInput,
  Textarea,
  useToast,
} from '@/components/ui';
import { ApiError, api, errorMessage } from '@/lib/api';
import { applyServerErrors } from '@/lib/forms';
import { browserTimezone, toLocalInputValue } from '@/lib/format';
import { invalidateExchangeData } from './ExchangeDialogs';

/** Books the next session of a contract. The teacher follows from the chosen skill. */
export function ScheduleSessionDialog({
  contracts,
  initialContractId,
  viewerId,
  onClose,
}: {
  /** Active contracts the member can schedule for. */
  contracts: ContractDTO[];
  initialContractId?: string;
  viewerId: string;
  onClose: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [contractId, setContractId] = useState(initialContractId ?? contracts[0]?.id ?? '');
  const contract = contracts.find((c) => c.id === contractId);
  const [skill, setSkill] = useState(contract?.skillA ?? '');
  // Defaults are computed once, when the dialog opens.
  const [earliest] = useState(() => toLocalInputValue(new Date()));
  const [when, setWhen] = useState(() => {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    tomorrow.setMinutes(0, 0, 0);
    return toLocalInputValue(tomorrow);
  });
  const [title, setTitle] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => {
      const start = new Date(when);
      if (Number.isNaN(start.getTime())) {
        return Promise.reject(new Error('Pick a date and time.'));
      }
      return api.post<{ session: SessionDTO }>('/sessions', {
        contractId,
        skill,
        title,
        scheduledStartTime: start.toISOString(),
      });
    },
    onSuccess: () => {
      invalidateExchangeData(queryClient);
      toast.success('Session scheduled. Your partner has been notified.');
      onClose();
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        setErrors(error.fields ?? {});
        setFormError(error.fields ? null : error.message);
      } else {
        setFormError(error instanceof Error ? error.message : errorMessage(error));
      }
    },
  });

  if (!contract) {
    return (
      <Dialog
        open
        onClose={onClose}
        title="No active contract"
        size="sm"
        description="Sessions belong to an exchange. Once a proposal is accepted you can schedule sessions here."
        footer={
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        }
      />
    );
  }

  const teacherOf = (skillName: string) =>
    skillName === contract.skillA ? contract.userA : contract.userB;
  const describe = (skillName: string) => {
    const teacher = teacherOf(skillName);
    return `${skillName} (${teacher.id === viewerId ? 'you teach' : `${teacher.name.split(' ')[0]} teaches`})`;
  };
  const remaining =
    contract.totalSessions - contract.completedSessions - contract.scheduledSessions;
  const timezone = browserTimezone();

  return (
    <Dialog
      open
      onClose={onClose}
      title="Schedule a session"
      description={`${contract.sessionDurationMinutes} minutes, as agreed in your contract.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={create.isPending}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="schedule-form"
            loading={create.isPending}
            disabled={remaining <= 0}
          >
            Schedule
          </Button>
        </>
      }
    >
      <form
        id="schedule-form"
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          setErrors({});
          setFormError(null);
          create.mutate();
        }}
      >
        {formError && <Notice>{formError}</Notice>}
        {remaining <= 0 && (
          <Notice tone="warning">
            All {contract.totalSessions} sessions of this contract are already scheduled or done.
          </Notice>
        )}
        {contracts.length > 1 && (
          <Select
            label="Contract"
            value={contractId}
            onChange={(event) => {
              const next = contracts.find((c) => c.id === event.target.value);
              setContractId(event.target.value);
              setSkill(next?.skillA ?? '');
            }}
          >
            {contracts.map((c) => {
              const partner = c.userA.id === viewerId ? c.userB : c.userA;
              return (
                <option key={c.id} value={c.id}>
                  {c.skillA} / {c.skillB} with {partner.name}
                </option>
              );
            })}
          </Select>
        )}
        <Select
          label="What this session covers"
          value={skill}
          error={errors.skill}
          onChange={(event) => setSkill(event.target.value)}
        >
          <option value={contract.skillA}>{describe(contract.skillA)}</option>
          <option value={contract.skillB}>{describe(contract.skillB)}</option>
        </Select>
        <Input
          label="Date and time"
          type="datetime-local"
          value={when}
          min={earliest}
          error={errors.scheduledStartTime}
          hint={timezone ? `In your time zone (${timezone}).` : undefined}
          onChange={(event) => setWhen(event.target.value)}
        />
        <Input
          label="Title"
          optional
          placeholder={`${skill} session`}
          value={title}
          maxLength={LIMITS.titleMax}
          error={errors.title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </form>
    </Dialog>
  );
}

/** One review per member per completed session. */
export function ReviewDialog({
  session,
  partner,
  onClose,
  onDone,
}: {
  session: SessionDTO;
  partner: UserSummary;
  onClose: () => void;
  onDone?: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [rating, setRating] = useState(0);
  const [feedback, setFeedback] = useState('');
  const [ratingError, setRatingError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const partnerTaught = session.teacher.id === partner.id;

  const submit = useMutation({
    mutationFn: (values: unknown) => api.post(`/sessions/${session.id}/review`, values),
    onSuccess: () => {
      invalidateExchangeData(queryClient);
      toast.success('Review saved. Thank you.');
      onDone?.();
      onClose();
    },
    onError: (error) => setFormError(errorMessage(error)),
  });

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Review ${partner.name}`}
      description={
        partnerTaught
          ? `How was ${partner.name.split(' ')[0]} as a teacher of ${session.skill}? Your review is public.`
          : `How was ${partner.name.split(' ')[0]} as a learner in this ${session.skill} session? Your review is public.`
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submit.isPending}>
            Not now
          </Button>
          <Button type="submit" form="review-form" loading={submit.isPending}>
            Submit review
          </Button>
        </>
      }
    >
      <form
        id="review-form"
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          const parsed = sessionReviewSchema.safeParse({ rating, feedback });
          if (!parsed.success) {
            setRatingError('Choose a rating from 1 to 5 stars.');
            return;
          }
          setRatingError(undefined);
          setFormError(null);
          submit.mutate(parsed.data);
        }}
      >
        {formError && <Notice>{formError}</Notice>}
        <StarRatingInput
          legend="Your rating"
          value={rating}
          onChange={setRating}
          error={ratingError}
        />
        <Textarea
          label="What stood out"
          optional
          rows={4}
          maxLength={LIMITS.feedbackMax}
          value={feedback}
          onChange={(event) => setFeedback(event.target.value)}
          hint="Specific feedback helps other members decide who to learn with."
        />
      </form>
    </Dialog>
  );
}

/** Flags a member for the moderation team. */
export function ReportDialog({ target, onClose }: { target: UserSummary; onClose: () => void }) {
  const toast = useToast();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(reportCreateSchema),
    defaultValues: { reportedUserId: target.id, reason: '' as never, details: '' },
  });

  const report = useMutation({
    mutationFn: (values: unknown) => api.post('/users/report', values),
    onSuccess: () => {
      toast.success('Report sent. Our moderation team will review it.');
      onClose();
    },
    onError: (error) => setFormError(applyServerErrors(error, setError, ['reason', 'details'])),
  });

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Report ${target.name}`}
      description="Reports are private. Only the moderation team sees them."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={report.isPending}>
            Cancel
          </Button>
          <Button type="submit" form="report-form" variant="danger" loading={report.isPending}>
            Send report
          </Button>
        </>
      }
    >
      <form
        id="report-form"
        noValidate
        className="flex flex-col gap-4"
        onSubmit={handleSubmit((values) => {
          setFormError(null);
          report.mutate(values);
        })}
      >
        {formError && <Notice>{formError}</Notice>}
        <Select label="Reason" error={errors.reason?.message} {...register('reason')}>
          <option value="">Choose a reason</option>
          {REPORT_REASONS.map((reason) => (
            <option key={reason}>{reason}</option>
          ))}
        </Select>
        <Textarea
          label="What happened"
          rows={4}
          maxLength={LIMITS.reportDetailsMax}
          error={errors.details?.message}
          hint="Include when it happened and anything that helps us verify it."
          {...register('details')}
        />
      </form>
    </Dialog>
  );
}
