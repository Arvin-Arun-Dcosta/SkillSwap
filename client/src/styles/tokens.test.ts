import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/** Reads the colour tokens of one theme block straight from the stylesheet. */
function readTokens(selector: string): Record<string, string> {
  const css = readFileSync(path.join(import.meta.dirname, 'index.css'), 'utf8');
  const start = css.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`no ${selector} block`);
  const block = css.slice(start, css.indexOf('}', start));
  const tokens: Record<string, string> = {};
  for (const match of block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})\s*;/gi)) {
    if (match[1] && match[2]) tokens[match[1]] = match[2];
  }
  return tokens;
}

function luminance(hex: string): number {
  const channel = (i: number) => {
    const value = parseInt(hex.slice(i, i + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** WCAG 2 contrast ratio between two colours. */
function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

/** Every foreground/background pairing the components use. Text needs 4.5:1 (WCAG 2.2 AA). */
const TEXT_PAIRS: [string, string][] = [
  ['text', 'bg'],
  ['text', 'surface'],
  ['text', 'surface-2'],
  ['text-muted', 'bg'],
  ['text-muted', 'surface'],
  ['text-muted', 'surface-2'],
  ['primary', 'bg'],
  ['primary', 'surface'],
  ['on-primary', 'primary'],
  ['on-primary', 'primary-hover'],
  ['teach', 'teach-bg'],
  ['learn', 'learn-bg'],
  ['danger', 'surface'],
  ['danger', 'danger-bg'],
  ['on-danger', 'danger'],
  ['success', 'surface'],
  ['success', 'success-bg'],
  ['warning', 'surface'],
  ['warning', 'warning-bg'],
  ['syntax-keyword', 'surface'],
  ['syntax-string', 'surface'],
  ['syntax-number', 'surface'],
  ['syntax-comment', 'surface'],
  ['syntax-name', 'surface'],
];

/** Boundaries and graphics that carry meaning need 3:1 against what they sit on. */
const UI_PAIRS: [string, string][] = [
  ['border-strong', 'surface'],
  ['border-strong', 'bg'],
  ['focus', 'bg'],
  ['focus', 'surface'],
  ['chart-1', 'surface'],
  ['chart-2', 'surface'],
];

describe.each([
  ['light', ':root'],
  ['dark', "[data-theme='dark']"],
])('%s theme colour contrast', (_name, selector) => {
  const tokens = readTokens(selector);
  const get = (name: string) => {
    const value = tokens[name];
    if (!value) throw new Error(`token --${name} missing in ${selector}`);
    return value;
  };

  it.each(TEXT_PAIRS)('%s on %s is readable as text (4.5:1)', (foreground, background) => {
    expect(contrast(get(foreground), get(background))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(UI_PAIRS)('%s against %s is visible as a boundary or mark (3:1)', (mark, background) => {
    expect(contrast(get(mark), get(background))).toBeGreaterThanOrEqual(3);
  });
});

describe('themes', () => {
  it('define the same set of tokens', () => {
    expect(Object.keys(readTokens("[data-theme='dark']")).sort()).toEqual(
      Object.keys(readTokens(':root')).sort(),
    );
  });
});
