/**
 * Headless harness. For a game where one playthrough is 8-12 hours, batch
 * simulation is the only viable balance method — this is the thing that
 * answers "is the God rung actually reachable" before anyone plays for eleven
 * hours to find out it is not.
 *
 *   npx tsx packages/core/src/harness.ts 24 500
 */
import { loadContent } from '@ed/content';
import { MAIN_BRANCH, validateBundle } from '@ed/schema';
import { stepYear } from './sim.js';
import { inRegency } from './world.js';
import { phenotypeOf } from './people/factory.js';
import { activeBranches, halls } from './people/branches.js';
import { CAMPAIGN_YEARS, END_YEAR } from './campaign.js';
import { bootstrapRun, runSetupFlags, runSetupLabel, type RunSetup } from './tools/run-setup.js';

export interface RunStats {
  seed: number;
  people: number;
  living: number;
  /** Mean living player-household size sampled once per played year. */
  meanHousehold: number;
  /** Mean children borne by women whose childbearing years are complete. */
  meanFamily: number;
  maxFont: number;
  maxExpressed: number;
  maxMadness: number;
  madWomen: number;
  madIncapable: number;

  /**
   * THE REGENCY RATE (open question §12 q2).
   *
   * `regencyYears` was declared here, hardcoded to 0, and never printed;
   * `ensureHead` returns `{ regency }` and its only caller discards it. So the
   * one number the design says to tune outsider `fontCarrierRate` against —
   * "target a median of one Regency per 8-12 generations, rather than setting
   * the rate and hoping" — has never been measured.
   *
   * Spells, not years, is the unit that answers it: a Regency is an event in the
   * life of the house, and a long one is still one.
   */
  regencyYears: number;
  regencySpells: number;
  generations: number;

  /**
   * The other half of q2. Null-font sons drive Regency frequency and are the
   * only men who cannot go mad — too few and marrying outward carries no real
   * threat, too many and the Barren Generation becomes the weather.
   */
  sons: number;
  mundaneSons: number;

  frequency: Record<string, number>;
  ageSpans: { age: string; span: number }[];
  /** Which Ages happened at all. An Age nobody sees is content nobody authors. */
  agesOccurred: string[];
  /** eventId -> times fired this run. The fire-rate gate reads this. */
  templateFires: Record<string, number>;
  chronicleEntries: number;
  /** The frame (concept §2, issue #13). Design target is 12-18 per run. */
  frameEntries: number;

  /** Cadet branches (concept §16). A run with none is a run with one household. */
  mainHall: number;
  branchesLive: number;
  branchesEver: number;
  branchesRecalled: number;
  grievance: number;
  discontent: number;

  /** What the chronicler did with the Record blocks he was offered. */
  recorded: number;
  omitted: number;
  embellished: number;

  /** The Ledger (§18), standing (§17) and old quarrels (§7). */
  clauses: number;
  respect: string;
  grudges: number;
  oldestGrudge: number;
  retainers: number;
  /** Mean loyalty across the staff in post. Set at hire and never moved, this was a constant. */
  loyalty: number;
  /** Secrets carried out of the house by released retainers, and the ones since told. */
  secretsLoose: number;
  secretsTold: number;
  discrepanciesOpen: number;

  /**
   * Careers (issue #16). The reason this line exists: the whole subsystem
   * shipped with no content that could write `Person.career`, and a run with
   * zero placements is indistinguishable here from a run with the feature
   * removed. `placements` counts everyone who ever held a post, living or
   * dead, so a zero is a door that was never cut rather than a generation
   * that happened not to buy one.
   */
  placements: number;
  placementsBy: Record<string, number>;
}

