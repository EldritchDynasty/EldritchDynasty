import type { Choice, EventTemplate, Person } from '@ed/schema';
import { MAIN_BRANCH } from '@ed/schema';
import type { SimCtx } from '../world.js';
import type { Rng } from '../rng.js';
import { streamFor } from '../rng.js';
import type { YearReport } from './report.js';
import { accrueMadness, rollAwakening } from '../people/factory.js';
import { retireNames } from '../people/names.js';
import { autoMarry, rollBirths, rollDeath } from '../people/demography.js';
import { dealMatch, matchSubjects, promisedBy, refreshHand } from '../people/match.js';
import { nameWorthAsking } from '../people/naming.js';
import { settleBranches, tickBranches } from '../people/branches.js';
import { ensureHead, maintainCast, releaseContracts } from '../people/succession.js';
import { tickFamilyQuarrels, tickRelationships } from '../people/relationships.js';
import { tickSecrets } from '../people/secrets.js';
import { tickPapers } from '../people/papers.js';
import { serviceBonds } from '../people/bond.js';
import { completeStudies } from '../people/library.js';
import { tickAges } from '../ages/scheduler.js';
import {
  tickLandImprovements, tickLandMarket, tickLandRisks, tickPlatIllumination,
} from '../land.js';
import { tickMuster } from '../muster.js';
import { tickEconomy } from '../economy.js';
import { tickCondition } from '../people/condition.js';
import { tickAssize } from '../assize.js';
import { tickBearing } from '../bearing.js';
import { tickAscension } from '../ascension.js';
import { runStandingOrders } from '../table.js';
import { tickCareers } from '../people/careers.js';
import { tickRivals } from '../people/rivals.js';
import { tickAuction } from '../auction.js';
import { selectEvents } from '../events/selection.js';
import { presentFrame, selectFrame } from '../events/frame.js';
import { dueArcSteps, type ArcStep } from '../events/arcs.js';
import { tickTales } from '../events/tales.js';
import { pickOutcome } from '../events/effects.js';
import { resolveChoiceOutcome } from '../events/checks.js';
import { autoCast, type SlotFill } from '../events/slots.js';
import { decideBranch } from '../events/deciders.js';
import {
  applyRecord, autoResolveDecision, autoRecordOption, choiceAvailability, commitOutcome,
  queueChoice, queueMatch, queueRecord,
} from '../events/decisions.js';
import { msg } from '../messages.js';

/**
 * A YEAR IS A LIST OF PHASES, and the list is the file.
 *
 * This was a hundred and thirty lines of straight-line code inside `stepYear`,
 * and its ordering constraints — several of which are load-bearing and were
 * discovered the hard way — existed only as comments beside the call that had
 * to come second. Adding a system meant reading the whole function to work out
 * where it went, and getting it wrong produced a working simulation with a
 * subtly wrong shape.
 *
 * Now the shape of a year is data. Three things follow:
 *
 *   ORDER IS STATED.        Each phase says what it must come after and why.
 *                           `year.test.ts` reads `after` and checks the table
 *                           against itself, so a reorder that breaks a stated
 *                           dependency fails a test rather than a playthrough.
 *
 *   PHASES RUN ALONE.       A phase takes `(ctx, rng, report)` and nothing
 *                           else, so a test can run `births` against a hand-made
 *                           world without simulating four centuries to reach the
 *                           state it wanted.
 *
 *   RANDOMNESS IS PER PHASE. Every phase draws from its own stream, derived
 *                           from (seed, year, phase name). One shared year-RNG
 *                           meant inserting a single `rng.bool()` anywhere
 *                           shifted every subsequent draw in the year, so no
 *                           refactor could preserve a run and no golden could
 *                           be trusted. Now a phase's dice depend on that
 *                           phase's name and nothing else.
 */
export interface PhaseRun {
  ctx: SimCtx;
  /** This phase's own stream. See `streamFor` in rng.ts. */
  rng: Rng;
  report: YearReport;
  /** false = park decisions on the docket for the player. */
  autoResolve: boolean;
}

export interface Phase {
  /** Stable: it seeds this phase's RNG stream, so renaming one changes runs. */
  readonly name: string;
  /** Phases this one must follow, and the note says why. */
  readonly after: readonly string[];
  readonly why: string;
  run(p: PhaseRun): void;
}

