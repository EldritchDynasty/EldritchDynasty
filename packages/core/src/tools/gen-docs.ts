/**
 * Render `docs/VOCABULARY.md` from the schemas and the year table.
 *
 *   npm run gen:docs
 *
 * Generated the same way `loci.yaml` is, and for the same reason: a reference
 * anyone maintains by hand is a reference that is wrong by the second commit.
 * `docs.test.ts` fails if the committed file is out of date.
 */
import { writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONTENT_RULES, vocabulary } from '@ed/schema';
import { YEAR_PHASES } from '../year/phases.js';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
export const VOCABULARY_PATH = join(REPO, 'docs', 'VOCABULARY.md');

/** A pipe inside a cell ends the cell. Escaped here, and nowhere else. */
const cell = (s: string) => s.replace(/\|/g, '\\|');

const table = (headers: string[], rows: string[][]): string => [
  `| ${headers.join(' | ')} |`,
  `|${headers.map(() => '---').join('|')}|`,
  ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`),
].join('\n');

const code = (s: string) => `\`${s}\``;

export function renderVocabulary(): string {
  const v = vocabulary();
  const out: string[] = [];

  out.push('# VOCABULARY');
  out.push('');
  out.push('**Generated — run `npm run gen:docs`. Do not edit.**');
  out.push('');
  out.push('Every closed vocabulary in the game, read off the schemas that define them.');
  out.push('Written so that authoring content or wiring an effect needs this file and');
  out.push('not `event.ts`, `conditions.ts`, `frequency.ts`, `person.ts` and `attributes.ts`.');
  out.push('');
  out.push('`T?` optional · `T = x` defaults to x · `T[]` array · `A|B` one of');
  out.push('');

  out.push('## Effects');
  out.push('');
  out.push('What an outcome may do. The union is closed; `applyEffect` in');
  out.push('`core/src/events/effects.ts` ends in `assertNever`, so adding a kind is a');
  out.push('compile error until it is handled.');
  out.push('');
  out.push(table(['kind', 'fields'], v.effects.map((e) => [
    code(e.name), e.fields.length ? e.fields.map(code).join(' ') : '—',
  ])));
  out.push('');
  out.push(`**Target** — who an effect lands on: ${v.targets.map(code).join(', ')}.`);
  out.push('');

  out.push('## Conditions');
  out.push('');
  out.push('Gate an event, an Age onset or an arc successor on world state. Named by');
  out.push('which key is present. `all` / `any` / `not` nest.');
  out.push('');
  out.push(table(['condition', 'shape'], v.conditions.map((c) => [
    code(c.name), c.fields.map(code).join(' '),
  ])));
  out.push('');

  out.push('## Filters');
  out.push('');
  out.push('Narrow a slot\'s candidates, or an heirloom\'s eligible bearers. Run against');
  out.push('one person at a time.');
  out.push('');
  out.push(table(['filter', 'shape'], v.filters.map((f) => [
    code(f.name), f.fields.map(code).join(' '),
  ])));
  out.push('');

  out.push('## Who decides');
  out.push('');
  out.push('`decidedBy` on a `choice` or `dispatch` interaction. Orthogonal to the');
  out.push('interaction kind: the shape says how many branches there are and whether the');
  out.push('player casts them, the decider says who takes one. Source:');
  out.push('`schema/src/decider.ts`, evaluated by `core/src/events/deciders.ts`.');
  out.push('');
  out.push(table(['decider', 'shape', 'what it means'], v.deciders.map((d) => [
    code(d.name), code(d.shape), d.note,
  ])));
  out.push('');

  out.push('## Trees of events');
  out.push('');
  out.push('An arc successor asks what happened in the parent. Every guard present must');
  out.push('hold, and exactly one successor is taken. Source: `schema/src/arc.ts`.');
  out.push('');
  out.push(`**Successor** — ${v.successorGuards.map(code).join(' · ')}`);
  out.push('');
  out.push('`Outcome.next` is the short form: `{event, after, keep}` on an outcome');
  out.push('compiles into a real arc before the engine sees it (`schema/src/desugar.ts`),');
  out.push('so a two-beat scene needs no arc file and there is still one thing that runs');
  out.push('a tree. `keep` names the slots cast with the same people in the follow-up.');
  out.push('');

  out.push('## Frequency');
  out.push('');
  out.push('A rationing tier, not a weight synonym. It reaches into scheduling,');
  out.push('presentation, folklore and whether a Record choice is required.');
  out.push('');
  out.push(table(
    ['tier', 'cap', 'cooldown', 'record block', 'folklore', 'chronicle'],
    v.frequencies.map((f) => [code(f.tier), f.cap, f.cooldown, f.record, f.rumour, f.chronicle]),
  ));
  out.push('');

  out.push('## Enumerations');
  out.push('');
  for (const e of v.enums) {
    out.push(`**${e.name}** — ${e.values.map(code).join(' · ')}`);
    if (e.note) out.push(`<br>${e.note}`);
    out.push('');
  }

  out.push('## The year');
  out.push('');
  out.push('In order. Each phase draws from its own RNG stream, seeded from its name.');
  out.push('Source: `core/src/year/phases.ts`.');
  out.push('');
  out.push(table(['#', 'phase', 'after', 'why'], YEAR_PHASES.map((p, i) => [
    String(i + 1), code(p.name), p.after.map(code).join(', ') || '—', p.why,
  ])));
  out.push('');

  out.push('## Validation rules');
  out.push('');
  out.push('Run one with `runRule(id, bundle)`. Source: `schema/src/validate.ts`.');
  out.push('');
  out.push(table(['rule', 'what it is for'], CONTENT_RULES.map((r) => [code(r.id), r.about])));
  out.push('');

  return out.join('\n');
}

export function vocabularyIsCurrent(): boolean {
  try {
    return readFileSync(VOCABULARY_PATH, 'utf8').replace(/\r\n/g, '\n') === renderVocabulary();
  } catch {
    return false;
  }
}

const isMain = process.argv[1]?.replace(/\\/g, '/').endsWith('gen-docs.ts');
if (isMain) {
  writeFileSync(VOCABULARY_PATH, renderVocabulary(), 'utf8');
  console.log(`wrote ${VOCABULARY_PATH}`);
}