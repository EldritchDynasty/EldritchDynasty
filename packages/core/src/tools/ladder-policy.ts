/**
 * THE LADDER POLICIES, ON THEIR OWN (issue #61, Stage D).
 *
 * Extracted from `ladder-gate.ts`, which still owns the design reasoning for
 * why these exist — `climb`/`spare` isolate whether Madness bargains are
 * taken, `scion` isolates whether the house has named somebody to build the
 * ladder on. Read that file's header before changing anything here.
 *
 * The reason this moved: `ending-gate.ts` needs the SAME "one policy answers
 * every ladder bargain, the chronicler answers everything else" machinery to
 * build its own climbing column (issue #61's Stage D2) — not a copy of it.
 * `gates.ts` already imports `firedUnderClimbing` from `ladder-gate.js` for
 * exactly this reason (gate 8's acquittal pass), so a second file reusing the
 * policy machinery under `ending-gate.ts` rather than under `ladder-gate.ts`
 * is the same move already made once, not a new one.
 */
import { isLadderRole, RESPECT_ORDER } from '@ed/schema';
import { affinitiesFor, booksFor, eldritchPower, householdAffinities, householdBooks, householdOpposedPairs, MADNESS_FLOOR, madnessOf, mindOf } from '../ascension.js';
import { autoResolveAll, resolveChoice, resolveRecord, type PendingChoice, type RecordOption } from '../events/decisions.js';
import type { SlotFill } from '../events/slots.js';
import { phenotypeOf } from '../people/factory.js';
import { hashSeed, makeRng } from '../rng.js';
import type { SimCtx } from '../world.js';

/**
 * `ascendant` is a fourth policy, added for `ending-gate.ts`'s climbing
 * column (issue #61, Stage D) rather than for `ladder-gate.ts`'s own three.
 * `climb`/`spare`/`scion` are deliberately one verb apart from each other —
 * that isolates a single lever, which is what a gate diagnosing WHICH lever
 * works needs. `ascendant` is the opposite question: is the TOP reachable
 * at all, to a house pulling every lever it has — so it takes Madness
 * bargains like `climb`, AND has `nameScion` called on it like `scion`, AND
 * (in `ending-gate.ts`, not here — this file has no marriage policy to set)
 * marries in. It behaves exactly like `climb` inside `answer()`; the two are
 * kept distinct so a caller can tell, from the policy value alone, whether
 * the other two levers were also pulled.
 */
/**
 * `pair` is a fifth policy (issue #61, Stage E4): `scion` isolates whether
 * the house has named ONE man; `pair` isolates whether it has named a
 * SECOND one alongside him — one verb apart from `scion`, the same way
 * `scion` is one verb apart from `spare`. It refuses every Madness bargain
 * exactly like `scion` does, so the gap between the two columns is the
 * heir and nothing else.
 */
/**
 * `pair_climb` is a sixth policy (issue #61, Stage E5), and the only one in
 * which the second man's rites can actually be taken.
 *
 * `pair` names a heir and REFUSES every ladder bargain, which was right for
 * what Stage E4 was asking — it isolated the heir's standing orders from the
 * Madness axis, so the gap between `scion` and `pair` was the heir and
 * nothing else. It is exactly wrong for what Stage E5 built. The second
 * man's Vessel and Great Rite are ladder bargains by construction
 * (`costsTheClimber` sees them, correctly), so under `pair` the house is
 * offered `the_second_name` and turns it down every single time, and the
 * column measures a scene nobody ever takes.
 *
 * So: `pair` plus `climb`, one verb apart from each, and the comparison that
 * answers this stage's question is `pair_climb` against `climb` — both take
 * every bargain, and only one of them has a second man to offer them to.
 */
export type LadderPolicy =
  'climb' | 'spare' | 'chronicler' | 'scion' | 'ascendant' | 'pair' | 'pair_climb';

/**
 * The composite ending policy uses the Record as a lever too.
 *
 * Concept §6/§29 makes Embellish the explicit way a house buys Respect, and
 * Exalted is one of God's real gates. The isolated ladder policies deliberately
 * leave records to the chronicler so their one-variable comparisons stay clean;
 * `ascendant` is different by definition — it asks whether the top is reachable
 * to a house pulling every player-facing lever at once.
 */
