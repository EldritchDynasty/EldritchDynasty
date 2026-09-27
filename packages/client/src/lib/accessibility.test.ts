// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  ACCESSIBILITY_STORAGE_KEY,
  SEEN_PROSE_STORAGE_KEY,
  applyAccessibility,
  chapterReplayDisposition,
  initialPrologueShown,
  hasSeenProse,
  loadAccessibility,
  loadSeenProse,
  prologueSeenText,
  rememberSeenProse,
  replayDisposition,
  revealPrologueBeat,
  saveAccessibility,
  seenProseKey,
  type AccessibilityPreferences,
} from './accessibility';

describe('reading preferences', () => {
  it('round-trips and applies the reader\'s choices', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    const wanted: AccessibilityPreferences = {
      textScale: 'largest',
      readingFont: 'readable',
      skipSeenProse: true,
      reduceMotion: true,
    };

    saveAccessibility(storage, wanted);
    expect(values.has(ACCESSIBILITY_STORAGE_KEY)).toBe(true);
    expect(loadAccessibility(storage)).toEqual(wanted);

    applyAccessibility(document.documentElement, wanted);
    expect(document.documentElement.dataset.textScale).toBe('largest');
    expect(document.documentElement.dataset.readingFont).toBe('readable');
    expect(document.documentElement.dataset.reduceMotion).toBe('true');
    expect(document.documentElement.style.fontSize).toBe('130%');
  });

  it('falls back safely when stored data is stale or malformed', () => {
    expect(loadAccessibility({ getItem: () => '{broken' })).toEqual({
      textScale: 'standard',
      readingFont: 'book',
      skipSeenProse: false,
      reduceMotion: false,
    });
    expect(loadAccessibility({ getItem: () => JSON.stringify({ textScale: 'huge' }) })).toEqual({
      textScale: 'standard',
      readingFont: 'book',
      skipSeenProse: false,
      reduceMotion: false,
    });
  });
});

