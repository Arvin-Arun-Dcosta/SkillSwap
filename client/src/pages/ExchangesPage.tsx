import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeftRight, CalendarDays, Clock, FileText, Handshake } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { ContractDTO, ExchangeAction, ExchangeDTO, ExchangeStatus } from '@skillswap/shared';
import {
  ContractDialog,
  contractStatusLabel,
  contractStatusTone,
} from '@/components/domain/ContractDialog';
import { CounterOfferDialog, invalidateExchangeData } from '@/components/domain/ExchangeDialogs';
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
  Progress,
  SectionHeading,
  SkeletonList,
  Tabs,
  type Tone,
  tabPanelProps,
  useToast,
} from '@/components/ui';
import { useAuth } from '@/features/auth/AuthProvider';
import { api, errorMessage } from '@/lib/api';
import { formatRelative, plural } from '@/lib/format';
import { usePageTitle } from '@/lib/hooks';

const TABS = ['received', 'sent', 'contracts'] as const;
type TabId = (typeof TABS)[number];

const STATUS: Record<ExchangeStatus, { label: string; tone: Tone }> = {
  PENDING: { label: 'Awaiting reply', tone: 'warning' },
  COUNTERED: { label: 'Counter-offer', tone: 'warning' },
  ACCEPTED: { label: 'Accepted', tone: 'success' },
  REJECTED: { label: 'Declined', tone: 'neutral' },
  CANCELLED: { label: 'Withdrawn', tone: 'neutral' },
  COMPLETED: { label: 'Completed', tone: 'neutral' },
};

const CONFIRM: Record<
  Exclude<ExchangeAction, 'accept'>,
  { title: string; description: string; confirmLabel: string; done: string }
> = {
  decline: {
    title: 'Decline this offer?',
    description: 'The other member will be told. You can still propose a new exchange later.',
    confirmLabel: 'Decline',
    done: 'Offer declined.',
  },
  cancel: {
    title: 'Withdraw your offer?',
    description: 'The other member will be told the offer is no longer available.',
    confirmLabel: 'Withdraw',
    done: 'Offer withdrawn.',
  },
};

function ExchangeCard({
  exchange,
  viewerId,
  onAct,
  onCounter,
  onContract,
  busy,
}: {
  exchange: ExchangeDTO;
  viewerId: string;
  onAct: (exchange: ExchangeDTO, action: ExchangeAction) => void;
  onCounter: (exchange: ExchangeDTO) => void;
  onContract: (contractId: string) => void;
  busy: boolean;
}) {
  const other = exchange.viewer.isSender ? exchange.receiver : exchange.sender;
  const youTeach = exchange.viewer.isSender ? exchange.teachingSkill : exchange.learningSkill;
  const youLearn = exchange.viewer.isSender ? exchange.learningSkill : exchange.teachingSkill;
  const status = STATUS[exchange.status];
  const open = exchange.status === 'PENDING' || exchange.status === 'COUNTERED';
  const terms = exchange.currentTerms;
  const counterByMe = exchange.counter?.byUserId === viewerId;

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start gap-3">
        <Avatar user={other} size="md" />
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-bold">
            <Link to={`/profile/${other.username}`} className="hover:underline">
              {other.name}
            </Link>
          </h3>
          <p className="text-sm text-muted">
            {exchange.viewer.isSender ? 'You proposed' : 'Proposed to you'}{' '}
            {formatRelative(exchange.createdAt)}
          </p>
        </div>
        <Badge tone={status.tone}>
          {open && exchange.awaitingUserId === viewerId ? 'Your reply needed' : status.label}
        </Badge>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <SkillChip skill={youTeach} kind="teach" detail="you teach" />
        <ArrowLeftRight className="size-4 text-muted" aria-hidden="true" />
        <SkillChip skill={youLearn} kind="learn" detail="you learn" />
      </div>

      <blockquote className="border-l-2 border-border-strong pl-3 text-sm">
        <p className="whitespace-pre-line break-words">{exchange.message}</p>
      </blockquote>

      {exchange.counter && (
        <div className="rounded-md bg-warning-bg p-3 text-sm">
          <p className="font-bold text-warning">
            {counterByMe ? 'Your counter-offer' : `${other.name.split(' ')[0]}'s counter-offer`}
          </p>
          <p className="mt-1 whitespace-pre-line break-words">{exchange.counter.message}</p>
        </div>
      )}

      <ul className="flex flex-wrap gap-x-5 gap-y-1.5 text-sm">
        <li className="flex items-center gap-1.5">
          <CalendarDays className="size-4 text-muted" aria-hidden="true" />
          {plural(terms.sessions, 'session')}
        </li>
        <li className="flex items-center gap-1.5">
          <Clock className="size-4 text-muted" aria-hidden="true" />
          {terms.durationMinutes} minutes each
        </li>
        {terms.schedule && <li className="text-muted">{terms.schedule}</li>}
      </ul>

      {terms.goals.length > 0 && (
        <div>
          <p className="text-sm font-semibold">Goals</p>
          <ul className="mt-1 list-disc pl-5 text-sm text-muted">
            {terms.goals.map((goal) => (
              <li key={goal} className="break-words">
                {goal}
              </li>
            ))}
          </ul>
        </div>
      )}

      {(open || exchange.contractId) && (
        <div className="flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:flex-wrap sm:justify-end">
          {exchange.contractId && (
            <Button
              variant="secondary"
              onClick={() => onContract(exchange.contractId ?? '')}
              icon={<FileText className="size-4" aria-hidden="true" />}
            >
              View contract
            </Button>
          )}
          {exchange.viewer.canCancel && (
            <Button variant="secondary" disabled={busy} onClick={() => onAct(exchange, 'cancel')}>
              Withdraw offer
            </Button>
          )}
          {exchange.viewer.canDecline && (
            <Button variant="secondary" disabled={busy} onClick={() => onAct(exchange, 'decline')}>
              Decline
            </Button>
          )}
          {exchange.viewer.canCounter && (
            <Button variant="secondary" disabled={busy} onClick={() => onCounter(exchange)}>
              Suggest changes
            </Button>
          )}
          {exchange.viewer.canAccept && (
            <Button loading={busy} onClick={() => onAct(exchange, 'accept')}>
              Accept{exchange.counter ? ' counter-offer' : ''}
            </Button>
          )}
          {open && !exchange.viewer.canAccept && !exchange.viewer.canCancel && (
            <p className="text-sm text-muted">Waiting for {other.name.split(' ')[0]}.</p>
          )}
        </div>
      )}
    </Card>
  );
}