export function recordOptionForPolicy(ctx: SimCtx, policy: LadderPolicy): RecordOption | undefined {
  if (policy !== 'ascendant') return undefined;
  // Embellish is a LEVER, not a personality. The ladder requires Exalted only
  // at its final wall, so the composite policy seizes the pen at Eminent and
  // tells the truth once it reaches Exalted. Below Eminent the ordinary
  // chronicler still answers.
  //
  // Do not special-case the post-Unmaking drop to Regarded. A measured
  // 100 x 500 experiment did exactly that and created a total standing lie
  // without increasing the number of worlds that ever reached God: seed 5106
  // still reached God, but the creditor withheld that final rung and its
  // Apotheosis became Devoured. That is §6's proof cost doing its job, not a
  // Respect bug. The intentional policy therefore does not buy standing by
  // knowingly destroying the evidence its ending must substantiate.
  if (ctx.world.respect === 'eminent') return 'embellish';
  if (ctx.world.respect === 'exalted') return 'record';
  return undefined;
}

/**
 * The Unmaking spends the elder who made the pair possible. An ascendant
 * policy therefore waits for the FRAGILE household setup — the living readers
 * and their opposed-pair circle — before paying that irreversible cost.
 *
 * Clauses are deliberately NOT setup here. They persist once recovered, while
 * the living reading circle can disappear with one death. The earlier no-wait
 * probe produced fourteen successful recipients but only one seven-clause
 * overlap; at that point, however, the ascendant policy handed the pen back to
 * the chronicler after the rite's two-tier Respect cost. A viable recipient
 * could therefore remain below Demigod and keep ageing while the Ledger caught
 * up. The policy now deliberately rebuilds that Respect instead, so this
 * calibration tests the other ordering: preserve the fragile people first and
 * let the persistent book finish afterwards.
 *
 * Standing is setup at the rite's OWN gate, Eminent (`the_unmaking`'s
 * conditions), not one tier above it. Waiting for Exalted looked strictly
 * better on paper, since the rite spends two tiers on success, but measured on
 * #332's 100 x 500 ascendant batch it was never met: in 271 years holding a
 * qualified elder and descendant, Exalted and the ready reading circle
 * overlapped in none, so the policy never called the rite and refused every
 * ambient offer. Eminent took successful recipients from 1 to 4 on the same
 * seeds. The descendant's power, Madness and Mind remain personal gates after
 * the rite, and seven clauses and Exalted remain the actual God gates in
 * ascension.ts — the policy rebuilds Respect afterwards rather than before.
 */
export function unmakingReadyForAscendant(ctx: SimCtx): boolean {
  return householdBooks(ctx) >= booksFor(ctx, 'god')
    // The recipient still has to clear Demigod on the way through the ladder,
    // whose household reading asks five distinct affinities after Unmaking.
    && householdAffinities(ctx) >= affinitiesFor('demigod')
    // God's extra circle requirement is structural, not "any four": one
    // representative from every opposed pair must still be alive to read.
    && householdOpposedPairs(ctx) >= affinitiesFor('god')
    && RESPECT_ORDER.indexOf(ctx.world.respect) >= RESPECT_ORDER.indexOf('eminent');
}

/**
 * Does taking this branch cost THE MAN WHO IS CLIMBING his mind?
 *
 * Narrowed to Madness landing on a `foremost` slot on purpose. "Any branch
 * that deals Madness to anybody" also catches `the_drowning`, which charges an
 * unwoken boy of seven — and a climbing column that drowns children too would
 * separate from a sparing one on Madness without either column saying anything
 * about the ladder. That is the confound this gate would be least able to see
 * and most likely to be congratulated for.
 */