export function runOnce(seed: number, years: number, setup: RunSetup = {}): RunStats {
  const bundle = loadContent();
  const ctx = bootstrapRun(bundle, seed, setup);

  const w = ctx.world;

  // `runYears` is exactly this loop; it is spelled out only so the Regency can
  // be sampled while the run is happening. Whether a woman holds the seat is
  // state rather than an event, so there is no report field to read it off
  // afterwards — by 2042 every Regency in the run is over.
  let regencyYears = 0;
  let regencySpells = 0;
  let householdYears = 0;
  let wasRegency = inRegency(w);
  for (let i = 0; i < years; i++) {
    stepYear(ctx);
    householdYears += w.people.household(w.playerHouse, w.year).length;
    const now = inRegency(w);
    if (now) regencyYears += 1;
    if (now && !wasRegency) regencySpells += 1;
    wasRegency = now;
  }

  let maxFont = 0, maxExpressed = 0, maxMadness = 0, madWomen = 0, madIncapable = 0;

  for (const p of w.people.all()) {
    const ph = phenotypeOf(p, ctx.genetics, w.year);
    maxFont = Math.max(maxFont, ph.eldritch.carriedFont);
    maxExpressed = Math.max(maxExpressed, ph.eldritch.expressedPower);
    maxMadness = Math.max(maxMadness, p.madness);
    if (p.madness > 0 && p.sex === 'female') madWomen++;
    if (p.madness > 0 && !ph.eldritch.canExpress) madIncapable++;
  }

  // Sons of the blood, not every male who ever lived under the roof: a husband
  // married in carries no font of this family and is not evidence about it.
  let sons = 0, mundaneSons = 0;
  for (const p of w.people.blood(w.playerHouse)) {
    if (p.sex !== 'male') continue;
    sons += 1;
    if (phenotypeOf(p, ctx.genetics, w.year).eldritch.carriedFont === 0) mundaneSons += 1;
  }

  const live = activeBranches(w);
  const records = w.chronicle.filter((c) => c.record !== undefined);
  const completedFamilies = w.people.all()
    .filter((p) => p.sex === 'female' && (p.died ?? w.year) - p.born > 45)
    .map((p) => w.people.children(p.id).length);

  return {
    seed,
    people: w.people.size,
    living: w.people.living().length,
    meanHousehold: round(householdYears / Math.max(1, years)),
    meanFamily: round(completedFamilies.reduce((a, n) => a + n, 0) / Math.max(1, completedFamilies.length)),
    maxFont: round(maxFont),
    maxExpressed: round(maxExpressed),
    maxMadness: round(maxMadness),
    madWomen,
    madIncapable,
    regencyYears,
    regencySpells,
    generations: w.generation,
    sons,
    mundaneSons,
    frequency: { ...w.frequency.firedThisRun },
    ageSpans: w.age.ended.map((e) => ({ age: e.age, span: e.ended - e.began })),
    // Ended and still running both count as having happened. An Age the run is
    // in the middle of at 2042 is one the player saw.
    agesOccurred: [...new Set([...w.age.ended.map((e) => e.age), ...w.age.active.map((a) => a.age)])],
    templateFires: { ...w.frequency.templateFires },
    chronicleEntries: w.chronicle.length,
    frameEntries: w.frame.entries.length,

    mainHall: (halls(w, w.year).get(MAIN_BRANCH) ?? []).length,
    branchesLive: live.length,
    branchesEver: w.branches.size,
    branchesRecalled: [...w.branches.values()].filter((b) => b.recalled !== undefined).length,
    grievance: round(live.reduce((a, b) => a + b.grievance, 0) / Math.max(1, live.length)),
    discontent: round(w.discontent),

    recorded: records.filter((c) => c.record === 'record').length,
    omitted: records.filter((c) => c.record === 'omit').length,
    embellished: records.filter((c) => c.record === 'embellish').length,

    clauses: w.clausesRecovered.size,
    respect: w.respect,
    grudges: [...w.relationships.values()].reduce((a, r) => a + r.grudges.length, 0),
    oldestGrudge: [...w.relationships.values()]
      .flatMap((r) => r.grudges)
      .reduce((m, g) => Math.max(m, w.year - g.originYear), 0),
    retainers: w.people.living().filter((p) => p.contract).length,
    loyalty: round(w.people.living().reduce((a, p) => a + (p.contract?.loyalty ?? 0), 0)
      / Math.max(1, w.people.living().filter((p) => p.contract).length)),
    /**
     * Secrets that walked out of the house, and the ones that got told. Zero
     * told across a batch is the mechanism not reaching a real run — which is
     * exactly the state `knowsSecrets` was in before it had one.
     */
    secretsLoose: w.looseSecrets.length,
    secretsTold: w.looseSecrets.filter((l) => l.told !== undefined).length,
    discrepanciesOpen: [...w.discrepancies.values()].filter((d) => d.state === 'open').length,

    placements: w.people.all().filter((p) => p.career).length,
    placementsBy: w.people.all().reduce<Record<string, number>>((acc, p) => {
      if (p.career) acc[p.career.career] = (acc[p.career.career] ?? 0) + 1;
      return acc;
    }, {}),
  };
}

