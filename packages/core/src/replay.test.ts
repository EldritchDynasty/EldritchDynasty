import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { pendingArc } from './fixtures/pending-arc.fixture.js';
import { isRegent } from './world.js';
import { assertSameWorld, assertSharedIdentity, firstDifference, runScenario, SCENARIOS } from './fixtures/scenarios.js';
import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { asId, LoggedDecisionS, SessionCommandS } from '@ed/schema';
import type { LoggedDecision, SessionCommand } from '@ed/schema';
import { canonical, digestOf, loadGame, saveGame } from './save.js';
import { describeDecision, replay, ReplayMismatchError } from './replay.js';
import { GameSession, newGame, resumeGame } from './session.js';
import { beginCommitment } from './muster.js';
import { place, testWorld } from './testing.js';
import { emptyReach, observeCheckedOutcome, observeGuardedOutcome } from './events/reach.js';

// Short spans and built state. Full campaigns remain in replay.slow.test.ts.
const content = loadContent();
const SEED = 1910;
const inputs = (s: GameSession) => s.ctx.world.decisionLog.filter(d => d.kind === 'command');
const snapshot = (s: GameSession) => canonical(s.save());
function rebuild(s: GameSession, log: readonly LoggedDecision[] = s.ctx.world.decisionLog, expected = digestOf(s.ctx)) {
  return replay(content, log, SEED, 1042, s.year - 1042, 'long', [], {
    expectedDigest: expected, origin: s.save().replayOrigin,
  });
}
function opening(s: GameSession) {
  s.advance(5);
  const d = s.pending.find(d => d.kind === 'choice' && d.event.id === 'the_tutors_good_years');
  if (!d || d.kind !== 'choice') throw new Error('The authored opening did not reach its question');
  return d;
}