export function costsTheClimber(pending: PendingChoice, choiceId: string): boolean {
  const e = pending.event;
  if (e.interaction.kind === 'narration') return false;
  const choice = e.interaction.choices.find((c) => c.id === choiceId);
  if (!choice) return false;
  // EVERY ladder role, from the one list (`schema`'s `LADDER_ROLES`), not
  // `foremost` alone. Hand-written here once, and it went stale the day
  // `second_foremost` arrived: the second man's Vessel — the single largest
  // charge the ladder lays on anybody — read as a free option, so no column
  // ever took it deliberately and the `pair` column measured a bargain
  // nobody was making (issue #61, Stage E5).
  const onTheLadder = new Set(
    Object.entries(e.slots).filter(([, sp]) => isLadderRole(sp.role)).map(([id]) => id),
  );
  if (!onTheLadder.size) return false;
  // A `rite` counts, and it is not an afterthought: §22's Vessel transfers the
  // consumed relative's Madness into the ascendant in full and uncapped, so it
  // is the single largest thing the ladder ever asks of the man climbing it
  // (issue #43). It carries no `madness` effect to recognise it by, because
  // how much arrives is a fact about two people rather than an authored number.
  return choice.outcomes.some((o) => o.effects.some(
    (f) => (f.kind === 'madness' && f.delta > 0
      && typeof f.target === 'object' && 'slot' in f.target && onTheLadder.has(f.target.slot))
      || (f.kind === 'rite' && (onTheLadder.has(f.ascendant)
        || (f.subject !== undefined && onTheLadder.has(f.subject)))),
  ));
}

/**
 * THE PLAYER STILL HAS TO NAME THE BODY.
 *
 * A ladder bargain with `castBy: player` is not resolved by choosing its
 * branch alone. The old gate did exactly that: it pressed "Take the Vessel"
 * with an empty cast, `resolveChoice` correctly refused "nobody cast as
 * VESSEL", and the loop then handed the whole scene to the chronicler. Every
 * "climb" measurement after the Vessel shipped therefore understated a player
 * who was actually trying.
 *
 * This is the deterministic cast used ONLY by the diagnostic policies. For a
 * Vessel, take the candidate carrying the most font — §22 calls that the
 * strongest play and the worst idea. For another player-cast ladder slot
 * (notably the younger in the Unmaking), take the candidate with the greatest
 * current Eldritch Power among those the authored filters already permit.
 */
export function ladderCast(
  ctx: SimCtx,
  pending: Pick<PendingChoice, 'cast'> & Partial<Pick<PendingChoice, 'fill'>>,
): SlotFill {
  const fill: SlotFill = {};
  const elderId = pending.fill?.ELDER;
  const elder = typeof elderId === 'string' ? ctx.world.people.get(elderId) : undefined;
  const inheritedMadness = elder ? madnessOf(ctx, elder) : undefined;

  for (const req of pending.cast) {
    const ranked = [...req.candidates].sort((a, b) => {
      const pa = ctx.world.people.get(a.id);
      const pb = ctx.world.people.get(b.id);
      if (!pa || !pb) return pa ? -1 : pb ? 1 : (a.id < b.id ? -1 : 1);

      if (req.slot === 'VESSEL') {
        const av = phenotypeOf(pa, ctx.genetics, ctx.world.year).eldritch.carriedFont;
        const bv = phenotypeOf(pb, ctx.genetics, ctx.world.year).eldritch.carriedFont;
        return bv - av || (a.id < b.id ? -1 : 1);
      }

      if (req.slot === 'ASCENDANT' && inheritedMadness !== undefined) {
        // The successful Unmaking gives every candidate the SAME elder's
        // Madness in full. Choosing only by present power was therefore
        // choosing blind to the two personal God gates the rite is guaranteed
        // to move. Prefer a descendant whose resulting Madness is inside
        // God's required window, then retain power as the tie-breaker.
        const fit = (p: typeof pa) => {
          const after = madnessOf(ctx, p) + inheritedMadness;
          return after >= MADNESS_FLOOR.god! && after <= mindOf(ctx, p);
        };
        const af = fit(pa);
        const bf = fit(pb);
        if (af !== bf) return bf ? 1 : -1;
      }

      const av = eldritchPower(ctx, pa);
      const bv = eldritchPower(ctx, pb);
      return bv - av || (a.id < b.id ? -1 : 1);
    });
    if (req.count) {
      const chosen = ranked.slice(0, req.count.min).map((c) => c.id);
      if (chosen.length >= req.count.min) fill[req.slot] = chosen;
      continue;
    }
    if (ranked[0]) fill[req.slot] = ranked[0].id;
  }
  return fill;
}

