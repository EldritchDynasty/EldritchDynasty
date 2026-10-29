/**
 * WHAT THE TABLE ASKS OF THE PLAYER (#1992, step 1).
 *
 * Concept §4 gives the player three verbs — who marries whom, who is spent,
 * and what gets written down. Everything else the house does is meant to be
 * the house's. Since #219 the Table has grown recurring systems, each measured
 * for reach and payback and none for what it costs a player to keep up. This
 * is the rubric that cost is counted in: one row per external command a
 * session accepts, saying which system it belongs to and what kind of work it
 * is.
 *
 * - `maintenance` keeps something running that would otherwise lapse or sit
 *   idle: a reader set to a book, a duty assigned or released, a standing
 *   ceiling, a drained field. Doing it again next year is the normal case.
 * - `consequential` is one of §4's three verbs, or a bet the house cannot take
 *   back: a marriage policy, a rite, an expedition, a forged grandmother.
 * - `ambiguous` is either, depending on when and why it is given — a post
 *   bought for the right son is a decision, the fifth post bought this decade
 *   is upkeep. Counted apart so neither of the other two absorbs it.
 *
 * The verb's name is not the classification: `bond` and `withhold` are one
 * line each and decide what kind of house this is, while `mysticAssign` is a
 * whole subsystem and is, mostly, keeping a sickroom staffed. The `why` on
 * each row is the argument; change the row and the argument together.
 *
 * The rows are typed by the schema's own unions, so a new order fails to
 * compile here until somebody classifies it — never a hand-kept list of kinds.
 * `classifyCommand` ends in `assertNever` for the same reason (invariant 5).
 *
 * Counting is descriptive. An order count under a bot's policy is that
 * policy's activity, not a player's attention; the client recorder (#1945,
 * #1992 step 2) and observed sessions are where attention is measured.
 */
import { MusterOrderS, TableOrderS, assertNever, type LoggedDecision, type MusterOrder, type SessionCommand, type TableOrder } from '@ed/schema';
import type { GameSession } from './session.js';

export const COMMAND_LOADS = ['maintenance', 'consequential', 'ambiguous'] as const;
export type CommandLoad = typeof COMMAND_LOADS[number];

/** Where in the client the command is given. */
export type CommandSurface = 'clock' | 'docket' | 'table' | 'muster' | 'naming' | 'delegation' | 'ambition';

/** Which recurring system at the Table an order tends. */
export type TableSystem =
  | 'mystic' | 'outside_practice' | 'covert' | 'security' | 'captivity' | 'library' | 'tutoring'
  | 'careers' | 'auction' | 'ledger' | 'rites' | 'marriage' | 'programme' | 'papers' | 'bonds'
  | 'land' | 'wardship' | 'succession' | 'muster';

export interface LoadRow {
  system: TableSystem;
  load: CommandLoad;
  why: string;
}

export const TABLE_ORDER_LOAD: { readonly [K in TableOrder['kind']]: LoadRow } = {
  mysticSearch: { system: 'outside_practice', load: 'ambiguous', why: 'asking after a practitioner is a purchase only if one is hired' },
  mysticHire: { system: 'outside_practice', load: 'ambiguous', why: 'a one-off service bought for one place; routine when renewed' },
  mysticCommission: { system: 'outside_practice', load: 'ambiguous', why: 'lends a reader to a patron for coin and standing' },
  mysticReturn: { system: 'outside_practice', load: 'maintenance', why: 'honours a service promise already made' },
  covertPrepare: { system: 'covert', load: 'consequential', why: 'sends a named operative where they can be caught' },
  covertWithdraw: { system: 'covert', load: 'ambiguous', why: 'calls off an operation, keeping the operative and losing the outlay' },
  covertDefend: { system: 'security', load: 'consequential', why: 'names guards against a threat to a named person' },
  releaseIntruder: { system: 'security', load: 'consequential', why: 'lets a captured enemy go rather than keep the grievance' },
  ransom: { system: 'captivity', load: 'consequential', why: 'brings a named relative home for a fixed price' },
  study: { system: 'library', load: 'maintenance', why: 'puts a reader on a book; the steward does the same for the idle' },
  restore: { system: 'library', load: 'maintenance', why: 'pays to keep a physical copy readable' },
  tutor: { system: 'tutoring', load: 'maintenance', why: 'a term per child, the education-focus chore CK3 dropped' },
  career: { system: 'careers', load: 'ambiguous', why: 'the steward fills posts too; which son holds one can still matter' },
  bid: { system: 'auction', load: 'maintenance', why: 'a standing ceiling for the next sale' },
  lotBid: { system: 'auction', load: 'ambiguous', why: 'one named lot: routine for a primer, a decision for a page or an heirloom' },
  seekBook: { system: 'library', load: 'maintenance', why: 'asks a broker to bring a missing common book to a sale' },
  seekClause: { system: 'ledger', load: 'consequential', why: 'a late search for one unrecovered clause of the contract' },
  unmaking: { system: 'rites', load: 'consequential', why: 'spends the elder who made the pair possible' },
  vesselRite: { system: 'rites', load: 'consequential', why: 'who is spent' },
  greatRite: { system: 'rites', load: 'consequential', why: 'who is spent' },
  forcingRite: { system: 'rites', load: 'consequential', why: 'risks a named boy to wake the blood' },
  withhold: { system: 'marriage', load: 'consequential', why: 'who marries whom' },
  mysticAssign: { system: 'mystic', load: 'maintenance', why: 'staffs a standing duty that serves until released' },
  mysticRelease: { system: 'mystic', load: 'maintenance', why: 'ends a duty; the book resumes' },
  marriages: { system: 'marriage', load: 'consequential', why: 'who marries whom, for every hand the player is not asked' },
  scion: { system: 'programme', load: 'consequential', why: 'names the man the ladder is built on' },
  scionHeir: { system: 'programme', load: 'consequential', why: 'names the second man beside him' },
  pedigree: { system: 'papers', load: 'consequential', why: 'buys a forged grandmother; what gets written down' },
  bond: { system: 'bonds', load: 'consequential', why: 'world §12: a decision about what kind of house this is' },
  buy: { system: 'land', load: 'ambiguous', why: 'a lot on the market; routine growth or a bet on the treasury' },
  sell: { system: 'land', load: 'ambiguous', why: 'gives up held ground at a discount' },
  rents: { system: 'land', load: 'ambiguous', why: 'a standing policy with an inherited grudge attached' },
  improve: { system: 'land', load: 'maintenance', why: 'drainage: a term against a parcel\'s yield' },
  endow: { system: 'land', load: 'ambiguous', why: 'gives a cadet hall ground, or takes it back' },
  buyBackWardship: { system: 'wardship', load: 'ambiguous', why: 'customary, and the price of the land income' },
  declareMundane: { system: 'succession', load: 'consequential', why: 'permanent, and can move the seal' },
};