export default function ExchangesPage() {
  usePageTitle('Exchanges');
  const { user } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const requested = params.get('tab');
  const tab: TabId = (TABS as readonly string[]).includes(requested ?? '')
    ? (requested as TabId)
    : 'received';

  const [counterFor, setCounterFor] = useState<ExchangeDTO | null>(null);
  const [contractId, setContractId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<{
    exchange: ExchangeDTO;
    action: 'decline' | 'cancel';
  } | null>(null);

  const exchanges = useQuery({
    queryKey: ['exchanges'],
    queryFn: async () => (await api.get<{ items: ExchangeDTO[] }>('/exchanges')).items,
  });
  const contracts = useQuery({
    queryKey: ['contracts'],
    queryFn: async () => (await api.get<{ items: ContractDTO[] }>('/contracts')).items,
  });

  const act = useMutation({
    mutationFn: ({ exchange, action }: { exchange: ExchangeDTO; action: ExchangeAction }) =>
      api.post<{ exchange: ExchangeDTO }>(`/exchanges/${exchange.id}/action`, { action }),
    onSuccess: ({ exchange }, { action }) => {
      invalidateExchangeData(queryClient);
      setConfirming(null);
      if (action === 'accept') {
        toast.success('Accepted. Your contract is ready: schedule your first session.');
        if (exchange.contractId) setContractId(exchange.contractId);
      } else {
        toast.success(CONFIRM[action].done);
      }
    },
    onError: (error) => {
      setConfirming(null);
      toast.error(errorMessage(error));
      invalidateExchangeData(queryClient);
    },
  });

  if (!user) return null;
  const all = exchanges.data ?? [];
  const received = all.filter((e) => !e.viewer.isSender);
  const sent = all.filter((e) => e.viewer.isSender);
  const needReply = all.filter((e) => e.viewer.canAccept).length;
  const list = tab === 'received' ? received : sent;
  const onAct = (exchange: ExchangeDTO, action: ExchangeAction) => {
    if (action === 'accept') act.mutate({ exchange, action });
    else setConfirming({ exchange, action });
  };

  return (
    <div className="container-page flex max-w-4xl flex-col gap-6 py-8 sm:py-10">
      <SectionHeading
        as="h1"
        title="Exchanges"
        description="Proposals you have sent and received, and the contracts that came out of them."
        action={<ButtonLink to="/discover">Find a partner</ButtonLink>}
      />
      <Tabs
        label="Exchange lists"
        idBase="exchanges"
        value={tab}
        onChange={(id) => setParams({ tab: id }, { replace: true })}
        tabs={[
          {
            id: 'received',
            label: 'Received',
            count: received.filter((e) => e.viewer.canAccept).length,
          },
          { id: 'sent', label: 'Sent', count: sent.filter((e) => e.viewer.canAccept).length },
          { id: 'contracts', label: 'Contracts' },
        ]}
      />
      <p className="sr-only" role="status">
        {needReply > 0 ? `${plural(needReply, 'exchange')} waiting for your reply` : ''}
      </p>

      <div {...tabPanelProps('exchanges', tab)} className="outline-none">
        {tab !== 'contracts' && (
          <>
            {exchanges.isPending && <SkeletonList className="h-56" />}
            {exchanges.isError && (
              <ErrorState
                message={errorMessage(exchanges.error)}
                onRetry={() => void exchanges.refetch()}
              />
            )}
            {exchanges.data && list.length === 0 && (
              <EmptyState
                icon={<Handshake className="size-6" aria-hidden="true" />}
                title={
                  tab === 'received' ? 'No proposals yet' : 'You have not proposed an exchange yet'
                }
                description={
                  tab === 'received'
                    ? 'When someone proposes an exchange with you, it appears here.'
                    : 'Find a member whose skills fit yours and send them a proposal.'
                }
                action={<ButtonLink to="/discover">Browse members</ButtonLink>}
              />
            )}
            <ul className="flex flex-col gap-4">
              {list.map((exchange) => (
                <li key={exchange.id}>
                  <ExchangeCard
                    exchange={exchange}
                    viewerId={user.id}
                    onAct={onAct}
                    onCounter={setCounterFor}
                    onContract={setContractId}
                    busy={act.isPending && act.variables?.exchange.id === exchange.id}
                  />
                </li>
              ))}
            </ul>
          </>
        )}

        {tab === 'contracts' && (
          <>
            {contracts.isPending && <SkeletonList className="h-36" />}
            {contracts.isError && (
              <ErrorState
                message={errorMessage(contracts.error)}
                onRetry={() => void contracts.refetch()}
              />
            )}
            {contracts.data?.length === 0 && (
              <EmptyState
                icon={<FileText className="size-6" aria-hidden="true" />}
                title="No contracts yet"
                description="A contract is created when an exchange is accepted. It tracks your sessions and goals."
              />
            )}
            <ul className="flex flex-col gap-4">
              {contracts.data?.map((contract) => {
                const iAmA = contract.userA.id === user.id;
                const partner = iAmA ? contract.userB : contract.userA;
                return (
                  <li key={contract.id}>
                    <Card className="flex flex-col gap-4">
                      <div className="flex flex-wrap items-start gap-3">
                        <Avatar user={partner} size="md" />
                        <div className="min-w-0 flex-1">
                          <h3 className="truncate font-bold">With {partner.name}</h3>
                          <div className="mt-1 flex flex-wrap gap-1.5">
                            <SkillChip
                              skill={iAmA ? contract.skillA : contract.skillB}
                              kind="teach"
                              detail="you teach"
                            />
                            <SkillChip
                              skill={iAmA ? contract.skillB : contract.skillA}
                              kind="learn"
                              detail="you learn"
                            />
                          </div>
                        </div>
                        <Badge tone={contractStatusTone[contract.status]}>
                          {contractStatusLabel[contract.status]}
                        </Badge>
                      </div>
                      <div>
                        <p className="mb-1.5 text-sm">
                          {contract.completedSessions} of{' '}
                          {plural(contract.totalSessions, 'session')} completed
                        </p>
                        <Progress
                          value={contract.completedSessions}
                          max={contract.totalSessions}
                          label={`Sessions completed with ${partner.name}`}
                        />
                      </div>
                      <div className="flex justify-end border-t border-border pt-4">
                        <Button variant="secondary" onClick={() => setContractId(contract.id)}>
                          Open contract<span className="sr-only"> with {partner.name}</span>
                        </Button>
                      </div>
                    </Card>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>

      {counterFor && (
        <CounterOfferDialog exchange={counterFor} onClose={() => setCounterFor(null)} />
      )}
      {contractId && (
        <ContractDialog
          contractId={contractId}
          viewerId={user.id}
          onClose={() => setContractId(null)}
        />
      )}
      {confirming && (
        <ConfirmDialog
          open
          onClose={() => setConfirming(null)}
          onConfirm={() => act.mutate(confirming)}
          loading={act.isPending}
          title={CONFIRM[confirming.action].title}
          description={CONFIRM[confirming.action].description}
          confirmLabel={CONFIRM[confirming.action].confirmLabel}
          cancelLabel="Keep it"
        />
      )}
    </div>
  );
}
