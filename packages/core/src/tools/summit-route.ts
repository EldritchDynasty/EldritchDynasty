/**
 * #1978 step 4: the summit route, played through the public session.
 *
 * Run with
 *   npm run report:summit-route -- [runs=24] [seedBase=197800] [output.json] [--unsigned] [--ascendant]
 *
 * Every other ladder measurement (`ending-gate.ts`'s `ascendant`,
 * `ladder-gate.ts`) drives the simulation from inside: it writes
 * `world.scion`, calls `resolveChoice` on its own RNG salt, and turns the year
 * with `stepYear`. Those runs say how often a house pulling every lever gets
 * to the top. They do not show that a PLAYER can, because no player has
 * those calls.
 *
 * This file plays the same composite policy with only the verbs the shipped
 * client has: `found`, `order`, `choose`, `record`, `letHimDecide` and
 * `advance` on a `GameSession` opened with `decider: 'ask'`. The policy may
 * READ the world to decide what to ask for — that is how it is the same
 * policy as `ascendant` — but every change to the world is one of those
 * logged session commands, so the saved command log is a route a person at
 * the client could type in. `routeIsPublic` checks that claim against the
 * save rather than trusting this comment.
 *
 * What it is not: a rate. One route on one seed proves the route exists on
 * that content revision. The ending gate's ascendant column remains the rate
 * evidence, and human comprehension remains unmeasured.
 */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { loadContent } from '@ed/content';
import {
  indexContent, type Content, type ContentBundle, type EndingId, type Rung, type SavedGame,
} from '@ed/schema';
import { ascensionBlockersFor, foremostOf, rungIndex, type LadderBlocker } from '../ascension.js';
import { CAMPAIGNS } from '../campaign.js';
import type { PendingChoice, PendingDecision } from '../events/decisions.js';
import { heldBooks } from '../people/library.js';
import { replay } from '../replay.js';
import { canonical, digestOf } from '../save.js';
import { newGame, type GameSession } from '../session.js';
import type { TableOrder } from '../table.js';
import {
  costsTheClimber, ladderCast, nameScion, nameScionHeir, recordOptionForPolicy, unmakingReadyForAscendant,
} from './ladder-policy.js';

type Source = Content | ContentBundle;

/** `ending-gate.ts`'s ascendant ceiling: above Marrow's 800-crown Death bid. */
export const ROUTE_BID_CEILING = 1000;
/** `prepareAscendantYear`'s reserve before it seeks a missing-affinity book. */
const SEEK_BOOK_RESERVE = 600;
/** The docket can chain (a rite queues its Record). The bots stop at 200 too. */
const DOCKET_GUARD = 200;

/**
 * `ascendant` is `ending-gate.ts`'s composite policy, sent as public verbs.
 * `summit` is the same until the house first stands on God, then keeps the
 * book: the reckoning reads the Chronicle, not the house (§6/§29.3), and an
 * open embellished lie withholds rungs. Measured on seed 198258 before this
 * rule existed, the ascendant house reached God in 1401 and went on
 * embellishing its Record lever and calling rites; at the term it held 15
 * unsupportable entries against a Long-Line allowance of 9 and was read as
 * Demigod — Devoured. So once God is reached, `summit` (a) answers every
 * Record block truthfully, (b) calls no further rite, and (c) takes an
 * offered option that buries an open lie.
 */
export type RoutePolicy = 'ascendant' | 'summit';

/** One ladder-relevant public act, for the written route. */
export interface RouteAct {
  year: number;
  verb: 'found' | 'order' | 'choose' | 'record';
  /** The order kind, the event id, or the Record option. */
  what: string;
  /** Who it named, where it named anyone. */
  person?: string;
  ok: boolean;
  reason?: string;
}

/**
 * #1978 step 1: the joint summit diagnosis, read every year from the same
 * ordered predicates `standingOf` uses (`ascensionBlockersFor`), never from a
 * first blocker alone. Two populations, because they answer different
 * questions: the foremost man in late-game years (best rung Demigod or
 * above), and every living Unmaking recipient — the only people the God
 * gate can ever pass for.
 */
export interface SummitDiagnosis {
  /** Years the house's best-ever rung was Demigod or higher and somebody stood foremost. */
  lateYears: number;
  /** In those years, how often each God prerequisite was unmet for the foremost man. */
  lateBlockers: Partial<Record<LadderBlocker, number>>;
  /** Living-recipient years after a successful Unmaking. */
  recipientYears: number;
  recipientBlockers: Partial<Record<LadderBlocker, number>>;
  /** Recipient-years with exactly one unmet God prerequisite, by which one. */
  recipientSole: Partial<Record<LadderBlocker, number>>;
  /** Recipient-years with every God prerequisite met (the rung was reachable that year). */
  recipientClear: number;
}

