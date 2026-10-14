import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Code2,
  FileText,
  MessageSquare,
  Mic,
  MicOff,
  MonitorUp,
  Paperclip,
  PenLine,
  Video,
  VideoOff,
} from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import type { SessionDTO, SessionDetail, UserSummary } from '@skillswap/shared';
import { invalidateExchangeData } from '@/components/domain/ExchangeDialogs';
import { ReviewDialog } from '@/components/domain/SessionDialogs';
import { LogoMark } from '@/components/layout/Logo';
import {
  Avatar,
  Badge,
  Button,
  ButtonLink,
  Card,
  ConfirmDialog,
  ErrorState,
  IconButton,
  Notice,
  PageLoading,
  Spinner,
  Tabs,
  tabPanelProps,
  useToast,
} from '@/components/ui';
import { useAuth, useConfig } from '@/features/auth/AuthProvider';
import { useSocket } from '@/features/realtime/SocketProvider';
import { ApiError, api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDateTime } from '@/lib/format';
import { usePageTitle } from '@/lib/hooks';
import NotFoundPage from '@/pages/NotFoundPage';
import { CodeEditor } from './CodeEditor';
import { Whiteboard } from './Whiteboard';
import { ChatPanel, FilesPanel, NotesPanel } from './panels';
import { useRoom } from './useRoom';
import { type CallStatus, useWebRTC } from './useWebRTC';

type ToolId = 'code' | 'whiteboard' | 'notes' | 'files' | 'chat';

const CALL_STATUS: Record<CallStatus, string> = {
  idle: 'Waiting for your partner',
  connecting: 'Connecting the call…',
  connected: 'Connected',
  reconnecting: 'Reconnecting…',
  failed: 'Call could not connect',
};

function StreamVideo({
  stream,
  muted,
  label,
  className,
}: {
  stream: MediaStream | null;
  muted?: boolean;
  label: string;
  className?: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream;
  }, [stream]);
  return (
    <video ref={ref} autoPlay playsInline muted={muted} aria-label={label} className={className} />
  );
}

function RoomFrame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-14 items-center gap-3 border-b border-border px-4">
        <LogoMark className="size-8" />
        <p className="truncate font-bold">{title}</p>
      </header>
      <main id="main" className="flex flex-1 items-center justify-center p-4">
        {children}
      </main>
    </div>
  );
}

/** Shown instead of the workspace when the session is already over. */
function ClosedSession({ session, viewer }: { session: SessionDetail; viewer: UserSummary }) {
  const [reviewing, setReviewing] = useState(false);
  const queryClient = useQueryClient();
  const partner = session.teacher.id === viewer.id ? session.learner : session.teacher;
  const completed = session.status === 'COMPLETED';
  return (
    <RoomFrame title={session.title}>
      <Card className="flex w-full max-w-2xl flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-bold">
            {completed ? 'This session is complete' : 'This session was cancelled'}
          </h1>
          <Badge tone={completed ? 'success' : 'neutral'}>
            {completed ? 'Completed' : 'Cancelled'}
          </Badge>
        </div>
        <p className="text-muted">
          {session.skill} with {partner.name} · {formatDateTime(session.scheduledStartTime)}
        </p>
        {session.notes.trim() && (
          <section aria-labelledby="closed-notes">
            <h2 id="closed-notes" className="text-sm font-semibold">
              Notes from the session
            </h2>
            <pre className="mt-2 max-h-72 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-surface-2 p-3 font-sans text-sm">
              {session.notes}
            </pre>
          </section>
        )}
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <ButtonLink to="/sessions?tab=past" variant="secondary">
            Back to sessions
          </ButtonLink>
          {session.viewer.canReview && (
            <Button onClick={() => setReviewing(true)}>Review {partner.name.split(' ')[0]}</Button>
          )}
        </div>
      </Card>
      {reviewing && (
        <ReviewDialog
          session={session}
          partner={partner}
          onClose={() => setReviewing(false)}
          onDone={() =>
            void queryClient.invalidateQueries({ queryKey: ['session', session.roomCode] })
          }
        />
      )}
    </RoomFrame>
  );
}

