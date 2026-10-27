import type { CampaignId, Content, ContentBundle, LibraryRun, LoggedDecision, SessionCommand, ProseVariant, ReplayOrigin } from '@ed/schema';
import { assertNever, indexContent, LoggedDecisionS } from '@ed/schema';
import { bootstrap } from './sim.js';
import { runYears, stepYear } from './year/step.js';
import { canonical, digestOf } from './save.js';
import { foundHouse } from './prologue.js';
import { GameSession } from './session.js';
import { createProseRuntime } from './prose.js';
import type { SimCtx } from './world.js';

/**
 * REPLAY (issue #8).
 *
 * A save is a snapshot — `loadGame` puts a run back exactly where it stood,
 * but says nothing about the path that got it there. Every run in this
 * codebase is reproducible from its complete bootstrap inputs: content,
 * seed, start year, campaign, prior Library runs and the recorded decisions.
 * Nothing in `core` reaches for `Math.random()` (invariant 8), and
 * `choose`/`record`/`name` all draw from streams keyed by the decision's own
 * id or the current year, never from "how many draws happened before", so
 * replaying the exact same external answers at the exact same points always
 * reproduces the exact same run. That is what makes the decision log the
 * thing that turns a bug report from hour eleven of a playthrough back into
 * a seed and a sequence of calls, rather than a house nobody can rebuild.
 *
 * `replay` re-runs the simulation from the seed and independently rebuilds
 * ITS OWN decision log through the public session verbs and existing commit
 * hooks. Old logs without session inputs keep the seeded chronicler path.
 * If the independently generated decisions do not
 * match exactly, the log lied about what happened — a bug in the hooks, not
 * something to shrug off — and this throws rather than silently returning a
 * run that does not match its own record. A decision log nothing ever checks
 * against a fresh run is this codebase's canonical dead feature.
 */
export class ReplayMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReplayMismatchError';
  }
}

export interface ReplayOptions {
  /** Verify the final saved state as well as the generated decision log. */
  expectedDigest?: string;
  /** The original host catalogue, when it overrode the authored content. */
  proseVariants?: readonly ProseVariant[];
  /** The save's initial rendering provenance when no input has yet recorded it. */
  origin?: ReplayOrigin;
}

type ReplayInputProblem =
  | { kind: 'bad_horizon' }
  | { kind: 'diverged'; index: number; year: number }
  | { kind: 'missing_input'; index: number; year: number }
  | { kind: 'clock_stalled'; year: number }
  | { kind: 'wrong_date'; got: number; want: number }
  | { kind: 'unreadable'; index: number }
  | { kind: 'refused'; index: number }
  | { kind: 'past_horizon'; index: number };

/** Helpers report structured faults; the public entry point owns diagnostics. */
class ReplayInputFailure extends Error {
  constructor(readonly problem: ReplayInputProblem) {
    super(problem.kind);
    this.name = 'ReplayInputFailure';
  }
}

