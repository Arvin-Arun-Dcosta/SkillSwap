import { Eraser, Pencil, Trash2, Undo2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { COLLAB } from '@skillswap/shared';
import { Button, ConfirmDialog, IconButton } from '@/components/ui';
import { cn } from '@/lib/cn';
import { useTheme } from '@/lib/theme';

/** The board has a fixed logical size; pointer positions are scaled into it at any display size. */
const WIDTH = 1600;
const HEIGHT = 1000;
const MAX_STROKES = 2000;
const MAX_POINTS_PER_STROKE = 4000;

/**
 * Strokes store a colour *name*, resolved against the viewer's theme when drawn. Ink drawn in
 * dark mode therefore stays visible for a partner in light mode.
 */
const INKS = [
  { id: 'ink', label: 'Ink', variable: '--text' },
  { id: 'teal', label: 'Teal', variable: '--chart-1' },
  { id: 'amber', label: 'Amber', variable: '--chart-2' },
  { id: 'red', label: 'Red', variable: '--danger' },
] as const;
type InkId = (typeof INKS)[number]['id'];
const SIZES = [
  { id: 4, label: 'Fine' },
  { id: 10, label: 'Medium' },
  { id: 22, label: 'Thick' },
] as const;

type Stroke = Y.Map<unknown>;

function resolveInk(id: unknown): string {
  const ink = INKS.find((i) => i.id === id) ?? INKS[0];
  return getComputedStyle(document.documentElement).getPropertyValue(ink.variable).trim() || '#000';
}

/** Draws every stroke. Everything read from the document is validated: the other side wrote it. */
function paint(canvas: HTMLCanvasElement, strokes: Y.Array<Stroke>): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, WIDTH, HEIGHT);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  strokes.forEach((stroke) => {
    if (!(stroke instanceof Y.Map)) return;
    const points = stroke.get('points');
    if (!(points instanceof Y.Array) || points.length < 2) return;
    const coords = points.toArray() as unknown[];
    const size = Number(stroke.get('size'));
    ctx.globalCompositeOperation =
      stroke.get('tool') === 'eraser' ? 'destination-out' : 'source-over';
    ctx.strokeStyle = resolveInk(stroke.get('ink'));
    ctx.lineWidth = Number.isFinite(size) ? Math.min(60, Math.max(1, size)) : 4;
    ctx.beginPath();
    for (let i = 0; i + 1 < coords.length; i += 2) {
      const x = Number(coords[i]);
      const y = Number(coords[i + 1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (i === 0) {
        ctx.moveTo(x, y);
        // A single tap should still leave a dot.
        if (coords.length === 2) ctx.lineTo(x + 0.01, y);
      } else ctx.lineTo(x, y);
    }
    ctx.stroke();
  });
  ctx.globalCompositeOperation = 'source-over';
}

/** Shared drawing surface. Works with mouse, pen and touch; strokes appear live for both sides. */
export function Whiteboard({ doc, userId }: { doc: Y.Doc; userId: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokes = doc.getArray<Stroke>(COLLAB.strokes);
  const [tool, setTool] = useState<'pen' | 'eraser'>('pen');
  const [ink, setInk] = useState<InkId>('ink');
  const [size, setSize] = useState<number>(4);
  const [count, setCount] = useState(strokes.length);
  const [confirmClear, setConfirmClear] = useState(false);
  const [theme] = useTheme();
  const drawing = useRef<{ points: Y.Array<number>; pending: number[]; pointerId: number } | null>(
    null,
  );
  const frame = useRef(0);

  const schedulePaint = useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      if (canvasRef.current) paint(canvasRef.current, strokes);
    });
  }, [strokes]);

  useEffect(() => {
    const onChange = () => {
      setCount(strokes.length);
      schedulePaint();
    };
    strokes.observeDeep(onChange);
    schedulePaint();
    return () => {
      strokes.unobserveDeep(onChange);
      cancelAnimationFrame(frame.current);
    };
  }, [strokes, schedulePaint]);

  // Ink colours depend on the theme, so repaint when it changes.
  useEffect(schedulePaint, [theme, schedulePaint]);

  const toBoard = (event: React.PointerEvent<HTMLCanvasElement>): [number, number] => {
    const rect = event.currentTarget.getBoundingClientRect();
    return [
      Math.round(((event.clientX - rect.left) / rect.width) * WIDTH),
      Math.round(((event.clientY - rect.top) / rect.height) * HEIGHT),
    ];
  };

  const flush = () => {
    const current = drawing.current;
    if (!current || current.pending.length === 0) return;
    if (current.points.length < MAX_POINTS_PER_STROKE) current.points.push(current.pending);
    current.pending = [];
  };

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0 || strokes.length >= MAX_STROKES) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const stroke = new Y.Map<unknown>();
    const points = new Y.Array<number>();
    doc.transact(() => {
      stroke.set('id', crypto.randomUUID());
      stroke.set('by', userId);
      stroke.set('tool', tool);
      stroke.set('ink', ink);
      stroke.set('size', tool === 'eraser' ? size * 4 : size);
      stroke.set('points', points);
      points.push(toBoard(event));
      strokes.push([stroke]);
    });
    drawing.current = { points, pending: [], pointerId: event.pointerId };
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const current = drawing.current;
    if (!current || current.pointerId !== event.pointerId) return;
    current.pending.push(...toBoard(event));
    // Points are sent in small batches rather than one message per pixel.
    if (current.pending.length >= 8) flush();
  };

  const endStroke = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (drawing.current?.pointerId !== event.pointerId) return;
    flush();
    drawing.current = null;
  };

  const undo = () => {
    for (let i = strokes.length - 1; i >= 0; i -= 1) {
      if (strokes.get(i).get('by') === userId) {
        strokes.delete(i, 1);
        return;
      }
    }
  };
  const hasOwnStroke = strokes.toArray().some((s) => s.get('by') === userId);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border p-3"
        role="toolbar"
        aria-label="Whiteboard tools"
      >
        <div className="flex gap-1">
          <IconButton
            label="Pen"
            size="sm"
            pressed={tool === 'pen'}
            variant={tool === 'pen' ? 'primary' : 'ghost'}
            onClick={() => setTool('pen')}
          >
            <Pencil className="size-4" aria-hidden="true" />
          </IconButton>
          <IconButton
            label="Eraser"
            size="sm"
            pressed={tool === 'eraser'}
            variant={tool === 'eraser' ? 'primary' : 'ghost'}
            onClick={() => setTool('eraser')}
          >
            <Eraser className="size-4" aria-hidden="true" />
          </IconButton>
        </div>

        <fieldset className="flex items-center gap-1.5">
          <legend className="sr-only">Colour</legend>
          {INKS.map((option) => (
            <label
              key={option.id}
              className={cn(
                'flex size-9 cursor-pointer items-center justify-center rounded-md has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-(--focus)',
                ink === option.id && tool === 'pen' && 'bg-surface-2 ring-2 ring-border-strong',
              )}
            >
              <input
                type="radio"
                name="whiteboard-ink"
                className="sr-only"
                checked={ink === option.id}
                onChange={() => {
                  setInk(option.id);
                  setTool('pen');
                }}
              />
              <span
                className="size-5 rounded-full border border-border-strong"
                style={{ backgroundColor: `var(${option.variable})` }}
                aria-hidden="true"
              />
              <span className="sr-only">{option.label}</span>
            </label>
          ))}
        </fieldset>

        <fieldset className="flex items-center gap-1.5">
          <legend className="sr-only">Line thickness</legend>
          {SIZES.map((option) => (
            <label
              key={option.id}
              className={cn(
                'flex size-9 cursor-pointer items-center justify-center rounded-md has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-(--focus)',
                size === option.id && 'bg-surface-2 ring-2 ring-border-strong',
              )}
            >
              <input
                type="radio"
                name="whiteboard-size"
                className="sr-only"
                checked={size === option.id}
                onChange={() => setSize(option.id)}
              />
              <span
                className="rounded-full bg-text"
                style={{ width: 4 + option.id / 2, height: 4 + option.id / 2 }}
                aria-hidden="true"
              />
              <span className="sr-only">{option.label}</span>
            </label>
          ))}
        </fieldset>

        <div className="ml-auto flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={undo}
            disabled={!hasOwnStroke}
            icon={<Undo2 className="size-4" aria-hidden="true" />}
          >
            Undo
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setConfirmClear(true)}
            disabled={count === 0}
            icon={<Trash2 className="size-4" aria-hidden="true" />}
          >
            Clear
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 items-start justify-center overflow-auto bg-surface-2 p-3">
        <canvas
          ref={canvasRef}
          width={WIDTH}
          height={HEIGHT}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endStroke}
          onPointerCancel={endStroke}
          role="img"
          aria-label={`Shared whiteboard with ${count} ${count === 1 ? 'stroke' : 'strokes'}. Drawing needs a pointer; use notes or chat for text.`}
          className={cn(
            'aspect-[16/10] max-h-full w-full max-w-5xl touch-none rounded-md border border-border bg-surface',
            tool === 'eraser' ? 'cursor-cell' : 'cursor-crosshair',
          )}
        />
      </div>

      <ConfirmDialog
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        onConfirm={() => {
          strokes.delete(0, strokes.length);
          setConfirmClear(false);
        }}
        title="Clear the whiteboard?"
        description="This removes every stroke for both of you and cannot be undone."
        confirmLabel="Clear whiteboard"
        cancelLabel="Keep it"
      />
    </div>
  );
}
