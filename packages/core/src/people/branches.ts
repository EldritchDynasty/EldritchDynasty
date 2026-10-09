import type { BranchId, BranchState, Person, PersonId, Year } from '@ed/schema';
import { MAIN_BRANCH, asId, isActiveBranch } from '@ed/schema';
import type { SimCtx, WorldState } from '../world.js';
import { phenotypeOf } from './factory.js';
import { escheatBranchLand } from '../land.js';
import { msg } from '../messages.js';

/**
 * CADET BRANCHES (concept §16). See `schema/src/branch.ts` for what a branch
 * is and why the family needs more than one household.
 *
 * Everything here is structural rather than random. A son leaves when his
 * brother takes the seal, not when a die says so — which means the player can
 * see it coming, and a house that keeps its heir alive keeps its hall full.
 */

/** A man does not found a hall at nineteen. */
export const CADET_AGE = 24;

/**
 * Halls, not people. Five is enough for the family to have cousins it has
 * never met and few enough that the tree stays readable. Past the cap, younger
 * sons stay put and take the crowding brake, exactly as they did before.
 */
export const MAX_ACTIVE_BRANCHES = 5;

/** A cadet hall is a smaller thing than the seat. */
export const BRANCH_SOFT_CAP = 8;

/**
 * Grievance. The baseline drifts DOWN — a branch with nothing to complain
 * about forgets, slowly, and by the third generation the split is just how the
 * family is arranged. It only climbs while there is a live reason, which is
 * what keeps the aggrieved branch to one or two rather than all five.
 */
const GRIEVANCE_FADE = -0.08;
const GRIEVANCE_PASSED_OVER = 0.55;
const GRIEVANCE_REGENCY = 0.25;
const GRIEVANCE_HONOURED = 45;

/**
 * "Loyal, funny, warm, and increasingly aggrieved" (§16). The increasingly is
 * this: a hall that has stood two generations and never once been sent for.
 */
const GRIEVANCE_NEVER_SENT_FOR = 0.35;
const NEVER_SENT_FOR_AFTER = 60;

/** Demigod Stagnation (§22): the same man, in the same chair, for too long. */
const GRIEVANCE_LONG_REIGN = 0.2;
const LONG_REIGN_YEARS = 45;

/**
 * THE SCION IS FED, AND A HALL NOTICES WHICH SON (issue #61, Stage C).
 *
 * Concentration is not a free mechanic. The scion draws the house's
 * book-years, its tutor money and its best marriage cards toward one man,
 * which means every hall that is not his gets less — the currency issue #85
 * asked for, made visible rather than a number moving quietly somewhere the
 * player never looks. Set beside `GRIEVANCE_LONG_REIGN` on purpose: a
 * background pressure a house lives with, not a crisis on the scale of
 * being passed over outright.
 */
const GRIEVANCE_SCION_FED = 0.2;

/** How fast the house's own temperature follows its branches. */
const DISCONTENT_LAG = 0.04;

export function branchOf(w: WorldState, p: Person, year: Year): string {
  const m = p.membership.find((x) => x.from <= year && (x.to === undefined || x.to > year));
  if (!m || m.house !== w.playerHouse) return MAIN_BRANCH;
  return m.branch ?? MAIN_BRANCH;
}

/** Everyone of the house alive this year, grouped by the hall they live in. */
// INVARIANT 13: a hall is not a house. This splits the household; it does not split the house.
export function halls(w: WorldState, year: Year): Map<string, Person[]> {
  const out = new Map<string, Person[]>([[MAIN_BRANCH, []]]);
  for (const p of w.people.household(w.playerHouse, year)) {
    const key = branchOf(w, p, year);
    const bucket = out.get(key);
    if (bucket) bucket.push(p);
    else out.set(key, [p]);
  }
  return out;
}

export function hall(w: WorldState, branch: string, year: Year): Person[] {
  return halls(w, year).get(branch) ?? [];
}

export function activeBranches(w: WorldState): BranchState[] {
  return [...w.branches.values()].filter(isActiveBranch);
}

export function softCapFor(branch: string): number {
  return branch === MAIN_BRANCH ? MAIN_HALL_SOFT_CAP : BRANCH_SOFT_CAP;
}

/**
 * The seat itself. A great house with sixty mouths and one seal is a house
 * with a succession problem, not a bigger house.
 */