describe('the reading-comfort checklist (#275)', () => {
  const css = readFileSync(join(import.meta.dirname, '..', 'styles.css'), 'utf8');
  const components = join(import.meta.dirname, '..', 'components');

  function variables(block: string): Record<string, string> {
    return Object.fromEntries(
      [...block.matchAll(/--([a-z-]+):\s*(#[0-9a-f]{6})\s*;/gi)]
        .map((match) => [match[1]!, match[2]!.toLowerCase()]),
    );
  }

  function channel(hex: string): number {
    const value = Number.parseInt(hex, 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }

  function luminance(hex: string): number {
    const colour = hex.replace('#', '');
    return 0.2126 * channel(colour.slice(0, 2))
      + 0.7152 * channel(colour.slice(2, 4))
      + 0.0722 * channel(colour.slice(4, 6));
  }

  function contrast(a: string, b: string): number {
    const first = luminance(a);
    const second = luminance(b);
    const light = Math.max(first, second);
    const dark = Math.min(first, second);
    return (light + 0.05) / (dark + 0.05);
  }

  it('keeps every ordinary text token at WCAG AA contrast on every game ground', () => {
    const lightBlock = css.match(/:root\s*\{([\s\S]*?)\}/)?.[1];
    const darkBlock = css.match(
      /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{\s*:root\s*\{([\s\S]*?)\}\s*\}/,
    )?.[1];
    expect(lightBlock).toBeTruthy();
    expect(darkBlock).toBeTruthy();

    const light = variables(lightBlock!);
    const dark = { ...light, ...variables(darkBlock!) };
    const grounds = ['vellum', 'vellum-deep', 'panel'] as const;
    const text = ['ink', 'ink-soft', 'ink-faint', 'rubric'] as const;

    for (const [theme, palette] of [['light', light], ['dark', dark]] as const) {
      for (const ink of text) {
        for (const ground of grounds) {
          expect(
            contrast(palette[ink]!, palette[ground]!),
            `${theme} --${ink} on --${ground}`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      }
      expect(
        contrast(palette['on-rubric']!, palette.rubric!),
        `${theme} --on-rubric on --rubric`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('has no component fact available only through a title tooltip', () => {
    for (const name of readdirSync(components).filter((entry) => entry.endsWith('.vue'))) {
      const source = readFileSync(join(components, name), 'utf8');
      const template = source.match(/<template>([\\s\\S]*?)<\\/template>/)?.[1] ?? '';
      expect(template, name).not.toMatch(/\b(?::|v-bind:)?title\s*=/);
    }
  });

  it('honours reduced motion from both the OS and the in-game preference', () => {
    expect(css).toMatch(/prefers-reduced-motion:\s*reduce/);
    expect(css).toContain(":root[data-reduce-motion='true'] *");
    expect(css).toMatch(/scroll-behavior:\s*auto\s*!important/);
    expect(css).toMatch(/transition-duration:\s*0\.01ms\s*!important/);
    expect(css).toMatch(/forced-colors:\s*active/);
  });

  it('offers two enlarged scales and a readable face', () => {
    expect(css).toContain("data-text-scale='large'");
    expect(css).toContain("data-text-scale='largest'");
    expect(css).toContain("data-reading-font='readable'");
  });

  it('keeps every long-form reading surface to a deliberate measure', () => {
    const measures = [
      ['Chronicle.vue', /max-width:\s*46ch\b/],
      ['Docket.vue', /max-width:\s*72ch\b/],
      ['Outcome.vue', /max-width:\s*72ch\b/],
      ['Chapter.vue', /max-width:\s*56ch\b/],
      ['Interlude.vue', /max-width:\s*56ch\b/],
      ['Abroad.vue', /max-width:\s*62ch\b/],
      ['Ending.vue', /max-width:\s*64ch\b/],
      ['Start.vue', /max-width:\s*58ch\b/],
      ['Prologue.vue', /max-width:\s*62ch\b/],
      ['Book.vue', /width:\s*min\(64ch,\s*100%\)/],
    ] as const;

    for (const [name, measure] of measures) {
      const source = readFileSync(join(components, name), 'utf8');
      expect(source, name).toMatch(measure);
    }
  });
});


describe('seen passive prose', () => {
  it('remembers exact prose and treats a changed variant as unseen', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    const first = seenProseKey('chapter-opening', 'The bells were quiet.');
    const changed = seenProseKey('chapter-opening', 'The bells were almost quiet.');

    rememberSeenProse(storage, first);

    expect(values.has(SEEN_PROSE_STORAGE_KEY)).toBe(true);
    expect(hasSeenProse(storage, first)).toBe(true);
    expect(hasSeenProse(storage, changed)).toBe(false);
    expect(loadSeenProse(storage)).toEqual(new Set([first]));
  });

  it('falls back to an empty history when the stored history is malformed', () => {
    expect(loadSeenProse({ getItem: () => '{broken' })).toEqual(new Set());
  });
});


describe('experienced-player Age openings (#258)', () => {
  function storage() {
    const values = new Map<string, string>();
    return {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
  }

  it('shows the first occurrence and records it as seen', () => {
    const s = storage();
    const text = 'The bells had not rung since winter.';

    expect(chapterReplayDisposition(
      s,
      true,
      { kind: 'opening', text },
    )).toBe('show');
    expect(hasSeenProse(s, seenProseKey('chapter-opening', text))).toBe(true);
  });

  it('skips an exact repeat only when the reader opted in', () => {
    const text = 'The bells had not rung since winter.';

    const enabled = storage();
    rememberSeenProse(enabled, seenProseKey('chapter-opening', text));
    expect(chapterReplayDisposition(
      enabled,
      true,
      { kind: 'opening', text },
    )).toBe('skip');

    const disabled = storage();
    rememberSeenProse(disabled, seenProseKey('chapter-opening', text));
    expect(chapterReplayDisposition(
      disabled,
      false,
      { kind: 'opening', text },
    )).toBe('show');
  });

  it('treats changed opening prose as unseen', () => {
    const s = storage();
    const oldText = 'The bells had not rung since winter.';
    const newText = 'The bells had scarcely rung since winter.';
    rememberSeenProse(s, seenProseKey('chapter-opening', oldText));

    expect(chapterReplayDisposition(
      s,
      true,
      { kind: 'opening', text: newText },
    )).toBe('show');
    expect(hasSeenProse(s, seenProseKey('chapter-opening', newText))).toBe(true);
  });

  it('always shows a closing and never records one', () => {
    const s = storage();

    expect(chapterReplayDisposition(
      s,
      true,
      { kind: 'closing' },
    )).toBe('show');
    expect(loadSeenProse(s).size).toBe(0);
  });
});


describe('experienced-reader replay beyond Age openings (#267)', () => {
  function storage() {
    const values = new Map<string, string>();
    return {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
  }

  const prologueText = [
    'The room was cold.',
    'A key was given.', 'The door would remember it.',
    'A name was given.', 'The book would keep it.',
    'A line was given.', 'The line would be collected.',
    'What was signed was inherited.',
  ].join('\u0000');

  it('fast-reveals only an exact repeated prologue when the reader opted in', () => {
    const s = storage();
    const beat = { kind: 'prologue' as const, text: prologueText };
    const key = seenProseKey('prologue', prologueText);

    expect(replayDisposition(s, true, beat)).toBe('show');
    expect(hasSeenProse(s, key), 'merely mounting the prologue must not mark it read').toBe(false);

    rememberSeenProse(s, key);
    expect(replayDisposition(s, true, beat)).toBe('fast');
    expect(replayDisposition(s, false, beat)).toBe('show');
    expect(replayDisposition(s, true, {
      kind: 'prologue',
      text: prologueText.replace('cold', 'very cold'),
    })).toBe('show');
  });

  it('marks a repeated authored scene without hiding it or depending on the skip preference', () => {
    const s = storage();
    const scene = {
      kind: 'scene' as const,
      event: 'the_same_room',
      authored: '{HEIR} finds the old key under the ledger.',
    };

    expect(replayDisposition(s, false, scene)).toBe('show');
    expect(replayDisposition(s, true, scene)).toBe('mark');

    // Filled names are deliberately not an input to the identity. The same
    // authored scene is still the same scene when a different heir fills it.
    expect(replayDisposition(s, false, scene)).toBe('mark');

    expect(replayDisposition(s, true, {
      ...scene,
      authored: '{HEIR} finds the old key beside the ledger.',
    })).toBe('show');
  });
});


describe('the prologue earns its seen mark only after it is read (#267)', () => {
  function storage() {
    const values = new Map<string, string>();
    return {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
  }

  const triad = [
    { given: 'A key was given.', owed: 'The door would remember it.' },
    { given: 'A name was given.', owed: 'The book would keep it.' },
    { given: 'A line was given.', owed: 'The line would be collected.' },
  ];
  const exactText = prologueSeenText(
    'The room was cold.',
    triad,
    'What was signed was inherited.',
  );

  it('does not remember a half-read signing, then remembers the third revealed beat', () => {
    const s = storage();
    const key = seenProseKey('prologue', exactText);
    let shown = initialPrologueShown(s, true, exactText, triad.length);

    expect(shown).toBe(0);
    expect(hasSeenProse(s, key)).toBe(false);

    shown = revealPrologueBeat(s, exactText, shown, triad.length);
    shown = revealPrologueBeat(s, exactText, shown, triad.length);
    expect(shown).toBe(2);
    expect(hasSeenProse(s, key)).toBe(false);

    shown = revealPrologueBeat(s, exactText, shown, triad.length);
    expect(shown).toBe(3);
    expect(hasSeenProse(s, key)).toBe(true);
  });

  it('fast-reveals only the passive beats of an exact repeat, and only with the preference on', () => {
    const s = storage();
    rememberSeenProse(s, seenProseKey('prologue', exactText));

    expect(initialPrologueShown(s, true, exactText, triad.length)).toBe(3);
    expect(initialPrologueShown(s, false, exactText, triad.length)).toBe(0);
    expect(initialPrologueShown(
      s,
      true,
      exactText.replace('cold', 'very cold'),
      triad.length,
    )).toBe(0);
  });

  it('keeps the fast path presentation-only until the existing Sign it gate', () => {
    const source = readFileSync(join(import.meta.dirname, '..', 'components', 'Prologue.vue'), 'utf8');
    const sign = source.indexOf('function sign(): void');
    expect(sign).toBeGreaterThan(0);

    // Replay setup and reveal state may touch only reader-local storage. The
    // first simulation verb remains the existing found() call inside sign().
    expect(source.slice(0, sign)).not.toContain('props.actions.');
    expect(source.slice(sign)).toContain('props.actions.found(');

    // Fast reveal changes only `shown`; the founding requirements still own
    // whether the simulation verb can be pressed.
    expect(source).toContain(':disabled="wanted.length > 0"');
  });
});