export function emptyDiagnosis(): SummitDiagnosis {
  return { lateYears: 0, lateBlockers: {}, recipientYears: 0, recipientBlockers: {}, recipientSole: {}, recipientClear: 0 };
}

/** Run `read` without letting it materialise a lazy genome: `GameSession`'s own read-model rule. */
function peek<T>(s: GameSession, read: () => T): T {
  const lazy = s.ctx.world.people.all().filter(p => p.genome.kind === 'lazy').map(p => ({ p, genome: p.genome }));
  try { return read(); } finally { for (const { p, genome } of lazy) p.genome = genome; }
}

function observe(s: GameSession, d: SummitDiagnosis): void {
  peek(s, () => {
    const w = s.ctx.world;
    const bump = (into: Partial<Record<LadderBlocker, number>>, k: LadderBlocker) => { into[k] = (into[k] ?? 0) + 1; };
    const foremost = foremostOf(s.ctx);
    if (foremost && rungIndex(w.ascension.best) >= rungIndex('demigod')) {
      d.lateYears++;
      for (const b of ascensionBlockersFor(s.ctx, foremost.person, 'god')) bump(d.lateBlockers, b);
    }
    for (const p of w.people.household(w.playerHouse, w.year)) {
      if (p.status !== 'alive' || !p.rites.includes('unmaking')) continue;
      const blockers = ascensionBlockersFor(s.ctx, p, 'god');
      d.recipientYears++;
      for (const b of blockers) bump(d.recipientBlockers, b);
      if (blockers.length === 1) bump(d.recipientSole, blockers[0]!);
      if (!blockers.length) d.recipientClear++;
    }
  });
}

export interface RouteRun {
  seed: number;
  signed: boolean;
  policy: RoutePolicy;
  ending?: EndingId;
  endYear: number;
  best: Rung;
  reachedAt: Partial<Record<Rung, number>>;
  clauses: number;
  respect: string;
  /** The ladder acts in order: Scion/Heir naming, rites, ladder bargains, Record lever. */
  acts: RouteAct[];
  diagnosis: SummitDiagnosis;
  /** Every accepted session command, by kind. */
  commands: Record<string, number>;
  fullSaveHash: string;
}

/** The founding a first-time player gets by accepting each offered default. */
function sign(s: GameSession, content: Content): RouteAct {
  const prologue = content.prologue;
  const heirloom = prologue?.heirlooms[0];
  const grudge = prologue?.grudges[0];
  if (!prologue || !heirloom || !grudge) throw new Error('the bundle has no signable prologue');
  const answers = Object.fromEntries(prologue.examination.map(q => [q.id, q.answers[0]!.id]));
  const result = s.found({ houseName: 'House Gearithy', heirloom: String(heirloom.heirloom), grudge: String(grudge.house), answers });
  return { year: s.year, verb: 'found', what: 'signing', ok: result.ok, ...(result.ok ? {} : { reason: result.reason }) };
}

/**
 * Who the ascendant policy would name, computed by the shared rule and then
 * put back. The rule (`nameScion`/`nameScionHeir`) assigns directly, so it is
 * run against the live world and immediately reverted; the only change that
 * survives is the public `order` the caller sends afterwards.
 */
export function wantedPair(s: GameSession): { scion: string | null; heir: string | null } {
  return peek(s, () => wantedPairNow(s));
}

function wantedPairNow(s: GameSession): { scion: string | null; heir: string | null } {
  const w = s.ctx.world;
  const before = { scion: w.scion, heir: w.scionHeir };
  try {
    nameScion(s.ctx);
    const scion = w.scion ?? null;
    nameScionHeir(s.ctx, true);
    return { scion, heir: w.scionHeir ?? null };
  } finally {
    w.scion = before.scion;
    w.scionHeir = before.heir;
  }
}

function act(s: GameSession, acts: RouteAct[], o: TableOrder, person?: string): boolean {
  const result = s.order(o);
  acts.push({ year: s.year, verb: 'order', what: o.kind, ...(person ? { person } : {}), ok: result.ok,
    ...(!result.ok && 'reason' in result && result.reason ? { reason: String(result.reason) } : {}) });
  return result.ok;
}

