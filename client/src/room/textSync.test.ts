import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { applyTextChange, diffText, transformPosition } from './textSync';

describe('diffText', () => {
  it('returns null for identical text', () => {
    expect(diffText('same', 'same')).toBeNull();
  });

  it('finds insertions, deletions and replacements', () => {
    expect(diffText('hello', 'hello world')).toEqual({ index: 5, remove: 0, insert: ' world' });
    expect(diffText('hello world', 'hello')).toEqual({ index: 5, remove: 6, insert: '' });
    expect(diffText('the cat sat', 'the dog sat')).toEqual({ index: 4, remove: 3, insert: 'dog' });
    expect(diffText('', 'a')).toEqual({ index: 0, remove: 0, insert: 'a' });
  });

  it('handles repeated characters around the edit', () => {
    const change = diffText('aaa', 'aaaa');
    expect(change).not.toBeNull();
    if (change) {
      const { index, remove, insert } = change;
      expect('aaa'.slice(0, index) + insert + 'aaa'.slice(index + remove)).toBe('aaaa');
    }
  });
});

describe('applyTextChange', () => {
  it('keeps concurrent edits from two members', () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    a.getText('notes').insert(0, 'Agenda\n');
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    // Both type at once, each starting from the same text, as two text boxes would.
    applyTextChange(a.getText('notes'), 'Agenda\n- recap');
    applyTextChange(b.getText('notes'), 'Our Agenda\n');
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    const merged = a.getText('notes').toJSON();
    expect(merged).toBe(b.getText('notes').toJSON());
    expect(merged).toBe('Our Agenda\n- recap');
  });
});

describe('transformPosition', () => {
  it('moves the caret past text inserted before it', () => {
    expect(transformPosition(5, [{ insert: 'abc' }])).toBe(8);
    expect(transformPosition(5, [{ retain: 2 }, { insert: 'xx' }])).toBe(7);
  });

  it('leaves the caret alone for edits after it', () => {
    expect(transformPosition(2, [{ retain: 4 }, { insert: 'zz' }])).toBe(2);
    expect(transformPosition(2, [{ retain: 4 }, { delete: 3 }])).toBe(2);
  });

  it('pulls the caret back for deletions before or around it', () => {
    expect(transformPosition(6, [{ retain: 1 }, { delete: 2 }])).toBe(4);
    expect(transformPosition(3, [{ retain: 1 }, { delete: 10 }])).toBe(1);
  });
});
