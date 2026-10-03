import type { Effect, EventTemplate, Outcome, Person, Target } from '@ed/schema';
import { assertNever, canHoldPost, FREQUENCY_PROFILES, MAIN_BRANCH, RESPECT_ORDER, isActiveBranch } from '@ed/schema';
import { chronicleEntryId, type SimCtx, type WorldState } from '../world.js';
import type { SlotFill } from './slots.js';
import { castPeople, renderBody, soleCast } from './slots.js';
import { phenotypeOf } from '../people/factory.js';
import { BEARER, grantHeirloom, transferHeirloom, useHeirloom } from '../people/heirlooms.js';
import { beginStudy, degradeLibraryCopy, gainSpellbook, loseSpellbookKnowledge, spellbookDef } from '../people/library.js';
import { bindService, freeBond } from '../people/bond.js';
import { branchOf } from '../people/branches.js';
import { addGrudge, relate } from '../people/relationships.js';
import type { Rng } from '../rng.js';
import { birthTales } from './tales.js';
import { WARNING_TAG, noteUnheard, warningWeight } from '../bearing.js';
import { proseForOutcome } from '../prose.js';
import { performRite } from './rites.js';
import type { EvalScope } from './scope.js';
import { beginTutoring } from '../table.js';
import {
  addOfficer, beginCommitment, reinforceCommitment, setPosition, settleCommitment, withdrawCommitment,
} from '../muster.js';
import {
  damageParcel, encroachParcel, grantParcel, restoreParcel, seizeParcel,
} from '../land.js';

export function resolveTargets(t: Target, ctx: SimCtx, fill: SlotFill): Person[] {
  const w = ctx.world;
  if (typeof t === 'string') {
    switch (t) {
      case 'head': return w.people.living().filter((p) => p.castSlots.includes('head'));
      case 'household': return w.people.household(w.playerHouse, w.year);
      case 'all_blood': return w.people.blood(w.playerHouse).filter((p) => p.status === 'alive');
      case 'children_of_head': {
        const h = w.people.living().find((p) => p.castSlots.includes('head'));
        return h ? w.people.children(h.id).filter((p) => p.status === 'alive') : [];
      }
      default: return assertNever(t, 'target');
    }
  }
  /**
   * `slot` is ONE MAN, `all` is EVERY man the slot holds — and until counted
   * slots existed (issue #90) the two were the same line of code twice, which
   * is why `all` is in the schema and had never once meant anything.
   *
   * For a counted slot `slot` takes the first cast, which is an arbitrary man
   * out of up to five; `slots/counted` rejects that in authored content so the
   * arbitrariness is a validation error rather than four survivors.
   */
  if ('slot' in t) {
    const p = w.people.get(soleCast(fill, t.slot) ?? '');
    return p ? [p] : [];
  }
  return castPeople(fill, t.all, ctx);
}

/**
 * `scope` is threaded for exactly one effect kind — `arc_flag`, which writes
 * story-local memory and therefore has to know which story. Everything else
 * ignores it. See `scope.ts`.
 */
/**
 * THE LIE A SCENE REACHES WHEN IT DOES NOT NAME ONE (issue #71).
 *
 * Twenty-three sites create a Discrepancy under a literal id, and every Record
 * block the player embellishes creates one of its own. The second set is where
 * the standing lies in a real run come from, and no scene naming a literal id
 * can ever touch them — so burying could only ever answer content's own
 * twenty-three, which leaves §29.3's bill unanswerable in practice and turns a
 * bargain into a tax. §29.4's fifth rule is reversible by ACT.
 *
 * WHICH ONE. The worst the house has, and it is not a tidiness choice:
 * `unsupportable` weights by severity, so the lie that costs the most at the
 * term is the one a house spending real money to bury is spending it on. Ties
 * go to the oldest — `Map` keeps insertion order, so the thing the family has
 * been carrying longest goes down first, which is also the only ordering the
 * world can be said to have an opinion about.
 *
 * `provableBy` NARROWS rather than requires: a scene about the Church buries
 * something the Church could have proved, and a scene about the archive
 * buries something in the archive. A lie nobody in particular can prove is
 * reachable by any of them, because there is nobody specific to buy off.
 */
