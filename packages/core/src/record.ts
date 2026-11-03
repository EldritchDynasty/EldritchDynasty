import type { Claim, Person, ResolvedClaim } from '@ed/schema';
import type { SimCtx } from './world.js';
import type { SlotFill } from './events/slots.js';
import { resolveTargets } from './events/effects.js';
import { attr, genomeOf, phenotypeOf } from './people/factory.js';
import { realizedHomozygosity as homozygosityOfGenome } from './genetics/expression.js';

/**
 * THE RECORD LAYER (issue #19) — what the chronicle SAYS, not what happened.
 *
 * `RecordView` is derived from `world.chronicle` on every read, never stored:
 * one source of truth for the lie, on the same principle as invariant 6 (the
 * phenotype cache is derived from the genome; this is derived from the
 * record). `divergence` non-empty is exactly sigil drift — the tree draws the
 * recorded person, hover shows the real one.
 */
export interface RecordView {
  person: string;
  /** Claimed values, keyed by attribute id. Only present for attributes the chronicle has actually spoken about. */
  attrs: Map<string, number>;
  claimedTraits: Set<string>;
  claimedDeath?: { year: number; cause: string };
  /** `attr:<id>`, `trait:<id>`, or `death` — non-empty means sigil drift. */
  divergence: Set<string>;
}

/** A `Claim`'s `target` resolved to the people it actually names, at the moment it was made. */
export function resolveClaim(claim: Claim, ctx: SimCtx, fill: SlotFill): ResolvedClaim[] {
  return resolveTargets(claim.target, ctx, fill).map((p): ResolvedClaim => {
    switch (claim.kind) {
      case 'attr': return { kind: 'attr', person: p.id, attr: claim.attr, value: claim.value };
      case 'trait': return { kind: 'trait', person: p.id, trait: claim.trait, has: claim.has };
      case 'death': return { kind: 'death', person: p.id, year: claim.year ?? ctx.world.year, cause: claim.cause };
      case 'deed': return { kind: 'deed', person: p.id, text: claim.text };
    }
  });
}

/**
 * The tolerance an attribute claim has to miss the real value by before it
 * counts as a divergence — a claim of 61 for a Strength of 60.6 is not a lie,
 * it is a chronicler rounding. Anything past this is the family's story
 * disagreeing with the body.
 */
const ATTR_DIVERGENCE_TOLERANCE = 1.5;

/**
 * The real value of a recordable attribute. Almost all of them are genome
 * expression and `attr()` answers directly — but `madness` and
 * `eldritch_power` are the two attributes `recordable: true` was actually
 * authored for (AGENTS.md: "declared, authored twice... and read by
 * nothing"), and neither is a genome-expressed attribute at all: `madness`
 * accrues on `Person.madness` and `eldritch_power` lives on the phenotype's
 * `eldritch.expressedPower`. `attr()` would silently read 0 for both.
 */
function realAttrValue(ctx: SimCtx, p: Person, attrId: string): number {
  if (attrId === 'madness') return p.madness;
  if (attrId === 'eldritch_power') return phenotypeOf(p, ctx.genetics, ctx.world.year).eldritch.expressedPower;
  return attr(p, attrId, ctx.genetics, ctx.world.year);
}

/**
 * Fold every claim the chronicle has ever made about `personId` into one
 * picture, latest claim per fact winning — the family's story evolves, and
 * `RecordView` is what it currently says, not an argument between decades.
 */
export function deriveRecordView(ctx: SimCtx, personId: string): RecordView {
  const w = ctx.world;
  const p = w.people.get(personId as never);

  const attrs = new Map<string, number>();
  const claimedTraits = new Set<string>(p ? [...p.traits].map(String) : []);
  let claimedDeath: { year: number; cause: string } | undefined;

  for (const entry of w.chronicle) {
    // A restored future page cannot change what the family's Record says today.
    if (entry.year > w.year || !entry.claims?.length) continue;
    for (const claim of entry.claims) {
      if (claim.person !== personId) continue;
      if (claim.kind === 'attr') {
        if (!ctx.content.attribute(claim.attr)?.recordable) continue;
        attrs.set(claim.attr, claim.value);
      } else if (claim.kind === 'trait') {
        if (claim.has) claimedTraits.add(claim.trait);
        else claimedTraits.delete(claim.trait);
      } else if (claim.kind === 'death') {
        claimedDeath = { year: claim.year, cause: claim.cause };
      }
      // `deed` claims are narrative colour — there is no mechanical "true
      // deed" to diverge from, so they do not feed `divergence` below.
    }
  }

  const divergence = new Set<string>();
  if (p) {
    for (const [attrId, claimed] of attrs) {
      const real = realAttrValue(ctx, p, attrId);
      if (Math.abs(claimed - real) > ATTR_DIVERGENCE_TOLERANCE) divergence.add(`attr:${attrId}`);
    }
    for (const t of claimedTraits) if (!p.traits.has(t as never)) divergence.add(`trait:${t}`);
    for (const t of p.traits) if (!claimedTraits.has(String(t))) divergence.add(`trait:${t}`);
    if (claimedDeath) {
      const trueYear = p.died;
      if (trueYear === undefined || claimedDeath.year !== trueYear || claimedDeath.cause !== p.causeOfDeath) {
        divergence.add('death');
      }
    }
  }

  const view: RecordView = { person: personId, attrs, claimedTraits, divergence };
  if (claimedDeath) view.claimedDeath = claimedDeath;
  return view;
}