/**
 * THE ONE DIAL OVER EVERYTHING THE PLAYER IS ASKED (issue #88).
 *
 * Spent in the `ambient` phase below: one draw in a year, or none, and never
 * two. Nothing else in the game rations choice — `arcs` presents its due
 * nodes outside this budget, and `selectEvents` returns forced candidates
 * BEFORE it spends any of it — so this number is very nearly the whole of the
 * choice stream rather than one contributor to it.
 *
 * WHAT IT MEASURES OUT AT, over the 25 seeds `attention.slow.test.ts` plays,
 * at both shipped terms (2026-09-20, `npm run gate:density`):
 *
 *   500 years   126 choice decisions   7.2 a generation (±0.2)   27% repeat
 *   300 years    77 choice decisions   7.1 a generation (±0.3)   21% repeat
 *
 * 126 over 439 lived years is 0.29 a year against a budget of 0.35; the gap
 * is the draws that land on an event the player never sees a question about,
 * because `decidedBy` gave the branch to chance or to a `state` ladder.
 *
 * SEVEN AND A FIFTH A GENERATION, AND THE SAME IN BOTH CAMPAIGNS. Of those
 * seven, one is the Match (concept §5's chapter beat). That is the measured
 * answer to #88's question, and the reason 0.35 is written down as intended
 * rather than lowered: the complaint underneath a density complaint is
 * repetition, and repetition measures at 3% WITHIN AN AGE at both terms now
 * that #86's rota is closed and #65's chaptering has landed. Lowering this
 * would make a thin game shorter rather than a repetitive game varied.
 *
 * WHAT MOVES IF IT MOVES, and all of it at once, because this rations every
 * tier together:
 *
 *   - `npm run gates -- fire-rate`, whose per-tier rates are all downstream
 *   - the tier shares recorded in `docs/BALANCE-LOG.md`, which nothing else
 *     reports and which are the standing before/after for any change here
 *   - arc completion: a substory whose launcher never draws never finishes
 *   - `attention.slow.test.ts`'s per-generation band, 5.5 to 9.5, which is
 *     set at ±25% of 7.2 precisely so that moving this by a quarter is a red
 *     build rather than a game that quietly got thinner
 */
const EVENT_BUDGET_PER_YEAR = 0.35;