export function replay(
  source: ContentBundle | Content,
  log: readonly LoggedDecision[],
  seed: number,
  startYear: number,
  years: number,
  /** Replay the campaign that wrote the log; old five-argument callers are Long Lines. */
  campaign: CampaignId = 'long',
  /** Exactly the prior-run Library inputs from the original bootstrap (issue #1601). */
  libraryRuns: readonly LibraryRun[] = [],
  options: ReplayOptions = {},
): SimCtx {
  const signing = log.filter((d) => d.kind === 'signing');
  if (signing.length > 1) {
    throw new ReplayMismatchError(
      `replay found ${signing.length} signing decisions at seed ${seed}; expected at most one`,
    );
  }
  const signed = signing[0];
  if (signed && log[0] !== signed) {
    throw new ReplayMismatchError(`replay signing decision is not first at seed ${seed}`);
  }

  // Examination choices alter bootstrap itself, so they have to be supplied
  // before any founding-state verb can be replayed.
  const content = indexContent(source);
  const firstInput = log.find(row => row.kind === 'command');
  if (firstInput && !LoggedDecisionS.safeParse(firstInput).success) {
    throw new ReplayMismatchError('replay initial input is not readable');
  }
  const origin = firstInput ? {
    proseMode: firstInput.initialProseMode ?? 'original',
    ...(firstInput.initialProseCatalogueEmpty ? { catalogueEmpty: true as const } : {}),
  } : options.origin;
  const ctx = bootstrap(
    content,
    seed,
    startYear,
    campaign,
    libraryRuns,
    signed ? { answers: signed.answers, founder: signed.founder } : undefined,
    createProseRuntime(origin?.proseMode ?? 'original', origin?.catalogueEmpty
      ? [] : options.proseVariants ?? content.proseVariants),
  );
  if (origin?.proseMode === 'plainenglish') ctx.replayOrigin = { ...origin };

  // Founding is the external answer made before the first year turns
  // (issue #391). It used to be absent from the log, so replay silently
  // rebuilt a different house: no chosen gift, grudge, friends, house name or
  // opening Chronicle page. Apply it through the same verb, never by copying
  // those five pieces of state here.
  const founding = log.filter((d) => d.kind === 'founding');
  if (founding.length > 1) {
    throw new ReplayMismatchError(
      `replay found ${founding.length} founding decisions at seed ${seed}; expected at most one`,
    );
  }
  const first = founding[0];
  if (first) {
    if (first.year !== startYear) {
      throw new ReplayMismatchError(
        `replay founding decision is dated ${first.year} at seed ${seed}; expected ${startYear}`,
      );
    }
    const result = foundHouse(ctx, {
      houseName: first.houseName,
      heirloom: first.heirloom,
      grudge: first.grudge,
      friends: first.friends.map((friend) => ({ ...friend })),
      ...(signed ? { answers: { ...signed.answers }, founder: signed.founder } : {}),
    });
    if (!result.ok) {
      throw new ReplayMismatchError(
        `replay could not apply founding decision at seed ${seed}: ${result.reason ?? 'refused'}`,
      );
    }
  }

  if (log.some(row => row.kind === 'command')) {
    try {
      replayInputs(ctx, log, startYear, years, options.proseVariants ?? content.proseVariants);
    } catch (error) {
      if (!(error instanceof ReplayInputFailure)) throw error;
      const p = error.problem;
      switch (p.kind) {
        case 'bad_horizon': throw new ReplayMismatchError('replay needs a finite nonnegative horizon');
        case 'diverged': throw new ReplayMismatchError(`replay diverged at decision ${p.index} in ${p.year}`);
        case 'missing_input': throw new ReplayMismatchError(`replay is missing a session input at decision ${p.index} in ${p.year}`);
        case 'clock_stalled': throw new ReplayMismatchError(`replay clock did not move in ${p.year}`);
        case 'wrong_date': throw new ReplayMismatchError(`replay input is dated ${p.got}, expected ${p.want}`);
        case 'unreadable': throw new ReplayMismatchError(`replay input ${p.index} is not readable`);
        case 'refused': throw new ReplayMismatchError(`replay input ${p.index} was refused`);
        case 'past_horizon': throw new ReplayMismatchError(`replay input ${p.index} exceeds the requested horizon`);
        default: assertNever(p, 'replay input problem');
      }
    }
  } else runYears(ctx, years);

  // Rendered private prose is a saved artefact, like Chronicle wording. The
  // replay independently verifies the actor, site, outcomes and assessed facts.
  const got = canonical(semantics(ctx.world.decisionLog));
  const want = canonical(semantics(log));
  if (got !== want) {
    throw new ReplayMismatchError(
      `replay diverged from the recorded log at seed ${seed}: rebuilt `
      + `${ctx.world.decisionLog.length} decisions, expected ${log.length}`,
    );
  }
  for (const [index, row] of ctx.world.decisionLog.entries()) {
    const recorded = log[index];
    if (row.kind === 'outcome' && row.primordial && recorded?.kind === 'outcome' && recorded.primordial) {
      row.primordial.receipt = recorded.primordial.receipt;
      row.primordial.manifestation = recorded.primordial.manifestation;
    }
  }
  if (options.expectedDigest !== undefined && digestOf(ctx) !== options.expectedDigest) {
    throw new ReplayMismatchError(`replay final state differs from the expected save at seed ${seed}`);
  }
  return ctx;
}

function semantics(rows: readonly LoggedDecision[]) {
  return rows.map(row => {
    if (row.kind !== 'outcome' || !row.primordial) return row;
    const { receipt: _receipt, manifestation: _manifestation, ...facts } = row.primordial;
    return { ...row, primordial: facts };
  });
}

/** Drive the existing public verbs, verifying each newly generated chunk once.
 * Internal export for constructed-state scenarios; not part of the package barrel.
 */