/**
 * Answer one docketed choice by the policy — but only when it is a bargain
 * about the ladder. Everything else in the game, Madness bargains included,
 * is the chronicler's in every column, for the reason `gate:blood` gives: a
 * second scripted decision would put a second difference between them.
 */
export function answer(
  ctx: SimCtx,
  pending: PendingChoice,
  policy: LadderPolicy,
  rng: ReturnType<typeof makeRng>,
  tally: { asked: number; paid: number },
): boolean {
  if (policy === 'chronicler' || !pending.choicesAreOpen) return false;
  const open = pending.choices.filter((c) => c.available);
  const costly = open.filter((c) => costsTheClimber(pending, c.id));
  const free = open.filter((c) => !costsTheClimber(pending, c.id));
  if (!costly.length) return false;   // not a ladder bargain; leave it

  const takesTheBargain = policy === 'climb' || policy === 'ascendant' || policy === 'pair_climb';
  // Ambient content can offer the Unmaking before the household is ready for
  // God's last working. A house deliberately playing for Apotheosis refuses
  // that premature offer: spending the elder early creates a short-lived
  // recipient and throws away the pair. The table can call the same authored
  // event again once the living reading circle and Respect are assembled.
  const postponeUnmaking = policy === 'ascendant'
    && pending.event.id === 'the_unmaking'
    && (ctx.world.ascension.best === 'god' || !unmakingReadyForAscendant(ctx));
  tally.asked += 1;
  const want = takesTheBargain && !postponeUnmaking ? costly[0] : free[0];
  if (!want) return false;
  const resolved = resolveChoice(ctx, pending.id, want.id, rng, ladderCast(ctx, pending)).ok;
  if (resolved && takesTheBargain && !postponeUnmaking) tally.paid += 1;
  return resolved;
}

/**
 * THE SCION COLUMN'S ONE VERB. Names whoever the house is building the ladder
 * on — an attentive player's standing order, played the way `gate:blood`
 * plays `marry_in`: set once by a rule over the state rather than answered
 * choice by choice.
 *
 * Holds the role for life once given. Renaming to whoever gained a point this
 * year would spend the marriage bias on a different man every few years and
 * concentrate nothing — the same reasoning the order's own doc comment gives
 * for why the game does not do this automatically either.
 *
 * PREFERS SOMEBODY NOT YET MARRIED, and this is not a minor tie-break: the
 * first cut of this column ranked by raw power alone and measured BYTE
 * IDENTICAL to `spare` — 61.8 in both, to one decimal, across eight seeds.
 * The reason was in the trace rather than the arithmetic. Naming only
 * fires when the previous scion is gone, so by the time it fires the
 * candidate has usually spent his whole adult life already married under
 * whatever policy stood before he was ever named — the override arrives
 * having missed the one decision it exists to change. Measured over one
 * seed to 1000 years: the power-only rule produced ONE scion marriage the
 * order could still act on; preferring the unmarried produced nine, several
 * of them cousins the family would otherwise have spent on the open market.
 * An attentive house does not wait for a man to become available to be
 * remarkable; it names the boy.
 */
export function nameScion(ctx: SimCtx): void {
  const w = ctx.world;
  const current = w.scion ? w.people.get(w.scion) : undefined;
  const stillHere = current?.status === 'alive'
    && w.people.household(w.playerHouse, w.year).some((q) => q.id === current.id);
  if (stillHere) return;

  const expressers = w.people.household(w.playerHouse, w.year)
    .filter((p) => phenotypeOf(p, ctx.genetics, w.year).eldritch.canExpress);
  const unmarried = expressers.filter((p) => !p.marriages.some((m) => !m.to));
  const pool = unmarried.length ? unmarried : expressers;
  w.scion = pool.length
    ? [...pool].sort((a, b) =>
      eldritchPower(ctx, b) - eldritchPower(ctx, a) || (a.id < b.id ? -1 : 1))[0]!.id
    : null;
}