type OpenLie = WorldState['discrepancies'] extends Map<string, infer V> ? V : never;

function openLie(ctx: SimCtx, provableBy?: readonly string[]): OpenLie | undefined {
  const want = provableBy ?? [];
  let best: OpenLie | undefined;
  for (const d of ctx.world.discrepancies.values()) {
    if (d.state !== 'open') continue;
    if (want.length && d.provableBy.length && !d.provableBy.some((h) => want.includes(h))) continue;
    if (!best || rank(d.severity) > rank(best.severity)) best = d;
  }
  return best;
}

const SEVERITY_RANK: Record<string, number> = { minor: 1, major: 2, total: 3 };
const rank = (severity: string): number => SEVERITY_RANK[severity] ?? 1;

export function applyEffect(eff: Effect, ctx: SimCtx, fill: SlotFill, scope: EvalScope = {}): void {
  const w = ctx.world;

  switch (eff.kind) {
    // INVARIANT 6: derived state is not storage — this writes to `acquired`.
    case 'attribute': {
      for (const p of resolveTargets(eff.target, ctx, fill)) {
        // Into the ACQUIRED layer. Writing to the phenotype cache looks like
        // it works and is discarded the moment the year ticks over.
        p.acquired[eff.attr] = (p.acquired[eff.attr] ?? 0) + eff.delta;
        if (p.phenotype) p.phenotype.dirty = true;
      }
      break;
    }
    // INVARIANT 1: canExpress is the only Madness gate.
    case 'madness': {
      for (const p of resolveTargets(eff.target, ctx, fill)) {
        // The gate, enforced at runtime as well as in validation. Women and
        // mundane men cannot go mad, and no effect may make them.
        if (!phenotypeOf(p, ctx.genetics, w.year).eldritch.canExpress) continue;
        p.madness = Math.max(0, p.madness + eff.delta);
      }
      break;
    }
    case 'trait': {
      for (const p of resolveTargets(eff.target, ctx, fill)) {
        if (eff.op === 'add') p.traits.add(eff.trait as never);
        else p.traits.delete(eff.trait as never);
      }
      break;
    }
    case 'status': {
      for (const p of resolveTargets(eff.target, ctx, fill)) {
        if (eff.status === 'dead') w.people.kill(p.id, w.year, eff.cause ?? 'unrecorded');
        else p.status = eff.status as Person['status'];
      }
      break;
    }
    case 'treasury': w.treasury += eff.delta; break;
    case 'respect': {
      const i = RESPECT_ORDER.indexOf(w.respect);
      const next = RESPECT_ORDER[Math.max(0, Math.min(RESPECT_ORDER.length - 1, i + eff.delta))]!;
      // Restart the decay clock whichever way it moved: doing something
      // disgraceful is still doing something, and a house nobody is talking
      // about is the only house that fades.
      if (next !== w.respect) w.respectChanged = w.year;
      w.respect = next;
      break;
    }
    case 'flag': w.flags.set(eff.flag, eff.set); break;
    case 'knowledge':
      if (eff.op === 'grant') w.knowledge.add(eff.flag);
      else w.knowledge.delete(eff.flag);
      break;
    case 'clause': w.clausesRecovered.add(eff.reveal); break;
    case 'rumour': {
      if (eff.op === 'seed') w.rumours.set(eff.id, { accuracy: eff.accuracy ?? 0.5, spread: 1, seededYear: w.year });
      else if (eff.op === 'feed') {
        const r = w.rumours.get(eff.id);
        if (r) r.spread += 1;
      } else w.rumours.delete(eff.id);
      break;
    }
    // INVARIANT: a proven Discrepancy is the one downstream consequence
    // Record/Omit/Embellish had none of (issue #9) — without it, Embellish
    // costs the player nothing and the thesis of the game is unwired.
    case 'discrepancy': {
      if (eff.op === 'create') {
        // Validated: `discrepancy/wiring` rejects a create with no id.
        if (eff.id) {
          w.discrepancies.set(eff.id, { severity: eff.severity ?? 'minor', provableBy: eff.provableBy ?? [], state: 'open' });
        }
        break;
      }
      const d = eff.id ? w.discrepancies.get(eff.id) : openLie(ctx, eff.provableBy);
      if (!d) break;
      d.state = eff.op === 'prove' ? 'proven' : 'buried';
      if (eff.op === 'prove') {
        // A full tier. Being caught in the lie costs more than the truth
        // would have — that asymmetry is what makes Embellish a real bet.
        const i = RESPECT_ORDER.indexOf(w.respect);
        const next = RESPECT_ORDER[Math.max(0, i - 1)]!;
        if (next !== w.respect) w.respectChanged = w.year;
        w.respect = next;
      }
      break;
    }
    case 'branch': {
      // Named by one of its people, or else the angriest hall in the family.
      const named = eff.slot ? w.people.get(soleCast(fill, eff.slot) ?? '') : undefined;
      const key = named ? branchOf(w, named, w.year) : undefined;
      const target = key && key !== MAIN_BRANCH
        ? w.branches.get(key)
        : [...w.branches.values()]
          .filter(isActiveBranch)
          .sort((a, b) => b.grievance - a.grievance)[0];
      if (!target) break;
      const delta = eff.op === 'appease' ? -Math.abs(eff.amount) : Math.abs(eff.amount);
      target.grievance = Math.max(0, Math.min(100, target.grievance + delta));
      break;
    }
    case 'chronicle': w.chronicle.push({ year: w.year, weight: 'line', text: eff.text, named: false }); break;
    case 'schedule': w.scheduled.push({ event: eff.event, year: w.year + eff.inYears }); break;
    case 'relationship': {
      // This case used to say "handled by its own subsystem" and break. There
      // was no subsystem: four authored outcomes, including the seal feud's
      // inherited grudge, discarded themselves here in silence.
      const from = resolveTargets(eff.from, ctx, fill);
      const to = resolveTargets(eff.to, ctx, fill);
      for (const a of from) {
        for (const b of to) {
          if (a.id === b.id) continue;
          const x = a.id;
          const y = b.id;
          if (eff.sentiment !== undefined) relate(w, x, y, eff.sentiment);
          // A grudge is taken by the injured party, so it points back the way
          // the sentiment came: `from` wronged `to`, and `to` remembers.
          if (eff.grudge) {
            addGrudge(ctx, y, x, eff.grudge, scope.event?.id ?? 'unrecorded', scope.page);
          }
        }
      }
      break;
    }
    case 'recast': {
      // Free the slot's occupant from the role so `maintainCast` refills it.
      //
      // The role comes from the TEMPLATE, not from a guess. This line used to
      // read `s !== 'head'`, hardcoded, which is right for `{slot: HEAD}` and
      // wrong for every other slot in the game: it left a freed VESSEL still
      // cast as `family_member` and, if that person happened to hold the seal,
      // quietly took it off them instead.
      const role = scope.event?.slots[eff.slot]?.role;
      const p = w.people.get(soleCast(fill, eff.slot) ?? '');
      if (role && p) p.castSlots = p.castSlots.filter((s) => s !== role);
      break;
    }
    /**
     * A RITE OF THE LADDER (§22, issue #43). Two people, named by slot,
     * because a rite is a thing one person has done to another — `resolveTargets`
     * takes one `Target` and every other effect in the game is about one side.
     *
     * The work is in `events/rites.ts`; this case only finds the two people.
     * A rite that cannot find them does nothing and says so, rather than
     * consuming whoever the household happened to list first.
     */
    case 'rite': {
      const ascendant = w.people.get(soleCast(fill, eff.ascendant) ?? '');
      const subject = eff.subject ? w.people.get(soleCast(fill, eff.subject) ?? '') : undefined;
      if (!ascendant) break;
      performRite(ctx, eff.rite, ascendant, subject, eff.cause);
      break;
    }
    case 'arc': {
      // `start` is handled at commit time, where the slot fill is available to
      // seed the new instance's bindings. The other two belong here.
      if (eff.op === 'start') break;
      for (const inst of w.arcs.values()) {
        if (inst.arc !== eff.arc || inst.status !== 'active') continue;
        if (eff.op === 'cancel') inst.status = 'cancelled';
        else inst.dueYear = w.year;      // advance: due now, resolves next tick
      }
      break;
    }
    // The other half of `arcFlag`. An event firing outside an arc has nowhere
    // to write, which `arcs/flags` fails the build over rather than leaving it
    // to be discovered as a successor that never takes the branch it should.
    case 'arc_flag': {
      if (scope.arc) scope.arc.localFlags[eff.flag] = eff.set;
      break;
    }
    case 'heirloom': {
      if (eff.op === 'grant') { grantHeirloom(ctx, eff.heirloom); break; }
      if (eff.op === 'use') {
        const slot = eff.to ?? BEARER;
        const bearer = w.people.get(soleCast(fill, slot) ?? '');
        if (bearer) useHeirloom(ctx, eff.heirloom, bearer);
        break;
      }
      // `transfer`: declared in the schema, handled nowhere — `op` is not the
      // discriminant `applyEffect` switches on, so `assertNever` could not
      // catch this falling through and doing nothing. The auction needs it.
      if (eff.op === 'transfer') { transferHeirloom(ctx, eff.heirloom); break; }
      assertNever(eff.op, 'heirloom op');
    }
    // The Library (§12, issue #15). `degrade` acts on the shelf copy directly —
    // wear is a property of the physical book, not of any one reader — so it
    // ignores `target`; `gain`/`lose` act on `Person.spellsKnown`.
    case 'spellbook': {
      if (eff.op === 'degrade') { degradeLibraryCopy(ctx, eff.book); break; }
      const def = spellbookDef(ctx, eff.book);
      if (!def) break;
      for (const p of resolveTargets(eff.target, ctx, fill)) {
        if (eff.op === 'gain') gainSpellbook(ctx, p, def);
        else if (eff.op === 'study') beginStudy(ctx, p, def);
        else loseSpellbookKnowledge(ctx, p, eff.book);
      }
      break;
    }
    // The forging path (issue #19, concept §7). The one place
    // `claimedParents` can diverge from `trueParents` after bootstrap — every
    // pedigree the player breeds against downstream of this reads the
    // CLAIMED line, so a false grandmother moves `pedigreeF` exactly as far
    // as the forgery claims, while `realizedHomozygosity` never moves at all.
    // THE BOND (world §12). Only ever a term of a contract somebody already
    // holds: `bindService` and `freeBond` both refuse anyone without one, so a
    // scene written against a stranger does nothing rather than inventing a
    // servant to do it to.
    case 'bond': {
      for (const p of resolveTargets(eff.target, ctx, fill)) {
        if (eff.op === 'bind') bindService(ctx, p, eff.marks);
        else freeBond(ctx, p);
      }
      break;
    }
    case 'marriage': {
      for (const p of resolveTargets(eff.target, ctx, fill)) w.people.closeMarriage(p.id, w.year);
      break;
    }
    case 'priorityMatch': {
      for (const p of resolveTargets(eff.target, ctx, fill)) {
        if (!w.priorityMatch.includes(p.id)) w.priorityMatch.push(p.id);
      }
      break;
    }
    case 'forge_lineage': {
      const claimedId = soleCast(fill, eff.claimedAs);
      if (!claimedId) break;
      for (const p of resolveTargets(eff.target, ctx, fill)) {
        p.claimedParents = { ...p.claimedParents, [eff.parent]: claimedId };
        p.lineageDocuments.push({
          generations: eff.generations,
          notarisedBy: eff.notarisedBy,
          forged: true,
          claims: `${eff.parent} of good blood, ${eff.generations} generations documented`,
        });
      }
      break;
    }
    // Careers (issue #16). Respect is bought with descendants — the costs
    // (breeding-pool exclusion, mortality) are read from `Person.career`
    // directly by `demography.ts`, not applied here.
    //
    // INVARIANT A placement names a career that exists, and nobody is placed
    // under its `minAge`. Both used to be written straight through. An unknown
    // id produced a `Person.career` that every reader resolved to `undefined`,
    // so the placement paid no income, no Respect and no cost — a career held
    // by a man for fifty years that was never once a career. `minAge` was
    // declared with a default of 16 and read by nothing, which is the same bug
    // one field along: it is the only reason a commission cannot be bought for
    // a four-year-old, and it was not a reason, because nothing asked.
    //
    // INVARIANT And the post is a man's — `canHoldPost` (schema/career.ts) is
    // the only placement gate. This is the last of its three doors, and it is
    // the quiet one: an outcome whose slot forgot `{ sex: male }` casts a
    // daughter, and every reader of `Person.career` then treats her as a
    // soldier or a priest. The `careers/gate` validation rule refuses that
    // bundle so this branch never has to be reached in a shipped build; it is
    // here because a rule covers the content in the repository and this covers
    // the content that has not been written yet. `leave` is not gated — a post
    // wrongly held is a post that may be given up.
    case 'career': {
      for (const p of resolveTargets(eff.target, ctx, fill)) {
        if (eff.op === 'leave') { p.career = undefined; continue; }
        if (!eff.career) continue;
        if (!canHoldPost(p.sex)) continue;
        const def = ctx.content.career(eff.career);
        if (!def) continue;
        if (w.year - p.born < def.minAge) continue;
        p.career = { career: eff.career as never, from: w.year };
      }
      break;
    }
    // A TUTOR'S TERM (§13, issue #128). `beginTutoring` is the ONE gate — the
    // player's order calls the same function — so this cannot drift into a
    // second copy of `canBeTaught` that forgets a body attribute, Madness or
    // Eldritch Power are not a thing a tutor teaches. `cancel` just drops
    // whatever term the target is in, if any; no refund, same as the order.
    case 'tutor': {
      for (const p of resolveTargets(eff.target, ctx, fill)) {
        if (eff.op === 'cancel') { w.tutoring = w.tutoring.filter((t) => t.person !== p.id); continue; }
        beginTutoring(ctx, p, eff.attr);
      }
      break;
    }
    // THE MUSTER (issue #89, Stage 2 — #95). At most one commitment is ever
    // `in_the_field`, so every op but `begin` acts on whichever one is
    // standing and does nothing if none is — an event that refuses this
    // way still fires, still writes its chronicle line, and this is the one
    // place that can say so instead of silently doing nothing (invariant 11).
    case 'muster': {
      switch (eff.op) {
        case 'begin':
          beginCommitment(ctx, eff.men ?? 0, eff.age ?? '');
          break;
        case 'reinforce':
          reinforceCommitment(ctx, eff.men ?? 0, eff.from);
          break;
        case 'add_officer':
          if (eff.officer) {
            for (const p of resolveTargets(eff.officer, ctx, fill)) addOfficer(ctx, p.id);
          }
          break;
        case 'set_position':
          if (eff.position) setPosition(ctx, eff.position);
          break;
        case 'settle':
          settleCommitment(ctx);
          break;
        case 'withdraw':
          withdrawCommitment(ctx);
          break;
        // No `default`: `op` is a closed Zod enum and every value has a case
        // above — TypeScript narrows `eff` itself to `never` past the last
        // one, so an `assertNever` here would be dispatching on a value that
        // provably cannot exist rather than guarding one that could.
      }
      break;
    }
    // LAND (issue #91, Phase D — #98). Every op is a no-op on the wrong
    // precondition (already held, not held) rather than a throw — the event
    // firing this already gated on `holdsParcel`, and this is what makes that
    // gate load-bearing rather than decorative. See the Effect's own doc in
    // `event.ts` for why a no-op here is correct rather than a stub.
    case 'land': {
      switch (eff.op) {
        case 'grant':
          grantParcel(ctx, eff.parcel);
          break;
        case 'seize':
          seizeParcel(ctx, eff.parcel);
          break;
        case 'damage':
          damageParcel(ctx, eff.parcel, eff.magnitude);
          break;
        case 'restore':
          restoreParcel(ctx, eff.parcel, eff.magnitude);
          break;
        case 'encroach':
          encroachParcel(ctx, eff.parcel, scope.page);
          break;
        // No `default`: `op` is a closed Zod enum, same reasoning as `muster` above.
      }
      break;
    }
    default:
      // Adding an Effect kind is now a compile error here, which is the whole
      // point of the union being closed. `kind: relationship` sat in this
      // switch with a comment saying another subsystem handled it; there was no
      // other subsystem, and four authored outcomes discarded themselves in
      // silence for as long as that comment was true.
      assertNever(eff, 'effect');
  }
}

