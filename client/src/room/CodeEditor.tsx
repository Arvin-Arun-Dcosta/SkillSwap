import { indentWithTab } from '@codemirror/commands';
import { HighlightStyle, type LanguageSupport, syntaxHighlighting } from '@codemirror/language';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { basicSetup } from 'codemirror';
import { Play, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next';
import * as Y from 'yjs';
import { COLLAB, EDITOR_LANGUAGES, type EditorLanguage } from '@skillswap/shared';
import { Button, Select } from '@/components/ui';
import { cn } from '@/lib/cn';
import { type SandboxLine, runJavaScript } from './runSandbox';

/** Language packages are loaded on demand, so opening a room does not download all of them. */
const LANGUAGE_LOADERS: Record<EditorLanguage, () => Promise<LanguageSupport>> = {
  javascript: () => import('@codemirror/lang-javascript').then((m) => m.javascript()),
  typescript: () =>
    import('@codemirror/lang-javascript').then((m) => m.javascript({ typescript: true })),
  python: () => import('@codemirror/lang-python').then((m) => m.python()),
  java: () => import('@codemirror/lang-java').then((m) => m.java()),
  cpp: () => import('@codemirror/lang-cpp').then((m) => m.cpp()),
  html: () => import('@codemirror/lang-html').then((m) => m.html()),
};

// Colours come from CSS variables, so one theme serves both light and dark mode.
const theme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: '14px',
    backgroundColor: 'var(--surface)',
    color: 'var(--text)',
  },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.6' },
  '.cm-gutters': {
    backgroundColor: 'var(--surface)',
    color: 'var(--text-muted)',
    border: 'none',
    borderRight: '1px solid var(--border)',
  },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'var(--surface-2)' },
  '.cm-cursor': { borderLeftColor: 'var(--text)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
    backgroundColor: 'color-mix(in srgb, var(--primary) 30%, transparent)',
  },
  '&.cm-focused': { outline: '2px solid var(--focus)', outlineOffset: '-2px' },
});

const highlight = HighlightStyle.define([
  { tag: [tags.keyword, tags.modifier, tags.controlKeyword], color: 'var(--syntax-keyword)' },
  { tag: [tags.string, tags.special(tags.string), tags.regexp], color: 'var(--syntax-string)' },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], color: 'var(--syntax-number)' },
  { tag: [tags.comment, tags.meta], color: 'var(--syntax-comment)', fontStyle: 'italic' },
  {
    tag: [tags.function(tags.variableName), tags.typeName, tags.className, tags.tagName],
    color: 'var(--syntax-name)',
  },
  { tag: tags.heading, fontWeight: 'bold' },
]);

const isLanguage = (value: unknown): value is EditorLanguage =>
  EDITOR_LANGUAGES.some((language) => language.id === value);

const LINE_TONE: Record<SandboxLine['level'], string> = {
  log: '',
  result: 'text-muted',
  warn: 'text-warning',
  error: 'text-danger',
  system: 'text-muted italic',
};

/** Shared code editor. Both participants edit the same text at once without overwriting each other. */
export function CodeEditor({ doc }: { doc: Y.Doc }) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [languageCompartment] = useState(() => new Compartment());
  const meta = doc.getMap<unknown>(COLLAB.meta);

  const readLanguage = (): EditorLanguage => {
    const value = meta.get(COLLAB.languageKey);
    return isLanguage(value) ? value : 'javascript';
  };
  const [language, setLanguage] = useState<EditorLanguage>(readLanguage);
  const [output, setOutput] = useState<SandboxLine[] | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!host.current) return;
    const text = doc.getText(COLLAB.code);
    const undoManager = new Y.UndoManager(text);
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: text.toJSON(),
        extensions: [
          keymap.of([...yUndoManagerKeymap, indentWithTab]),
          basicSetup,
          theme,
          syntaxHighlighting(highlight),
          languageCompartment.of([]),
          yCollab(text, null, { undoManager }),
          EditorView.contentAttributes.of({ 'aria-label': 'Shared code editor' }),
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      undoManager.destroy();
      viewRef.current = null;
    };
  }, [doc, languageCompartment]);

  // The language is part of the shared document: when one side changes it, both editors follow.
  useEffect(() => {
    const sync = () => setLanguage(readLanguage());
    meta.observe(sync);
    return () => meta.unobserve(sync);
    // `readLanguage` only reads `meta`, which is stable for a given document.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta]);

  useEffect(() => {
    let cancelled = false;
    void LANGUAGE_LOADERS[language]().then((support) => {
      if (!cancelled)
        viewRef.current?.dispatch({ effects: languageCompartment.reconfigure(support) });
    });
    return () => {
      cancelled = true;
    };
  }, [language, languageCompartment]);

  const runnable = EDITOR_LANGUAGES.find((l) => l.id === language)?.runnable ?? false;
  const languageLabel = EDITOR_LANGUAGES.find((l) => l.id === language)?.label ?? language;

  const run = async () => {
    setRunning(true);
    setOutput(null);
    const result = await runJavaScript(doc.getText(COLLAB.code).toJSON());
    const lines = [...result.lines];
    if (result.timedOut) {
      lines.push({ level: 'system', text: 'Stopped after 5 seconds. Is there an endless loop?' });
    } else if (lines.length === 0) {
      lines.push({
        level: 'system',
        text: 'Finished with no output. Use console.log() to print values.',
      });
    }
    setOutput(lines);
    setRunning(false);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border p-3">
        <Select
          label="Language"
          value={language}
          onChange={(event) => meta.set(COLLAB.languageKey, event.target.value)}
          wrapperClassName="w-44"
          className="h-9"
        >
          {EDITOR_LANGUAGES.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </Select>
        <div className="flex items-center gap-3">
          {!runnable && (
            <p className="max-w-56 text-right text-sm text-muted">
              {languageLabel} is highlighted but cannot be run here. Only JavaScript runs in the
              browser.
            </p>
          )}
          <Button
            size="sm"
            onClick={() => void run()}
            loading={running}
            disabled={!runnable}
            icon={<Play className="size-4" aria-hidden="true" />}
          >
            Run
          </Button>
        </div>
      </div>

      <div ref={host} className="min-h-48 flex-1 overflow-hidden" />

      {output && (
        <section
          aria-label="Program output"
          className="max-h-56 shrink-0 overflow-y-auto border-t border-border bg-surface-2"
        >
          <div className="sticky top-0 flex items-center justify-between bg-surface-2 px-3 py-1.5">
            <h3 className="text-sm font-semibold">Output</h3>
            <button
              type="button"
              onClick={() => setOutput(null)}
              className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-sm text-muted hover:text-text"
            >
              <Trash2 className="size-4" aria-hidden="true" />
              Clear
            </button>
          </div>
          <pre
            className="px-3 pb-3 font-mono text-sm whitespace-pre-wrap break-words"
            aria-live="polite"
          >
            {output.map((line, index) => (
              <span key={index} className={cn('block', LINE_TONE[line.level])}>
                {line.level === 'result' ? `← ${line.text}` : line.text}
              </span>
            ))}
          </pre>
        </section>
      )}
    </div>
  );
}