function Workspace({ session, viewer }: { session: SessionDetail; viewer: UserSummary }) {
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const config = useConfig();
  const { socket, connected } = useSocket();
  const room = useRoom(socket, session.roomCode);
  const [tool, setTool] = useState<ToolId>('code');
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [review, setReview] = useState<SessionDTO | null>(null);
  const [seenMessages, setSeenMessages] = useState(0);

  const partner = session.teacher.id === viewer.id ? session.learner : session.teacher;
  const partnerFirst = partner.name.split(' ')[0] ?? partner.name;
  const joined = room.phase.name === 'joined';
  const { sendMediaState } = room;
  const onMediaState = useCallback(
    (state: { audio: boolean; video: boolean; screen: boolean }) => sendMediaState(state),
    [sendMediaState],
  );

  const call = useWebRTC({
    socket,
    joined,
    polite: room.phase.name === 'joined' ? room.phase.polite : false,
    peerEpoch: room.peerEpoch,
    peerPresent: room.peer !== null,
    iceServers: config?.iceServers ?? [],
    onMediaState,
  });

  // Files are listed by the REST endpoint; the socket only says "something changed".
  useEffect(() => {
    if (room.filesVersion > 0) {
      void queryClient.invalidateQueries({ queryKey: ['session', session.roomCode] });
    }
  }, [room.filesVersion, queryClient, session.roomCode]);

  const unread = tool === 'chat' ? 0 : Math.max(0, room.messages.length - seenMessages);

  const end = useMutation({
    mutationFn: () => api.post<{ session: SessionDTO }>(`/sessions/${session.id}/end`),
    onSuccess: ({ session: ended }) => {
      setConfirmEnd(false);
      invalidateExchangeData(queryClient);
      if (ended.status === 'COMPLETED') setReview(ended);
      else {
        toast.info('Session closed. It did not count because your partner never joined.');
        void navigate('/sessions');
      }
    },
    onError: (error) => {
      setConfirmEnd(false);
      toast.error(errorMessage(error));
    },
  });

  const leave = () => void navigate('/sessions');
  const afterReview = () => {
    void queryClient.invalidateQueries({ queryKey: ['session', session.roomCode] });
    void navigate('/sessions?tab=past');
  };

  if (review) {
    return (
      <RoomFrame title={session.title}>
        <Card className="w-full max-w-md text-center">
          <h1 className="text-xl font-bold">Session complete</h1>
          <p className="mt-2 text-muted">
            Your notes, code and whiteboard are saved with the session.
          </p>
        </Card>
        <ReviewDialog
          session={review}
          partner={partner}
          onClose={afterReview}
          onDone={afterReview}
        />
      </RoomFrame>
    );
  }
  if (room.phase.name === 'error') {
    return (
      <RoomFrame title={session.title}>
        <div className="w-full max-w-md">
          <ErrorState
            title="Could not open the room"
            message={room.phase.message}
            onRetry={room.rejoin}
          />
        </div>
      </RoomFrame>
    );
  }
  if (room.phase.name === 'replaced') {
    return (
      <RoomFrame title={session.title}>
        <Card className="flex w-full max-w-md flex-col gap-4 text-center">
          <h1 className="text-xl font-bold">This session is open in another tab</h1>
          <p className="text-muted">
            Only one tab can be in the room at a time, to keep the call stable.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
            <Button variant="secondary" onClick={leave}>
              Leave
            </Button>
            <Button onClick={room.rejoin}>Use this tab instead</Button>
          </div>
        </Card>
      </RoomFrame>
    );
  }
  if (room.phase.name === 'ended') {
    const byMe = room.phase.byUserId === viewer.id;
    const completed = room.phase.status === 'COMPLETED';
    return (
      <RoomFrame title={session.title}>
        <Card className="flex w-full max-w-md flex-col gap-4 text-center">
          <h1 className="text-xl font-bold">{completed ? 'Session complete' : 'Session closed'}</h1>
          <p className="text-muted">
            {byMe ? 'You' : partner.name} ended the session.{' '}
            {completed
              ? 'Your notes, code and whiteboard are saved.'
              : 'It did not count as completed.'}
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
            <ButtonLink to="/sessions" variant="secondary">
              Back to sessions
            </ButtonLink>
            {completed && (
              <Button onClick={() => setReview({ ...session, status: 'COMPLETED' })}>
                Review {partnerFirst}
              </Button>
            )}
          </div>
        </Card>
      </RoomFrame>
    );
  }

  const peerMedia = room.peer?.media;
  const remoteHasVideo =
    call.remoteStream !== null &&
    call.remoteStream.getVideoTracks().length > 0 &&
    (peerMedia ? peerMedia.video || peerMedia.screen : true);
  const statusText = !connected
    ? 'You are offline. Reconnecting…'
    : !joined
      ? 'Joining the room…'
      : room.peer
        ? CALL_STATUS[call.status]
        : `Waiting for ${partnerFirst} to join`;
  const statusTone =
    !connected || call.status === 'failed'
      ? 'danger'
      : call.status === 'connected' && room.peer
        ? 'success'
        : 'warning';

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-2 sm:px-4">
        <IconButton label="Leave the room" onClick={leave}>
          <ArrowLeft className="size-5" aria-hidden="true" />
        </IconButton>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-bold">{session.title}</h1>
          <p className="truncate text-sm text-muted">
            {session.skill} · with {partner.name}
          </p>
        </div>
        <div className="hidden sm:block">
          <Badge tone={statusTone}>
            <span role="status">{statusText}</span>
          </Badge>
        </div>
        <Button variant="danger" size="sm" onClick={() => setConfirmEnd(true)} disabled={!joined}>
          End session
        </Button>
      </header>

      <main id="main" className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* Call */}
        <section
          aria-label="Video call"
          className="flex shrink-0 flex-col gap-2 border-b border-border bg-surface-2 p-2 sm:p-3 lg:w-96 lg:border-b-0 lg:border-r xl:w-[28rem]"
        >
          <p className="text-center text-sm font-medium sm:hidden" role="status">
            {statusText}
          </p>
          <div className="relative mx-auto aspect-video max-h-[28dvh] w-full overflow-hidden rounded-lg bg-surface lg:max-h-none">
            <StreamVideo
              stream={call.remoteStream}
              label={`${partner.name}'s video`}
              className={cn('size-full bg-black object-contain', !remoteHasVideo && 'hidden')}
            />
            {!remoteHasVideo && (
              <div className="flex size-full flex-col items-center justify-center gap-2 p-3 text-center">
                <Avatar user={partner} size="lg" />
                <p className="font-semibold">{partner.name}</p>
                <p className="text-sm text-muted">
                  {!room.peer
                    ? 'Not in the room yet'
                    : call.status === 'connected'
                      ? 'Camera is off'
                      : CALL_STATUS[call.status]}
                </p>
                {!joined && <Spinner label="Joining the room" />}
              </div>
            )}
            {room.peer && peerMedia && !peerMedia.audio && call.status === 'connected' && (
              <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-sm bg-surface/90 px-2 py-1 text-xs font-semibold">
                <MicOff className="size-3.5" aria-hidden="true" />
                {partnerFirst} is muted
              </span>
            )}
            {/* Your own preview, picture-in-picture. */}
            <div className="absolute bottom-2 right-2 aspect-video w-24 overflow-hidden rounded-md border border-border bg-surface shadow-overlay sm:w-32">
              {call.previewStream && (call.media.video || call.media.screen) ? (
                <StreamVideo
                  stream={call.previewStream}
                  muted
                  label="Your camera preview"
                  className={cn('size-full object-cover', !call.media.screen && '-scale-x-100')}
                />
              ) : (
                <div className="flex size-full items-center justify-center text-xs text-muted">
                  <VideoOff className="size-4" aria-hidden="true" />
                  <span className="sr-only">Your camera is off</span>
                </div>
              )}
            </div>
          </div>

          <div className="flex justify-center gap-2" role="toolbar" aria-label="Call controls">
            <IconButton
              label={call.media.audio ? 'Mute microphone' : 'Unmute microphone'}
              pressed={!call.media.audio}
              variant={call.media.audio ? 'secondary' : 'danger'}
              disabled={!call.localStream?.getAudioTracks().length}
              onClick={call.toggleAudio}
            >
              {call.media.audio ? (
                <Mic className="size-5" aria-hidden="true" />
              ) : (
                <MicOff className="size-5" aria-hidden="true" />
              )}
            </IconButton>
            <IconButton
              label={call.media.video ? 'Turn camera off' : 'Turn camera on'}
              pressed={!call.media.video}
              variant={call.media.video || call.media.screen ? 'secondary' : 'danger'}
              disabled={!call.localStream?.getVideoTracks().length || call.media.screen}
              onClick={call.toggleVideo}
            >
              {call.media.video || call.media.screen ? (
                <Video className="size-5" aria-hidden="true" />
              ) : (
                <VideoOff className="size-5" aria-hidden="true" />
              )}
            </IconButton>
            {call.canShareScreen && (
              <IconButton
                label={call.media.screen ? 'Stop sharing your screen' : 'Share your screen'}
                pressed={call.media.screen}
                variant={call.media.screen ? 'primary' : 'secondary'}
                onClick={() => void call.toggleScreen()}
              >
                <MonitorUp className="size-5" aria-hidden="true" />
              </IconButton>
            )}
          </div>
          {call.mediaError && (
            <div className="hidden lg:block">
              <Notice tone="warning">{call.mediaError}</Notice>
            </div>
          )}
          {session.contract && session.contract.goals.length > 0 && (
            <div className="mt-2 hidden min-h-0 overflow-y-auto rounded-lg bg-surface p-4 lg:block">
              <h2 className="text-sm font-semibold">Goals for this exchange</h2>
              <ul className="mt-2 flex flex-col gap-1.5 text-sm">
                {session.contract.goals.map((goal) => (
                  <li
                    key={goal.id}
                    className={cn('flex gap-2', goal.completed && 'text-muted line-through')}
                  >
                    <span aria-hidden="true">{goal.completed ? '✓' : '○'}</span>
                    <span className="min-w-0 break-words">
                      {goal.title}
                      {goal.completed && <span className="sr-only"> (done)</span>}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-sm text-muted">
                Session {session.contract.completedSessions + 1} of {session.contract.totalSessions}
                . Tick goals off from the contract on the Exchanges page.
              </p>
            </div>
          )}
        </section>

        {/* Tools */}
        <section
          aria-label="Shared tools"
          className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface"
        >
          <Tabs
            label="Shared tools"
            idBase="room"
            size="sm"
            value={tool}
            onChange={(next) => {
              // Entering or leaving chat marks everything received so far as read.
              if (tool === 'chat' || next === 'chat') setSeenMessages(room.messages.length);
              setTool(next);
            }}
            className="shrink-0 px-2"
            tabs={[
              { id: 'code', label: 'Code', icon: <Code2 className="size-4" aria-hidden="true" /> },
              {
                id: 'whiteboard',
                label: 'Whiteboard',
                icon: <PenLine className="size-4" aria-hidden="true" />,
              },
              {
                id: 'notes',
                label: 'Notes',
                icon: <FileText className="size-4" aria-hidden="true" />,
              },
              {
                id: 'files',
                label: 'Files',
                icon: <Paperclip className="size-4" aria-hidden="true" />,
                count: session.files.length,
              },
              {
                id: 'chat',
                label: 'Chat',
                icon: <MessageSquare className="size-4" aria-hidden="true" />,
                count: unread,
              },
            ]}
          />
          <div
            {...tabPanelProps('room', tool)}
            tabIndex={-1}
            className="min-h-0 flex-1 outline-none"
          >
            {!joined ? (
              <div className="flex h-full items-center justify-center">
                <Spinner label="Joining the room" />
              </div>
            ) : (
              <>
                {tool === 'code' && <CodeEditor doc={room.doc} />}
                {tool === 'whiteboard' && <Whiteboard doc={room.doc} userId={viewer.id} />}
                {tool === 'notes' && <NotesPanel doc={room.doc} />}
                {tool === 'files' && (
                  <FilesPanel
                    session={session}
                    viewerId={viewer.id}
                    maxUploadMb={config?.maxUploadMb ?? 10}
                  />
                )}
                {tool === 'chat' && (
                  <ChatPanel
                    messages={room.messages}
                    viewerId={viewer.id}
                    peerName={partnerFirst}
                    peerTyping={room.peerTyping}
                    onSend={room.sendMessage}
                    onTyping={room.setTyping}
                  />
                )}
              </>
            )}
          </div>
        </section>
      </main>

      <ConfirmDialog
        open={confirmEnd}
        onClose={() => setConfirmEnd(false)}
        onConfirm={() => end.mutate()}
        loading={end.isPending}
        title="End this session for both of you?"
        description={
          room.peer
            ? 'The room closes for both participants and the session is marked complete. Notes, code and the whiteboard are saved. To step out without ending, use the back arrow instead.'
            : `${partnerFirst} has not joined. Ending now closes the session without counting it. To step out and come back later, use the back arrow instead.`
        }
        confirmLabel="End session"
        cancelLabel="Keep going"
      />
    </div>
  );
}

export default function RoomPage() {
  const { roomCode = '' } = useParams();
  const { user } = useAuth();
  const query = useQuery({
    queryKey: ['session', roomCode.toUpperCase()],
    queryFn: async () =>
      (await api.get<{ session: SessionDetail }>(`/sessions/room/${encodeURIComponent(roomCode)}`))
        .session,
    retry: (count, error) => !(error instanceof ApiError && error.status === 404) && count < 2,
  });
  usePageTitle(query.data ? query.data.title : 'Session');

  if (!user) return null;
  if (query.isPending) return <PageLoading label="Opening the room" />;
  if (query.error instanceof ApiError && query.error.status === 404) {
    return (
      <div className="flex min-h-dvh flex-col">
        <main id="main">
          <NotFoundPage />
        </main>
      </div>
    );
  }
  if (query.isError) {
    return (
      <RoomFrame title="Session">
        <div className="w-full max-w-md">
          <ErrorState message={errorMessage(query.error)} onRetry={() => void query.refetch()} />
        </div>
      </RoomFrame>
    );
  }

  const session = query.data;
  if (session.status === 'COMPLETED' || session.status === 'CANCELLED') {
    return <ClosedSession session={session} viewer={user} />;
  }
  return <Workspace key={session.id} session={session} viewer={user} />;
}
