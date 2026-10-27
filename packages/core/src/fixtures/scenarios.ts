import type { Content, ContentBundle, ProseMode } from '@ed/schema';
import { asId } from '@ed/schema';
import { pendingArc } from './pending-arc.fixture.js';
import { replayInputs } from '../replay.js';
import { canonical, digestOf, saveGame } from '../save.js';
import { resumeGame, type GameSession } from '../session.js';
import { place, testWorld } from '../testing.js';
import { head, isRegent, type SimCtx } from '../world.js';

/** Test/CLI catalogue, deliberately absent from the public package exports.
 * Build exact states with the existing helpers; after build, only session verbs
 * perform actions. Assertions may inspect state to locate a broken mechanism.
 */
export interface Scenario {
  name: string;
  description: string;
  build(content: Content | ContentBundle): SimCtx;
  steps: readonly { name: string; act(session: GameSession): void }[];
}

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

const choiceOf = (s: GameSession) => {
  const decision = s.pending.find(d => d.kind === 'choice' && d.event.id === 'the_tutors_good_years');
  check(decision?.kind === 'choice', 'the tutor story must have a pending choice');
  return decision;
};

function answerTutor(s: GameSession) {
  const d = choiceOf(s);
  check(s.choose(d.id, 'teach_the_heir').ok, 'the saved tutor choice must be accepted');
  s.letHimDecide();
}

function turn(s: GameSession, years: number) {
  s.decider = 'chronicler';
  const before = s.year;
  s.advance(years);
  check(s.year === before + years, `the clock must advance ${years} year(s)`);
}

export const SCENARIOS: readonly Scenario[] = [
  {
    name: 'succession-regency',
    description: 'A minor inherits wardship, buys back the harvest, then takes the seal as Regent.',
    build(content) {
      const ctx = testWorld(content, 1937);
      for (const p of ctx.world.people.living()) ctx.world.people.kill(p.id, ctx.world.year, 'before succession');
      for (const p of ctx.world.people.all()) p.castSlots = [];
      ctx.world.headSince = undefined;
      place(ctx, { sex: 'female', age: 14, name: 'The ward' });
      ctx.world.treasury = 10000;
      return ctx;
    },
    steps: [
      { name: 'the vacant seal opens wardship', act(s) {
        turn(s, 1);
        check(s.table().wardship?.wardName === 'The ward', 'the minor must be named in Table wardship');
        check(!head(s.ctx.world), 'a minor must not hold the seal');
      } },
      { name: 'buy back the harvest and come of age', act(s) {
        check(s.order({ kind: 'buyBackWardship' }).ok, 'wardship buyback must be accepted');
        check(s.table().wardship?.boughtBack, 'the Table must show the paid buyback');
        turn(s, 1);
        const seated = s.view().halls.flatMap(h => h.members).find(p => p.head);
        check(seated?.name === 'The ward', 'the former ward must hold the seal at sixteen');
        const ruler = head(s.ctx.world);
        check(ruler && isRegent(s.ctx.world, ruler), 'the female successor must be a Regent');
        check(!s.table().wardship, 'majority must end wardship');
      } },
    ],
  },
  {
    name: 'docket-blocks-clock',
    description: 'A pending choice blocks time; answering it releases the clock.',
    build: content => pendingArc(content).ctx,
    steps: [
      { name: 'turning a blocked clock changes nothing', act(s) {
        const before = canonical(s.save());
        const year = s.year;
        const result = s.advance(2);
        check(result.stoppedBy === 'decision' && !result.years.length, 'the public advance must report the blocking decision');
        check(s.year === year && canonical(s.save()) === before, 'a blocked attempt must change neither state nor commands');
        check(s.order({ kind: 'bid', ceiling: 0 }).ok, 'a standing preference remains available while blocked');
      } },
      { name: 'answer and resume the year', act(s) {
        answerTutor(s);
        turn(s, 1);
        check(!s.pending.length, 'the chronicler must clear the docket');
      } },
    ],
  },
  {
    name: 'mystic-paid-practice',
    description: 'A learned reader keeps the larder: preparation, yearly upkeep and real food savings.',
    build(content) {
      const ctx = testWorld(content, 1937);
      ctx.world.treasury = 1000;
      const reader = place(ctx, { sex: 'female', age: 30, name: 'The larder keeper', awakened: true });
      reader.spellsKnown.push(asId('lesser_workings_of_death'));
      return ctx;
    },
    steps: [
      { name: 'pay preparation once', act(s) {
        const reader = s.view().halls.flatMap(h => h.members).find(p => p.name === 'The larder keeper');
        check(reader, 'the learned reader must be visible');
        const before = s.save().treasury;
        const order = { kind: 'mysticAssign', person: reader.id, working: 'the_still_larder', target: { kind: 'hall', hall: 'main' } } as const;
        check(s.order(order).ok, 'the learned reader must accept the duty');
        check(s.save().treasury === before - 3, 'preparation must charge exactly three crowns');
        const assigned = canonical(s.save());
        check(!s.order(order).ok, 'a duplicate duty must be refused');
        check(canonical(s.save()) === assigned, 'a refused duplicate must not charge or log an input');
        check(s.table().mystic.duties[0]?.service.servedYears === 0, 'preparation must provide no early benefit');
      } },
      { name: 'keep two paid years of provisions', act(s) {
        for (const years of [1, 2]) {
          turn(s, 1);
          const duty = s.table().mystic.duties.find(d => d.working === 'the_still_larder');
          check(duty?.status === 'serving', 'the reader must be serving');
          check(duty.service.servedYears === years, 'the duty must apply once per paid year');
          check(Math.abs(duty.service.spent - (3 + years * 0.4)) < 1e-9, 'only preparation and one upkeep per year may be charged');
          check((duty.service.crownsKept ?? 0) > 0, 'the economy must record actual provision savings');
          check((duty.service.crownsKept ?? 0) <= years * 8 * 0.3 + 1e-9, 'provision savings must respect the working cap');
          const saved = canonical(s.save());
          s.view(); s.table();
          check(canonical(s.save()) === saved, 'reading the duty must not apply or charge it again');
        }
      } },
    ],
  },
  {
    name: 'pending-arc-resume',
    description: '#1932: answer a saved tutor story once and deliver its consequence once.',
    build: content => pendingArc(content).ctx,
    steps: [
      { name: 'keep the offered cast and wording on the docket', act(s) {
        choiceOf(s);
        check(s.order({ kind: 'bid', ceiling: 0 }).ok, 'the checkpoint must follow a public command');
      } },
      { name: 'answer once and deliver the promised consequence', act(s) {
        const arcId = choiceOf(s).arcStep!.instance.id;
        answerTutor(s);
        const instance = s.ctx.world.arcs.get(arcId)!;
        check(instance.node === 'the_day_book' && instance.history.length === 1, 'the answer must advance the authoritative arc exactly once');
        turn(s, 4);
        const ended = s.ctx.world.arcs.get(arcId)!;
        check(ended.status === 'ended' && ended.history.length === 2, 'the follow-up must end the same arc exactly once');
        const outcomes = s.save().decisionLog.filter(d => d.kind === 'outcome');
        check(outcomes.filter(d => d.event === 'the_tutors_good_years').length === 1, 'the opening must commit once');
        check(outcomes.filter(d => d.event === 'the_heir_reads_the_tally').length === 1, 'the promised follow-up must commit once');
      } },
    ],
  },
];

