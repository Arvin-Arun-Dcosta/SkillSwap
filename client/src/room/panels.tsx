import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Download, FileText, Paperclip, Send, Trash2, Upload } from 'lucide-react';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import {
  ALLOWED_UPLOAD_EXTENSIONS,
  COLLAB,
  type ChatMessageDTO,
  LIMITS,
  type SessionDetail,
} from '@skillswap/shared';
import {
  Avatar,
  Button,
  EmptyState,
  IconButton,
  Notice,
  buttonClass,
  useToast,
} from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatBytes, formatTime } from '@/lib/format';
import { REMOTE } from './useRoom';
import { applyTextChange, transformPosition } from './textSync';

/* ---------- Notes ---------- */

/** Shared notes: a plain text box bound to the shared document, saved automatically. */
export function NotesPanel({ doc }: { doc: Y.Doc }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const text = doc.getText(COLLAB.notes);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.value = text.toJSON();
    const onChange = (event: Y.YTextEvent) => {
      // Our own typing is already in the box; only the partner's edits need applying.
      if (event.transaction.origin !== REMOTE) return;
      const start = transformPosition(el.selectionStart, event.delta);
      const end = transformPosition(el.selectionEnd, event.delta);
      el.value = text.toJSON();
      // Keep the caret where the member was typing instead of jumping to the end.
      if (document.activeElement === el) el.setSelectionRange(start, end);
    };
    text.observe(onChange);
    return () => text.unobserve(onChange);
  }, [text]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-3">
      <label htmlFor="session-notes" className="text-sm font-semibold">
        Session notes
      </label>
      <textarea
        id="session-notes"
        ref={ref}
        defaultValue=""
        onInput={(event) => applyTextChange(text, event.currentTarget.value)}
        maxLength={50_000}
        placeholder="Agenda, key ideas, things to practise before next time…"
        aria-describedby="session-notes-hint"
        className="min-h-48 flex-1 resize-none rounded-md border border-border-strong bg-surface p-3 text-base leading-relaxed focus:border-primary"
      />
      <p id="session-notes-hint" className="text-sm text-muted">
        Both of you can type here at once. Notes are saved automatically and stay with the session.
      </p>
    </div>
  );
}

/* ---------- Files ---------- */