/**
 * `outcome_weight` (issue #11) — a household trait can bias which outcome an
 * outcome group lands on, once it is reached, by tag. Multiplicative and
 * per-holder: two traits matching the same outcome compound.
 */
function outcomeWeightMultiplier(o: Outcome, ctx: SimCtx): number {
  let mult = 1;
  const w = ctx.world;
  for (const p of w.people.household(w.playerHouse, w.year)) {
    for (const tid of p.traits) {
      const trait = ctx.content.trait(tid);
      if (!trait) continue;
      for (const pres of trait.presence) {
        for (const m of pres.modifiers) {
          if (m.kind === 'outcome_weight' && m.match.tags.some((t) => o.tags.includes(t))) mult *= m.multiply;
        }
      }
    }
  }
  return mult;
}

/**
 * THE HOUSE STOPS BEING TOLD (§29 stage 3, issue #45).
 *
 * An outcome tagged `warning` is the branch where the retainer says the thing,
 * and a house the world has come to read as carrying itself gets it less often
 * — down to a fifth of the time at the top of the reading. It is a weight and
 * not a gate on purpose: a hard cutoff is a rule a player can name, and rule 1
 * of §29 is that this is never named.
 *
 * `event` is threaded here for one reason: when a warning was on the table and
 * was not the branch taken, that is written down (`noteUnheard`). Every
 * warning withheld leaves a trace the player can find later — without it,
 * suppressed information is indistinguishable from bad dice.
 */