export const YEAR_PHASES: readonly Phase[] = [
  {
    name: 'ages',
    after: [],
    why: 'An Age is the weather every other phase happens in, so it is decided first.',
    run({ ctx, rng, report }) {
      const w = ctx.world;
      const ages = tickAges(ctx, rng);
      report.agesBegan = ages.began.map((a) => a.id);
      report.agesEnded = ages.ended.map((a) => a.id);
      report.agesNamed = ages.named.map((a) => a.id);
      for (const a of ages.named) {
        w.chronicle.push({
          year: w.year,
          weight: 'page',
          title: a.name,
          text: a.opening ?? msg(ctx, 'age.named_fallback', 'They began to call it {AGE}.', { AGE: a.name }),
          named: true,
        });
      }
    },
  },

  {
    name: 'lifecycle',
    after: ['ages'],
    why: 'Awakening, Madness and mortality all read the year the Age has just set.',
    run({ ctx, rng, report }) {
      const w = ctx.world;
      // THE HIGH-WATER MARK, before anybody dies this year. `fragility` reads
      // it to tell a line that is dying from one that is merely young, and it
      // is taken here because this is the phase that can lower the count
      // (issue #42). A declared field nothing writes is the bug this codebase
      // refuses, so it is written once a year, in the open.
      w.bloodHighWater = Math.max(
        w.bloodHighWater,
        w.people.blood(w.playerHouse).filter((q) => q.status === 'alive').length,
      );

      for (const p of w.people.living()) {
        if (rollAwakening(p, w.year, ctx.genetics, rng)) report.awakenings.push(p);
        accrueMadness(p, ctx.genetics, w.year);
        if (rollDeath(p, ctx, rng)) report.deaths.push(p);
      }
      // A name is spoken for while its holder lives and for a generation
      // after. Without this the pool drained by 1153 and two thirds of the
      // run was called `Garrick 788` (`people/names.ts`). Draws no dice, so
      // it cannot move this phase's stream.
      retireNames(
        ctx.takenNames,
        w.people.all().map((p) => ({ name: p.name, died: p.died, alive: p.status === 'alive' })),
        w.year,
      );
    },
  },

  {
    name: 'guardian',
    after: ['lifecycle'],
    why: 'He can only have crossed over in the pass that tried to kill him.',
    run({ ctx, report }) {
      const w = ctx.world;
      if (w.guardianSince) return;
      const g = w.people.guardian();
      if (!g) return;

      // Not a death — a change of state, and the one moment in the run where
      // the voice of the chronicle changes hands.
      w.guardianSince = w.year;
      report.guardianCrossed = g;
      w.chronicle.push({
        year: w.year,
        weight: 'illuminated',
        title: msg(ctx, 'guardian.crossed_title', 'The House Does Not Empty'),
        text: msg(ctx, 'guardian.crossed',
          'They buried {NARRATOR} in the spring and the house did not feel emptier for it, which everyone noticed and nobody said. The fires were laid before anyone laid them. The accounts stayed balanced through a year in which nobody balanced them. He had not gone anywhere. He had only stopped being someone they had to feed.',
          { NARRATOR: g.name }),
        named: true,
      });
    },
  },

  {
    name: 'quarrels',
    after: ['lifecycle'],
    why: 'Grudges pass to the living and posts fall vacant, both on this year\'s deaths.',
    run({ ctx, rng, report }) {
      tickRelationships(ctx);
      tickFamilyQuarrels(ctx);
      // A year off the debt BEFORE the releases read it: a bond that finishes
      // this year should not also be held for this year, and `releaseContracts`
      // skips anyone still bonded (world §12, `people/bond.ts`).
      serviceBonds(ctx);
      for (const r of releaseContracts(ctx, rng)) {
        report.serviceEnded.push({ person: r.person.id, text: r.text });
      }
    },
  },

  {
    name: 'secrets',
    after: ['quarrels'],
    why: 'A secret can only walk out with somebody, and `quarrels` is where '
      + 'service ends. Loyalty moves here too, so a year of arrears is priced '
      + 'before the next year\'s releases read it (`people/secrets.ts`).',
    run({ ctx, rng }) {
      tickSecrets(ctx, rng);
    },
  },

  {
    name: 'papers',
    after: ['secrets'],
    why: 'A forged pedigree is caught the way a secret walks out — by somebody '
      + 'with a motive putting two records side by side (world §16). Runs after '
      + '`secrets` so both leave the house through the same kind of year, and '
      + 'before `assize`, so the world reads a house whose papers have just '
      + 'been questioned as the house it now is (`people/papers.ts`).',
    run({ ctx, rng }) {
      tickPapers(ctx, rng);
    },
  },

  {
    name: 'assize',
    after: ['ages'],
    why: 'The world reads the house as the Age has just left it, and before anything this year spends.',
    run({ ctx, rng, report }) {
      report.assize = tickAssize(ctx, rng);
    },
  },

  {
    name: 'bearing',
    after: ['assize'],
    why: 'Bearing is read off acts already taken and halls already angry, so it '
      + 'runs after the Assize has settled the year\'s standing and before the '
      + 'Match deals a hand against it. It draws no dice.',
    run({ ctx, report }) {
      report.bearing = tickBearing(ctx);
    },
  },

  {
    name: 'careers',
    after: ['quarrels'],
    why: 'A career\'s income and Respect are owed to whoever is still living '
      + 'after this year\'s dead are settled, and `economy` needs the treasury '
      + 'they add before it tallies the year (issue #16).',
    run({ ctx, rng }) {
      tickCareers(ctx, rng);
    },
  },

  {
    name: 'table',
    after: ['careers'],
    why: 'A term finishes for whoever is alive after `lifecycle`, and a reader is set to a book '
      + 'at the pace of whichever post `careers` has just given him.',
    run({ ctx, rng }) {
      // Overwritten wholesale, not merged — last year's steward action is not
      // this year's, and `newly_placed`/`newly_taught`/`set_to_a_book` should
      // never cast someone the steward acted on two years ago (issue #127).
      ctx.world.stewardYear = runStandingOrders(ctx, rng);
    },
  },

  {
    name: 'library',
    after: ['careers', 'table'],
    why: 'A book finished this year is finished by whoever is still alive after '
      + '`lifecycle`, and by whichever career they held when `careers` settled — '
      + 'a Scholar who left the post mid-book still read it at a Scholar\'s pace, '
      + 'because the years were spent when the study began.',
    /**
     * A FINISHED BOOK IS DEMOGRAPHY UNTIL IT IS THE FIRST ONE (issue #82).
     *
     * Six to eight readers are mid-book at all times, so this phase fired
     * about three times a year for a thousand years and wrote a `line` entry
     * every time. Measured on seed 7: 2,902 of the finished book's 3,738
     * entries were this one sentence — 78% of the chronicle, and 80-87% of
     * the 60-entry window the panel actually draws. The twelve `illuminated`
     * entries of a whole run were several hundred shelf lines apart, so the
     * typography worked and nobody was ever present when it did.
     *
     * What a chronicler writes down is the FIRST time the house reads a
     * thing. The twelfth copy of Lesser Workings of Light finishing is the
     * house going about its business, which is what `passage.ts` is for.
     */
    run({ ctx, report }) {
      for (const done of completeStudies(ctx)) {
        const p = ctx.world.people.get(done.person);
        const def = ctx.content.spellbook(done.book);
        if (!p || !def) continue;
        report.studiesFinished.push({ person: p.id, name: p.name, book: def.name });

        if (!done.first) continue;
        ctx.world.chronicle.push({
          year: ctx.world.year,
          weight: 'line',
          text: msg(ctx, 'library.first_reading', '{PERSON} finished {BOOK}. Nobody in the house had read it before.',
            { PERSON: p.name, BOOK: def.name }),
          named: false,
        });
      }
    },
  },

  {
    name: 'muster',
    after: ['ages', 'careers'],
    why: 'A commitment is settled against the Age that ended and the officers who are still alive, '
      + 'and `economy` must see this year\'s war upkeep in its tally (issue #89, Stage 2 — #95). '
      + 'Fully dormant with no commitment standing — no draw, no write, no chronicle line — which is '
      + 'the free regression test: a run that never musters must digest bit-identical to one that '
      + 'never had this phase at all.',
    run({ ctx, rng }) {
      tickMuster(ctx, rng);
    },
  },

  {
    name: 'land',
    after: ['ages'],
    why: '`economy` reads what the house holds this year, so land settles before it (issue #93). '
      + 'The market opens and expires here, and a term of improvement completes here, on this '
      + 'phase\'s own reserved stream (issue #94, Phase B) — tenant risk and loss (issue #91, '
      + 'Phase D on) land inside it too, rather than reshuffling the table around them.',
    run({ ctx, rng, report }) {
      tickLandMarket(ctx, rng);
      tickLandImprovements(ctx);
      report.landRisks = tickLandRisks(ctx, rng);
      // Last in the phase: the illuminated deed reads the acreage AFTER this
      // year's risks have settled, so a holding lost to one is not counted.
      tickPlatIllumination(ctx);
    },
  },

  {
    name: 'economy',
    after: ['careers', 'land', 'muster'],
    why: 'Wages are owed to whoever is still in post after the contracts settle, '
      + 'and the annual tally comes last so it sees career and war upkeep too. '
      + 'Condition then reads the closed books before this year\'s birth roll.',
    run({ ctx }) {
      tickEconomy(ctx);
      tickCondition(ctx);
    },
  },

  {
    name: 'auction',
    after: ['economy'],
    why: 'Bidding spends the treasury `economy` just tallied, and a lot bought this year should '
      + 'show up in the same year\'s chronicle as everything else that happened to the house (issue #17).',
    run({ ctx, rng, autoResolve }) {
      tickAuction(ctx, rng, autoResolve);
    },
  },

  {
    name: 'succession',
    after: ['lifecycle'],
    why: 'The seat and the recurring cast refill on this year\'s vacancies. Without '
      + 'this the head, tutor and rival slots empty within a generation and the '
      + 'event pool silently collapses to nothing.',
    run({ ctx, rng }) {
      ensureHead(ctx, rng);
      if (ctx.world.year % 4 === 0) maintainCast(ctx, rng);
    },
  },

  {
    name: 'branches',
    after: ['succession'],
    why: 'A son leaves the year his brother takes the seal, and not before.',
    run({ ctx, report }) {
      report.branchesFounded = settleBranches(ctx).map((b) => b.id);
      tickBranches(ctx);
    },
  },

  {
    name: 'rivals',
    after: [],
    why: 'Rival-house descent (issue #24 item 6) draws from its own stream and reads nothing '
      + 'else this year has settled, so it has no real dependency — it runs before `marriage` '
      + 'only so a lineage member who came of age this year is already there when a card is '
      + 'dealt for her.',
    run({ ctx }) {
      tickRivals(ctx);
    },
  },

  {
    name: 'marriage',
    after: ['branches'],
    why: 'A bride joins the hall her husband is in, which the split has just decided.',
    run({ ctx, rng, report, autoResolve }) {
      if (ctx.world.year % 3 !== 0) return;

      // THE MATCH first, then everyone else. The seat's own marriages are
      // dealt as cards and answered by the player (concept §5); `autoMarry`
      // pairs the halls, the retainers and the married-in, and skips anybody
      // whose hand is already on the docket — otherwise the pairing code
      // would answer a question the player has just been asked.
      const drafted = new Set<string>();
      for (const subject of matchSubjects(ctx)) {
        const offer = dealMatch(ctx, subject, rng);
        if (!offer.cards.length) continue;
        drafted.add(subject.id);
        // The house has been to market for this person. Whether the hand is
        // taken or not, it does not go again next season (`WorldState.courted`).
        ctx.world.courted[subject.id] = ctx.world.year;
        // AND THE PRIORITY IS SPENT (issue #132, Stage 2) — the same moment
        // `courted` is set, for the same reason: a hand offered is a hand
        // answered, whatever the answer, and a decline does not loop this.
        ctx.world.priorityMatch = ctx.world.priorityMatch.filter((id) => id !== subject.id);
        const pending = queueMatch(ctx, offer);
        if (autoResolve) {
          autoResolveDecision(ctx, pending, rng);
        } else {
          report.pending.push(pending);
          // AND EVERYBODY AN UNANSWERED HAND PROMISES (issue #83). The skip
          // set held the subject and nobody else, so the cousin on her card
          // was married off by the `autoMarry` call below — in this same
          // phase, before the player had seen the panel. A card is an offer
          // the house has made; the house does not then spend the person it
          // offered.
          //
          // ONLY WHERE THE HAND IS ACTUALLY STANDING. With the chronicler
          // answering, the hand is resolved on the line above, before
          // `autoMarry` runs at all: the promised cousin is by then either
          // married to the subject or released, and reserving them is pure
          // loss. Measured over six seeds to 1642, reserving unconditionally
          // cost the house a fifth of its living members, took seed 1042 from
          // forty marriages to twelve, and drove that line extinct. There is
          // no window to close when there is no hand waiting.
          for (const promised of promisedBy(offer)) drafted.add(promised);
        }
      }

      autoMarry(ctx, rng, drafted);
    },
  },

  {
    name: 'births',
    after: ['marriage'],
    why: 'A couple married this spring may conceive this year.',
    run({ ctx, rng, report }) {
      const w = ctx.world;
      const newborns: { child: Person; servants: boolean }[] = [];
      for (const { birth: b, branch, servants } of rollBirths(ctx, rng)) {
        if (!b.child) continue;

        // Born into the hall their mother lives in, not into the seat. This is
        // what makes a branch a lineage rather than a list of exiles.
        if (branch !== MAIN_BRANCH && b.child.membership[0]) b.child.membership[0].branch = branch;

        // Whether the child is of the blood is now decided in `conceiveChild`
        // itself (issue #42, `descentKind`), off both true parents rather than
        // off `servants` alone — a servant family is the special case where
        // that general rule and this narrower flag used to agree, so nothing
        // here corrects it any more. `servants` still gates naming below.
        w.people.add(b.child);
        report.births.push(b.child);

        newborns.push({ child: b.child, servants: Boolean(servants) });
      }

      // NAMING IS A REWARD, NOT A FORM (issue #62).
      //
      // Raised after every birth of the year is in, so the predicate reads a
      // settled cohort rather than a half-built one. The chronicler's
      // suggestion is taken silently for everybody else — which was already a
      // supported way to play (`keepSuggestedName`), and is now the default
      // rather than a 189-click opt-out.
      //
      // Still never the steward's daughter, and still never a child of
      // another house: the offer is about the bloodline.
      for (const { child, servants } of newborns) {
        if (servants || child.houseOfOrigin !== w.playerHouse) continue;
        const because = nameWorthAsking(ctx, child);
        if (!because) continue;
        w.pendingNames.push({
          person: child.id,
          born: w.year,
          suggested: child.name,
          sex: child.sex,
          because,
        });
      }
    },
  },

  {
    name: 'arcs',
    after: ['births'],
    why: 'A substory casts from the living, and this year\'s dead and born are settled.',
    run({ ctx, rng, report, autoResolve }) {
      for (const step of dueArcSteps(ctx, rng)) {
        const event = ctx.content.mustEvent(step.node.event, `arc node ${step.node.id}`);
        const body = step.absent && event.absentBody ? event.absentBody : event.body;
        present(ctx, { ...event, body }, step.fill, step.playerCast, rng, report, autoResolve, step);
      }
    },
  },

  {
    name: 'ambient',
    after: ['arcs'],
    why: 'Substories get the year\'s attention before the ambient pool spends any of it.',
    run({ ctx, rng, report, autoResolve }) {
      // Called every year, not only on years the ambient budget lands. Selection
      // returns forced candidates — arc follow-ups and scheduled events — before
      // it spends any budget, and skipping the call on the two years in three
      // where the budget is zero meant a follow-up scheduled for 1204 arrived in
      // 1207 whenever the dice said so.
      const budget = rng.next() < EVENT_BUDGET_PER_YEAR ? 1 : 0;
      for (const cand of selectEvents(ctx, rng, budget)) {
        present(ctx, cand.event, cand.fill, cand.playerCast, rng, report, autoResolve);
      }
    },
  },

  {
    name: 'frame',
    after: ['ambient'],
    why: 'The frame reacts to the record — it has to run after the year has written its lines, not before.',
    run({ ctx, rng, report }) {
      const e = selectFrame(ctx, rng);
      if (!e) return;
      const entry = presentFrame(ctx, e, rng);
      if (entry) report.frame = entry;
    },
  },

  {
    name: 'ascension',
    after: ['library', 'economy'],
    why: 'A rung is read off the books finished this year and the standing the economy has just set.',
    run({ ctx, report }) {
      report.ascension = tickAscension(ctx);
    },
  },

  {
    name: 'generation',
    after: ['ambient', 'frame'],
    why: 'The generation counter gates content, so it turns over once everything else has. Tale '
      + 'circulation ticks here too — it only cares that the year has advanced, not what else fired in it.',
    run({ ctx }) {
      if (ctx.world.year % 25 === 0) ctx.world.generation += 1;
      tickTales(ctx);
    },
  },

  {
    name: 'docket',
    after: ['generation'],
    why: 'A hand dealt in `marriage` is answered after the whole year has run — `step.ts` turns '
      + 'every phase and only then reports the block — so the last thing the year does is re-read '
      + 'what it is about to ask the player (issue #83).',
    /**
     * WHAT THE DOCKET IS ABOUT TO ASK, RE-READ AGAINST THE YEAR THAT JUST RAN.
     *
     * Draws from no stream and decides nothing. It is bookkeeping on a
     * question already asked, which is why it can sit last without moving a
     * single number in any other phase.
     *
     * Marriage cards only, because they are the one docket entry that names
     * living people who can stop being available. A choice event's branches
     * are re-checked by `choiceAvailability` at the moment they are answered.
     */
    run({ ctx, report }) {
      const withdrawn = new Set<string>();
      for (const d of ctx.world.pendingDecisions) {
        if (d.kind !== 'match') continue;
        if (!refreshHand(ctx, d.subject.id, d.cards)) withdrawn.add(d.id);
      }
      if (!withdrawn.size) return;
      // A hand with nothing takeable in it is withdrawn rather than shown.
      // Stopping the clock to offer three shut cards and *Take none of them*
      // is asking a question with one legal answer.
      ctx.world.pendingDecisions = ctx.world.pendingDecisions.filter((d) => !withdrawn.has(d.id));
      report.pending = report.pending.filter((d) => !withdrawn.has(d.id));
    },
  },
];