export const MUSTER_ORDER_LOAD: { readonly [K in MusterOrder['op']]: LoadRow } = {
  reinforce: { system: 'muster', load: 'maintenance', why: 'tops up a commitment the story already raised' },
  buy: { system: 'muster', load: 'ambiguous', why: 'a commission for a named position' },
  withdraw: { system: 'muster', load: 'consequential', why: 'abandons a commitment and what it promised' },
};

export interface CommandClass {
  /** Stable key for counting: `order:study`, `muster:reinforce`, `choose`. */
  category: string;
  surface: CommandSurface;
  /** Only Table and Muster orders belong to a Table system. */
  system?: TableSystem;
  /** `null` for turning the page, which is not work at the Table. */
  load: CommandLoad | null;
}

export function classifyCommand(c: SessionCommand): CommandClass {
  switch (c.kind) {
    case 'advance': return { category: c.kind, surface: 'clock', load: null };
    case 'order': {
      const row = TABLE_ORDER_LOAD[c.order.kind];
      return { category: `order:${c.order.kind}`, surface: 'table', system: row.system, load: row.load };
    }
    case 'muster': {
      const row = MUSTER_ORDER_LOAD[c.order.op];
      return { category: `muster:${c.order.op}`, surface: 'muster', system: row.system, load: row.load };
    }
    case 'choose':
    case 'send':
    case 'record':
    case 'match':
    case 'declineHand':
      return { category: c.kind, surface: 'docket', load: 'consequential' };
    // Handing the pen back answers every standing question at once.
    case 'letHimDecide': return { category: c.kind, surface: 'docket', load: 'ambiguous' };
    case 'name':
    case 'nameParcel':
    case 'keepSuggestedName':
    case 'keepSuggestedNames':
      return { category: c.kind, surface: 'naming', load: 'maintenance' };
    case 'delegateChoice':
    case 'delegateRecord':
      return { category: c.kind, surface: 'delegation', load: 'ambiguous' };
    case 'setAmbition': return { category: c.kind, surface: 'ambition', load: 'consequential' };
    default: return assertNever(c, 'session command');
  }
}

export interface LoadCount {
  attempted: number;
  accepted: number;
  refused: number;
}

export interface CommandTally {
  byCategory: Record<string, LoadCount>;
  byLoad: Record<CommandLoad, LoadCount>;
  bySystem: Partial<Record<TableSystem, LoadCount>>;
}

const zero = (): LoadCount => ({ attempted: 0, accepted: 0, refused: 0 });

export function emptyCommandTally(): CommandTally {
  return { byCategory: {}, byLoad: { maintenance: zero(), consequential: zero(), ambiguous: zero() }, bySystem: {} };
}

/** One attempt, and whether the session kept it. Turning the page is counted by category only. */
export function noteCommand(tally: CommandTally, command: SessionCommand, accepted: boolean): void {
  const c = classifyCommand(command);
  const bump = (n: LoadCount) => { n.attempted++; if (accepted) n.accepted++; else n.refused++; };
  bump(tally.byCategory[c.category] ??= zero());
  if (c.load) bump(tally.byLoad[c.load]);
  if (c.system) bump(tally.bySystem[c.system] ??= zero());
}

/**
 * The accepted commands a save already carries. A refused input leaves no row
 * (`GameSession.#input`), so this counts acceptances only; attempts need an
 * observer at the call.
 */
export function acceptedCommands(log: readonly LoggedDecision[]): { year: number; command: SessionCommand }[] {
  return log.flatMap(row => row.kind === 'command' ? [{ year: row.year, command: row.command }] : []);
}

/**
 * Count every Table and Muster attempt at the call. Arguments, the result and
 * a throw all pass through untouched; the wrapper only reads them. A payload
 * the schema refuses was never an order, and is not counted as a refused one.
 */
export function observeOrders(s: GameSession, tally: CommandTally): void {
  const order = s.order.bind(s);
  const muster = s.muster.bind(s);
  s.order = (o) => {
    const result = order(o);
    if (TableOrderS.safeParse(o).success) noteCommand(tally, { kind: 'order', order: o }, result.ok);
    return result;
  };
  s.muster = (o) => {
    const result = muster(o);
    if (MusterOrderS.safeParse(o).success) noteCommand(tally, { kind: 'muster', order: o }, result.ok);
    return result;
  };
}