export const MAIN_HALL_SOFT_CAP = 14;

/** Move a person into another hall, keeping the kind of membership they had. */
function moveTo(w: WorldState, p: Person, branch: string, kind?: Person['membership'][number]['kind']): void {
  const current = p.membership.find((m) => m.to === undefined);
  const settled = kind ?? current?.kind ?? 'blood';
  if (current) {
    if ((current.branch ?? MAIN_BRANCH) === branch && current.kind === settled) return;
    current.to = w.year;
  }
  const record: Person['membership'][number] = {
    house: asId(w.playerHouse),
    kind: settled,
    from: w.year,
  };
  if (branch !== MAIN_BRANCH) record.branch = branch;
  p.membership.push(record);
}

/**
 * Who speaks for a hall, WITHOUT electing anybody. The main hall's speaker is
 * the Head, by definition.
 *
 * Split out of `speakerOf` because that function records its answer, and a
 * READING must not: `cast.ts` asks which hall carries the wound and who speaks
 * for it, and the first cut of that quietly elected speakers in half the
 * branches every time a client drew a panel (invariant 6, and the save proved
 * it). `speakerOf` is this plus the writing down.
 */
export function wouldSpeakFor(ctx: SimCtx, branch: string): Person | undefined {
  const w = ctx.world;
  const members = hall(w, branch, w.year);
  if (branch === MAIN_BRANCH) return members.find((p) => p.castSlots.includes('head'));

  const b = w.branches.get(branch);
  const sitting = b?.speaker ? w.people.get(b.speaker) : undefined;
  if (sitting && sitting.status === 'alive' && branchOf(w, sitting, w.year) === branch) return sitting;

  const adults = members.filter((p) => w.year - p.born >= 16 && !p.contract);
  return adults.filter((p) => p.sex === 'male').sort((a, x) => a.born - x.born)[0]
    ?? adults.sort((a, x) => a.born - x.born)[0]
    ?? members.sort((a, x) => a.born - x.born)[0];
}

/** Who speaks for a hall, and remembers it. The simulation's version. */
export function speakerOf(ctx: SimCtx, branch: string): Person | undefined {
  const next = wouldSpeakFor(ctx, branch);
  const b = ctx.world.branches.get(branch);
  if (b && next && branch !== MAIN_BRANCH) b.speaker = next.id;
  return next;
}

/**
 * Step six of the core loop: name an heir, and everyone else becomes a cadet
 * branch.
 *
 * The rule is deliberately not "younger sons leave". It is "men of the blood
 * who are not the speaker and not the speaker's children leave" — which means
 * sons stay while their father holds the hall and go the year their brother
 * takes it. The timing falls out of succession instead of being scheduled
 * against it, so nothing has to stay in step with anything.
 */
// INVARIANT 12: nothing takes the seal out of the main house — every mover is
// checked against `castSlots.includes('head')` before a hall changes hands.
export function settleBranches(ctx: SimCtx): BranchState[] {
  const w = ctx.world;
  const founded: BranchState[] = [];

  reapExtinct(ctx);

  for (const [key, members] of halls(w, w.year)) {
    const speaker = speakerOf(ctx, key);
    if (!speaker) continue;

    const leavers = members
      .filter((p) => qualifiesToLeave(w, p, speaker))
      .sort((a, b) => a.born - b.born);

    for (const p of leavers) {
      if (activeBranches(w).length >= MAX_ACTIVE_BRANCHES) break;
      founded.push(foundBranch(ctx, p, key));
    }
  }

  return founded;
}

function qualifiesToLeave(w: WorldState, p: Person, speaker: Person): boolean {
  if (p.id === speaker.id) return false;
  if (p.castSlots.includes('head')) return false;   // belt and braces: not the seal
  if (p.status !== 'alive') return false;
  if (p.sex !== 'male') return false;
  if (p.contract) return false;                       // retainers serve a hall, not a line
  if (w.year - p.born < CADET_AGE) return false;

  const current = p.membership.find((m) => m.to === undefined);
  if (!current || (current.kind !== 'blood' && current.kind !== 'cadet')) return false;

  // A son does not leave while his father holds the hall.
  if (p.trueParents.father === speaker.id || p.trueParents.mother === speaker.id) return false;
  return true;
}

