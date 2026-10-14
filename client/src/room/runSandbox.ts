export interface SandboxLine {
  level: 'log' | 'warn' | 'error' | 'result' | 'system';
  text: string;
}

export interface SandboxResult {
  lines: SandboxLine[];
  timedOut: boolean;
}

const TIMEOUT_MS = 5000;
const MAX_LINES = 200;
const MAX_LINE_LENGTH = 2000;

const LEVELS = new Set(['log', 'warn', 'error', 'result']);

/** Keeps one output line within bounds; the code producing it is untrusted. */
export function sanitiseLine(data: unknown): SandboxLine | null {
  if (typeof data !== 'object' || data === null) return null;
  const { level, text } = data as { level?: unknown; text?: unknown };
  if (typeof level !== 'string' || !LEVELS.has(level) || typeof text !== 'string') return null;
  return {
    level: level as SandboxLine['level'],
    text: text.length > MAX_LINE_LENGTH ? `${text.slice(0, MAX_LINE_LENGTH)}…` : text,
  };
}

/**
 * Runs JavaScript in an isolated, opaque-origin iframe and collects what it prints.
 *
 * The code comes from a shared editor, so it may have been typed by the other participant. It
 * must never run in this page's origin: there it could act as the signed-in member.
 */
export function runJavaScript(code: string, timeoutMs = TIMEOUT_MS): Promise<SandboxResult> {
  return new Promise((resolve) => {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('sandbox', 'allow-scripts');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.tabIndex = -1;
    iframe.style.display = 'none';
    iframe.src = '/sandbox/runner.html';

    const lines: SandboxLine[] = [];
    let finished = false;

    const finish = (timedOut: boolean) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      // Removing the frame tears down its worker, even one stuck in an infinite loop.
      iframe.remove();
      resolve({ lines, timedOut });
    };

    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframe.contentWindow) return;
      const data = event.data as { type?: unknown } | null;
      if (data?.type === 'ready') {
        iframe.contentWindow?.postMessage({ type: 'run', code }, '*');
      } else if (data?.type === 'log') {
        if (lines.length < MAX_LINES) {
          const line = sanitiseLine(data);
          if (line) lines.push(line);
        } else if (lines.length === MAX_LINES) {
          lines.push({ level: 'system', text: `Output stopped after ${MAX_LINES} lines.` });
        }
      } else if (data?.type === 'done') {
        finish(false);
      }
    };

    const timer = setTimeout(() => finish(true), timeoutMs);
    window.addEventListener('message', onMessage);
    document.body.appendChild(iframe);
  });
}