/** `prepareAscendantYear`, as orders. */
function prepare(s: GameSession, acts: RouteAct[]): void {
  const w = s.ctx.world;
  const want = wantedPair(s);
  if (want.scion && want.scion !== w.scion) act(s, acts, { kind: 'scion', person: want.scion }, want.scion);
  if (want.heir && want.heir !== w.scionHeir && want.heir !== w.scion) {
    act(s, acts, { kind: 'scionHeir', person: want.heir }, want.heir);
  }
  if (s.table().treasury < SEEK_BOOK_RESERVE) return;
  const onShelf = new Set(peek(s, () => heldBooks(s.ctx)).map(b => s.ctx.content.spellbook(b.id)?.affinity));
  const missing = s.ctx.content.spellbooks.find(b => b.tier === 'minor' && !onShelf.has(b.affinity)
    && !w.auction.upcoming.some(lot => lot.kind === 'spellbook' && lot.refId === b.id));
  if (missing) s.order({ kind: 'seekBook', book: missing.id });
}

/** `answer` from `ladder-policy.ts`, sent as a public `choose`. */
function ladderBargain(s: GameSession, pending: PendingChoice, acts: RouteAct[]): boolean {
  if (!pending.choicesAreOpen) return false;
  const open = pending.choices.filter(c => c.available);
  const costly = open.filter(c => costsTheClimber(pending, c.id));
  if (!costly.length) return false;
  const postpone = pending.event.id === 'the_unmaking'
    && (s.ctx.world.ascension.best === 'god' || !peek(s, () => unmakingReadyForAscendant(s.ctx)));
  const want = postpone ? open.find(c => !costsTheClimber(pending, c.id)) : costly[0];
  if (!want) return false;
  const cast = peek(s, () => ladderCast(s.ctx, pending));
  const result = s.choose(pending.id, want.id, cast);
  const named = Object.values(cast).flat().filter((v): v is string => typeof v === 'string');
  acts.push({ year: s.year, verb: 'choose', what: `${pending.event.id}:${want.id}`,
    ...(named.length ? { person: named.join('+') } : {}), ok: result.ok });
  return result.ok;
}

/** Has the house stood on God, so that `summit` now keeps the book? */
function keepingTheBook(s: GameSession, policy: RoutePolicy): boolean {
  return policy === 'summit' && s.ctx.world.ascension.best === 'god';
}

/** An offered option whose outcomes bury an open lie (`discrepancy: bury`). */
export function buryOption(pending: PendingChoice): string | undefined {
  if (!pending.choicesAreOpen || pending.event.interaction.kind === 'narration') return undefined;
  const offered = new Set(pending.choices.filter(c => c.available).map(c => c.id));
  return pending.event.interaction.choices.find(c => offered.has(c.id) && c.outcomes.length > 0
    && c.outcomes.every(o => o.effects.some(f => f.kind === 'discrepancy' && f.op === 'bury')))?.id;
}

function bury(s: GameSession, pending: PendingChoice, acts: RouteAct[]): boolean {
  const choice = buryOption(pending);
  if (!choice) return false;
  const result = s.choose(pending.id, choice, peek(s, () => ladderCast(s.ctx, pending)));
  acts.push({ year: s.year, verb: 'choose', what: `${pending.event.id}:${choice}`, ok: result.ok });
  return result.ok;
}

/** `resolveYear(…, 'ascendant')`, with the chronicler's share handed back through `letHimDecide`. */
function answerDocket(s: GameSession, acts: RouteAct[], policy: RoutePolicy): void {
  for (let guard = 0; s.pending.length && guard < DOCKET_GUARD; guard++) {
    const pending: PendingDecision[] = s.pending;
    const keeping = keepingTheBook(s, policy);
    const bargain = pending.find((d): d is PendingChoice => d.kind === 'choice'
      && ((keeping && bury(s, d as PendingChoice, acts)) || ladderBargain(s, d as PendingChoice, acts)));
    if (bargain) continue;
    const option = keeping ? 'record' : recordOptionForPolicy(s.ctx, 'ascendant');
    const record = option ? pending.find(d => d.kind === 'record') : undefined;
    if (record && option) {
      const result = s.record(record.id, option);
      acts.push({ year: s.year, verb: 'record', what: option, ok: result.ok });
      if (result.ok) continue;
    }
    s.letHimDecide();
  }
}

/** The rite orders and the archival search, after the docket — `resolveAscendantYear`. */
function callRites(s: GameSession, acts: RouteAct[], policy: RoutePolicy): void {
  const w = s.ctx.world;
  for (const kind of keepingTheBook(s, policy) ? [] : ['vesselRite', 'greatRite', 'unmaking'] as const) {
    if (kind === 'unmaking' && (w.ascension.best === 'god' || !peek(s, () => unmakingReadyForAscendant(s.ctx)))) continue;
    // A refused rite order is the ordinary state of most years. Keep only the
    // calls that opened a scene; the save's command log keeps the rest.
    if (!s.order({ kind }).ok) continue;
    acts.push({ year: s.year, verb: 'order', what: kind, ok: true });
    answerDocket(s, acts, policy);
    break;
  }
  s.order({ kind: 'seekClause' });
}