export function replayInputs(ctx: SimCtx, log: readonly LoggedDecision[], startYear: number, years: number,
  proseVariants: readonly ProseVariant[]): void {
  if (!Number.isFinite(years) || years < 0) throw new ReplayInputFailure({ kind: 'bad_horizon' });
  const until = startYear + Math.ceil(years);
  const session = new GameSession(ctx);
  let catalogueEmpty = ctx.prose.variants.size === 0;
  let checked = 0;
  function verifyReplayChunk() {
    const end = ctx.world.decisionLog.length;
    if (end > log.length || canonical(semantics(ctx.world.decisionLog.slice(checked, end)))
      !== canonical(semantics(log.slice(checked, end)))) {
      throw new ReplayInputFailure({ kind: 'diverged', index: checked, year: ctx.world.year });
    }
    checked = end;
  }
  verifyReplayChunk();
  function advanceLegacyReplayYear() {
    const before = ctx.world.year;
    if (before >= until || ctx.world.ending || ctx.world.pendingDecisions.length) {
      throw new ReplayInputFailure({ kind: 'missing_input', index: checked, year: before });
    }
    // Retain the old seeded-chronicler path for a prefix or direct-core
    // continuation. Public session turns carry their own advance command.
    stepYear(ctx);
    verifyReplayChunk();
    if (ctx.world.year === before && !ctx.world.ending) {
      throw new ReplayInputFailure({ kind: 'clock_stalled', year: before });
    }
  }
  while (checked < log.length) {
    const row = log[checked]!;
    if (row.kind !== 'command' || row.year > ctx.world.year) {
      advanceLegacyReplayYear();
      continue;
    }
    if (row.year !== ctx.world.year) {
      throw new ReplayInputFailure({ kind: 'wrong_date', got: row.year, want: ctx.world.year });
    }
    const parsed = LoggedDecisionS.safeParse(row);
    if (!parsed.success || parsed.data.kind !== 'command') {
      throw new ReplayInputFailure({ kind: 'unreadable', index: checked });
    }
    const before = ctx.world.decisionLog.length;
    session.setProseMode(row.proseMode ?? 'original');
    const empty = row.proseCatalogueEmpty === true || proseVariants.length === 0;
    if (empty !== catalogueEmpty) {
      session.setProseVariants(empty ? [] : proseVariants);
      catalogueEmpty = empty;
    }
    executeInput(session, parsed.data.command);
    if (ctx.world.decisionLog.length === before) {
      throw new ReplayInputFailure({ kind: 'refused', index: checked });
    }
    if (ctx.world.year > until) throw new ReplayInputFailure({ kind: 'past_horizon', index: checked });
    verifyReplayChunk();
  }
  while (ctx.world.year < until && !ctx.world.ending) advanceLegacyReplayYear();
}

function executeInput(session: GameSession, command: SessionCommand): void {
  switch (command.kind) {
    case 'advance':
      session.decider = command.decider;
      session.advance(command.years);
      return;
    case 'order': session.order(command.order); return;
    case 'muster': session.muster(command.order); return;
    case 'choose': session.choose(command.decision, command.choice, command.cast); return;
    case 'send': session.send(command.decision, command.cast); return;
    case 'record': session.record(command.decision, command.option); return;
    case 'match': session.match(command.decision, command.card); return;
    case 'declineHand': session.declineHand(command.decision); return;
    case 'letHimDecide': session.letHimDecide(); return;
    case 'name': session.name(command.person, command.name); return;
    case 'nameParcel': session.nameParcel(command.parcel, command.name); return;
    case 'keepSuggestedName': session.keepSuggestedName(command.person); return;
    case 'keepSuggestedNames': session.keepSuggestedNames(); return;
    case 'delegateChoice': session.delegateChoice(command.event, command.choice); return;
    case 'delegateRecord': session.delegateRecord(command.event, command.option); return;
    case 'setAmbition': session.setAmbition(command.ambition); return;
    default: return assertNever(command, 'session replay input');
  }
}

/** One readable line per decision — what the harness prints to bisect a run. */
export function describeDecision(d: LoggedDecision): string {
  switch (d.kind) {
    case 'command':
      return `${d.year}  input ${d.command.kind}`;
    case 'outcome':
      return `${d.year}  ${d.event}${d.choiceId ? `/${d.choiceId}` : ''} -> ${d.outcomeId}`;
    case 'record':
      return `${d.year}  ${d.event} recorded as ${d.option}`;
    case 'match':
      return d.card
        ? `${d.year}  ${d.subject} married ${d.spouse} off ${d.card}`
        : `${d.year}  ${d.subject} was offered a hand and took none of it`;
    case 'signing':
      return `${d.year}  signed as ${d.founder?.name?.trim() || 'the authored founder'}`
        + `${d.founder ? ` (${d.founder.gender}, ${d.founder.configuration})` : ''}; `
        + `${Object.keys(d.answers).length} Examination answer(s)`;
    case 'founding':
      return `${d.year}  founded ${d.houseName}; asked for ${d.heirloom}; wronged ${d.grudge}`;
    case 'name':
      return `${d.year}  ${d.person} named ${d.name}`;
    default:
      return assertNever(d, 'logged decision');
  }
}