/**
 * THE PAIR COLUMN'S SECOND VERB (issue #61, Stage E4). The same rule
 * `nameScion` plays — hold the role for life once given, prefer somebody
 * not yet married — over the pool `nameScion` does NOT touch: everybody
 * the Scion is not. Called after `nameScion` in every caller, never before,
 * so a house with no Scion yet does not name a heir before it has anyone
 * for him to stand beside.
 *
 * PREFERS THE SCION'S OWN CHILD OR SIBLING, and this is not a minor
 * tie-break. `preferred`'s whole concentrating effect on a marriage is
 * inherited by the NEXT generation, not carried backward into the man
 * whose wedding it was — a heir picked from the general expresser pool by
 * power alone might be a cousin six branches over who never received a
 * single one of the Scion's own concentrated marriages, in which case
 * naming him buys the book-and-tutor bias this stage built and none of
 * the blood-concentration bias the whole mechanism is FOR. A heir who
 * shares the Scion's own parent, or is his own child, is standing on
 * exactly the blood the pair is meant to be building.
 */
export function nameScionHeir(ctx: SimCtx): void {
  const w = ctx.world;
  const current = w.scionHeir ? w.people.get(w.scionHeir) : undefined;
  const stillHere = current?.status === 'alive'
    && current.id !== w.scion
    && w.people.household(w.playerHouse, w.year).some((q) => q.id === current.id);
  if (stillHere) return;

  const household = w.people.household(w.playerHouse, w.year);
  const kin = new Set<string>();
  if (w.scion) {
    for (const s of w.people.siblings(w.scion)) kin.add(s.id);
    for (const p of household) {
      if (p.trueParents.mother === w.scion || p.trueParents.father === w.scion) kin.add(p.id);
    }
  }

  const expressers = household
    .filter((p) => p.id !== w.scion && phenotypeOf(p, ctx.genetics, w.year).eldritch.canExpress);
  const unmarried = expressers.filter((p) => !p.marriages.some((m) => !m.to));
  const pool = unmarried.length ? unmarried : expressers;
  w.scionHeir = pool.length
    ? [...pool].sort((a, b) => {
      const ak = kin.has(a.id) ? 1 : 0;
      const bk = kin.has(b.id) ? 1 : 0;
      if (ak !== bk) return bk - ak;
      return eldritchPower(ctx, b) - eldritchPower(ctx, a) || (a.id < b.id ? -1 : 1);
    })[0]!.id
    : null;
}

/**
 * Answer every docketed decision for one year under a ladder policy: the
 * ladder's own bargains go through `answer`, everything else is the
 * chronicler's. Shared by `ladder-gate.ts`'s `playOnce`/`playForFires` and by
 * `ending-gate.ts`'s climbing column, so the two callers cannot drift on what
 * "the chronicler answers everything else" means.
 *
 * The RNG salt (`'ladder-decide'`) is shared too, on purpose — this is the
 * same decision-resolution act wherever it is called from, and a second salt
 * string would buy nothing but a reason two batches diverge on the same seed
 * for no mechanism either one changed.
 */
export function resolveYear(
  ctx: SimCtx,
  seed: number,
  policy: LadderPolicy,
  tally: { asked: number; paid: number },
): void {
  const w = ctx.world;
  let guard = 0;
  while (w.pendingDecisions.length && guard++ < 200) {
    const rng = makeRng(hashSeed(seed, 'ladder-decide', w.year, guard));
    const choice = w.pendingDecisions.find((d): d is PendingChoice => d.kind === 'choice');
    if (choice && answer(ctx, choice, policy, rng, tally)) continue;

    // A deliberate rite that just resolved may have queued its Record as the
    // next decision. The ascendant column is the one policy allowed to use
    // every lever, so it writes the larger version instead of handing this
    // Respect decision straight back to the chronicler. Other policies retain
    // byte-for-byte their old fallback.
    const recordOption = recordOptionForPolicy(ctx, policy);
    if (recordOption) {
      const record = w.pendingDecisions.find((d) => d.kind === 'record');
      if (record && resolveRecord(ctx, record.id, recordOption).ok) continue;
    }

    autoResolveAll(ctx, rng);
  }
}