describe('public session input replay (#1910)', () => {
  it('replays the exact page retained by a scheduled opening consequence (#1946)', () => {
    const s = newGame(content, { seed: SEED, decider: 'chronicler' });
    s.advance(8);
    const scheduled = s.ctx.world.scheduled.find(promise => promise.event === 'the_line_carried_forward');
    expect(scheduled?.cause?.page).toBeDefined();
    const parent = s.ctx.world.chronicle.find(page => page.id === scheduled!.cause!.page);
    expect(parent?.year).toBe(scheduled!.cause!.year);
    const resumed = resumeGame(JSON.parse(JSON.stringify(s.save())), content);
    expect(resumed.ctx.world.scheduled).toEqual(s.ctx.world.scheduled);
    expect(digestOf(rebuild(resumed))).toBe(digestOf(s.ctx));
  });

  it('replays a forcing order answered after saving its preset cast (#1951)', () => {
    let s = newGame(content, { seed: SEED });
    const rite = s.table().forcing.find(row => row.ready && row.boys.length)!;
    expect(rite).toBeDefined();
    expect(s.order({ kind: 'forcingRite', rite: rite.rite, person: rite.boys[0]!.person }).ok).toBe(true);
    const saved = s.save();
    s = resumeGame(JSON.parse(JSON.stringify(saved)), content);
    expect(snapshot(s)).toBe(canonical(saved));
    const pending = s.pending.find(decision => decision.kind === 'choice' && decision.event.id === rite.rite)!;
    if (pending.kind !== 'choice') throw new Error('forcing choice required');
    expect(pending.preset).toEqual(['CHILD']);
    const presets: (readonly string[] | undefined)[] = [];
    s.ctx.observeOutcome = observation => presets.push(observation.preset);
    expect(s.choose(pending.id, pending.choices.find(choice => choice.available)!.id).ok).toBe(true);
    expect(presets[0]).toEqual(['CHILD']);
    s.letHimDecide();
    s.decider = 'chronicler';
    s.advance(1);
    expect(canonical(saveGame(rebuild(s)))).toBe(snapshot(s));
  });

  it('preserves the complete public-session save and replay with reach observation (#1930)', () => {
    const play = (observed: boolean) => {
      const s = newGame(content, { seed: SEED, decider: 'chronicler' });
      const into = emptyReach();
      if (observed) s.ctx.observeOutcome = observation => {
        observeGuardedOutcome(s.ctx, observation, into);
        observeCheckedOutcome(s.ctx, observation, into);
      };
      const pupil = s.table().pupils[0]!;
      expect(s.order({ kind: 'tutor', person: pupil.person, attr: 'mind' }).ok).toBe(true);
      s.advance(9);
      expect(canonical(saveGame(rebuild(s)))).toBe(snapshot(s));
      if (observed) expect(into.guarded!.expected.size).toBeGreaterThan(0);
      return snapshot(s);
    };
    expect(play(true)).toBe(play(false));
  });

  it('reconstructs paid Table orders, policy and ambition through the same public verbs', () => {
    const s = newGame(content, { seed: SEED, decider: 'chronicler' });
    const pupil = s.table().pupils[0]!;
    expect(s.order({ kind: 'tutor', person: pupil.person, attr: 'mind' }).ok).toBe(true);
    expect(s.order({ kind: 'bid', ceiling: 73 }).ok).toBe(true);
    expect(s.order({ kind: 'marriages', policy: 'out' }).ok).toBe(true);
    expect(s.setAmbition('secure_branches')).toBe(true);
    s.advance(3);
    const after = rebuild(s);
    expect(digestOf(after)).toBe(digestOf(s.ctx));
    expect(after.world.treasury).toBe(s.ctx.world.treasury);
    expect(after.world.tutoring).toEqual(s.ctx.world.tutoring);
    expect(inputs(s).map(d => d.command.kind)).toEqual(['order', 'order', 'order', 'setAmbition', 'advance']);
    expect(inputs(s).at(-1)!.command).toMatchObject({ kind: 'advance', years: 3, decider: 'chronicler' });
  });

  it('preserves deferred ask timing, a manual answer and a pending follow-up across reload', () => {
    let s = newGame(content, { seed: SEED });
    const d = opening(s);
    expect(s.year).toBe(1043);
    expect(inputs(s)[0]!.command).toEqual({ kind: 'advance', years: 5, decider: 'ask' });
    // A blocked clock attempt contributes no input or hidden simulation work.
    const before = snapshot(s);
    expect(s.advance(8).years).toEqual([]);
    expect(snapshot(s)).toBe(before);
    // #1932: reload while the arc choice is still pending, so its answer must
    // advance the same authoritative instance that uninterrupted replay uses.
    s = resumeGame(JSON.parse(JSON.stringify(s.save())), content);
    const choice = d.choices.filter(c => c.available).at(-1)!;
    expect(s.choose(d.id, choice.id).ok).toBe(true);
    expect(digestOf(rebuild(s))).toBe(digestOf(s.ctx));
    s = resumeGame(JSON.parse(JSON.stringify(s.save())), content);
    s.letHimDecide();
    s.advance(2);
    expect(digestOf(rebuild(s))).toBe(digestOf(s.ctx));
    expect(rebuild(s).world.pendingDecisions).toEqual(s.ctx.world.pendingDecisions);
  });

  it('replays delegation changes and handing the current docket back to the chronicler', () => {
    const s = newGame(content, { seed: SEED });
    const d = opening(s);
    s.delegateChoice(d.event.id, d.choices.find(c => c.available)!.id);
    s.delegateRecord(d.event.id, 'record');
    s.letHimDecide();
    s.delegateChoice(d.event.id, null);
    s.delegateRecord(d.event.id, null);
    s.decider = 'chronicler';
    s.advance(3);
    expect(digestOf(rebuild(s))).toBe(digestOf(s.ctx));
    expect(s.ctx.world.delegation).toEqual({ choices: {}, records: {} });
  });

  it.each(['original', 'plainenglish'] as const)('preserves saved words and later reading switches from %s', mode => {
    const s = newGame(content, { seed: SEED, decider: 'chronicler', proseMode: mode });
    s.setProseMode(mode === 'original' ? 'plainenglish' : 'original');
    expect(s.order({ kind: 'bid', ceiling: 17 }).ok).toBe(true);
    s.advance(3);
    s.setProseMode(mode);
    s.advance(2);
    const after = rebuild(s);
    expect(after.world.chronicle).toEqual(s.ctx.world.chronicle);
    expect(digestOf(after)).toBe(digestOf(s.ctx));
  });

  it('preserves signing inputs when founding changes who carried the blood', () => {
    const s = newGame(content, { seed: SEED, proseMode: 'plainenglish', decider: 'chronicler' });
    expect(s.found({ houseName: 'The House of Wren', heirloom: 'portion_of_agelessness', grudge: 'house_marrow', friends: [],
      founder: { name: 'Wren', gender: 'woman', configuration: 'blood_mother' } }).ok).toBe(true);
    s.order({ kind: 'bid', ceiling: 9 });
    s.advance(2);
    expect(digestOf(rebuild(s))).toBe(digestOf(s.ctx));
  });

  it('accepts the original host catalogue as a replay input without logging presentation-only calls', () => {
    const proseVariants = content.proseVariants.map(row => ({ ...row, plainenglish: row.plainenglish + ' [catalogue]' }));
    const s = newGame(content, { seed: SEED, decider: 'chronicler', proseMode: 'plainenglish', proseVariants });
    s.order({ kind: 'bid', ceiling: 19 });
    s.advance(2);
    const after = replay(content, s.ctx.world.decisionLog, SEED, 1042, s.year - 1042, 'long', [], {
      expectedDigest: digestOf(s.ctx), proseVariants,
    });
    expect(after.world.chronicle).toEqual(s.ctx.world.chronicle);
    expect(s.ctx.world.chronicle.some(page => page.text?.includes('[catalogue]'))).toBe(true);
  });

  it('preserves fallback words written before an asynchronous catalogue arrived', () => {
    const s = newGame(content, { seed: SEED, decider: 'chronicler', proseMode: 'plainenglish', proseVariants: [] });
    s.order({ kind: 'bid', ceiling: 11 });
    s.advance(2);
    s.setProseVariants(content.proseVariants);
    s.advance(2);
    const after = rebuild(s);
    expect(after.world.chronicle).toEqual(s.ctx.world.chronicle);
  });

  it('retains initial wording when saved and resumed before the first input', () => {
    let s = newGame(content, { seed: SEED, proseMode: 'plainenglish', decider: 'chronicler' });
    expect(digestOf(rebuild(s))).toBe(digestOf(s.ctx));
    const saved = JSON.parse(JSON.stringify(s.save()));
    expect(saved.replayOrigin).toEqual({ proseMode: 'plainenglish' });
    const loaded = loadGame(saved, content);
    expect(canonical(saveGame(loaded))).toBe(canonical(saved));
    s = resumeGame(saved, content, { proseMode: 'original', decider: 'chronicler' });
    s.order({ kind: 'bid', ceiling: 5 });
    s.advance(2);
    expect(digestOf(rebuild(s))).toBe(digestOf(s.ctx));
  });

  it('leaves the entire save untouched on refused requests and empty acknowledgements', () => {
    const s = newGame(content, { seed: SEED });
    const before = snapshot(s);
    expect(s.order({ kind: 'study', person: 'absent', book: 'absent' }).ok).toBe(false);
    expect(s.order({ kind: 'bid', ceiling: NaN }).ok).toBe(false);
    expect(s.muster({ op: 'withdraw' }).ok).toBe(false);
    expect(s.choose('absent', 'absent').ok).toBe(false);
    expect(s.send('absent').ok).toBe(false);
    expect(s.record('absent', 'omit').ok).toBe(false);
    expect(s.match('absent', 'absent').ok).toBe(false);
    expect(s.declineHand('absent')).toBe(false);
    expect(s.name('absent', 'Linn')).toBe(false);
    expect(s.nameParcel('absent', 'Linn')).toBe(false);
    expect(s.keepSuggestedName('absent')).toBe(false);
    s.keepSuggestedNames();
    s.letHimDecide();
    s.delegateChoice('absent', null);
    s.delegateRecord('absent', null);
    expect(s.advance(0).years).toEqual([]);
    expect(snapshot(s)).toBe(before);
  });

  it('owns nested caller payloads and persists them independently of live assignments', () => {
    const ctx = testWorld(content, SEED);
    ctx.world.treasury = 500;
    const reader = place(ctx, { sex: 'female', age: 30, awakened: true });
    reader.spellsKnown.push(asId('lesser_workings_of_life'));
    const s = new GameSession(ctx);
    const request = { kind: 'mysticAssign', person: reader.id, working: 'sickroom_watch',
      target: { kind: 'hall', hall: 'main' }, bindings: {} } as const;
    expect(s.order(request).ok).toBe(true);
    const original = structuredClone(inputs(s)[0]);
    (request.target as { hall: string }).hall = 'elsewhere';
    (request.bindings as Record<string, string>).WARD = 'changed';
    expect(inputs(s)[0]).toEqual(original);
    const saved = s.save();
    expect(LoggedDecisionS.safeParse(saved.decisionLog[0]).success).toBe(true);
    const after = loadGame(saved, content);
    after.world.mystic.assignments[0]!.bindings.WARD = 'later';
    expect(after.world.decisionLog[0]).toEqual(original);
    expect(saved.decisionLog[0]).toEqual(original);
  });

  it('does not materialize a body in the save when an eligibility check refuses the order', () => {
    const ctx = testWorld(content, SEED);
    const p = place(ctx, { sex: 'male', age: 30, awakened: true });
    const book = ctx.content.spellbooks.find(book => book.threshold > 0)!;
    p.acquired[book.affinity] = -1000;
    ctx.world.library.set(book.id, { id: book.id, acquiredYear: ctx.world.year, condition: 100 });
    const s = new GameSession(ctx);
    expect(p.genome.kind).toBe('lazy');
    const before = snapshot(s);
    expect(s.order({ kind: 'study', person: p.id, book: book.id }).ok).toBe(false);
    expect(snapshot(s)).toBe(before);
  });

  it('records the final closing, but repeated attempts to turn a closed clock do not change the save', () => {
    const s = new GameSession(testWorld(content, SEED, 1542));
    s.advance();
    expect(s.ctx.world.ending).toBeDefined();
    expect(inputs(s)).toHaveLength(1);
    const before = snapshot(s);
    s.advance(3);
    expect(snapshot(s)).toBe(before);
  });

  it('records accepted Muster orders and keeps refused ones out of the log', () => {
    const ctx = testWorld(content, SEED);
    const c = beginCommitment(ctx, 5, 'the_wars');
    const s = new GameSession(ctx);
    expect(s.muster({ op: 'reinforce', men: 2 }).ok).toBe(true);
    expect(s.muster({ op: 'buy', position: 'none' }).ok).toBe(true);
    expect(s.muster({ op: 'withdraw' }).ok).toBe(true);
    const before = snapshot(s);
    expect(s.muster({ op: 'reinforce', men: 1 }).ok).toBe(false);
    expect(snapshot(s)).toBe(before);
    expect(c.status).toBe('withdrawn');
    expect(inputs(s).map(d => d.command)).toEqual([
      { kind: 'muster', order: { op: 'reinforce', men: 2 } },
      { kind: 'muster', order: { op: 'buy', position: 'none' } },
      { kind: 'muster', order: { op: 'withdraw' } },
    ]);
  });

  it('records names before their existing output, and records individual/all naming acknowledgements', () => {
    const ctx = testWorld(content, SEED);
    const s = new GameSession(ctx);
    const children = ['Linn', 'Maud', 'Wren'].map(name => place(ctx, { sex: 'female', age: 0, name }));
    for (const child of children) ctx.world.pendingNames.push({ person: child.id, born: ctx.world.year,
      suggested: child.name, sex: child.sex, because: 'test naming offer' });
    expect(s.name(children[0]!.id, 'Anwen')).toBe(true);
    expect(s.keepSuggestedName(children[1]!.id)).toBe(true);
    s.keepSuggestedNames();
    expect(ctx.world.pendingNames).toEqual([]);
    expect(ctx.world.decisionLog.map(d => d.kind)).toEqual(['command', 'name', 'command', 'command']);
  });

  it('read-only and prose operations never add simulation inputs', () => {
    const s = newGame(content, { seed: SEED });
    const before = snapshot(s);
    s.view(); s.table(); s.land(); s.book(); s.line(); s.prologue();
    s.setProseMode('plainenglish'); s.setProseVariants(content.proseVariants);
    expect(snapshot(s)).toBe(before);
  });

  it('keeps a fresh read model identical across JSON save/reload', () => {
    const s = newGame(content, { seed: SEED });
    const before = s.view();
    const after = resumeGame(JSON.parse(JSON.stringify(s.save())), content);
    expect(after.view()).toEqual(before);
  });

  it.each(['male', 'female'] as const)('retains a lazy %s body\'s authored bias across an opaque save', sex => {
    const ctx = testWorld(content, SEED);
    const p = place(ctx, { sex, age: 25 });
    if (p.genome.kind !== 'lazy') throw new Error('The placed body must remain lazy for this witness');
    p.genome.bias = { strength: 20, longevity: 10 };
    const s = new GameSession(ctx);
    const before = s.view();
    const saved = s.save();
    const stored = saved.people.find(person => person.id === p.id)!.genome;
    expect(stored).toMatchObject({ kind: 'lazy', bias: { strength: 20, longevity: 10 } });
    const after = resumeGame(JSON.parse(JSON.stringify(saved)), content);
    expect(after.view()).toEqual(before);
    expect(digestOf(after.ctx)).toBe(digestOf(ctx));
    if (stored.kind !== 'lazy' || !stored.bias) throw new Error('The save must retain the lazy bias');
    stored.bias.strength = 99;
    expect(p.genome.bias.strength).toBe(20);
  });

  it('rejects malformed, refused, wrongly dated and out-of-horizon inputs', () => {
    const s = newGame(content, { seed: SEED, decider: 'chronicler' });
    s.order({ kind: 'bid', ceiling: 73 });
    s.advance(2);
    const tamper = (edit: (rows: LoggedDecision[]) => void) => {
      const rows = structuredClone(s.ctx.world.decisionLog);
      edit(rows);
      expect(() => rebuild(s, rows)).toThrow(ReplayMismatchError);
    };
    tamper(rows => { (rows[0] as { year: number }).year -= 1; });
    tamper(rows => { (rows[0] as { year: number }).year = 1100; });
    tamper(rows => { (rows[0] as { command: unknown }).command = { kind: 'absent' }; });
    tamper(rows => { Object.assign(rows[0]!, { initialProseMode: 'absent' }); });
    tamper(rows => { (rows[0] as { command: unknown }).command = { kind: 'muster', order: { op: 'withdraw' } }; });
    tamper(rows => { (rows[1] as { command: unknown }).command = { kind: 'advance', years: 100, decider: 'chronicler' }; });
    // A different valid bid can have no later output to contradict it. The
    // expected final-save fingerprint detects that altered external input.
    tamper(rows => { (rows[0] as { command: unknown }).command = { kind: 'order', order: { kind: 'bid', ceiling: 74 } }; });
  });

  it('describes each recorded input and validates its closed vocabulary', () => {
    const command: SessionCommand = { kind: 'order', order: { kind: 'bid', ceiling: 7 } };
    expect(SessionCommandS.safeParse(command).success).toBe(true);
    expect(SessionCommandS.safeParse({ kind: 'order', order: { kind: 'absent' } }).success).toBe(false);
    expect(describeDecision({ kind: 'command', year: 1042, command })).toBe('1042  input order');
  });
});