function foundBranch(ctx: SimCtx, founder: Person, splitFrom: string): BranchState {
  const w = ctx.world;
  const id = asId<BranchId>(`br_${(w.counters.branch += 1).toString(36)}`);

  const branch: BranchState = {
    id,
    name: msg(ctx, 'branches.name', "{FOUNDER}'s line", { FOUNDER: founder.name }),
    house: asId(w.playerHouse),
    founder: founder.id,
    splitFrom,
    foundedYear: w.year,
    speaker: founder.id,
    grievance: 0,
  };
  w.branches.set(id, branch);

  moveTo(w, founder, id, 'cadet');

  // A man takes his household with him: his wife, and the children still under
  // his roof. Leaving them behind is how you get orphans in a full house.
  for (const m of founder.marriages) {
    if (m.to !== undefined) continue;
    const spouse = w.people.get(m.spouse);
    // Not the seal, on either count. During a Regency the Head is a woman of
    // the blood, and if her husband founded a hall he took her — and the whole
    // main house — out of the main house with him.
    if (!spouse || spouse.status !== 'alive' || spouse.castSlots.includes('head')) continue;
    moveTo(w, spouse, id);
  }
  for (const child of w.people.children(founder.id)) {
    if (child.status !== 'alive') continue;
    if (branchOf(w, child, w.year) !== splitFrom) continue;
    if (child.marriages.some((m) => m.to === undefined)) continue;
    // NEVER the seal. A man leaving to found a hall takes his unmarried
    // children with him, and if one of them happened to be the sitting Head he
    // took the head of the family out of the main house — after which
    // `speakerOf` found no head in the main hall, so nobody there could ever
    // leave again, and succession never noticed because the seat was filled.
    if (child.castSlots.includes('head')) continue;
    moveTo(w, child, id);
  }

  w.chronicle.push({
    year: w.year,
    weight: 'paragraph',
    title: msg(ctx, 'branches.founded.title', 'A Second Roof'),
    text: msg(ctx, 'branches.founded.text', '{FOUNDER} took the east rooms and then took a house of his own, which the family called generous and the family called sensible, and which was both. He kept the name. He did not keep the seal.', { FOUNDER: founder.name }),
    named: false,
  });

  return branch;
}

/**
 * The wound the Head is too busy to notice.
 *
 * A branch does not become dangerous because it is poor. It becomes dangerous
 * because it holds a man who could have led, and watches somebody lesser hold
 * the seal for thirty years.
 */
export function tickBranches(ctx: SimCtx): void {
  const w = ctx.world;
  reapExtinct(ctx);

  const head = w.people.living().find((p) => p.castSlots.includes('head'));
  const headExpresses = head ? phenotypeOf(head, ctx.genetics, w.year).eldritch.canExpress : false;
  const regency = head?.sex === 'female';
  // Tenure, not age. Measuring this off the head's birth year meant an old man
  // who inherited last spring counted as a forty-year reign.
  const longReign = head && w.headSince !== undefined
    ? w.year - w.headSince > LONG_REIGN_YEARS
    : false;

  const live = activeBranches(w);
  let total = 0;

  for (const b of live) {
    const members = hall(w, b.id, w.year);
    let delta = GRIEVANCE_FADE;

    // The wound: this hall holds a man who could have led, and did not.
    const passedOver = !headExpresses && members.some(
      (p) => p.sex === 'male'
        && w.year - p.born >= 16
        && phenotypeOf(p, ctx.genetics, w.year).eldritch.canExpress,
    );
    if (passedOver) delta += GRIEVANCE_PASSED_OVER;
    if (regency) delta += GRIEVANCE_REGENCY;
    if (longReign) delta += GRIEVANCE_LONG_REIGN;
    if (!b.heldSeal && w.year - b.foundedYear > NEVER_SENT_FOR_AFTER) delta += GRIEVANCE_NEVER_SENT_FOR;
    // THE SCION IS FED, AND THIS HALL IS NOT (issue #61, Stage C). Never for
    // the hall that holds him — his own branch is not being passed over by
    // the programme, it IS the programme.
    if (w.scion && !members.some((p) => p.id === w.scion)) delta += GRIEVANCE_SCION_FED;
    // THE HEIR IS FED TOO (issue #61, Stage E4), same rule, added rather
    // than replacing: a hall holding neither reads the grievance twice,
    // because the programme now costs the rest of the family twice as
    // much — both the Scion's books and the heir's, both his tutor's terms
    // and the heir's, out of the same finite house. A hall holding one of
    // the pair is only half passed over.
    if (w.scionHeir && !members.some((p) => p.id === w.scionHeir)) delta += GRIEVANCE_SCION_FED;

    b.grievance = Math.max(0, Math.min(100, b.grievance + delta));
    total += b.grievance;
  }

  /**
   * Discontent is a TEMPERATURE, not a tally. It was an accumulator, and an
   * accumulator with no ceiling reads "furious" by 1400 in every run whatever
   * the player did — a gate that is always open is not a gate. It follows the
   * branches slowly, so a house can be talked down, and the annual economy can
   * still spike it by going broke.
   */
  const target = live.length ? total / live.length : 0;
  w.discontent = Math.max(0, Math.min(100, w.discontent + (target - w.discontent) * DISCONTENT_LAG));
}