/** Run one phase by name, with its own stream. For tests and probes. */
export function runPhase(name: string, ctx: SimCtx, report: YearReport, autoResolve = true): void {
  const phase = YEAR_PHASES.find((p) => p.name === name);
  if (!phase) throw new Error(`no year phase '${name}'`);
  phase.run({ ctx, rng: streamFor(ctx.world, phase.name), report, autoResolve });
}

/**
 * Put an event in front of whoever is deciding.
 *
 * Narration resolves on the spot — there is nothing to ask. A choice event
 * either goes on the docket or is answered by the chronicler, and the Record
 * block that follows it works the same way. One function, so the two modes
 * cannot drift apart: everything the player can decide, auto-resolve can
 * decide, and neither path is the special case.
 */
export function present(
  ctx: SimCtx,
  e: EventTemplate,
  fill: SlotFill,
  playerCast: string[],
  rng: Rng,
  report: YearReport,
  autoResolve: boolean,
  arcStep?: ArcStep,
): void {
  if (e.interaction.kind === 'narration') {
    const outcome = pickOutcome(e.interaction.outcomes, rng, ctx, e);
    const cast = autoCast(e, ctx, fill, playerCast, rng);
    const resolved = commitOutcome(ctx, e, outcome, cast, undefined, rng, arcStep);
    report.resolved.push(resolved);
    afterRecord(ctx, e, resolved.entryId, cast, rng, report, autoResolve);
    return;
  }

  // WHO DECIDES, asked before WHETHER ANYONE IS ASKED. An event whose branch
  // the family's own condition takes is not a question, so it does not go on
  // the docket even in `ask` mode — putting it there would be offering the
  // player a decision the content already said was not his.
  const scope = { arc: arcStep?.instance };
  const decided = decideBranch(ctx, e, fill, rng, { scope });

  if (decided.asks && !autoResolve) {
    report.pending.push(queueChoice(ctx, e, e.body, fill, playerCast, arcStep));
    return;
  }

  const cast = autoCast(e, ctx, fill, playerCast, rng);
  const choice = decided.choice ?? chroniclerBranch(ctx, e, e.interaction.choices, cast, rng, scope);
  const outcome = resolveChoiceOutcome(ctx, e, choice, cast, rng);
  const resolved = commitOutcome(ctx, e, outcome, cast, choice.id, rng, arcStep);
  report.resolved.push(resolved);
  afterRecord(ctx, e, resolved.entryId, cast, rng, report, autoResolve);
}