export interface Difference { path: string; expected: unknown; actual: unknown }

/** Compare complete canonical saves, not only fingerprints. savedAt is removed
 * by canonical(); array positions and sorted object keys give stable paths.
 */
export function firstDifference(expected: unknown, actual: unknown, path = ''): Difference | undefined {
  if (Object.is(expected, actual)) return undefined;
  if (expected && actual && typeof expected === 'object' && typeof actual === 'object') {
    if (Array.isArray(expected) !== Array.isArray(actual)) return { path, expected, actual };
    const a = expected as Record<string, unknown>, b = actual as Record<string, unknown>;
    for (const key of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
      const next = Array.isArray(expected) ? `${path}[${key}]` : path ? `${path}.${key}` : key;
      if (Object.hasOwn(a, key) !== Object.hasOwn(b, key)) return { path: next, expected: a[key], actual: b[key] };
      const diff = firstDifference(a[key], b[key], next);
      if (diff) return diff;
    }
    return undefined;
  }
  return { path, expected, actual };
}

/** Walk each object once, recording additional paths to id-bearing objects.
 * This detects alias loss independently of equal JSON. Maps and Sets are live
 * world structures. Derived phenotype caches are rebuilt, not persisted, and
 * their references into the content/genetics tables are outside this contract.
 */
function objectPaths(root: unknown) {
  const paths = new Map<string, object>();
  const seen = new Set<object>();
  function visit(value: unknown, path: string) {
    if (!value || typeof value !== 'object') return;
    if ('id' in value && typeof value.id === 'string') paths.set(path, value);
    if (seen.has(value)) return;
    seen.add(value);
    if (value instanceof Map) {
      for (const [key, child] of value) visit(child, `${path}[${JSON.stringify(key)}]`);
    } else if (value instanceof Set) {
      [...value].forEach((child, i) => visit(child, `${path}[${i}]`));
    } else {
      for (const [key, child] of Object.entries(value)) {
        if (key === 'phenotype') continue;
        visit(child, Array.isArray(value) ? `${path}[${key}]` : path ? `${path}.${key}` : key);
      }
    }
  }
  visit(root, '');
  return paths;
}