export function FilesPanel({
  session,
  viewerId,
  maxUploadMb,
}: {
  session: SessionDetail;
  viewerId: string;
  maxUploadMb: number;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['session', session.roomCode] });

  const upload = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return api.upload(`/sessions/${session.id}/files`, form);
    },
    onSuccess: () => {
      setError(null);
      toast.success('File shared.');
      void refresh();
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const remove = useMutation({
    mutationFn: (fileId: string) => api.delete(`/sessions/${session.id}/files/${fileId}`),
    onSuccess: () => void refresh(),
    onError: (err) => toast.error(errorMessage(err)),
  });

  const choose = (file: File | undefined) => {
    if (!file) return;
    const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
    // Checked here for a fast, clear message; the server enforces the same rules.
    if (!(ALLOWED_UPLOAD_EXTENSIONS as readonly string[]).includes(extension)) {
      return setError(
        `.${extension || 'that'} files cannot be shared. Allowed: ${ALLOWED_UPLOAD_EXTENSIONS.join(', ')}.`,
      );
    }
    if (file.size > maxUploadMb * 1024 * 1024) {
      return setError(`That file is larger than the ${maxUploadMb} MB limit.`);
    }
    upload.mutate(file);
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Shared files</h3>
          <p className="text-sm text-muted">
            Only the two of you can download these. Up to {maxUploadMb} MB each.
          </p>
        </div>
        <input
          ref={input}
          type="file"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          accept={ALLOWED_UPLOAD_EXTENSIONS.map((ext) => `.${ext}`).join(',')}
          onChange={(event) => {
            choose(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
        <Button
          size="sm"
          loading={upload.isPending}
          onClick={() => input.current?.click()}
          icon={<Upload className="size-4" aria-hidden="true" />}
        >
          Share a file
        </Button>
      </div>
      {error && <Notice>{error}</Notice>}
      {session.files.length === 0 ? (
        <EmptyState
          icon={<Paperclip className="size-6" aria-hidden="true" />}
          title="No files yet"
          description="Share slides, exercises or code. Documents, images, code and zip files are accepted."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {session.files.map((file) => (
            <li
              key={file.id}
              className="flex items-center gap-3 rounded-md border border-border p-3"
            >
              <FileText className="size-5 shrink-0 text-muted" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{file.name}</p>
                <p className="text-sm text-muted">
                  {formatBytes(file.size)} ·{' '}
                  {file.uploadedByUserId === viewerId ? 'shared by you' : 'shared by your partner'}
                </p>
              </div>
              <a
                href={`/api/sessions/${session.id}/files/${file.id}`}
                download={file.name}
                className={buttonClass('secondary', 'sm', 'size-9 px-0')}
                aria-label={`Download ${file.name}`}
                title="Download"
              >
                <Download className="size-4" aria-hidden="true" />
              </a>
              {file.uploadedByUserId === viewerId && (
                <IconButton
                  label={`Remove ${file.name}`}
                  size="sm"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(file.id)}
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </IconButton>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ---------- Chat ---------- */

const TYPING_IDLE_MS = 2500;

export function ChatPanel({
  messages,
  viewerId,
  peerName,
  peerTyping,
  onSend,
  onTyping,
}: {
  messages: ChatMessageDTO[];
  viewerId: string;
  peerName: string;
  peerTyping: boolean;
  onSend: (text: string) => Promise<string | null>;
  onTyping: (typing: boolean) => void;
}) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typing = useRef(false);

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, peerTyping]);

  const stopTyping = () => {
    if (typingTimer.current) clearTimeout(typingTimer.current);
    if (typing.current) {
      typing.current = false;
      onTyping(false);
    }
  };
  // Stop the indicator when the panel goes away, so it never sticks on the other side.
  useEffect(() => stopTyping, []); // eslint-disable-line react-hooks/exhaustive-deps

  const onChange = (value: string) => {
    setDraft(value);
    if (!typing.current && value.trim()) {
      typing.current = true;
      onTyping(true);
    }
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(stopTyping, TYPING_IDLE_MS);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    stopTyping();
    const problem = await onSend(text);
    setSending(false);
    setError(problem);
    // Keep the text if it was not sent, so nothing typed is lost.
    if (!problem) setDraft('');
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        role="log"
        aria-label="Chat messages"
        aria-live="polite"
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3"
      >
        {messages.length === 0 && (
          <p className="m-auto max-w-xs text-center text-sm text-muted">
            No messages yet. Chat is handy for links, snippets and quick questions.
          </p>
        )}
        {messages.map((message) => {
          const mine = message.sender.id === viewerId;
          return (
            <div
              key={message.id}
              className={cn(
                'flex max-w-[85%] gap-2',
                mine ? 'ml-auto flex-row-reverse' : 'mr-auto',
              )}
            >
              {!mine && <Avatar user={message.sender} size="sm" />}
              <div className={cn('min-w-0', mine && 'text-right')}>
                <p className="text-xs text-muted">
                  {mine ? 'You' : message.sender.name} ·{' '}
                  <time dateTime={message.createdAt}>{formatTime(message.createdAt)}</time>
                </p>
                <p
                  className={cn(
                    'mt-0.5 inline-block whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-left text-sm',
                    mine ? 'bg-primary text-on-primary' : 'bg-surface-2',
                  )}
                >
                  {message.text}
                </p>
              </div>
            </div>
          );
        })}
        <div ref={end} />
      </div>
      <p className="h-6 px-3 text-sm text-muted" aria-live="polite">
        {peerTyping ? `${peerName} is typing…` : ''}
      </p>
      {error && (
        <div className="px-3 pb-2">
          <Notice>{error}</Notice>
        </div>
      )}
      <form
        onSubmit={(event) => void submit(event)}
        className="flex items-end gap-2 border-t border-border p-3"
      >
        <label htmlFor="chat-input" className="sr-only">
          Message
        </label>
        <input
          id="chat-input"
          value={draft}
          maxLength={LIMITS.chatMax}
          autoComplete="off"
          placeholder="Write a message"
          onChange={(event) => onChange(event.target.value)}
          className="h-11 min-w-0 flex-1 rounded-md border border-border-strong bg-surface px-3 text-base focus:border-primary"
        />
        <IconButton
          label="Send message"
          type="submit"
          variant="primary"
          disabled={!draft.trim() || sending}
        >
          <Send className="size-5" aria-hidden="true" />
        </IconButton>
      </form>
    </div>
  );
}