export function pickOutcome(outcomes: Outcome[], rng: Rng, ctx: SimCtx, event?: EventTemplate): Outcome {
  const suppression = warningWeight(ctx);
  const weigh = (o: Outcome) => o.weight * outcomeWeightMultiplier(o, ctx)
    * (o.tags.includes(WARNING_TAG) ? suppression : 1);

  const picked = rng.weighted(outcomes, weigh) ?? outcomes[0]!;
  const hadOne = outcomes.some((o) => o.tags.includes(WARNING_TAG));
  if (hadOne && !picked.tags.includes(WARNING_TAG)) noteUnheard(ctx, event?.id ?? 'unnamed');
  return picked;
}

export interface ResolvedEvent {
  event: EventTemplate;
  outcome: Outcome;
  text: string;
  fill: SlotFill;
  /** The chronicle entry this outcome created. See `applyRecord` (issue #8). */
  entryId: string;
}

export function applyOutcome(
  e: EventTemplate,
  outcome: Outcome,
  ctx: SimCtx,
  fill: SlotFill,
  scope: EvalScope = {},
): ResolvedEvent {
  // Allocate before effects: an effect may create a delayed consequence that
  // needs to remember the page this outcome is about to write (#269).
  const entryId = chronicleEntryId(ctx);
  // The template and its page join the scope here rather than being passed
  // separately: recast needs the role, and provenance needs the page.
  const inner: EvalScope = { ...scope, event: e, page: entryId };
  for (const eff of outcome.effects) applyEffect(eff, ctx, fill, inner);

  const text = renderBody(proseForOutcome(ctx, e, outcome), fill, ctx);
  const profile = FREQUENCY_PROFILES[e.frequency];
  const people = [...new Set(Object.values(fill).flatMap((cast) =>
    typeof cast === 'string' ? [cast] : cast))];

  // Frequency decides how the chronicle renders it. In a game whose artefact
  // IS the chronicle, this is where the tier is felt rather than computed.
  ctx.world.chronicle.push({
    id: entryId,
    year: ctx.world.year,
    weight: profile.chronicle,
    title: profile.named ? e.title : undefined,
    text,
    eventId: e.id,
    named: profile.named,
    ...(people.length ? { people } : {}),
  });

  // Rare and Mythic always enter folklore. Common never does.
  if (profile.rumour === 'always' && e.rumour) {
    ctx.world.rumours.set(e.rumour.id, { accuracy: e.rumour.accuracy, spread: e.rumour.spread, seededYear: ctx.world.year });
  }

  birthTales(e, ctx);

  return { event: e, outcome, text, fill, entryId };
}