const round = (n: number) => Math.round(n * 10) / 10;

export function batch(runs: number, years: number, setup: RunSetup = {}): void {
  const bundle = loadContent();
  const issues = validateBundle(bundle);
  const errors = issues.filter((i) => i.level === 'error');
  console.log(`content: ${bundle.events.length} events, ${bundle.ages.length} ages, ${bundle.loci.length} loci · ${runSetupLabel(setup)}`);
  console.log(`validation: ${errors.length} errors, ${issues.length - errors.length} warnings`);
  for (const e of errors) console.log(`  ERROR ${e.where}: ${e.message}`);

  const all: RunStats[] = [];
  for (let i = 0; i < runs; i++) all.push(runOnce(1000 + i * 7, years, setup));

  const avg = (f: (s: RunStats) => number) => round(all.reduce((a, s) => a + f(s), 0) / all.length);

  console.log(`\n${runs} runs x ${years} years`);
  console.log(`  people/run        ${avg((s) => s.people)}   living at end ${avg((s) => s.living)}`);
  console.log(`  mean household    ${avg((s) => s.meanHousehold)}   completed family ${avg((s) => s.meanFamily)}`);
  console.log(`  max carried font  ${avg((s) => s.maxFont)}`);
  console.log(`  max expressed EP  ${avg((s) => s.maxExpressed)}`);
  console.log(`  max madness       ${avg((s) => s.maxMadness)}`);
  console.log(`  chronicle entries ${avg((s) => s.chronicleEntries)}`);
  console.log(`  frame interludes  ${avg((s) => s.frameEntries)}   (target 12-18)`);

  // Cadet branches. A run showing 0 founded is the old behaviour — one
  // household, damped by the crowding brake, for a thousand years.
  console.log('\n  the halls:');
  console.log(`    main hall         ${avg((s) => s.mainHall)}  of ${avg((s) => s.living)} living`);
  console.log(`    branches          ${avg((s) => s.branchesLive)} live / ${avg((s) => s.branchesEver)} ever founded`);
  console.log(`    seal to a cadet   ${avg((s) => s.branchesRecalled)} branches, per run`);
  console.log(`    grievance         ${avg((s) => s.grievance)}   discontent ${avg((s) => s.discontent)}`);

  console.log('\n  the record (what the chronicler did with it):');
  console.log(`    recorded ${avg((s) => s.recorded)}   omitted ${avg((s) => s.omitted)}   embellished ${avg((s) => s.embellished)}`);

  // The Ledger. A run showing 9.0 every time is the calendar handing over the
  // contract; a run showing 2.0 is a house that never kept an archivist. Both
  // should happen, and the God rung needs seven.
  const clauses = all.map((s) => s.clauses).sort((a, b) => a - b);
  console.log('\n  the Ledger and the world:');
  console.log(`    clauses recovered ${avg((s) => s.clauses)}   (min ${clauses[0]}, max ${clauses[clauses.length - 1]}, `
    + `${all.filter((s) => s.clauses >= 7).length}/${runs} reach the God gate of 7)`);
  const tiers = new Map<string, number>();
  for (const s of all) tiers.set(s.respect, (tiers.get(s.respect) ?? 0) + 1);
  console.log(`    standing at ${END_YEAR}  ${[...tiers].map(([k, v]) => `${k} ${v}`).join(' · ')}`);
  console.log(`    live grudges      ${avg((s) => s.grudges)}   oldest ${avg((s) => s.oldestGrudge)} years`);
  console.log(`    retainers in post ${avg((s) => s.retainers)}   mean loyalty ${avg((s) => s.loyalty)}`);
  console.log(`    secrets walked    ${avg((s) => s.secretsLoose)}   told ${avg((s) => s.secretsTold)}`
    + `   open Discrepancies ${avg((s) => s.discrepanciesOpen)}`);

  // Respect is bought with descendants, or it is not bought. A zero here is
  // the bug this line was added for, not a quiet run.
  const byCareer = new Map<string, number>();
  for (const s of all) for (const [id, n] of Object.entries(s.placementsBy)) {
    byCareer.set(id, (byCareer.get(id) ?? 0) + n);
  }
  const spread = [...byCareer].sort((a, b) => b[1] - a[1]).map(([id, n]) => `${id} ${n}`).join(' · ');
  console.log(`    career placements ${avg((s) => s.placements)}/run   ${spread || 'NONE — nothing ever wrote Person.career'}`);

  console.log('\n  events fired by frequency (mean per run):');
  for (const f of ['common', 'uncommon', 'rare', 'mythic']) {
    console.log(`    ${f.padEnd(9)} ${avg((s) => s.frequency[f] ?? 0)}`);
  }

  // THE GENETICS THE DESIGN SAYS TO TUNE AGAINST (open questions §12 q2).
  // Both of these were unmeasurable until now, and the brief's instruction on
  // both is the same: do not set the rate and hope, hit the target.
  const spells = all.reduce((a, s) => a + s.regencySpells, 0);
  const gens = all.reduce((a, s) => a + s.generations, 0);
  const perRegency = spells ? round(gens / spells) : Infinity;
  const sons = all.reduce((a, s) => a + s.sons, 0);
  const mundane = all.reduce((a, s) => a + s.mundaneSons, 0);
  console.log('\n  the female half of the game:');
  console.log(`    regencies         ${avg((s) => s.regencySpells)}/run, ${avg((s) => s.regencyYears)} years`
    + `   one per ${perRegency} generations  (target 8-12)`);
  console.log(`    mundane sons      ${sons ? round((100 * mundane) / sons) : 0}%  (${mundane}/${sons} of the blood carry no font)`);

  const spans = new Map<string, number[]>();
  for (const s of all) for (const a of s.ageSpans) spans.set(a.age, [...(spans.get(a.age) ?? []), a.span]);

  // Occurrence is a separate question from duration, and the more urgent one:
  // an Age appearing in 4% of runs is an Age whose exclusive content will
  // never be seen, however well its spans match what was authored.
  const occurred = new Map<string, number>();
  for (const s of all) for (const a of s.agesOccurred) occurred.set(a, (occurred.get(a) ?? 0) + 1);
  console.log('\n  age spans (min / median / max, years) and how many runs saw one:');
  for (const age of [...new Set([...spans.keys(), ...occurred.keys()])].sort()) {
    const xs = spans.get(age) ?? [];
    const sorted = [...xs].sort((a, b) => a - b);
    const shape = xs.length
      ? `${sorted[0]} / ${sorted[Math.floor(sorted.length / 2)]} / ${sorted[sorted.length - 1]}`
      : '- / - / -';
    const seen = occurred.get(age) ?? 0;
    console.log(`    ${age.padEnd(20)} ${shape.padEnd(16)} ${Math.round((100 * seen) / all.length)}% of runs (n=${xs.length})`);
  }
  const unseen = bundle.ages.filter((a) => !occurred.has(String(a.id)));
  if (unseen.length) console.log(`    NEVER OCCURRED: ${unseen.map((a) => a.id).join(', ')}`);

  // Per-template fire rate. `firedThisRun` above counts by tier, which cannot
  // distinguish four hundred events the player sees from four hundred events
  // of which he sees twelve.
  const fires = new Map<string, number>();
  for (const s of all) for (const [id, n] of Object.entries(s.templateFires)) {
    if (n > 0) fires.set(id, (fires.get(id) ?? 0) + 1);
  }
  const rates = bundle.events
    .filter((e) => e.tier !== 'frame')
    .map((e) => ({ id: String(e.id), pct: (100 * (fires.get(String(e.id)) ?? 0)) / all.length }))
    .sort((a, b) => a.pct - b.pct);
  console.log('\n  rarest events (% of runs that saw one at all):');
  for (const r of rates.slice(0, 8)) console.log(`    ${r.id.padEnd(34)} ${round(r.pct)}%`);
  const never = rates.filter((r) => r.pct === 0);
  if (never.length) console.log(`    NEVER FIRED: ${never.map((r) => r.id).join(', ')}`);

  const madW = all.reduce((a, s) => a + s.madWomen, 0);
  const madI = all.reduce((a, s) => a + s.madIncapable, 0);
  console.log(`\n  INVARIANTS  mad women: ${madW}   mad-but-incapable: ${madI}   (both must be 0)`);
}

const isMain = process.argv[1]?.replace(/\\/g, '/').endsWith('harness.ts');
if (isMain) {
  const args = process.argv.slice(2);
  const positional = args.filter((a) => !a.startsWith('--'));
  batch(Number(positional[0] ?? 16), Number(positional[1] ?? CAMPAIGN_YEARS), runSetupFlags(args));
}