// ── The perception layer: reveal_signs (issue #11's own gap, closed here) ──

/** The household's total sign-reading power — a trait's `reveal_signs` modifier, summed. */
export function revealPower(ctx: SimCtx, roster: Person[]): number {
  let power = 0;
  for (const p of roster) {
    for (const tid of p.traits) {
      const trait = ctx.content.trait(tid);
      if (!trait) continue;
      for (const pres of trait.presence) {
        for (const m of pres.modifiers) {
          if (m.kind === 'reveal_signs') power += m.power;
        }
      }
    }
  }
  return power;
}

/**
 * What the household actually SEES. A house with enough sign-reading power in
 * residence is not fooled by its own record — this is the perception layer
 * `reveal_signs` was declared for, and had no consumer until now.
 */
export function visibleRecordView(ctx: SimCtx, personId: string, roster: Person[]): RecordView {
  const view = deriveRecordView(ctx, personId);
  if (revealPower(ctx, roster) < 1) return view;

  const p = ctx.world.people.get(personId as never);
  if (!p) return view;
  const seenThrough: RecordView = {
    person: personId,
    attrs: new Map([...view.attrs.keys()].map((k) => [k, realAttrValue(ctx, p, k)])),
    claimedTraits: new Set([...p.traits].map(String)),
    divergence: new Set(),
  };
  // A restored future death has not happened in the year being read.
  if (p.died !== undefined && p.died <= ctx.world.year) {
    seenThrough.claimedDeath = { year: p.died, cause: p.causeOfDeath ?? 'unrecorded' };
  }
  return seenThrough;
}

// ── Pedigree F vs realized homozygosity — the forged-dowry economy ─────────

/**
 * How many generations of CLAIMED ancestry a pedigree calculation walks.
 * Deep enough to catch a first-cousin marriage (2) with room to spare.
 */
export const PEDIGREE_DEPTH = 6;

/** Every claimed ancestor of `start`, by shortest distance in generations. Does not include `start` itself. */
function ancestorDepths(ctx: SimCtx, start: string | undefined, maxDepth: number): Map<string, number> {
  const depths = new Map<string, number>();
  if (!start) return depths;
  let frontier = [start];
  for (let depth = 1; depth <= maxDepth && frontier.length; depth++) {
    const next: string[] = [];
    for (const id of frontier) {
      const person = ctx.world.people.get(id as never);
      if (!person) continue;
      for (const parentId of [person.claimedParents.mother, person.claimedParents.father]) {
        if (!parentId || depths.has(parentId)) continue;
        depths.set(parentId, depth);
        next.push(parentId);
      }
    }
    frontier = next;
  }
  return depths;
}

/**
 * The inbreeding coefficient AS THE FAMILY'S OWN DOCUMENTS WOULD CALCULATE
 * IT — Wright's path-counting formula, F = Σ (1/2)^(n1+n2+1) over every
 * ancestor common to both `claimedParents` lines, walked from the CLAIMED
 * pedigree rather than the true one. Ancestors' own F is treated as zero
 * (the standard shallow-pedigree approximation) — good enough for a document
 * nobody is meant to be able to check against a genome anyway.
 *
 * This is deliberately blind to a forged lineage: a claimed grandmother who
 * is not the real one moves this number exactly as far as the forgery says
 * she should. See `realizedHomozygosity` for the number the body actually has.
 */
/**
 * The same number, for a marriage that has not happened yet: F of the child
 * these two WOULD have, from the claimed pedigree. This is what a suitor card
 * puts in front of the player (`people/match.ts`) — 0.0625 is first cousins,
 * 0.25 is a match the Church would have opinions about, 0 is a stranger.
 *
 * Blind to forgery in exactly the same way and for exactly the same reason: a
 * house that bought a grandmother is a house whose cousin now reads as a
 * stranger on the only document anybody can check.
 */
export function matchF(ctx: SimCtx, aId: string, bId: string): number {
  const withSelf = (id: string): Map<string, number> => {
    const depths = ancestorDepths(ctx, id, PEDIGREE_DEPTH);
    depths.set(id, 0);
    return depths;
  };
  const a = withSelf(aId);
  const b = withSelf(bId);

  let f = 0;
  for (const [ancestor, n1] of a) {
    const n2 = b.get(ancestor);
    if (n2 === undefined) continue;
    f += 0.5 ** (n1 + n2 + 1);
  }
  return f;
}

export function pedigreeF(ctx: SimCtx, personId: string): number {
  const p = ctx.world.people.get(personId as never);
  if (!p) return 0;
  const motherSide = ancestorDepths(ctx, p.claimedParents.mother, PEDIGREE_DEPTH);
  const fatherSide = ancestorDepths(ctx, p.claimedParents.father, PEDIGREE_DEPTH);

  let f = 0;
  for (const [ancestor, n1] of motherSide) {
    const n2 = fatherSide.get(ancestor);
    if (n2 === undefined) continue;
    f += 0.5 ** (n1 + n2 + 1);
  }
  return f;
}

/**
 * The number the genome actually has, for a person rather than a raw
 * `Genome` — `genetics/expression.ts`'s own `realizedHomozygosity` already
 * does the counting (its doc comment names this exact contrast); this is
 * the one-line lookup `record.ts`'s callers actually want.
 */
export function realizedHomozygosityOf(ctx: SimCtx, personId: string): number {
  const p = ctx.world.people.get(personId as never);
  if (!p) return 0;
  return homozygosityOfGenome(genomeOf(p, ctx.genetics));
}
