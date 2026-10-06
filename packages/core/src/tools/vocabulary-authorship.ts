import {
  indexContent, vocabulary,
  type Content, type ContentBundle,
} from '@ed/schema';

type Source = ContentBundle | Content;

/**
 * Effect kinds intentionally implemented but not authored yet.
 *
 * This is a debt list, not an allow-list: both a new unauthored kind and a
 * listed debt becoming authored must fail so the exception cannot silently
 * grow stale.
 */
export const VOCABULARY_AUTHORSHIP_OWED = ['recast', 'schedule'] as const;

export interface VocabularyAuthorshipVerdict {
  ok: boolean;
  lines: string[];
  declared: string[];
  authored: string[];
  unauthored: string[];
  newlyUnauthored: string[];
  owedStill: string[];
  paidOff: string[];
}

/**
 * The merge-safety half of the historical vocabulary-reach gate.
 *
 * Whether an Effect kind is declared and whether authored content uses it are
 * static facts. The old gate also replayed 800 campaigns to print
 * "authored but never reached" diagnostics, but that sampled fact never
 * affected its ok/fail verdict. Keeping the structural verdict here lets merge
 * CI prove the actual invariant without paying for population telemetry.
 */
export function vocabularyAuthorship(source: Source): VocabularyAuthorshipVerdict {
  const bundle = indexContent(source);
  const declared = vocabulary().effects.map((effect) => effect.name);
  const authoredSet = new Set<string>();

  const note = (outcome: { effects?: unknown }): void => {
    for (const effect of (outcome.effects ?? []) as { kind?: string }[]) {
      if (typeof effect?.kind === 'string') authoredSet.add(effect.kind);
    }
  };

  for (const event of bundle.events) {
    if (event.interaction.kind === 'narration') {
      for (const outcome of event.interaction.outcomes) note(outcome);
    } else {
      for (const choice of event.interaction.choices) {
        for (const outcome of choice.outcomes) note(outcome);
      }
    }
  }

  const authored = [...authoredSet].sort();
  const unauthored = declared.filter((kind) => !authoredSet.has(kind));
  const owed = new Set<string>(VOCABULARY_AUTHORSHIP_OWED);
  const newlyUnauthored = unauthored.filter((kind) => !owed.has(kind));
  const owedStill = VOCABULARY_AUTHORSHIP_OWED.filter((kind) => unauthored.includes(kind));
  const paidOff = VOCABULARY_AUTHORSHIP_OWED.filter((kind) => !unauthored.includes(kind));

  const lines = [
    `vocabulary authorship: ${declared.length} Effect kinds — ${authored.length} authored`,
  ];
  if (owedStill.length) {
    lines.push(
      `  owed, and pinned: ${owedStill.join(', ')} — declared and handled, authored by no content`,
    );
  }
  if (newlyUnauthored.length) {
    lines.push(
      `  FAIL: ${newlyUnauthored.length} declared Effect kind(s) no content authors —`,
    );
    for (const kind of newlyUnauthored) {
      lines.push(`    ${kind}: the case in applyEffect exists and no outcome has ever asked for it`);
    }
    lines.push('  Either author content that uses it, or delete the kind (invariant 11).');
  }
  if (paidOff.length) {
    lines.push(
      `  FAIL: ${paidOff.join(', ')} is authored now. Remove it from VOCABULARY_AUTHORSHIP_OWED — `
      + 'a pin nobody prunes is a comment that lies about the game.',
    );
  }

  return {
    ok: newlyUnauthored.length === 0 && paidOff.length === 0,
    lines,
    declared,
    authored,
    unauthored,
    newlyUnauthored,
    owedStill: [...owedStill],
    paidOff: [...paidOff],
  };
}
