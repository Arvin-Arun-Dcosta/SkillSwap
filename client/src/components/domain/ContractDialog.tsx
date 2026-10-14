import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeftRight, CalendarPlus } from 'lucide-react';
import { useState } from 'react';
import type { ContractDTO } from '@skillswap/shared';
import {
  Avatar,
  Badge,
  Button,
  ConfirmDialog,
  Dialog,
  ErrorState,
  Progress,
  Spinner,
  useToast,
} from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDate } from '@/lib/format';
import { invalidateExchangeData } from './ExchangeDialogs';
import { ScheduleSessionDialog } from './SessionDialogs';
import { SkillChip } from './SkillChip';

export const contractStatusTone = {
  ACTIVE: 'success',
  COMPLETED: 'neutral',
  TERMINATED: 'warning',
} as const;

export const contractStatusLabel = {
  ACTIVE: 'Active',
  COMPLETED: 'Completed',
  TERMINATED: 'Ended early',
} as const;

/** The agreement behind an accepted exchange: who teaches what, progress, goals. */
export function ContractDialog({
  contractId,
  viewerId,
  onClose,
}: {
  contractId: string;
  viewerId: string;
  onClose: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [scheduling, setScheduling] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);

  const query = useQuery({
    queryKey: ['contracts', contractId],
    queryFn: async () =>
      (await api.get<{ contract: ContractDTO }>(`/contracts/${contractId}`)).contract,
  });
  const contract = query.data;

  // Goals being saved right now. A box flips the moment it is clicked and settles with the server.
  const [toggling, setToggling] = useState<ReadonlySet<string>>(new Set());
  const toggleGoal = useMutation({
    mutationFn: (goalId: string) =>
      api.post<{ contract: ContractDTO }>(`/contracts/${contractId}/goals/${goalId}/toggle`),
    onMutate: (goalId) => setToggling((current) => new Set(current).add(goalId)),
    onSuccess: ({ contract: updated }) => {
      queryClient.setQueryData(['contracts', contractId], updated);
      void queryClient.invalidateQueries({ queryKey: ['contracts'], exact: true });
      void queryClient.invalidateQueries({ queryKey: ['session'] });
    },
    onError: (error) => toast.error(errorMessage(error)),
    onSettled: (_data, _error, goalId) =>
      setToggling((current) => {
        const next = new Set(current);
        next.delete(goalId);
        return next;
      }),
  });

  const end = useMutation({
    mutationFn: () => api.post(`/contracts/${contractId}/end`),
    onSuccess: () => {
      invalidateExchangeData(queryClient);
      toast.success('Contract ended.');
      setConfirmEnd(false);
      onClose();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (scheduling && contract) {
    return (
      <ScheduleSessionDialog
        contracts={[contract]}
        viewerId={viewerId}
        onClose={() => {
          setScheduling(false);
          void query.refetch();
        }}
      />
    );
  }

  const active = contract?.status === 'ACTIVE';
  const isDone = (goal: ContractDTO['goals'][number]) => goal.completed !== toggling.has(goal.id);
  const done = contract?.goals.filter(isDone).length ?? 0;

  return (
    <>
      <Dialog
        open={!confirmEnd}
        onClose={onClose}
        title="Learning contract"
        size="lg"
        footer={
          contract && active ? (
            <>
              <Button
                variant="ghost"
                className="text-danger sm:mr-auto"
                onClick={() => setConfirmEnd(true)}
              >
                End contract
              </Button>
              <Button variant="secondary" onClick={onClose}>
                Close
              </Button>
              <Button
                onClick={() => setScheduling(true)}
                icon={<CalendarPlus className="size-4" aria-hidden="true" />}
              >
                Schedule a session
              </Button>
            </>
          ) : (
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
          )
        }
      >
        {query.isPending && (
          <div className="flex justify-center py-10">
            <Spinner label="Loading contract" />
          </div>
        )}
        {query.isError && (
          <ErrorState message={errorMessage(query.error)} onRetry={() => void query.refetch()} />
        )}
        {contract && (
          <div className="flex flex-col gap-6">
            <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
              {[
                { user: contract.userA, skill: contract.skillA },
                { user: contract.userB, skill: contract.skillB },
              ].map(({ user, skill }, index) => (
                <div key={user.id} className="contents">
                  {index === 1 && (
                    <ArrowLeftRight
                      className="mx-auto size-5 shrink-0 rotate-90 text-muted sm:rotate-0"
                      aria-hidden="true"
                    />
                  )}
                  <div className="flex min-w-0 flex-1 items-center gap-3 rounded-md bg-surface-2 p-3">
                    <Avatar user={user} size="md" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold">
                        {user.name}
                        {user.id === viewerId && (
                          <span className="font-normal text-muted"> (you)</span>
                        )}
                      </p>
                      <SkillChip skill={skill} kind="teach" detail="teaches" className="mt-1" />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold">
                  {contract.completedSessions} of {contract.totalSessions} sessions completed
                  {contract.scheduledSessions > 0 && (
                    <span className="font-normal text-muted">
                      {' '}
                      · {contract.scheduledSessions} scheduled
                    </span>
                  )}
                </p>
                <Badge tone={contractStatusTone[contract.status]}>
                  {contractStatusLabel[contract.status]}
                </Badge>
              </div>
              <Progress
                value={contract.completedSessions}
                max={contract.totalSessions}
                label="Sessions completed"
              />
              <p className="mt-2 text-sm text-muted">
                {contract.sessionDurationMinutes} minutes each
                {contract.schedule && ` · ${contract.schedule}`} · started{' '}
                {formatDate(contract.startDate)}
                {contract.endedAt && ` · ended ${formatDate(contract.endedAt)}`}
              </p>
            </div>

            <fieldset disabled={!active}>
              <legend className="mb-2 text-sm font-semibold">
                Goals{' '}
                <span className="font-normal text-muted">
                  ({done} of {contract.goals.length} done)
                </span>
              </legend>
              <ul className="flex flex-col gap-1.5">
                {contract.goals.map((goal) => (
                  <li key={goal.id}>
                    <label
                      className={cn(
                        'flex min-h-11 items-center gap-3 rounded-md border border-border px-3 py-2 text-sm',
                        active && 'cursor-pointer hover:bg-surface-2',
                      )}
                    >
                      <input
                        type="checkbox"
                        className="size-5 shrink-0 accent-(--primary)"
                        checked={isDone(goal)}
                        disabled={toggling.has(goal.id)}
                        onChange={() => toggleGoal.mutate(goal.id)}
                      />
                      <span
                        className={cn(
                          'min-w-0 break-words',
                          isDone(goal) && 'text-muted line-through',
                        )}
                      >
                        {goal.title}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              {!active && (
                <p className="mt-2 text-sm text-muted">
                  This contract is closed; goals are read-only.
                </p>
              )}
            </fieldset>
          </div>
        )}
      </Dialog>
      <ConfirmDialog
        open={confirmEnd}
        onClose={() => setConfirmEnd(false)}
        onConfirm={() => end.mutate()}
        loading={end.isPending}
        title="End this contract?"
        description="Upcoming sessions will be cancelled and the exchange will be closed. Completed sessions and reviews stay. This cannot be undone."
        confirmLabel="End contract"
        cancelLabel="Keep it"
      />
    </>
  );
}
