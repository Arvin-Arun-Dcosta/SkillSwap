import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, CalendarX2, Star, Video } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import type { ContractDTO, SessionDTO, SessionStatus } from '@skillswap/shared';
import { invalidateExchangeData } from '@/components/domain/ExchangeDialogs';
import { ReviewDialog, ScheduleSessionDialog } from '@/components/domain/SessionDialogs';
import { SkillChip } from '@/components/domain/SkillChip';
import {
  Avatar,
  Badge,
  Button,
  ButtonLink,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  SectionHeading,
  SkeletonList,
  Tabs,
  type Tone,
  tabPanelProps,
  useToast,
} from '@/components/ui';
import { useAuth } from '@/features/auth/AuthProvider';
import { api, errorMessage } from '@/lib/api';
import { formatDateTime, formatRelative } from '@/lib/format';
import { usePageTitle } from '@/lib/hooks';

const STATUS: Record<SessionStatus, { label: string; tone: Tone }> = {
  SCHEDULED: { label: 'Scheduled', tone: 'primary' },
  ACTIVE: { label: 'In progress', tone: 'success' },
  COMPLETED: { label: 'Completed', tone: 'neutral' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral' },
};

export default function SessionsPage() {
  usePageTitle('Sessions');
  const { user } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'past' ? 'past' : 'upcoming';
  const [scheduling, setScheduling] = useState(false);
  const [reviewing, setReviewing] = useState<SessionDTO | null>(null);
  const [cancelling, setCancelling] = useState<SessionDTO | null>(null);

  const sessions = useQuery({
    queryKey: ['sessions'],
    queryFn: async () => (await api.get<{ items: SessionDTO[] }>('/sessions')).items,
  });
  const contracts = useQuery({
    queryKey: ['contracts'],
    queryFn: async () => (await api.get<{ items: ContractDTO[] }>('/contracts')).items,
  });

  const cancel = useMutation({
    mutationFn: (session: SessionDTO) => api.post(`/sessions/${session.id}/cancel`),
    onSuccess: () => {
      invalidateExchangeData(queryClient);
      toast.success('Session cancelled. Your partner has been notified.');
      setCancelling(null);
    },
    onError: (error) => {
      toast.error(errorMessage(error));
      setCancelling(null);
    },
  });

  if (!user) return null;
  const all = sessions.data ?? [];
  const upcoming = all.filter((s) => s.status === 'SCHEDULED' || s.status === 'ACTIVE');
  const past = all.filter((s) => s.status === 'COMPLETED' || s.status === 'CANCELLED');
  const list = tab === 'upcoming' ? upcoming : past;
  const activeContracts = (contracts.data ?? []).filter((c) => c.status === 'ACTIVE');
  const toReview = past.filter((s) => s.viewer.canReview).length;

  return (
    <div className="container-page flex max-w-4xl flex-col gap-6 py-8 sm:py-10">
      <SectionHeading
        as="h1"
        title="Sessions"
        description="Times are shown in your own time zone."
        action={
          <Button
            onClick={() => setScheduling(true)}
            icon={<CalendarPlus className="size-4" aria-hidden="true" />}
          >
            Schedule a session
          </Button>
        }
      />
      <Tabs
        label="Session lists"
        idBase="sessions"
        value={tab}
        onChange={(id) => setParams({ tab: id }, { replace: true })}
        tabs={[
          { id: 'upcoming', label: 'Upcoming', count: upcoming.length },
          { id: 'past', label: 'Past', count: toReview },
        ]}
      />

      <div {...tabPanelProps('sessions', tab)} className="outline-none">
        {sessions.isPending && <SkeletonList className="h-36" />}
        {sessions.isError && (
          <ErrorState
            message={errorMessage(sessions.error)}
            onRetry={() => void sessions.refetch()}
          />
        )}
        {sessions.data && list.length === 0 && (
          <EmptyState
            icon={<Video className="size-6" aria-hidden="true" />}
            title={tab === 'upcoming' ? 'Nothing scheduled' : 'No past sessions yet'}
            description={
              tab === 'upcoming'
                ? activeContracts.length > 0
                  ? 'Pick a time for the next session of your contract.'
                  : 'Sessions belong to an accepted exchange. Find a partner to get started.'
                : 'Completed and cancelled sessions are kept here, with their notes.'
            }
            action={
              tab === 'upcoming' &&
              (activeContracts.length > 0 ? (
                <Button onClick={() => setScheduling(true)}>Schedule a session</Button>
              ) : (
                <ButtonLink to="/discover">Find a partner</ButtonLink>
              ))
            }
          />
        )}
        <ul className="flex flex-col gap-4">
          {list.map((session) => {
            const iTeach = session.teacher.id === user.id;
            const partner = iTeach ? session.learner : session.teacher;
            const status = STATUS[session.status];
            return (
              <li key={session.id}>
                <Card className="flex flex-col gap-4">
                  <div className="flex flex-wrap items-start gap-3">
                    <Avatar user={partner} size="md" />
                    <div className="min-w-0 flex-1">
                      <h2 className="truncate font-bold">{session.title}</h2>
                      <p className="text-sm text-muted">With {partner.name}</p>
                    </div>
                    <Badge tone={status.tone}>{status.label}</Badge>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <SkillChip
                      skill={session.skill}
                      kind={iTeach ? 'teach' : 'learn'}
                      detail={iTeach ? 'you teach' : 'you learn'}
                    />
                    <p className="text-sm">
                      <time dateTime={session.scheduledStartTime}>
                        {formatDateTime(session.scheduledStartTime)}
                      </time>
                      <span className="text-muted">
                        {' '}
                        · {session.durationMinutes} min
                        {session.status === 'SCHEDULED' &&
                          ` · ${formatRelative(session.scheduledStartTime)}`}
                      </span>
                    </p>
                  </div>
                  {session.description && (
                    <p className="text-sm text-muted">{session.description}</p>
                  )}

                  {(session.viewer.canJoin ||
                    session.viewer.canCancel ||
                    session.viewer.canReview) && (
                    <div className="flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
                      {session.viewer.canCancel && (
                        <Button
                          variant="secondary"
                          onClick={() => setCancelling(session)}
                          icon={<CalendarX2 className="size-4" aria-hidden="true" />}
                        >
                          Cancel<span className="sr-only"> {session.title}</span>
                        </Button>
                      )}
                      {session.viewer.canReview && (
                        <Button
                          onClick={() => setReviewing(session)}
                          icon={<Star className="size-4" aria-hidden="true" />}
                        >
                          Review {partner.name.split(' ')[0]}
                        </Button>
                      )}
                      {session.viewer.canJoin && (
                        <ButtonLink
                          to={`/session/${session.roomCode}`}
                          icon={<Video className="size-4" aria-hidden="true" />}
                        >
                          {session.status === 'ACTIVE' ? 'Join now' : 'Open room'}
                          <span className="sr-only"> for {session.title}</span>
                        </ButtonLink>
                      )}
                    </div>
                  )}
                  {session.status === 'COMPLETED' && session.viewer.hasReviewed && (
                    <p className="border-t border-border pt-3 text-sm text-muted">
                      You reviewed this session.
                    </p>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      </div>

      {scheduling && (
        <ScheduleSessionDialog
          contracts={activeContracts}
          viewerId={user.id}
          onClose={() => setScheduling(false)}
        />
      )}
      {reviewing && (
        <ReviewDialog
          session={reviewing}
          partner={reviewing.teacher.id === user.id ? reviewing.learner : reviewing.teacher}
          onClose={() => setReviewing(null)}
        />
      )}
      {cancelling && (
        <ConfirmDialog
          open
          onClose={() => setCancelling(null)}
          onConfirm={() => cancel.mutate(cancelling)}
          loading={cancel.isPending}
          title="Cancel this session?"
          description={`"${cancelling.title}" will be cancelled and your partner notified. You can schedule a new one any time.`}
          confirmLabel="Cancel session"
          cancelLabel="Keep it"
        />
      )}
    </div>
  );
}
