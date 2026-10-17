import type { Condition, Filter, Person } from '@ed/schema';
import { assertNever, compare, RESPECT_ORDER, RUNG_ORDER } from '@ed/schema';
import { inRegency, type SimCtx } from '../world.js';
import { attr, phenotypeOf } from '../people/factory.js';
import { activeBranches } from '../people/branches.js';
import { grudgeAgainstUs } from '../people/relationships.js';
import { isBonded } from '../people/bond.js';
import { influencedAttr } from './influence.js';
import { rungIndex, standingOf } from '../ascension.js';
import type { EvalScope } from './scope.js';
import { castPeople, type SlotFill } from './fill.js';
import { heldAcres, heldParcels } from '../land.js';
import { livingBlood } from '../ending.js';
import { campaignDef, campaignProgress } from '../campaign.js';
import { minimumArcYears } from './arc-reach.js';

/**
 * `scope` carries what the world does not know: which substory is asking. Only
 * `arcFlag` and `arcVisited` read it, and the recursion below MUST forward it —
 * a combinator that dropped it would make `{ all: [{ arcFlag: 'paid' }] }` mean
 * something different from `{ arcFlag: 'paid' }`, which is the sort of bug that
 * looks like flaky content.
 */
export function evalCondition(c: Condition | undefined, ctx: SimCtx, scope: EvalScope = {}): boolean {
  if (!c) return true;
  const w = ctx.world;

  if ('all' in c) return c.all.every((x) => evalCondition(x, ctx, scope));
  if ('any' in c) return c.any.some((x) => evalCondition(x, ctx, scope));
  if ('not' in c) return !evalCondition(c.not, ctx, scope);

  if ('flag' in c) {
    const v = w.flags.get(c.flag);
    return c.is === false ? !v : Boolean(v);
  }
  if ('knowledge' in c) return w.knowledge.has(c.knowledge) === c.has;
  if ('respect' in c) {
    return compare(RESPECT_ORDER.indexOf(w.respect), c.respect.op, RESPECT_ORDER.indexOf(c.respect.tier));
  }
  if ('year' in c) return compare(w.year, c.year.op, c.year.value);
  if ('campaignProgress' in c) return compare(campaignProgress(w.year, campaignDef(w.campaign)), c.campaignProgress.op, c.campaignProgress.value);
  if ('generation' in c) return compare(w.generation, c.generation.op, c.generation.value);
  if ('treasury' in c) return compare(w.treasury, c.treasury.op, c.treasury.value);
  if ('clausesRecovered' in c) return compare(w.clausesRecovered.size, c.clausesRecovered.op, c.clausesRecovered.value);
  if ('familySize' in c) return compare(w.people.household(w.playerHouse, w.year).length, c.familySize.op, c.familySize.value);
  if ('bloodCount' in c) return compare(livingBlood(w), c.bloodCount.op, c.bloodCount.value);

  if ('familyAny' in c) {
    return w.people
      .household(w.playerHouse, w.year)
      .some((p) => attr(p, c.familyAny.attr, ctx.genetics, w.year) >= c.familyAny.atLeast);
  }
  if ('hasExpressingHead' in c) {
    const h = w.people.living().find((p) => p.castSlots.includes('head'));
    const yes = h ? phenotypeOf(h, ctx.genetics, w.year).eldritch.canExpress : false;
    return yes === c.hasExpressingHead;
  }
  if ('inRegency' in c) return inRegency(w) === c.inRegency;

  // ── Cadet branches (concept §16, §22) ──────────────────────────────────
  if ('cadetBranches' in c) {
    return compare(activeBranches(w).length, c.cadetBranches.op, c.cadetBranches.value);
  }
  if ('branchGrievance' in c) {
    const worst = activeBranches(w).reduce((m, b) => Math.max(m, b.grievance), 0);
    return compare(worst, c.branchGrievance.op, c.branchGrievance.value);
  }
  if ('discontent' in c) return compare(w.discontent, c.discontent.op, c.discontent.value);
  if ('grudgeAgainstUs' in c) {
    return compare(grudgeAgainstUs(w), c.grudgeAgainstUs.op, c.grudgeAgainstUs.value);
  }

  // ── Age gating ─────────────────────────────────────────────────────────
  if ('ageActive' in c) return w.age.active.some((a) => a.age === c.ageActive);
  if ('ageRegister' in c) {
    return w.age.active.some((a) => ctx.content.age(a.age)?.register === c.ageRegister);
  }
  if ('ageElapsed' in c) {
    return w.age.active.some((a) => compare(w.year - a.began, c.ageElapsed.op, c.ageElapsed.years));
  }
  if ('ageStacked' in c) return compare(w.age.active.length, c.ageStacked.op, c.ageStacked.count);
  if ('ageNamed' in c) return w.age.active.some((a) => a.named === c.ageNamed);
  // The run's clock in Ages rather than in years (issue #46). `ended` only,
  // so a house halfway through its fourth Age has lived through three.
  if ('agesElapsed' in c) return compare(w.age.ended.length, c.agesElapsed.op, c.agesElapsed.value);

  // ── Discrepancies (issue #9) ───────────────────────────────────────────
  if ('discrepancy' in c) {
    const d = w.discrepancies.get(c.discrepancy);
    return c.state !== undefined ? d?.state === c.state : d !== undefined;
  }
  if ('openDiscrepancies' in c) {
    const open = [...w.discrepancies.values()].filter((d) => d.state === 'open').length;
    return compare(open, c.openDiscrepancies.op, c.openDiscrepancies.value);
  }
  // The Assize's last reading (`assize.ts`). Read off the world rather than
  // recomputed, so an event and the phase that acted this year agree about
  // which way the wind was blowing.
  if ('assize' in c) return compare(w.assize.pressure, c.assize.op, c.assize.value);
  // Bearing (`bearing.ts`, §29), read off the score the phase wrote for the
  // same reason the Assize is: the event and the year that acted agree.
  if ('bearing' in c) return compare(w.bearing.score, c.bearing.op, c.bearing.value);
  // The warnings nobody gave (§29 stage 3). Counted, not scored: what content
  // wants to know is whether there is anything for a rival to have noticed.
  if ('unheard' in c) return compare(w.bearing.unheard.length, c.unheard.op, c.unheard.value);
  // The ladder (`ascension.ts`, §22). `best` asks the high-water mark — what
  // the family EVER reached — which is what a scene about a dead Hierophant
  // needs; without it, such a scene would stop being reachable the year he died.
  if ('ascension' in c) {
    const held = c.ascension.best ? w.ascension.best : w.ascension.rung;
    return RUNG_ORDER.indexOf(held) >= RUNG_ORDER.indexOf(c.ascension.atLeast);
  }

  // ── Arc memory ──────────────────────────────────────────────────────────
  // No arc in scope means no story is asking, and a story-local memory has no
  // answer for the ambient pool. FALSE, not true: a permissive default here
  // would fire every event gated on a substory's progress in every run,
  // including the runs where that substory never started.
  if ('arcFlag' in c) {
    if (!scope.arc) return false;
    const v = scope.arc.localFlags[c.arcFlag];
    return c.is === undefined ? Boolean(v) : v === c.is;
  }
  if ('arcVisited' in c) {
    if (!scope.arc) return false;
    return scope.arc.history.some((h) => h.node === c.arcVisited);
  }

  // ── Unlocks (issue #11) ─────────────────────────────────────────────────
  if ('unlocked' in c) {
    return w.people.household(w.playerHouse, w.year).some((p) => [...p.traits].some((tid) => {
      const trait = ctx.content.trait(tid);
      return trait?.presence.some((pres) => pres.modifiers.some((m) => m.kind === 'unlock' && m.grants === c.unlocked)) ?? false;
    }));
  }

  // ── Posts and schooling (issue #126) ────────────────────────────────────
  if ('posts' in c) {
    const held = w.people.household(w.playerHouse, w.year)
      .filter((p) => p.career !== undefined && (!c.posts.career || c.posts.career.includes(String(p.career.career))));
    return compare(held.length, c.posts.op, c.posts.value);
  }
  if ('postHeldFor' in c) {
    const holders = w.people.household(w.playerHouse, w.year)
      .filter((p) => p.career !== undefined && String(p.career.career) === c.postHeldFor.career);
    if (!holders.length) return false;
    const longest = Math.max(...holders.map((p) => w.year - p.career!.from));
    return compare(longest, c.postHeldFor.op, c.postHeldFor.years);
  }

  // ── Land (issue #91, Phase D — #98) ─────────────────────────────────────
  if ('holdsParcel' in c) {
    return heldParcels(ctx).some((state) => state.defId === c.holdsParcel);
  }
  if ('acreage' in c) {
    return compare(heldAcres(ctx), c.acreage.op, c.acreage.value);
  }

  // ── The derived start window (issue #91, Stage H) ───────────────────────
  if ('arcCanFinish' in c) {
    const arc = ctx.content.arc(c.arcCanFinish);
    if (!arc) return false; // an unresolved reference refuses, the same reading `discrepancy` gives one
    // `minimumArcYears` is `startArc`'s own refusal check (#133), read here
    // as a CONTENT-facing gate instead of an engine-side backstop — so a
    // scene that would start this arc is never OFFERED once it is already
    // too late, rather than being offered and then silently doing nothing
    // the moment the player takes it.
    const shortest = minimumArcYears(arc);
    // Infinity means the walk found no finite route to 'end' at all (every
    // successor loops) — a shape this rule has nothing to say about, so it
    // does not refuse an arc it cannot measure.
    if (!Number.isFinite(shortest)) return true;
    return campaignDef(w.campaign).endYear - w.year >= shortest;
  }

  // This used to be `return true`, which is the most expensive default in the
  // codebase: a condition kind added to the schema and not handled here does
  // not fail — it PASSES, so every event carrying it fires unconditionally, for
  // a thousand years, looking exactly like content that was meant to be common.
  return assertNever(c, 'condition');
}