function reapExtinct(ctx: SimCtx): void {
  const w = ctx.world;
  const populated = halls(w, w.year);
  for (const b of activeBranches(w)) {
    const key = b.id;
    if ((populated.get(key) ?? []).length) continue;
    b.extinct = w.year;
    b.speaker = undefined;
    // Greyed, per concept §6: the chronicle shows what is known to have
    // existed and to be gone. Players will screenshot the grey.
    // Escheat, come home (issue #91, Stage H): ground endowed to a branch
    // that has nobody left to answer for it returns to the house that
    // granted it, before the "ended" line below so the plat and the
    // chronicle agree about which happened first.
    escheatBranchLand(ctx, key);
    w.chronicle.push({
      year: w.year,
      weight: 'line',
      text: msg(ctx, 'branches.extinct', '{BRANCH} ended, {YEARS} years after it began.', {
        BRANCH: b.name, YEARS: String(w.year - b.foundedYear),
      }),
      named: false,
      greyed: true,
    });
  }
}

/**
 * Calling a cousin home.
 *
 * Succession scans the whole house, cadets included, so a branch man can be
 * named Head without this — but he cannot RULE from the branch hall. Bringing
 * him in dissolves nothing: his branch keeps going under a new speaker, and
 * it stops being aggrieved, because one of theirs is sitting in the chair.
 */
export function recallToMain(ctx: SimCtx, p: Person): void {
  const w = ctx.world;
  const from = branchOf(w, p, w.year);
  if (from === MAIN_BRANCH) return;

  moveTo(w, p, MAIN_BRANCH, 'blood');
  for (const m of p.marriages) {
    if (m.to !== undefined) continue;
    const spouse = w.people.get(m.spouse);
    if (spouse && spouse.status === 'alive') moveTo(w, spouse, MAIN_BRANCH);
  }
  for (const child of w.people.children(p.id)) {
    if (child.status !== 'alive') continue;
    if (branchOf(w, child, w.year) !== from) continue;
    if (child.marriages.some((x) => x.to === undefined)) continue;
    moveTo(w, child, MAIN_BRANCH, 'blood');
  }

  const b = w.branches.get(from);
  if (b) {
    b.recalled = w.year;
    b.heldSeal = w.year;
    b.grievance = Math.max(0, b.grievance - GRIEVANCE_HONOURED);
    if (b.speaker === p.id) b.speaker = undefined;
  }

  w.chronicle.push({
    year: w.year,
    weight: 'paragraph',
    title: msg(ctx, 'branches.recalled.title', 'They Sent for the Cousin'),
    text: msg(ctx, 'branches.recalled.text', '{PERSON} was born in the smaller house and had not expected to see the inside of the seal room. He was sent for in the winter and the road was bad. Nobody in the main line had thought about him in thirty years, and every one of them knew his name by spring.', { PERSON: p.name }),
    named: false,
  });
}

/** Diagnostics for the editor and the harness. */
export function branchReport(ctx: SimCtx): {
  id: string;
  name: string;
  founded: Year;
  members: number;
  grievance: number;
  extinct?: Year;
  speaker?: PersonId;
}[] {
  const w = ctx.world;
  const populated = halls(w, w.year);
  return [...w.branches.values()].map((b) => ({
    id: b.id,
    name: b.name,
    founded: b.foundedYear,
    members: (populated.get(b.id) ?? []).length,
    grievance: Math.round(b.grievance),
    extinct: b.extinct,
    speaker: b.speaker,
  }));
}