describe('named public-session scenarios (#1937)', () => {
  it('keeps the constructed-state runner outside the public barrel', async () => {
    const core = await import('@ed/core');
    expect(core).not.toHaveProperty('replayInputs');
    expect(core).not.toHaveProperty('SCENARIOS');
    expect(core).not.toHaveProperty('runScenario');
  });

  for (const scenario of SCENARIOS) {
    it.each(['original', 'plainenglish'] as const)(`${scenario.name} continues through JSON resume and command replay in %s`, mode => {
      const result = runScenario(scenario, content, mode);
      expect(result.years).toBeGreaterThan(0);
      expect(result.transcript).toHaveLength(scenario.steps.length);
      if (scenario.name === 'pending-arc-resume') expect(result.aliases).toBeGreaterThan(0);
    });
  }

  it('keeps the founder charter distinct from a later female successor', () => {
    const s = newGame(content, { seed: 1937 });
    expect(s.found({ houseName: 'The House of Wren', heirloom: 'portion_of_agelessness', grudge: 'house_marrow', friends: [],
      founder: { name: 'Wren', gender: 'woman', configuration: 'blood_mother' } }).ok).toBe(true);
    const founder = s.ctx.world.people.mustGet(s.ctx.world.narrator!);
    expect(founder.sex).toBe('female');
    expect(founder.castSlots).toContain('head');
    expect(isRegent(s.ctx.world, founder)).toBe(false);
    expect(s.view().halls.flatMap(h => h.members).find(p => p.head)?.name).toBe('Wren');
  });

  it('detects an orphaned arc even when every saved value is equal', () => {
    const { ctx } = pendingArc(content);
    const restored = loadGame(JSON.parse(JSON.stringify(saveGame(ctx))), content);
    expect(assertSharedIdentity(ctx.world, restored.world)).toBeGreaterThan(0);
    const before = canonical(saveGame(restored));
    const pending = restored.world.pendingDecisions[0]!;
    if (pending.kind !== 'choice') throw new Error('expected the fixture choice');
    pending.arcStep!.instance = structuredClone(pending.arcStep!.instance);
    expect(canonical(saveGame(restored))).toBe(before);
    expect(() => assertSharedIdentity(ctx.world, restored.world))
      .toThrow(/shared identity lost:.*arcs.*pendingDecisions\[0\].arcStep.instance/);
  });

  it('finds arbitrary id-bearing aliases through nested objects, arrays and Maps', () => {
    const shared = { id: 'next-shared-object', count: 1 };
    const original = { index: new Map([['one', shared]]), queue: [{ nested: shared }] };
    const restored = structuredClone(original);
    expect(assertSharedIdentity(original, restored)).toBe(1);
    restored.queue[0]!.nested = { ...shared };
    expect(() => assertSharedIdentity(original, restored)).toThrow(/index\["one"\].*queue\[0\].nested/);
  });

  it('reports the first meaningful path in a full canonical save', () => {
    const { ctx } = pendingArc(content);
    const restored = loadGame(JSON.parse(JSON.stringify(saveGame(ctx))), content);
    restored.world.arcs.values().next().value!.node = 'another_node';
    expect(() => assertSameWorld(ctx, restored, 'continuation')).toThrow(/first divergence at arcs\[0\]\[1\].node/);
    expect(firstDifference({ a: [] }, { a: {} })?.path).toBe('a');
    expect(firstDifference({ a: undefined }, {})?.path).toBe('a');
    expect(firstDifference({ a: [1, 2] }, { a: [1, 3] })).toEqual({ path: 'a[1]', expected: 2, actual: 3 });
  });

  it('replay checks regenerated output rather than copying the recorded log', () => {
    const fixture = SCENARIOS.find(s => s.name === 'docket-blocks-clock')!;
    let builds = 0;
    expect(() => runScenario({ ...fixture, build(source) {
      const ctx = fixture.build(source);
      // The second build is the replay leg; resume uses the original save.
      // Change its world; a copied log alone could still match.
      if (++builds === 2) ctx.world.treasury += 1;
      return ctx;
    } }, content)).toThrow(/replay.*first divergence at treasury/);
  });

  it('lists and executes the same catalogue through the portable launcher', () => {
    const root = fileURLToPath(new URL('../../../', import.meta.url));
    const cli = fileURLToPath(new URL('../../../tools/scenario.mjs', import.meta.url));
    const listed = spawnSync(process.execPath, [cli, '--list'], { cwd: root, encoding: 'utf8' });
    expect(listed.status, listed.stderr).toBe(0);
    for (const scenario of SCENARIOS) expect(listed.stdout).toContain(`${scenario.name}:`);
    const executed = spawnSync(process.execPath, [cli, 'pending-arc-resume'], { cwd: root, encoding: 'utf8' });
    expect(executed.status, executed.stderr).toBe(0);
    expect(executed.stdout).toContain('pending-arc-resume: PASS');
    const invalid = spawnSync(process.execPath, [cli, 'missing-scenario'], { cwd: root, encoding: 'utf8' });
    expect(invalid.status).toBe(1);
    expect(invalid.stderr).toContain('Usage: npm run scenario');
  });
});