export function assertSharedIdentity(original: unknown, restored: unknown): number {
  const before = objectPaths(original), after = objectPaths(restored);
  const first = new Map<object, string>();
  let checked = 0;
  for (const [path, object] of before) {
    const other = first.get(object);
    if (other === undefined) first.set(object, path);
    else {
      check(after.has(path) && after.get(path) === after.get(other), `shared identity lost: ${other} ↔ ${path}`);
      checked++;
    }
  }
  return checked;
}

export function assertSameWorld(expected: SimCtx, actual: SimCtx, context: string): void {
  const difference = firstDifference(JSON.parse(canonical(saveGame(expected))), JSON.parse(canonical(saveGame(actual))));
  if (difference) throw new Error(`${context}: first divergence at ${difference.path}: expected ${JSON.stringify(difference.expected)}, got ${JSON.stringify(difference.actual)}`);
  check(digestOf(expected) === digestOf(actual), `${context}: canonical saves match but digests differ`);
}

export interface ScenarioResult { name: string; transcript: string[]; digest: string; aliases: number; years: number }

/** Each fixture enters the public surface through saveGame → resumeGame. This
 * applies the save schema's projection (e.g. transient ArcStep.playerCast is
 * represented by the docket's cast requests). Identity is checked against the
 * original constructed world BEFORE that projection can hide an orphan.
 * Each checkpoint then compares uninterrupted, JSON-resumed and command-replay
 * legs. Constructed fixtures replace seed bootstrap only; replayInputs
 * independently regenerates and verifies every command's output, as replay()
 * does for full games. No scenario or dispatcher enters the client API.
 */
export function runScenario(scenario: Scenario, content: Content | ContentBundle, mode: ProseMode = 'original'): ScenarioResult {
  const built = scenario.build(content);
  const original = resumeGame(JSON.parse(JSON.stringify(saveGame(built))), content, { proseMode: mode });
  let aliases = assertSharedIdentity(built.world, original.ctx.world);
  let resumed = resumeGame(JSON.parse(JSON.stringify(original.save())), content, { proseMode: mode });
  const start = original.year;
  aliases += assertSharedIdentity(original.ctx.world, resumed.ctx.world);
  assertSameWorld(original.ctx, resumed.ctx, `${scenario.name}: initial load`);
  const transcript: string[] = [];
  for (const step of scenario.steps) {
    step.act(original);
    step.act(resumed);
    assertSameWorld(original.ctx, resumed.ctx, `${scenario.name}/${step.name}: continuation`);
    // replayInputs restores the reading mode from each recorded command; its
    // session must begin in the fixture's original mode, just as replay() does.
    const replaySession = resumeGame(JSON.parse(JSON.stringify(saveGame(scenario.build(content)))), content);
    const replayed = replaySession.ctx;
    try {
      replayInputs(replayed, original.ctx.world.decisionLog, start, original.year - start, replayed.content.proseVariants);
    } catch (error) {
      assertSameWorld(original.ctx, replayed, `${scenario.name}/${step.name}: replay (${String(error)})`);
      throw error;
    }
    assertSameWorld(original.ctx, replayed, `${scenario.name}/${step.name}: replay`);
    const loaded = resumeGame(JSON.parse(JSON.stringify(resumed.save())), content, { proseMode: mode });
    aliases += assertSharedIdentity(resumed.ctx.world, loaded.ctx.world);
    assertSameWorld(resumed.ctx, loaded.ctx, `${scenario.name}/${step.name}: checkpoint`);
    resumed = loaded;
    transcript.push(`${original.year}: ${step.name} — uninterrupted / JSON resume / command replay agree`);
  }
  check(original.year > start, 'a scenario must verify continuation across a year transition');
  return { name: scenario.name, transcript, digest: digestOf(original.ctx), aliases, years: original.year - start };
}

// The portable .mjs launcher supplies tsx. Importing the catalogue runs nothing.
if (process.argv[1]?.replace(/\\/g, '/').endsWith('/scenarios.ts')) {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--list') {
    for (const s of SCENARIOS) console.log(`${s.name}: ${s.description}`);
  } else {
    const selected = SCENARIOS.find(s => s.name === args[0]);
    if (args.length !== 1 || !selected) {
      console.error('Usage: npm run scenario -- --list | <name>');
      process.exitCode = 1;
    } else {
      try {
        const { loadContent } = await import('@ed/content');
        const result = runScenario(selected, loadContent());
        console.log(`${result.name}: PASS (${result.years} year${result.years === 1 ? '' : 's'}, ${result.aliases} shared identities checked)`);
        for (const line of result.transcript) console.log(`  ${line}`);
      } catch (error) {
        console.error(`${selected.name}: FAIL — ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
      }
    }
  }
}