/**
 * What the chronicler answers when the player is not here.
 *
 * The important half is the first line. A `party` decider asked for a cast and
 * did not get one from a player, so `autoCast` supplied it — and now the check
 * pooled over exactly those people decides, exactly as it would have for the
 * player. Picking a branch at random instead would mean an event that delegates
 * to the family's competence behaves one way in the game and another in the
 * harness, which is the drift invariant 9 exists to prevent.
 *
 * Only a `player` decider falls past that line, and there the chronicler picks.
 * He is bound by `requires` exactly as the player is (issue #8) and falls back
 * to the full list only when NOTHING is open, because a decision with no legal
 * answer still has to resolve rather than stall the year.
 */
function chroniclerBranch(
  ctx: SimCtx,
  e: EventTemplate,
  choices: Choice[],
  cast: SlotFill,
  rng: Rng,
  scope: { arc?: ArcStep['instance'] },
): Choice {
  const withCast = decideBranch(ctx, e, cast, rng, { castReady: true, scope });
  if (withCast.choice) return withCast.choice;

  const open = choices.filter((c) => choiceAvailability(c, ctx, cast, e).available);
  return rng.pick(open.length ? open : choices);
}

function afterRecord(
  ctx: SimCtx,
  e: EventTemplate,
  entryId: string,
  fill: SlotFill,
  rng: Rng,
  report: YearReport,
  autoResolve: boolean,
): void {
  if (!e.record) return;
  if (autoResolve) applyRecord(ctx, e, entryId, autoRecordOption(rng), fill);
  else {
    const q = queueRecord(ctx, e, entryId, fill);
    if (q) report.pending.push(q);
  }
}
