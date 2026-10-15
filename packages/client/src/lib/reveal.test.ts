import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REVEAL_ELEMENTS, revealNotice, revealStorageKey, loadRevealed, saveRevealed } from './reveal';

const ORIGINAL = [
  'The clock can now move five years at a time.',
  'The table is open: this is where the house gives standing orders.',
  'The Assize is visible: it is how the wider world answers the house.',
  'The ladder is visible: it shows how far the blood has climbed.',
  'Abroad is open: tales and rumours now have somewhere to be read.',
  'The longer clock is open: a generation, or on to the term.',
];

const PLAIN = [
  'You can now move forward five years at once.',
  'Family orders are now available. Use the Table to manage resources and make plans.',
  'You can now see how the wider world is responding to your family.',
  "You can now see the family's progress toward greater power.",
  'You can now read stories and rumours about the family from outside the house.',
  'You can now move forward a generation or to the end of the game.',
];

describe('progressive reveal notices in both reading modes (#1700)', () => {
  it('retains every Original literal and has distinct Plain English wording for each ID', () => {
    expect(REVEAL_ELEMENTS.map((id) => revealNotice(id))).toEqual(ORIGINAL);
    expect(REVEAL_ELEMENTS.map((id) => revealNotice(id, 'original'))).toEqual(ORIGINAL);
    expect(REVEAL_ELEMENTS.map((id) => revealNotice(id, 'plainenglish'))).toEqual(PLAIN);
    expect(new Set(PLAIN).size).toBe(REVEAL_ELEMENTS.length);
  });

  it('changes the words both ways without changing the recorded reveal IDs', () => {
    const seen = new Set([REVEAL_ELEMENTS[0]!, REVEAL_ELEMENTS[3]!]);
    const saved: Record<string, string> = {};
    const storage = {
      getItem: (key: string) => saved[key] ?? null,
      setItem: (key: string, value: string) => { saved[key] = value; },
    };
    const key = revealStorageKey({
      seed: 17,
      campaign: { id: 'short', startYear: 1200 },
      houseName: 'The House',
    } as Parameters<typeof revealStorageKey>[0]);

    saveRevealed(storage, key, seen);
    const restored = loadRevealed(storage, key);
    const ids = [...restored];
    expect(ids).toEqual([...seen]);
    expect(ids.map((id) => revealNotice(id, 'original'))).toEqual([
      ORIGINAL[0], ORIGINAL[3],
    ]);
    expect(ids.map((id) => revealNotice(id, 'plainenglish'))).toEqual([
      PLAIN[0], PLAIN[3],
    ]);
    expect(ids.map((id) => revealNotice(id, 'original'))).toEqual([
      ORIGINAL[0], ORIGINAL[3],
    ]);
    expect([...restored]).toEqual(ids);
    expect(saved[key]).toBe(JSON.stringify(ids));
  });

  it('renders a visible App notice by stable ID and current reader preference', () => {
    const source = readFileSync(join(import.meta.dirname, '../App.vue'), 'utf8');
    expect(source).toContain('ref<RevealElement[]>([])');
    expect(source).toContain('...transition.newlyShown,');
    expect(source).toContain('revealNotice(notice, accessibility.proseMode)');
    expect(source).toContain('dismissReveal(notice)');
    expect(source).not.toContain('text: revealNotice(id)');
    expect(source).not.toContain('notice.text');
  });
});