export function playSummitRoute(
  source: Source, seed: number, opts: { signed?: boolean; years?: number; policy?: RoutePolicy } = {},
): RouteRun & { saved: SavedGame; digest: string } {
  const content = indexContent(source);
  const signed = opts.signed ?? true;
  const policy = opts.policy ?? 'summit';
  const s = newGame(content, { seed, campaign: 'long', decider: 'ask' });
  const acts: RouteAct[] = [];
  if (signed) {
    const founding = sign(s, content);
    acts.push(founding);
    if (!founding.ok) throw new Error(`seed ${seed}: the signing was refused: ${founding.reason}`);
  }
  act(s, acts, { kind: 'marriages', policy: 'in' });
  act(s, acts, { kind: 'bid', ceiling: ROUTE_BID_CEILING });
  const diagnosis = emptyDiagnosis();
  const years = opts.years ?? CAMPAIGNS.long.years;
  // One call past the term: `stepYear` closes the Ledger on the call after the collection year.
  for (let y = 0; y <= years && !s.ctx.world.ending; y++) {
    prepare(s, acts);
    const before = s.year;
    s.advance(1);
    answerDocket(s, acts, policy);
    callRites(s, acts, policy);
    if (!s.ctx.world.ending) observe(s, diagnosis);
    // A year that did not turn was blocked by a docket the guard could not
    // clear. That would be a policy fault, not a route; say so loudly.
    if (s.year === before && !s.ctx.world.ending) {
      throw new Error(`seed ${seed}: year ${before} did not turn; ${s.pending.length} decisions still pending`);
    }
  }
  const w = s.ctx.world;
  const saved = s.save();
  const commands: Record<string, number> = {};
  for (const row of saved.decisionLog) {
    if (row.kind === 'command') commands[row.command.kind] = (commands[row.command.kind] ?? 0) + 1;
  }
  return {
    seed, signed, policy,
    ...(w.ending ? { ending: w.ending.id } : {}),
    endYear: w.year,
    best: w.ascension.best,
    reachedAt: { ...w.ascension.reachedAt },
    clauses: w.clausesRecovered.size,
    respect: w.respect,
    acts,
    diagnosis,
    commands,
    fullSaveHash: hashSave(saved),
    saved,
    digest: digestOf(s.ctx),
  };
}

export function hashSave(saved: SavedGame): string {
  return createHash('sha256').update(canonical({ ...saved, savedAt: '' })).digest('hex');
}

/**
 * THE ROUTE IS ONLY PUBLIC IF THE LOG SAYS SO. `replay` rebuilds the run from
 * the seed through the session verbs alone, regenerates its own decision log,
 * and throws on the first difference — then compares the final world digest.
 * It knows nothing of this file's policy, so a policy that changed the world
 * any way other than through a logged command diverges here.
 */
export function routeReplays(source: Source, run: { seed: number; endYear: number; saved: SavedGame; digest: string }): boolean {
  const start = CAMPAIGNS.long.startYear;
  const rebuilt = replay(source, run.saved.decisionLog, run.seed, start, run.endYear - start, 'long', [], {
    expectedDigest: run.digest, origin: run.saved.replayOrigin,
  });
  return digestOf(rebuilt) === run.digest;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
  const runs = Number(args[0] ?? 24);
  const seedBase = Number(args[1] ?? 197800);
  const out = args[2];
  const signed = !process.argv.includes('--unsigned');
  const policy: RoutePolicy = process.argv.includes('--ascendant') ? 'ascendant' : 'summit';
  const content = loadContent();
  const rows: Omit<RouteRun, 'acts'>[] = [];
  const routes: RouteRun[] = [];
  for (let i = 0; i < runs; i++) {
    const started = Date.now();
    const { saved: _saved, digest: _digest, ...run } = playSummitRoute(content, seedBase + i, { signed, policy });
    const { acts: _acts, ...row } = run;
    rows.push(row);
    if (run.best === 'god' || run.ending === 'apotheosis' || run.ending === 'unmade') routes.push(run);
    console.log(`${run.seed}\t${run.ending ?? '-'}\tbest ${run.best}\tclauses ${run.clauses}\t${run.respect}\t${((Date.now() - started) / 1000).toFixed(1)}s`);
  }
  const tally = (read: (r: Omit<RouteRun, 'acts'>) => string) => Object.fromEntries(
    [...new Set(rows.map(read))].sort().map(k => [k, rows.filter(r => read(r) === k).length]));
  const summary = { runs, seedBase, signed, policy, endings: tally(r => r.ending ?? 'none'), best: tally(r => r.best) };
  console.log(JSON.stringify(summary, null, 2));
  if (out) writeFileSync(out, JSON.stringify({ summary, rows, routes }, null, 2));
}