/**
 * `role` is the slot ROLE `p` is being tested as a candidate for — supplied
 * by `candidatesFor`, which is the only caller that knows it — so an
 * `attribute` modifier's `slot` target (issue #11) can apply here exactly as
 * it would once `p` is actually cast. Omitted by callers with no slot in
 * play (e.g. heirloom eligibility), which is "not being cast anywhere."
 */
export function evalFilter(f: Filter, p: Person, ctx: SimCtx, bound: SlotFill, role?: string): boolean {
  const w = ctx.world;
  if ('all' in f) return f.all.every((x) => evalFilter(x, p, ctx, bound, role));
  if ('any' in f) return f.any.some((x) => evalFilter(x, p, ctx, bound, role));
  if ('not' in f) return !evalFilter(f.not, p, ctx, bound, role);

  if ('attr' in f) return compare(influencedAttr(ctx, p, f.attr, role), f.op, f.value);
  if ('trait' in f) return p.traits.has(f.trait as never) === f.has;
  if ('tag' in f) return p.castSlots.includes(f.tag) === f.has;
  if ('sex' in f) return p.sex === f.sex;
  if ('age' in f) return compare(w.year - p.born, f.age.op, f.age.value);
  if ('status' in f) return f.status.includes(p.status);
  if ('membership' in f) return p.membership.some((m) => f.membership.includes(m.kind) && m.to === undefined);
  if ('career' in f) return p.career !== undefined && f.career.includes(p.career.career);
  if ('awakened' in f) return p.awakening.awakened === f.awakened;
  // World §12. Read off the contract rather than a membership kind: a bond is a
  // TERM of service, not a class of person, and this world has no second kind.
  if ('bonded' in f) return isBonded(p) === f.bonded;
  if ('canExpress' in f) return phenotypeOf(p, ctx.genetics, w.year).eldritch.canExpress === f.canExpress;
  if ('declaredMundane' in f) return p.awakening.declaredMundane === f.declaredMundane;
  // WHERE THIS MAN STANDS, THIS INSTANT — as against the `ascension`
  // condition, which asks where the HOUSE stood when the ladder was last
  // measured, and that is the second-to-last phase of the year. A template
  // gated on the house and cast on `foremost` can therefore be handed a man
  // who never climbed, once the man who did has died or been charged past his
  // own mind earlier in the same year. `standingOf` is a live reading.
  if ('rung' in f) return rungIndex(standingOf(ctx, p).rung) >= rungIndex(f.rung.atLeast);
  // WHAT HE DID, as against where he stands. The Great Rite widens a man
  // without moving him a rung, so "has been made into something" is not a
  // question `rung` can answer (§22, issue #43).
  if ('rite' in f) return p.rites.includes(f.rite.taken);

  if ('relation' in f) {
    /**
     * A COUNTERPART MAY BE SEVERAL PEOPLE. `f.of` names a slot, and a counted
     * slot holds a party (issue #90) — so `not` means none of them and every
     * other relation means any of them. That is also what makes a party narrow
     * within itself: `castParty` puts the members cast so far in `bound` under
     * the slot's own name before drawing the next one, so `not: SENT` on the
     * SENT slot casts distinct men without a line of its own.
     *
     * An uncast counterpart still PASSES — a comparison with nobody is not one
     * this can judge, and `slots/references` is the rule that stops an author
     * relying on a filter that can never see its counterpart.
     */
    const others = castPeople(bound, f.of, ctx);
    if (!others.length) return true;
    switch (f.relation) {
      case 'not': return others.every((o) => p.id !== o.id);
      case 'child_of': return others.some((o) => p.trueParents.mother === o.id || p.trueParents.father === o.id);
      case 'descendant_of': return others.some((o) => {
        const seen = new Set<string>();
        const pending = [p.trueParents.mother, p.trueParents.father];
        while (pending.length) {
          const id = pending.pop();
          if (!id || seen.has(id)) continue;
          if (id === o.id) return true;
          seen.add(id);
          const parent = w.people.get(id);
          if (parent) pending.push(parent.trueParents.mother, parent.trueParents.father);
        }
        return false;
      });
      case 'sibling_of': return others.some((o) => w.people.siblings(o.id).some((s) => s.id === p.id));
      case 'spouse_of': return others.some((o) => p.marriages.some((m) => m.spouse === o.id && !m.to));
      case 'blood_of': return others.some((o) => p.membership.some((m) => m.kind === 'blood' && o.membership.some((n) => n.house === m.house)));
      default: return assertNever(f.relation, 'relation filter');
    }
  }

  /**
   * EXCEEDS A NAMED COUNTERPART, on one of the three quantities §22's God
   * gate compares (issue #61). Same uncast-passes rule as `relation`, for the
   * same reason — a comparison with nobody is not one this can judge — and
   * the same live reading `rung` already uses, off the same `standingOf`.
   * `.every`, not `.some`: a counted counterpart-slot would otherwise let
   * "exceeds ELDER" pass by beating the weakest of several, which is not what
   * exceeding a named party means.
   */
  if ('exceeds' in f) {
    const others = castPeople(bound, f.exceeds.of, ctx);
    if (!others.length) return true;
    const mine = standingOf(ctx, p)[f.exceeds.on];
    return others.every((o) => mine > standingOf(ctx, o)[f.exceeds.on]);
  }
  // WAS THIS PERSON SCHOOLED, as against whether they happen to be clever.
  // `acquired` mixes a tutor's gain with every other effect that can touch an
  // attribute; `taught` is set only where a term actually completed.
  if ('taught' in f) return f.taught.attr !== undefined ? p.taught.includes(f.taught.attr) : p.taught.length > 0;
  // MID-TERM RIGHT NOW, as against `taught`'s "ever completed one".
  if ('inTerm' in f) return w.tutoring.some((t) => t.person === p.id) === f.inTerm;

  // A filter kind nothing handles used to pass, which means a slot spec written
  // against it cast ANYONE. Same default, same cost, same fix as above.
  return assertNever(f, 'filter');
}
