import { describe, expect, it } from 'vitest';
import { loadBundle, loadContent } from '@ed/content';
import {
  VOCABULARY_AUTHORSHIP_OWED,
  vocabularyAuthorship,
} from './tools/vocabulary-authorship.js';

describe('vocabulary authorship merge witness', () => {
  it('accepts shipped content while keeping known unauthored debt explicit', () => {
    const verdict = vocabularyAuthorship(loadContent());

    expect(verdict.ok, verdict.lines.join('\n')).toBe(true);
    expect(verdict.newlyUnauthored).toEqual([]);
    expect(verdict.paidOff).toEqual([]);
    expect(verdict.owedStill).toEqual([...VOCABULARY_AUTHORSHIP_OWED]);
    expect(verdict.declared.length).toBeGreaterThan(verdict.owedStill.length);
    expect(verdict.authored.length + verdict.unauthored.length).toBe(verdict.declared.length);
  });

  it('rejects a deliberately broken fixture when an authored Effect kind disappears', () => {
    const bundle = structuredClone(loadBundle());
    const pristine = vocabularyAuthorship(bundle);
    const owed = new Set<string>(VOCABULARY_AUTHORSHIP_OWED);
    const removed = pristine.authored.find((kind) => !owed.has(kind));
    expect(removed, 'fixture has no non-debt authored Effect kind to remove').toBeDefined();

    for (const event of bundle.events) {
      const strip = (outcome: { effects?: Array<{ kind?: string }> }) => {
        if (!outcome.effects) return;
        outcome.effects = outcome.effects.filter((effect) => effect.kind !== removed);
      };
      if (event.interaction.kind === 'narration') {
        for (const outcome of event.interaction.outcomes) strip(outcome);
      } else {
        for (const choice of event.interaction.choices) {
          for (const outcome of choice.outcomes) strip(outcome);
        }
      }
    }

    const verdict = vocabularyAuthorship(bundle);
    expect(verdict.ok).toBe(false);
    expect(verdict.newlyUnauthored).toContain(removed);
    expect(verdict.lines.join('\n')).toContain('FAIL:');
  });
});
