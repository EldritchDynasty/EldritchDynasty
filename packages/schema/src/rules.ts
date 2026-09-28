import type { ArcDef, Schedule } from './arc.js';
import type { Content } from './content-index.js';
import type { EventTemplate } from './event.js';
import { isLadderRole } from './event.js';
import type { Filter } from './conditions.js';
import type { Issue, ValidationRule } from './validate.js';
import { FREQUENCY_PROFILES } from './frequency.js';
import { RESPECT_ORDER } from './conditions.js';
import { canBeTaught, canLearn } from './attributes.js';
import { FRAME_PROSE_SENTENCE_THRESHOLD, PROSE_SENTENCE_THRESHOLD, proseIssues } from './prose.js';
import { isInlineArcId } from './desugar.js';
import { ENDING_ORDER } from './ending.js';
import { assertNever } from './exhaustive.js';
import { auditChoices, isProseOnly, SELF_EXPRESSION_TAG } from './choices.js';

/**
 * THE RULES.
 *
 * Each one is independent, named, and testable on its own. Adding a check is
 * appending to the array at the bottom of this file; nothing else in the
 * codebase has to know it exists.
 *
 * The convention for `where` is `kind:id` or `kind:id/part`, so a warning
 * points at a file and a line in the editor without further parsing.
 */

/**
 * The share of templates that must put a question in front of the player
 * rather than resolve themselves. See `attentionFloor` below for why it is a
 * floor rather than a target, and why it is set this far under where the
 * content stands.
 */
export const PLAYER_SHARE_FLOOR = 0.25;

const err = (rule: string, where: string, message: string): Issue =>
  ({ level: 'error', rule, where, message });
const warn = (rule: string, where: string, message: string): Issue =>
  ({ level: 'warning', rule, where, message });

function outcomeGroups(e: EventTemplate) {
  if (e.interaction.kind === 'narration') return [e.interaction.outcomes];
  return e.interaction.choices.map((c) => c.outcomes);
}

function allOutcomes(e: EventTemplate) {
  return outcomeGroups(e).flat();
}

function choicesOf(e: EventTemplate) {
  return e.interaction.kind === 'narration' ? [] : e.interaction.choices;
}

/** The decider, spelled the same way for all three interaction kinds. */
function deciderOf(e: EventTemplate) {
  return e.interaction.kind === 'narration' ? ('chance' as const) : e.interaction.decidedBy;
}

/**
 * The check a `party` decider spends, if any. A check named here resolves a
 * BRANCH; a check named by `Choice.check` resolves an outcome inside one. Which
 * of the two a check is decides what its bands are allowed to name, so this
 * question gets asked in three rules and is worth one function.
 */
function branchCheckOf(e: EventTemplate): string | undefined {
  const d = deciderOf(e);
  return typeof d === 'object' && 'party' in d ? d.party.check : undefined;
}

/** Filters nest through `all`/`any`/`not` exactly as conditions do. */
function walkFilters(fs: unknown[], fn: (f: Record<string, unknown>) => void): void {
  for (const raw of fs) {
    if (!raw || typeof raw !== 'object') continue;
    const f = raw as Record<string, unknown>;
    fn(f);
    if (Array.isArray(f.all)) walkFilters(f.all, fn);
    if (Array.isArray(f.any)) walkFilters(f.any, fn);
    if (f.not) walkFilters([f.not], fn);
  }
}

function walkConditions(c: unknown, fn: (c: Record<string, unknown>) => void): void {
  if (!c || typeof c !== 'object') return;
  const o = c as Record<string, unknown>;
  fn(o);
  if (Array.isArray(o.all)) o.all.forEach((x: unknown) => walkConditions(x, fn));
  if (Array.isArray(o.any)) o.any.forEach((x: unknown) => walkConditions(x, fn));
  if (o.not) walkConditions(o.not, fn);
}

// ── Identity ──────────────────────────────────────────────────────────────

const uniqueIds: ValidationRule = {
  id: 'ids/unique',
  about: 'Two events with one id means one of them is unreachable, and save files name both.',
  check(content) {
    const issues: Issue[] = [];
    const seen = new Set<string>();
    for (const e of content.events) {
      if (seen.has(e.id)) issues.push(err(this.id, `event:${e.id}`, 'duplicate event id'));
      seen.add(e.id);
    }
    return issues;
  },
};

const threePurposes: ValidationRule = {
  id: 'event/purposes',
  about: 'CI gate 6. Exactly three distinct purposes, from the closed vocabulary (editor brief §4.5).',
  check(content) {
    return content.events
      .filter((e) => new Set(e.purposes).size !== 3)
      .map((e) => err(this.id, `event:${e.id}`, 'three DISTINCT purposes required'));
  },
};

/**
 * How many triples the closed purpose vocabulary can form: nine purposes taken
 * three at a time.
 */
const PURPOSE_TRIPLES = 84;

/**
 * How far above its fair share a triple may be used before it is a draft
 * repeated rather than a subject revisited.
 */
const OVERLAP_TOLERANCE = 2.5;

const purposeDuplicates: ValidationRule = {
  id: 'event/purpose-overlap',
  about: 'CI gate 6. A triple used far past its share is one event written several times.',
  check(content) {
    /**
     * A FIXED CAP OF THREE MADE THE BRIEF'S OWN CONTENT BUDGET UNREACHABLE.
     *
     * §25 budgets 300-500 templates "for a run to feel non-repetitive" and
     * calls the game "a content problem wearing a systems costume". The closed
     * purpose vocabulary forms 84 triples, so a hard cap of two per triple
     * walls the library at 168 — barely half the low end of the budget, and
     * only 39 templates above where it stands today.
     *
     * That wall was reached while authoring four events. What it produces is
     * not fewer duplicate scenes; it is authors assigning whichever triple the
     * validator will still accept, which inverts the rule completely — the
     * three purposes exist so an author DECLARES what an event is for, and a
     * declaration chosen to satisfy a check declares nothing.
     *
     * So the sweep measures what it was always about (§25: "the editor reports
     * templates sharing all three purposes... our equivalent failure is the
     * event whose only job is *the family is formidable*") — a triple carrying
     * far more than its share of the library — rather than a fixed number that
     * happens to be right at one library size. At 129 templates the allowance
     * is 4; at 400 it is 12; the sweep still catches a triple used three times
     * its share, which is what a draft repeated actually looks like.
     *
     * The alternative fix is to widen the purpose vocabulary, which is a design
     * decision about what events are FOR and belongs to whoever owns §25.
     */
    const allowance = Math.max(
      3,
      Math.ceil((OVERLAP_TOLERANCE * content.events.length) / PURPOSE_TRIPLES),
    );

    const byPurpose = new Map<string, string[]>();
    for (const e of content.events) {
      const key = [...e.purposes].sort().join('+');
      byPurpose.set(key, [...(byPurpose.get(key) ?? []), e.id]);
    }
    const issues: Issue[] = [];
    for (const [key, ids] of byPurpose) {
      if (ids.length > allowance) {
        issues.push(err(
          this.id,
          'purposes',
          `${ids.length} templates share all three purposes (${key}), against an allowance of `
          + `${allowance} at ${content.events.length} templates: ${ids.join(', ')}`,
        ));
      }
    }
    return issues;
  },
};

// ── Frequency obligations ─────────────────────────────────────────────────

const frequencyObligations: ValidationRule = {
  id: 'frequency/obligations',
  about: 'A tier is a set of duties, not a weight: Record blocks, folklore, caps, accounts.',
  check(content) {
    const issues: Issue[] = [];
    for (const e of content.events) {
      // The frame rations on its own cadence, off the ambient Frequency
      // ledger entirely (issue #13) — `frame/shape` holds it to its own,
      // stricter obligations instead.
      if (e.tier === 'frame') continue;
      const at = `event:${e.id}`;
      const p = FREQUENCY_PROFILES[e.frequency];

      if (p.record === 'required' && !e.record) {
        issues.push(err(this.id, at, `${e.frequency} events must carry a record block`));
      }
      if (p.record === 'forbidden' && e.record) {
        issues.push(err(this.id, at, 'common events must not carry a record block — the Record choice loses meaning if it is routine'));
      }
      if (p.rumour === 'always' && !e.rumour) {
        issues.push(warn(this.id, at, `${e.frequency} events should seed a rumour — the world remembers events of this weight`));
      }
      if (p.rumour === 'never' && e.rumour) {
        issues.push(warn(this.id, at, 'common events do not enter folklore'));
      }
      if (e.frequency === 'mythic' && e.repeatable) {
        issues.push(err(this.id, at, 'a mythic event that can repeat is not mythic'));
      }
      if (p.named && e.accounts.length < 2) {
        issues.push(warn(this.id, at, 'fewer than two contradicting accounts (concept §19)'));
      }
    }
    return issues;
  },
};

// ── Record claims ──────────────────────────────────────────────────────────

/**
 * RECORD AND EMBELLISH ARE TWO ANSWERS TO THE SAME QUESTION (issue #138).
 *
 * A claim is how the rest of the game knows who a page spoke about. If only
 * Embellish carries them, a truthful house has no book as far as the Match
 * panel is concerned; if only Record carries them, the lie becomes invisible
 * instead. The asymmetry is the bug, so neither direction is allowed.
 *
 * Omit is deliberately absent here. It writes a dated blank line, and a blank
 * asserts nothing.
 */
const recordClaimSymmetry: ValidationRule = {
  id: 'record/claims',
  about: 'Record and Embellish must either both carry claims or neither may, because both are pages about the same event.',
  check(content) {
    const issues: Issue[] = [];
    for (const e of content.events) {
      if (!e.record) continue;
      const recorded = e.record.options.record.claims.length;
      const embellished = e.record.options.embellish.claims.length;
      if ((recorded === 0) === (embellished === 0)) continue;
      issues.push(err(
        this.id,
        `event:${e.id}/record`,
        `Record and Embellish claims are asymmetric (Record ${recorded}, Embellish ${embellished})`,
      ));
    }
    return issues;
  },
};

// ── Slots ─────────────────────────────────────────────────────────────────

const slotReferences: ValidationRule = {
  id: 'slots/references',
  about: 'Every {TOKEN} names a declared slot, and a relation filter names one that is cast before it.',
  check(content) {
    const issues: Issue[] = [];
    for (const e of content.events) {
      const slotIds = new Set(Object.keys(e.slots));
      for (const token of e.body.matchAll(/\{([A-Z_][A-Z0-9_]*)\}/g)) {
        const name = token[1]!;
        if (!slotIds.has(name)) {
          issues.push(err(this.id, `event:${e.id}`, `body references undefined slot {${name}}`));
        }
      }

      /**
       * `evalFilter` PASSES a `relation` filter whose counterpart slot is not
       * cast yet, because a comparison with nobody is not one it can judge. So
       * a filter that can never see its counterpart is inert — a declared
       * constraint that does nothing, which is invariant 11's exact shape.
       *
       * `resolveSlots` fills slots in DEPENDENCY order now, so this is no
       * longer a matter of what the author happened to name things. Two cases
       * remain, and both are real:
       *
       *   a filter naming a slot the event does not declare, and
       *   a CYCLE, which no order can satisfy — `A` not `B` while `B` is not
       *   `A` means whichever fills first has an inert filter.
       */
      const deps = new Map<string, string[]>();
      for (const [sid, spec] of Object.entries(e.slots)) {
        const targets: string[] = [];
        walkFilters(spec.filters, (f) => {
          if (!('relation' in f)) return;
          const other = String((f as { of: string }).of);
          if (!slotIds.has(other)) {
            issues.push(err(this.id, `event:${e.id}/${sid}`, `relation filter names undefined slot '${other}'`));
            return;
          }
          if (other !== sid) targets.push(other);
        });
        deps.set(sid, targets);
      }

      // Anything left unplaced by a topological pass is in a cycle.
      const placed = new Set<string>();
      for (let pass = 0; pass < deps.size && placed.size < deps.size; pass++) {
        const ready = [...deps].filter(([n, ds]) => !placed.has(n) && ds.every((d) => placed.has(d)));
        if (!ready.length) break;
        for (const [n] of ready) placed.add(n);
      }
      for (const sid of deps.keys()) {
        if (placed.has(sid)) continue;
        issues.push(err(this.id, `event:${e.id}/${sid}`,
          'this slot\'s relation filters form a cycle — whichever fills first compares against nobody, '
          + 'so one of them narrows nothing'));
      }
    }
    return issues;
  },
};

/**
 * `evalFilter` passes a `relation` filter with no counterpart cast yet — a
 * comparison with nobody is not one it can judge (`slots/references`'s own
 * comment). `not` is a plain boolean negation over a function with two
 * different meanings for `true`: "the relation holds" and "the relation is
 * unanswerable". Wrap the second meaning in `not` and it inverts into a
 * rejection of EVERY candidate, not a narrowing of any of them.
 *
 * `castBy: player` is the only shape that gets a counterpart that is never
 * cast when the filter runs — `resolveSlots` defers a player-cast slot's
 * fill entirely (issue #114). Every `relation` filter in shipped content
 * pointed at an engine-cast slot until now, so this has never bitten, and
 * it gets MORE reachable as the library grows: `castBy: player` is one of
 * the four shapes that satisfy the player-share floor, so authors are
 * pushed toward exactly the slot kind that triggers it.
 */
function relationNamesPlayerCast(
  f: Record<string, unknown>, slots: Record<string, { castBy: 'engine' | 'player' }>,
): string | undefined {
  if ('relation' in f && typeof (f as { of?: unknown }).of === 'string') {
    const named = (f as { of: string }).of;
    return slots[named]?.castBy === 'player' ? named : undefined;
  }
  for (const key of ['all', 'any'] as const) {
    const children = f[key];
    if (!Array.isArray(children)) continue;
    for (const child of children) {
      const hit = relationNamesPlayerCast(child as Record<string, unknown>, slots);
      if (hit) return hit;
    }
  }
  // Deliberately NOT descending into a nested `not` — a double negative
  // cancels the trap rather than repeating it: `not: { not: { relation } }`
  // reads the relation directly, at one negation, which passes rather than
  // rejects on an uncast counterpart.
  return undefined;
}

const negatedRelationOnPlayerCast: ValidationRule = {
  id: 'slots/negated-relation',
  about: 'A negated relation filter must name a counterpart cast before it, or it rejects everybody instead of narrowing anybody.',
  check(content) {
    const issues: Issue[] = [];
    for (const e of content.events) {
      for (const [sid, spec] of Object.entries(e.slots)) {
        walkFilters(spec.filters, (f) => {
          if (!('not' in f)) return;
          const named = relationNamesPlayerCast(f.not as Record<string, unknown>, e.slots);
          if (!named) return;
          issues.push(err(
            this.id,
            `event:${e.id}/${sid}`,
            `negates a relation against '${named}', which is castBy: player and not yet cast when this `
            + 'filter runs — it rejects EVERY candidate rather than narrowing them. Write one of: cast '
            + `'${named}' by the engine instead; use `
            + `\`relation: 'not', of: '${sid}'\` to narrow a party within itself, with no counterpart at `
            + 'all; or drop the constraint and let the prose carry it.',
          ));
        });
      }
    }
    return issues;
  },
};

const arcBoundSlots: ValidationRule = {
  id: 'slots/arc-bound',
  about: 'A slot bound for a whole substory needs an arc, and an absent-body if it may go missing.',
  check(content) {
    const issues: Issue[] = [];
    for (const e of content.events) {
      for (const [sid, spec] of Object.entries(e.slots)) {
        const at = `event:${e.id}/${sid}`;
        if (spec.bind === 'arc' && !e.arc) {
          issues.push(warn(this.id, at, 'arc-bound slot on an event that belongs to no arc'));
        }
        if (spec.bind === 'arc' && spec.onMissing === 'continue_absent' && !e.absentBody) {
          issues.push(err(this.id, at, 'continue_absent requires absentBody — otherwise this renders a token for a man forty years in the ground'));
        }
      }
    }
    return issues;
  },
};

// ── The Madness gate (invariant 1) ────────────────────────────────────────

const madnessGate: ValidationRule = {
  id: 'madness/gate',
  about: 'Madness may only be dealt to a target the slot has already gated to someone who can express.',
  check(content) {
    const issues: Issue[] = [];
    for (const e of content.events) {
      for (const o of allOutcomes(e)) {
        for (const eff of o.effects) {
          if (eff.kind !== 'madness' || eff.delta <= 0) continue;
          const t = eff.target;
          const slot = typeof t === 'object' && 'slot' in t ? e.slots[t.slot] : undefined;
          // `foremost` and `second_foremost` are gated by their POOL rather
          // than by a filter — both roles draw only from people who can
          // express — so requiring a filter here would be asking an author
          // to restate the role.
          const guarded = isLadderRole(slot?.role)
            || slot?.filters.some((f) => 'canExpress' in f && f.canExpress === true)
            || slot?.filters.some((f) => 'sex' in f && f.sex === 'male');
          if (!guarded) {
            issues.push(err(
              this.id,
              `event:${e.id}/${o.id}`,
              'madness effect on a target not gated to canExpress — women and mundane men cannot go mad (concept §10)',
            ));
          }
        }
      }
    }
    return issues;
  },
};

// ── The rites (concept §22, issue #43) ────────────────────────────────────

/**
 * A `rite` effect names two people by slot and does something between them
 * that no other effect in the game does: it moves one person's attributes,
 * blood and Madness into another and then spends them.
 *
 * Three ways to get that wrong, and none of them fails at runtime — the verb
 * finds nobody, shrugs, and the event still fires and still writes its
 * chronicle line, which is this codebase's signature failure.
 *
 *   a slot name that is not declared on the event;
 *   an ascendant slot that can cast someone who cannot express, which would
 *     be a Madness transfer into a woman or a mundane son (invariant 1) —
 *     `role: foremost` is the one role whose POOL is that gate, the same
 *     reasoning `madness/gate` uses one rule above;
 *   the Vessel rite with no subject, which is a rite with nobody in it.
 */
const riteWiring: ValidationRule = {
  id: 'rites/wiring',
  about: 'A rite names declared slots, casts its ascendant from a pool that can express, and takes its subject.',
  check(content) {
    const issues: Issue[] = [];
    for (const e of content.events) {
      for (const o of allOutcomes(e)) {
        for (const eff of o.effects) {
          if (eff.kind !== 'rite') continue;
          const at = `event:${e.id}/${o.id}`;
          const ascendant = e.slots[eff.ascendant];
          if (!ascendant) {
            issues.push(err(this.id, at, `rite names undefined slot '${eff.ascendant}' as its ascendant`));
          } else if (!isLadderRole(ascendant.role) && !gatedOnExpression(ascendant)) {
            // What this rule wants is the GUARANTEE, not the role. `foremost`
            // and `second_foremost` supply it because their pool IS the
            // canExpress gate; a slot that filters on `canExpress` supplies
            // the same thing directly, and the unmaking needs that — §22
            // raises THE YOUNGER, who is by definition not the man standing
            // highest (issue #43).
            issues.push(err(this.id, at,
              `the '${eff.ascendant}' slot casts ${ascendant.role} with no expression gate, and a rite `
              + "deals Madness into whoever it names — cast `foremost` or `second_foremost`, whose "
              + 'pools are the canExpress gate, or filter the slot on `canExpress` (concept §10)'));
          }
          if (eff.subject !== undefined && !e.slots[eff.subject]) {
            issues.push(err(this.id, at, `rite names undefined slot '${eff.subject}' as its subject`));
          }
          if (eff.rite === 'vessel' && !eff.subject) {
            issues.push(err(this.id, at, 'the Vessel rite consumes a named relative and this one names nobody'));
          }
        }
      }
    }
    return issues;
  },
};

/**
 * Does this slot promise that whoever it casts can express?
 *
 * `foremost` promises it by construction. Anything else has to say so, and
 * this walks the filter tree because `all`/`any`/`not` are part of the
 * vocabulary and a promise nested inside an `all` is still a promise. An
 * `any` is NOT one: one of its branches may not carry the gate.
 */
function gatedOnExpression(slot: { filters?: Filter[] }): boolean {
  const walk = (f: Filter): boolean => {
    if ('canExpress' in f) return f.canExpress === true;
    if ('all' in f) return f.all.some(walk);
    return false;
  };
  return (slot.filters ?? []).some(walk);
}

// ── The attention floor (invariant 9, and what a docket is for) ───────────

/**
 * The share of the library the player is actually asked about.
 *
 * A decision the player takes is the expensive kind of content and the kind
 * this game is made of: `stepYear` parks it on `world.pendingDecisions` and
 * STOPS THE CLOCK until it is answered (invariant 9). Everything else — a
 * `state` ladder, a `chance` draw, a narration — resolves itself and goes
 * into the chronicle as something that happened while the player was looking
 * elsewhere.
 *
 * Both are wanted, and the second is cheaper to write, which is the problem
 * this rule exists for. Texture is easy: a hundred templates of weather and
 * pantry can be added in an afternoon and every one of them is a line in the
 * chronicle and none of them is a game. Nothing anywhere reports the drift,
 * because a run full of narration looks exactly like a run full of decisions
 * from the outside — same fire rates, same gates, same green CI.
 *
 * FOUR SHAPES COUNT AS ASKING, and they are counted because each one puts a
 * question in front of the player rather than in front of the simulation:
 *
 *   `decidedBy: player` on a choice or dispatch — the docket, the default,
 *                       and what a choice event has always been.
 *   `decidedBy: { party }` — the player casts the `castBy: player` slots and
 *                       a check over exactly those people takes the branch;
 *                       WHO GOES is the decision (`decider.ts`).
 *   any `castBy: player` slot — the mission mechanic, on any interaction.
 *   a Record block — Record / Omit / Embellish, which dockets its own
 *                       decision and is the mechanical form of the thesis.
 *
 * 25% is a FLOOR AND NOT A TARGET, set the way gate 4's 0.5% fire-rate floor
 * was: far enough below where the content stands that it never argues with an
 * author, close enough to matter before the library is unrecognisable. At the
 * time of writing 237 of 292 templates ask something — 81%, and 89% of
 * everything that is not the frame, which by rule never asks. The floor is for
 * the six-hundredth template, not the two-hundredth.
 */
const attentionFloor: ValidationRule = {
  id: 'events/player-share',
  about: 'At least a quarter of the library must actually ask the player something.',
  check(content) {
    const asks = (e: EventTemplate): boolean => {
      if (e.record) return true;
      if (Object.values(e.slots).some((s) => s.castBy === 'player')) return true;
      if (e.interaction.kind === 'narration') return false;
      const d = e.interaction.decidedBy;
      return d === 'player' || (typeof d === 'object' && d !== null && 'party' in d);
    };

    const total = content.events.length;
    if (total === 0) return [];
    const asking = content.events.filter(asks).length;
    const share = asking / total;
    if (share >= PLAYER_SHARE_FLOOR) return [];

    return [err(
      this.id,
      'events',
      `only ${asking} of ${total} templates ask the player anything `
      + `(${(100 * share).toFixed(1)}%, against a floor of ${(100 * PLAYER_SHARE_FLOOR).toFixed(0)}%). `
      + 'A choice decided by `state` or `chance`, and a narration, resolve themselves — '
      + 'they are texture, not play. Give some of them `decidedBy: player`, a `castBy: player` '
      + 'slot, or a Record block.',
    )];
  },
};

// ── Cross-references ──────────────────────────────────────────────────────

const knownReferences: ValidationRule = {
  id: 'refs/known',
  about: 'Ages, arcs, careers, spellbooks, knowledge flags, tales and their about-events named by content must be things that exist.',
  check(content) {
    const issues: Issue[] = [];

    const granted = new Set<string>();
    for (const e of content.events) {
      for (const o of allOutcomes(e)) {
        for (const eff of o.effects) {
          if (eff.kind === 'knowledge' && eff.op === 'grant') granted.add(eff.flag);
        }
      }
      if (e.record?.options.record.grantsKnowledge) granted.add(e.record.options.record.grantsKnowledge);
    }

    for (const e of content.events) {
      const at = `event:${e.id}`;
      for (const a of [...(e.ages?.only ?? []), ...(e.ages?.never ?? [])]) {
        if (!content.age(a)) issues.push(err(this.id, at, `unknown age '${a}'`));
      }
      for (const id of e.accounts) {
        if (!content.tale(id)) issues.push(err(this.id, at, `unknown tale '${id}' in accounts`));
      }
      for (const o of allOutcomes(e)) {
        for (const eff of o.effects) {
          if (eff.kind === 'arc' && !content.arc(eff.arc)) {
            issues.push(err(this.id, `${at}/${o.id}`, `unknown arc '${eff.arc}'`));
          }
          if (eff.kind === 'schedule' && !content.event(eff.event)) {
            issues.push(err(this.id, `${at}/${o.id}`, `schedules unknown event '${eff.event}'`));
          }
          if (eff.kind === 'heirloom' && !content.heirloom(eff.heirloom)) {
            issues.push(err(this.id, `${at}/${o.id}`, `unknown heirloom '${eff.heirloom}'`));
          }
          if (eff.kind === 'clause' && !content.clause(eff.reveal)) {
            issues.push(err(this.id, `${at}/${o.id}`, `reveals unknown clause '${eff.reveal}'`));
          }
          // A career or a book named by a typo is not a loud failure anywhere
          // downstream. `applyEffect` now declines the placement outright and
          // `gainSpellbook` resolves the volume to nothing, so the outcome
          // fires, reads as though it worked, and does nothing for the rest of
          // the run. This is the only place that can still say so.
          if (eff.kind === 'career' && eff.op === 'assign' && eff.career && !content.career(eff.career)) {
            issues.push(err(this.id, `${at}/${o.id}`, `assigns unknown career '${eff.career}'`));
          }
          if (eff.kind === 'spellbook' && !content.spellbook(eff.book)) {
            issues.push(err(this.id, `${at}/${o.id}`, `unknown spellbook '${eff.book}'`));
          }
          // A `land` effect naming a parcel by typo mints or seizes nothing —
          // `grantParcel`/`seizeParcel`/`damageParcel`/`restoreParcel` are all
          // no-ops on an id `content.parcel` cannot resolve, the same silent
          // failure a career or a book gets caught for above.
          if (eff.kind === 'land' && !content.parcel(eff.parcel)) {
            issues.push(err(this.id, `${at}/${o.id}`, `unknown parcel '${eff.parcel}'`));
          }
          // A `tutor` effect naming an attribute that does not exist, or one
          // no tutor can teach (a body attribute, Madness, Eldritch Power),
          // silently refuses through `canBeTaught` — the fee is charged and
          // the outcome fires and nothing happens, the same silent failure
          // an unknown career or book gets caught for above.
          if (eff.kind === 'tutor') {
            const subject = content.attributes.find((a) => String(a.id) === eff.attr);
            if (!subject) {
              issues.push(err(this.id, `${at}/${o.id}`, `tutor effect names unknown attribute '${eff.attr}'`));
            } else if (!canBeTaught(subject.kind)) {
              issues.push(err(
                this.id, `${at}/${o.id}`,
                `tutor effect names '${eff.attr}', which is ${subject.kind} — no tutor can teach it`,
              ));
            }
          }
        }
      }
      // A `career` filter naming a post that does not exist matches nobody, so
      // the slot never fills and the event never fires — silence of exactly the
      // kind this rule exists to break.
      for (const [slot, spec] of Object.entries(e.slots)) {
        walkFilters(spec.filters, (f) => {
          if (!Array.isArray(f.career)) return;
          for (const id of f.career) {
            if (!content.career(String(id))) {
              issues.push(err(this.id, `${at}/${slot}`, `filters on unknown career '${String(id)}'`));
            }
          }
        });
      }
      walkConditions(e.conditions, (c) => {
        if ('knowledge' in c && c.has === true && !granted.has(String(c.knowledge))) {
          issues.push(err(this.id, at, `knowledge condition '${String(c.knowledge)}' is granted by no event`));
        }
        // A `posts`/`postHeldFor` condition naming a career by typo matches
        // nobody ever, the same silent failure a `career` filter or effect
        // gets caught for above.
        if ('posts' in c) {
          const posts = c.posts as { career?: unknown[] } | undefined;
          for (const id of posts?.career ?? []) {
            if (!content.career(String(id))) {
              issues.push(err(this.id, at, `posts condition names unknown career '${String(id)}'`));
            }
          }
        }
        if ('postHeldFor' in c) {
          const p = c.postHeldFor as { career?: unknown } | undefined;
          if (p?.career !== undefined && !content.career(String(p.career))) {
            issues.push(err(this.id, at, `postHeldFor condition names unknown career '${String(p.career)}'`));
          }
        }
        // A `holdsParcel` condition naming an id by typo can never be true —
        // the same silent failure a `career` filter gets caught for above.
        if ('holdsParcel' in c && !content.parcel(String(c.holdsParcel))) {
          issues.push(err(this.id, at, `holdsParcel condition names unknown parcel '${String(c.holdsParcel)}'`));
        }
      });
    }

    for (const t of content.tales) {
      const at = `tale:${t.id}`;
      if (!content.event(t.about)) {
        issues.push(err(this.id, at, `'about' names unknown event '${t.about}'`));
      }
      for (const house of t.houses) {
        if (!content.house(house)) {
          issues.push(err(this.id, at, `'houses' names unknown house '${house}'`));
        }
      }
    }
    return issues;
  },
};

const accountsContradict: ValidationRule = {
  id: 'tales/accounts',
  about: 'CI gate 8. Every pair of an event\'s accounts must contradict on at least one field '
    + '— differing bias is the minimum bar (issue #14). Two accounts that agree are one account written twice.',
  check(content) {
    const issues: Issue[] = [];
    for (const e of content.events) {
      if (e.accounts.length < 2) continue;
      const at = `event:${e.id}`;
      // Unknown ids are `refs/known`'s complaint, not this rule's.
      const tales = e.accounts.map((id) => content.tale(id)).filter((t): t is NonNullable<typeof t> => t !== undefined);
      for (let i = 0; i < tales.length; i++) {
        for (let j = i + 1; j < tales.length; j++) {
          if (tales[i]!.bias === tales[j]!.bias) {
            issues.push(err(
              this.id,
              at,
              `accounts '${tales[i]!.id}' and '${tales[j]!.id}' do not contradict — both are '${tales[i]!.bias}'`,
            ));
          }
        }
      }
    }
    return issues;
  },
};

const discrepancyWiring: ValidationRule = {
  id: 'discrepancy/wiring',
  about: 'A Discrepancy proved or buried without ever being created cannot be found; provableBy must name a real house.',
  check(content) {
    const issues: Issue[] = [];
    const created = new Set<string>();
    const provedOrBuried: { id: string; op: 'prove' | 'bury'; at: string }[] = [];

    const checkProvableBy = (ids: string[], at: string) => {
      for (const houseId of ids) {
        if (!content.house(houseId)) issues.push(err(this.id, at, `provableBy names unknown house '${houseId}'`));
      }
    };

    for (const e of content.events) {
      const at = `event:${e.id}`;
      for (const o of allOutcomes(e)) {
        for (const eff of o.effects) {
          if (eff.kind !== 'discrepancy') continue;
          const where = `${at}/${o.id}`;
          if (eff.op === 'create') {
            // `id` is optional on the variant so that `bury` can go without
            // one (issue #71). A `create` without one names nothing and can
            // never be proved or buried, which is the shape of dead content
            // this rule exists for.
            if (!eff.id) {
              issues.push(err(this.id, where, 'creates a Discrepancy with no id, which nothing can ever answer'));
              continue;
            }
            created.add(eff.id);
            checkProvableBy(eff.provableBy ?? [], where);
          } else if (eff.id) {
            provedOrBuried.push({ id: eff.id, op: eff.op, at: where });
          } else {
            // A bury with no id reaches whatever open lie the house has, so
            // there is nothing to match against content. Its `provableBy` is
            // a FILTER rather than a claim, and still has to name real houses.
            checkProvableBy(eff.provableBy ?? [], where);
          }
        }
      }
      if (e.record) {
        const d = e.record.options.embellish.discrepancy;
        created.add(d.id);
        checkProvableBy(d.provableBy, `${at}/record/embellish`);
      }
    }

    for (const p of provedOrBuried) {
      if (!created.has(p.id)) {
        const verb = p.op === 'prove' ? 'proves' : 'buries';
        issues.push(err(this.id, p.at, `${verb} Discrepancy '${p.id}', which nothing ever creates`));
      }
    }
    return issues;
  },
};

/**
 * ONE ID, ONE MEANING.
 *
 * A secret on a contract becomes a Discrepancy under its own id the year it is
 * told (`core/people/secrets.ts`), so an id that content ALSO creates as a
 * Discrepancy has two origins and one state, and whichever ran second silently
 * decides what the first one meant. The same id used for a knowledge flag is
 * the same trap with better camouflage: `knows_what_the_room_did` (what the
 * house wrote down) and `what_the_third_jug_did` (what the physician can
 * repeat elsewhere) are two facts, and giving them one id makes writing the
 * thing down look like leaking it.
 */
const secretsWiring: ValidationRule = {
  id: 'secrets/wiring',
  about: 'A secret on a contract becomes a Discrepancy under its own id, so nothing else may own that id.',
  check(content) {
    const issues: Issue[] = [];

    const discrepancies = new Map<string, string>();
    const knowledge = new Map<string, string>();
    for (const e of content.events) {
      const at = `event:${e.id}`;
      for (const o of allOutcomes(e)) {
        for (const eff of o.effects) {
          if (eff.kind === 'discrepancy' && eff.op === 'create' && eff.id) discrepancies.set(eff.id, `${at}/${o.id}`);
          if (eff.kind === 'knowledge' && eff.op === 'grant') knowledge.set(eff.flag, `${at}/${o.id}`);
        }
      }
      if (e.record) {
        discrepancies.set(e.record.options.embellish.discrepancy.id, `${at}/record/embellish`);
        const granted = e.record.options.record.grantsKnowledge;
        if (granted) knowledge.set(granted, `${at}/record/record`);
        for (const key of ['record', 'omit', 'embellish'] as const) {
          for (const eff of e.record.options[key].effects) {
            if (eff.kind === 'discrepancy' && eff.op === 'create' && eff.id) discrepancies.set(eff.id, `${at}/record/${key}`);
            if (eff.kind === 'knowledge' && eff.op === 'grant') knowledge.set(eff.flag, `${at}/record/${key}`);
          }
        }
      }
    }

    const holders: { at: string; secrets: readonly string[] }[] = [
      ...content.characterTemplates
        .filter((t) => t.contract)
        .map((t) => ({ at: `character:${t.id}`, secrets: t.contract!.knowsSecrets.map(String) })),
      ...content.characters
        .filter((c) => c.contract)
        .map((c) => ({ at: `character:${c.key}`, secrets: c.contract!.knowsSecrets.map(String) })),
    ];

    for (const holder of holders) {
      for (const secret of holder.secrets) {
        const clash = discrepancies.get(secret);
        if (clash) {
          issues.push(err(this.id, holder.at, `secret '${secret}' is also created as a Discrepancy at ${clash}`));
        }
        const known = knowledge.get(secret);
        if (known) {
          issues.push(err(this.id, holder.at, `secret '${secret}' is also granted as knowledge at ${known}`));
        }
      }
    }
    return issues;
  },
};

const arcWiring: ValidationRule = {
  id: 'arcs/wiring',
  about: 'An arc that points at a node or an event that is not there dies silently at that node.',
  check(content) {
    const issues: Issue[] = [];
    for (const arc of content.arcs) {
      const nodeIds = new Set(arc.nodes.map((n) => n.id));
      if (!nodeIds.has(arc.entry)) {
        issues.push(err(this.id, `arc:${arc.id}`, `entry node '${arc.entry}' not found`));
      }
      for (const n of arc.nodes) {
        const event = content.event(n.event);
        if (!event) {
          issues.push(err(this.id, `arc:${arc.id}/${n.id}`, `unknown event '${n.event}'`));
        }
        for (const s of n.successors) {
          if (s.to !== 'end' && !nodeIds.has(s.to)) {
            issues.push(err(this.id, `arc:${arc.id}/${n.id}`, `successor '${s.to}' not found`));
          }
          // A guard naming an outcome, a branch or a tag the parent cannot
          // produce is a guard that never holds — a successor that is written
          // down, looks wired, and is unreachable for the life of the game.
          if (!event) continue;
          const at = `arc:${arc.id}/${n.id}`;
          if (s.fromOutcome && !allOutcomes(event).some((o) => o.id === s.fromOutcome)) {
            issues.push(err(this.id, at, `fromOutcome '${s.fromOutcome}' is not an outcome of '${event.id}'`));
          }
          if (s.fromChoice && !choicesOf(event).some((c) => c.id === s.fromChoice)) {
            issues.push(err(this.id, at, `fromChoice '${s.fromChoice}' is not a branch of '${event.id}'`));
          }
          if (s.fromTag && !allOutcomes(event).some((o) => o.tags.includes(s.fromTag!))) {
            issues.push(err(this.id, at, `fromTag '${s.fromTag}' is on no outcome of '${event.id}'`));
          }
        }
      }
    }

    // THE REVERSE CHECK, which is the one that was missing. An arc pointing at
    // a node that is not there has always failed the build; an EVENT claiming
    // to be a node of an arc that does not know it never did. The symptom is
    // the worst kind: the event leaves the ambient pool (anything with an `arc`
    // block does) and the arc never calls it, so it is authored, validated, and
    // unreachable in every run.
    for (const e of content.events) {
      if (!e.arc) continue;
      const at = `event:${e.id}`;
      const arc = content.arc(e.arc.of);
      if (!arc) {
        issues.push(err(this.id, at, `is a node of unknown arc '${e.arc.of}'`));
        continue;
      }
      const node = arc.nodes.find((n) => n.id === e.arc!.node);
      if (!node) {
        issues.push(err(this.id, at, `arc '${arc.id}' has no node '${e.arc.node}'`));
      } else if (node.event !== e.id) {
        issues.push(err(this.id, at, `arc '${arc.id}' node '${node.id}' runs '${node.event}', not this event`));
      }
    }

    // Inline follow-ups (`Outcome.next`) before `desugar.ts` compiles them.
    for (const e of content.events) {
      for (const o of allOutcomes(e)) {
        const link = o.next;
        if (!link) continue;
        const at = `event:${e.id}/${o.id}`;
        const target = content.event(link.event);
        if (!target) {
          issues.push(err(this.id, at, `next names unknown event '${link.event}'`));
          continue;
        }
        for (const slot of link.keep) {
          if (!target.slots[slot]) {
            issues.push(err(this.id, at, `keeps slot '${slot}', which '${target.id}' does not declare`));
          }
          if (!e.slots[slot]) {
            issues.push(err(this.id, at, `keeps slot '${slot}', which this event does not cast`));
          }
        }
        if (link.event === e.id) {
          issues.push(err(this.id, at, 'next points at its own event'));
        }
      }
    }
    return issues;
  },
};

/**
 * How many years a node's OWN schedule can cost, worst case — the same three
 * branches `scheduleNext` (`core/src/events/arcs.ts`) draws from, read as an
 * upper bound instead of a roll. `next_generation`'s `20 + rng.int(12)` tops
 * out at 31.
 *
 * That number now lives in two packages with no import between them to keep
 * it honest — `schema` cannot depend on `core`, which depends on `schema` —
 * so a change to `scheduleNext`'s own bounds has to be brought here by hand.
 * `rules.test.ts`'s synthetic-arc tests pin the CURRENT value (31) rather
 * than importing it, which is the best a one-way dependency allows; it will
 * not itself notice the two drifting apart.
 */
function longestNodeDelay(schedule: Schedule): number {
  if (schedule === 'immediate') return 0;
  if (schedule === 'next_generation') return 31;
  return schedule.maxYears;
}

/**
 * The longest an arc can possibly take from `entry` to any `end` — the sum,
 * along the worst branch, of every node's own `longestNodeDelay`. A cycle (a
 * successor pointing back at a node already on the current path) makes this
 * `Infinity` — `arc_the_muster`'s `word` node is its own successor "on
 * purpose... the middle of a war is the part that repeats" (`muster.yaml`),
 * so an unbounded arc is a real, shipped shape and not a wiring mistake.
 * `arcExpiry` reads that `Infinity` as "this rule's finite-path model does
 * not apply here" rather than as a failure: a looping arc's own
 * `expiresAfterYears` is a timeout on the loop, which is a different promise
 * than "the longest ROUTE fits inside it", and this rule only checks the one
 * issue #131 is actually about.
 */
function longestArcPath(arc: ArcDef): number {
  const byId = new Map(arc.nodes.map((n) => [n.id, n]));
  const memo = new Map<string, number>();
  const onPath = new Set<string>();

  function from(nodeId: string): number {
    const cached = memo.get(nodeId);
    if (cached !== undefined) return cached;
    const node = byId.get(nodeId);
    if (!node) return 0; // an unknown node is `arcs/wiring`'s finding, not this rule's
    if (onPath.has(nodeId)) return Infinity;

    onPath.add(nodeId);
    // No successors ends the story here (`desugar.ts`'s own reading of an
    // empty list), so the node's own delay is the whole of its contribution.
    let downstream = 0;
    for (const s of node.successors) {
      downstream = Math.max(downstream, s.to === 'end' ? 0 : from(s.to));
    }
    onPath.delete(nodeId);

    const total = longestNodeDelay(node.schedule) + downstream;
    memo.set(nodeId, total);
    return total;
  }

  return from(arc.entry);
}

/**
 * AN ARC WHOSE DECLARED EXPIRY CONTRADICTS ITS OWN DECLARED SPAN drops its
 * last beat silently on a high roll (issue #131). `dueArcSteps` checks
 * `expiresAfterYears` against `startedYear` when a beat comes due and marks
 * the instance `expired` rather than delayed — so a payoff beat authored past
 * that point does not happen late. It does not happen. Nothing throws, and no
 * chronicle line says the letter never came.
 *
 * The walk is `longestArcPath`, above, and it mirrors the engine's own
 * `scheduleNext` exactly: a rule nobody has seen fail is indistinguishable
 * from a rule that cannot, so `rules.test.ts` hands this one a bundle whose
 * longest path provably exceeds its own expiry.
 */
const arcExpiry: ValidationRule = {
  id: 'arcs/expiry',
  about: 'An arc\'s expiresAfterYears must cover the longest path its own node schedules can draw.',
  check(content) {
    const issues: Issue[] = [];
    for (const arc of content.arcs) {
      if (arc.expiresAfterYears === undefined) continue;
      const longest = longestArcPath(arc);
      // A cycle means the arc loops by design (`arc_the_muster`'s `word`
      // node) and its expiry is a timeout on that loop, not a bound this
      // rule can check.
      if (!Number.isFinite(longest)) continue;
      if (longest > arc.expiresAfterYears) {
        issues.push(err(
          this.id, `arc:${arc.id}`,
          `the longest path through its own nodes (${longest} years) exceeds its own `
          + `expiresAfterYears (${arc.expiresAfterYears}) — a high roll on the node schedules `
          + 'expires the instance before its last beat can fire',
        ));
      }
    }
    return issues;
  },
};

/**
 * `Outcome.next` compiles into `triggers`, and an outcome that already has one
 * keeps it (see `desugar.ts`) — so the inline follow-up would be silently
 * dropped. Saying so is better than picking a winner nobody asked for.
 */
const inlineCollision: ValidationRule = {
  id: 'arcs/inline',
  about: 'An inline follow-up must belong to exactly one chain, and must not compete with an authored arc.',
  check(content) {
    const issues: Issue[] = [];

    // An outcome's `next` compiles into `triggers`, and `desugar.ts` leaves an
    // authored `triggers` alone — so the follow-up would be silently dropped.
    // Saying so beats picking a winner nobody asked for.
    for (const e of content.events) {
      for (const o of allOutcomes(e)) {
        // `desugar.ts` runs before validation does, so by now every `next` has
        // grown the `triggers` that starts its compiled arc. Only an AUTHORED
        // one is a collision — the compiled id is this pass's own work.
        if (o.next && o.triggers && !isInlineArcId(o.triggers.arc)) {
          issues.push(err(this.id, `event:${e.id}/${o.id}`,
            `declares next '${o.next.event}' and triggers arc '${o.triggers.arc}' — the follow-up would be discarded`));
        }
      }
    }

    // One event can carry one `arc` block, so a follow-up can belong to one
    // chain. Two chains leading to the same scene means one of them ends there
    // and the other silently does not.
    const reachedFrom = new Map<string, string[]>();
    for (const e of content.events) {
      for (const o of allOutcomes(e)) {
        if (!o.next) continue;
        const from = reachedFrom.get(o.next.event) ?? [];
        from.push(`${e.id}/${o.id}`);
        reachedFrom.set(o.next.event, from);
      }
    }
    for (const [target, from] of reachedFrom) {
      if (from.length > 1) {
        issues.push(err(this.id, `event:${target}`,
          `is the inline follow-up of ${from.length} outcomes (${from.join(', ')}) — an event can only be a node of one chain`));
      }
    }

    /**
     * A chain nothing leads into can never start. `desugarInline` compiles
     * nothing for it, correctly, and the events sit there looking authored.
     *
     * This used to ask whether EVERY linked event was itself a follow-up,
     * which is only the same question while the library holds exactly one
     * chain. The second chain in the content made the rule unfalsifiable
     * overnight: one chain looping on itself and one ordinary chain beside it
     * passed, because `every` was false, and the looping one is precisely the
     * thing this rule is for. It is asked per COMPONENT now — walk from every
     * beat that can actually start, and anything with a `next` that the walk
     * never reaches is in a loop or hanging off one.
     */
    const followUps = new Set(reachedFrom.keys());
    const linked = content.events.filter((e) => allOutcomes(e).some((o) => o.next));
    const byId = new Map(content.events.map((e) => [String(e.id), e]));
    const reachable = new Set<string>();
    const walk = (id: string) => {
      if (reachable.has(id)) return;
      reachable.add(id);
      const e = byId.get(id);
      if (!e) return;                        // an unknown target is `refs/known`'s complaint
      for (const o of allOutcomes(e)) if (o.next) walk(o.next.event);
    };
    for (const e of linked) if (!followUps.has(e.id)) walk(e.id);
    const stranded = linked.filter((e) => !reachable.has(e.id));
    if (stranded.length) {
      issues.push(err(this.id, 'events',
        `${stranded.map((e) => e.id).join(', ')}: every inline follow-up here is itself a follow-up `
        + '— the chain is a cycle with no beat that can start it'));
    }
    return issues;
  },
};

/**
 * Story-local memory is only local to a story. Written by an event that is not
 * a node of one, nothing can ever read it; read where no arc is in scope, it is
 * false forever. Both are silent, and both look exactly like a guard that is
 * simply never satisfied.
 */
const arcFlags: ValidationRule = {
  id: 'arcs/flags',
  about: 'arc_flag effects and arcFlag/arcVisited conditions only mean anything inside a substory.',
  check(content) {
    const issues: Issue[] = [];
    const nodeIdsOf = (arcId: string) => new Set((content.arc(arcId)?.nodes ?? []).map((n) => n.id));

    for (const e of content.events) {
      const at = `event:${e.id}`;
      const inArc = Boolean(e.arc);

      for (const o of allOutcomes(e)) {
        for (const eff of o.effects) {
          if (eff.kind !== 'arc_flag') continue;
          if (!inArc) {
            issues.push(err(this.id, `${at}/${o.id}`,
              `sets arc flag '${eff.flag}', but this event is not a node of any substory — nothing can read it`));
          }
        }
      }

      // An event's own `conditions` are evaluated by the ambient selection pass,
      // where no arc is in scope even for an arc node. That is a warning rather
      // than an error only because an arc node's conditions are not consulted at
      // all — the arc calls it directly — so it is dead weight, not a lie.
      walkConditions(e.conditions, (c) => {
        if ('arcFlag' in c || 'arcVisited' in c) {
          issues.push(warn(this.id, at,
            'an arcFlag/arcVisited condition on an event is always false — put it on the successor\'s `when` instead'));
        }
      });
    }

    for (const arc of content.arcs) {
      const nodes = nodeIdsOf(arc.id);
      for (const n of arc.nodes) {
        for (const s of n.successors) {
          walkConditions(s.when, (c) => {
            if ('arcVisited' in c && !nodes.has(String(c.arcVisited))) {
              issues.push(err(this.id, `arc:${arc.id}/${n.id}`,
                `arcVisited names '${String(c.arcVisited)}', which is not a node of this arc`));
            }
          });
        }
      }
    }
    return issues;
  },
};

/**
 * A decider that names something that is not there does not fail — it falls
 * through to a weighted draw, which is a working event that quietly ignores the
 * rule its author wrote.
 */
const deciderWiring: ValidationRule = {
  id: 'decider/wiring',
  about: 'A state ladder must name real branches and end in an unguarded rung; a party decider needs a check and a party.',
  check(content) {
    const issues: Issue[] = [];
    for (const e of content.events) {
      const d = deciderOf(e);
      if (typeof d !== 'object') continue;
      const at = `event:${e.id}`;
      const choices = choicesOf(e);

      if ('state' in d) {
        for (const rung of d.state) {
          if (!choices.some((c) => c.id === rung.take)) {
            issues.push(err(this.id, at, `state rung takes '${rung.take}', which is not a branch of this event`));
          }
        }
        if (d.state.every((r) => r.when !== undefined)) {
          issues.push(warn(this.id, at,
            'every rung of this ladder is guarded — when none of them holds the branch is drawn by weight, '
            + 'which is rarely what a ladder is for. A final rung with no `when` is the else.'));
        }
        continue;
      }

      const check = e.checks.find((c) => c.id === d.party.check);
      if (!check) {
        issues.push(err(this.id, at, `party decider names check '${d.party.check}', which this event does not declare`));
      }
      // The point of delegating is that the player picks who. An event with no
      // player-cast slot delegates to whoever the engine happened to cast,
      // which is a check wearing a decision's clothes.
      if (!Object.values(e.slots).some((sl) => sl.castBy === 'player')) {
        issues.push(err(this.id, at,
          'a party decider needs at least one `castBy: player` slot — the party the player names is the decision'));
      }
    }
    return issues;
  },
};

// ── Shape of the writing ──────────────────────────────────────────────────

const outcomeWeights: ValidationRule = {
  id: 'outcomes/weights',
  about: 'A group of outcomes whose weights sum to zero can never resolve.',
  check(content) {
    const issues: Issue[] = [];
    for (const e of content.events) {
      // A checked choice resolves by band (issue #10), so its outcomes' own
      // weights are unused — asking them to sum to 100 would be enforcing a
      // number nothing reads.
      const groups = e.interaction.kind !== 'narration'
        ? e.interaction.choices.filter((c) => c.check === undefined).map((c) => c.outcomes)
        : outcomeGroups(e);
      for (const group of groups) {
        const sum = group.reduce((s, o) => s + o.weight, 0);
        if (sum === 0) issues.push(err(this.id, `event:${e.id}`, 'outcome weights sum to zero'));
        else if (sum !== 100) issues.push(warn(this.id, `event:${e.id}`, `outcome weights sum to ${sum}, not 100`));
      }
    }
    return issues;
  },
};

const choiceShape: ValidationRule = {
  id: 'event/shape',
  about: 'A choice with one option is narration; a body of twenty words is a stub.',
  check(content) {
    const issues: Issue[] = [];
    for (const e of content.events) {
      if (e.interaction.kind === 'choice' && e.interaction.choices.length < 2) {
        issues.push(err(this.id, `event:${e.id}`, 'a choice event needs at least two options'));
      }
      if (e.body.split(/\s+/).length < 25) {
        issues.push(warn(this.id, `event:${e.id}`, 'body under 25 words'));
      }
    }
    return issues;
  },
};

/**
 * A check's bands name one of two different things depending on what the check
 * is FOR, and the difference is not visible in the check itself.
 *
 *   Choice.check          resolves an outcome INSIDE a branch already taken.
 *                         Bands name outcome ids.
 *   decidedBy.party.check resolves WHICH BRANCH is taken (`decider.ts`).
 *                         Bands name choice ids.
 *
 * A check used as both would need its bands to mean both at once, which is why
 * that is an error rather than a clever feature.
 */
const checksWiring: ValidationRule = {
  id: 'checks/wiring',
  about: 'A Check must be declared to be named, its bands ordered highest-first, and every band must name a real '
    + 'outcome — or, for a check a party decider spends, a real branch.',
  check(content) {
    const issues: Issue[] = [];
    for (const e of content.events) {
      const at = `event:${e.id}`;

      for (const c of e.checks) {
        const thresholds = c.bands.map((b) => b.atLeast);
        for (let i = 1; i < thresholds.length; i++) {
          if (thresholds[i]! >= thresholds[i - 1]!) {
            issues.push(err(this.id, `${at}/check:${c.id}`, 'bands must be strictly descending by atLeast, highest threshold first'));
            break;
          }
        }
      }

      if (e.interaction.kind === 'narration') continue;

      const branchCheck = branchCheckOf(e);
      if (branchCheck !== undefined) {
        const check = e.checks.find((c) => c.id === branchCheck);
        const branchIds = new Set(e.interaction.choices.map((c) => c.id));
        if (check) {
          for (const b of check.bands) {
            if (!branchIds.has(b.outcome)) {
              issues.push(err(this.id, `${at}/check:${check.id}`,
                `this check decides the BRANCH, so its bands name choices — '${b.outcome}' is not one of them`));
            }
          }
        }
        if (e.interaction.choices.some((c) => c.check === branchCheck)) {
          issues.push(err(this.id, `${at}/check:${branchCheck}`,
            'is spent both to pick the branch and to resolve one — its bands cannot name choices and outcomes at once'));
        }
      }

      for (const choice of e.interaction.choices) {
        if (choice.check === undefined) continue;
        const at2 = `${at}/${choice.id}`;
        const check = e.checks.find((c) => c.id === choice.check);
        if (!check) {
          issues.push(err(this.id, at2, `names check '${choice.check}', which this event does not declare`));
          continue;
        }
        const outcomeIds = new Set(choice.outcomes.map((o) => o.id));
        for (const b of check.bands) {
          if (!outcomeIds.has(b.outcome)) {
            issues.push(err(this.id, at2, `check '${check.id}' band names outcome '${b.outcome}', which this choice does not have`));
          }
        }
      }
    }
    return issues;
  },
};

const voiceContract: ValidationRule = {
  id: 'prose/voice',
  about: 'Bodies over five sentences are held to the countable half of the prose manual. '
    + 'The frame answers to a tighter budget (issue #13).',
  check(content) {
    const issues: Issue[] = [];
    for (const e of content.events) {
      const threshold = e.tier === 'frame' ? FRAME_PROSE_SENTENCE_THRESHOLD : PROSE_SENTENCE_THRESHOLD;
      issues.push(...proseIssues(`event:${e.id}`, e.body, threshold));
      if (e.absentBody) issues.push(...proseIssues(`event:${e.id}/absentBody`, e.absentBody, threshold));
    }
    return issues;
  },
};

/**
 * §29's FIRST RULE, made into a check — and NARROWER than the issue's literal
 * text, for a reason that the shipped content proved on the first run.
 *
 * Rule 1 says no player-facing string may contain *pride*, *arrogance*,
 * *hubris* or *vanity*. Rule 4, four lines later, says **only other people say
 * it** — *"one circulating tale calls the house proud, another calls it
 * dignified, and both stand."* Those two rules cannot both be read literally,
 * and when this was first built as a flat word match over everything a player
 * can read, it returned five hits of which four were the design working:
 *
 *   - two nested tales, which is rule 4's own named channel
 *   - `the village decides the house is either very poor or very proud and
 *     settles, after some discussion, on proud` — other people, verbatim
 *   - a grandmother `not proud of` a household count, which is the word
 *     meaning something else entirely
 *
 * A rule that fires on four good sentences to catch one is a rule that
 * teaches authors to write worse, and this file's own convention is that a
 * floor belongs where it does not argue with the content that exists.
 *
 * So it checks the thing rule 1 is actually protecting: **it must never
 * become a stat.** *No stat, no meter, no bar* is the first half of that
 * sentence and is the half with teeth. In the content directory the nearest
 * thing to a meter is a CHOICE LABEL — the words on the button, which is
 * where a player looks to find out what a decision is called. There is no
 * legitimate scene in which the button names this. Prose may say what the
 * village thinks; the button may not tell the player what he is spending.
 *
 * The other half of rule 1 lives outside content, in the client, and is
 * asserted where it belongs: `session-api.test.ts` holds the read model to
 * exposing no bearing at all.
 */
const NEVER_NAMED = ['pride', 'proud', 'arrogance', 'arrogant', 'hubris', 'vanity', 'vain'];

/** The exact vocabulary guarded by `prose/bearing`, reusable by non-content prose. */
export function bearingWordsIn(text: string): string[] {
  return NEVER_NAMED.filter((word) => new RegExp(`\\b${word}\\b`, 'i').test(text));
}

const bearingUnnamed: ValidationRule = {
  id: 'prose/bearing',
  about: 'No choice label names bearing — it must never read as a stat (concept §29, rule 1).',
  check(content) {
    const issues: Issue[] = [];
    for (const e of content.events) {
      if (e.interaction.kind === 'narration') continue;
      for (const c of e.interaction.choices) {
        for (const word of bearingWordsIn(c.label)) {
          issues.push(err(this.id, `event:${e.id}/${c.id}`, `a choice label names it: '${word}'. `
            + 'Bearing is never a thing the player is told he is spending (concept §29, rule 1) — '
            + 'the label says what the house DOES, and the prose may let somebody else supply the noun'));
        }
      }
    }
    return issues;
  },
};

// ── The frame (concept §2, Layer 1; issue #13) ────────────────────────────

const frameShape: ValidationRule = {
  id: 'frame/shape',
  about: 'The frame reacts to the record: no effects, no Record block, no rumour, no choices, '
    + 'no slot against the living family, and at least one read to react to. `reads` is frame-only, '
    + 'and a `chronicled` read names an event that can actually leave a page.',
  check(content) {
    const issues: Issue[] = [];
    for (const e of content.events) {
      const at = `event:${e.id}`;

      if (e.tier !== 'frame') {
        if (e.reads.length) {
          issues.push(err(this.id, at, `'reads' is frame-only; this event is tier '${e.tier}'`));
        }
        continue;
      }

      if (e.reads.length === 0) {
        issues.push(err(this.id, at, 'a frame event declares no reads — it has nothing to react to'));
      }
      if (e.conditions) {
        issues.push(err(this.id, at, 'the frame gates on reads, not conditions — conditions read live household state, which the frame never looks at'));
      }
      if (e.record) {
        issues.push(err(this.id, at, 'the frame never dispenses systems information — no Record block'));
      }
      if (e.rumour) {
        issues.push(err(this.id, at, 'the frame is not part of the tale — it does not enter folklore'));
      }
      if (e.interaction.kind !== 'narration') {
        issues.push(err(this.id, at, 'the frame never asks the player anything — narration only'));
      }
      for (const [sid, spec] of Object.entries(e.slots)) {
        if (spec.role !== 'listener_record' && spec.role !== 'listener_blood') {
          issues.push(err(this.id, `${at}/${sid}`, `the frame casts only the two listener roles, not '${spec.role}'`));
        }
      }
      for (const o of allOutcomes(e)) {
        if (o.effects.length) {
          issues.push(err(this.id, `${at}/${o.id}`, 'the frame reacts — it does not change anything'));
        }
      }

      // A `chronicled` read waits for a page one named event leaves behind. A
      // typo in that name is the frame's own silent failure: the interlude is
      // simply never eligible, in any run, and nothing anywhere says so.
      for (const r of e.reads) {
        if (!('chronicled' in r)) continue;
        const source = content.events.find((x) => x.id === r.chronicled);
        if (!source) {
          issues.push(err(this.id, at, `'chronicled: ${r.chronicled}' names no event — this interlude can never be eligible`));
        } else if (source.tier === 'frame') {
          issues.push(err(this.id, at, `'chronicled: ${r.chronicled}' names a frame event, and the frame writes no chronicle`));
        }
      }
    }
    return issues;
  },
};

// ── The world around the events ───────────────────────────────────────────

const ageCoverage: ValidationRule = {
  id: 'ages/coverage',
  about: 'An Age with no content of its own is a modifier wearing a name.',
  check(content) {
    const issues: Issue[] = [];
    for (const age of content.ages) {
      const owned = content.events.filter((e) => e.ages?.only?.includes(age.id)).length;
      if (owned < 4) {
        issues.push(warn(this.id, `age:${age.id}`, `only ${owned} exclusive events — an Age with no content of its own is a modifier wearing a name`));
      }
      if (age.clauseBearing && age.duration.medianYears < 25) {
        issues.push(warn(this.id, `age:${age.id}`, 'clause-bearing Age with a short median span; consider clauseBearing: false'));
      }
    }
    return issues;
  },
};

const clauseAssignment: ValidationRule = {
  id: 'clause/ages',
  about: 'CI gate 7. A clause pinned to fewer than two Ages is a clause some runs never see.',
  check(content) {
    const issues: Issue[] = [];
    for (const c of content.clauses) {
      const at = `clause:${c.id}`;
      for (const a of c.ages) {
        if (!content.age(a)) issues.push(err(this.id, at, `unknown age '${a}'`));
      }
      if (c.ages.length < 2) {
        issues.push(err(this.id, at, `assigned to ${c.ages.length} Age(s) — every clause needs at least two`));
      }
    }
    return issues;
  },
};

/**
 * THE RUN HAS TWO ENDS, AND BOTH ARE AUTHORED.
 *
 * The prologue is one document and the endings are five, and every one of the
 * five has to be able to replay the prologue's triad. That makes three things
 * checkable before a run ever starts, all of which would otherwise be found by
 * a player at the only two moments in the game that cannot be replayed.
 */
const prologueShape: ValidationRule = {
  id: 'prologue/shape',
  about: 'One prologue, three beats, and both of its choices pointing at things that exist.',
  check(content) {
    const issues: Issue[] = [];
    if (content.bundle.prologue.length !== 1) {
      issues.push(err(this.id, 'prologue', `${content.bundle.prologue.length} prologues — the run opens on exactly one`));
      return issues;
    }
    const p = content.prologue!;
    const at = `prologue:${p.id}`;
    for (const h of p.heirlooms) {
      if (!content.heirloom(String(h.heirloom))) {
        issues.push(err(this.id, at, `unknown heirloom '${h.heirloom}' — the founding gift has to be a real object`));
      }
    }
    for (const g of p.grudges) {
      const house = content.house(String(g.house));
      if (!house) issues.push(err(this.id, at, `unknown house '${g.house}' — nobody to hold the first grudge`));
      else if (house.isPlayerHouse) issues.push(err(this.id, at, 'the first grudge is held against the house, not by it'));
    }
    return issues;
  },
};

const endingsComplete: ValidationRule = {
  id: 'ending/complete',
  about: 'All five endings, once each. An ending nobody wrote is an ending that cannot fire.',
  check(content) {
    const issues: Issue[] = [];
    const seen = new Map<string, number>();
    for (const e of content.endings) seen.set(e.id, (seen.get(e.id) ?? 0) + 1);
    for (const id of ENDING_ORDER) {
      const n = seen.get(id) ?? 0;
      if (n === 0) issues.push(err(this.id, `ending:${id}`, 'not authored — the closed ending union requires authored prose'));
      if (n > 1) issues.push(err(this.id, `ending:${id}`, `authored ${n} times`));
    }
    return issues;
  },
};

const endingRing: ValidationRule = {
  id: 'ending/ring',
  about: 'Every ending replays the prologue with EXACTLY ONE element changed. Two is a rewrite, none is not a ring.',
  check(content) {
    const issues: Issue[] = [];
    const beats = content.prologue?.triad.length ?? 0;
    for (const e of content.endings) {
      const at = `ending:${e.id}`;
      const changed = [e.ring.given, e.ring.owed].filter((x) => x !== undefined).length;
      if (changed !== 1) {
        issues.push(err(this.id, at, `${changed} elements changed — the ring substitutes exactly one`));
      }
      if (beats && (e.ring.beat < 1 || e.ring.beat > beats)) {
        issues.push(err(this.id, at, `beat ${e.ring.beat} is not one of the prologue's ${beats}`));
      }
    }
    return issues;
  },
};

/**
 * A POST IS A MAN'S, AND A SLOT IS WHERE THAT GETS FORGOTTEN.
 *
 * `canHoldPost` (career.ts) is the engine's gate and it holds: a `career`
 * effect landing on a daughter does nothing. Doing nothing is this codebase's
 * signature failure — the outcome still fires, still pays its Respect, still
 * writes its chronicle line, and still says "He is very good at it" about a
 * woman who was never placed. Five of the eight authored placements could cast
 * one: `role: unwoken` and `role: family_member` draw from the whole
 * household, and only three of them remembered `{ sex: male }`.
 *
 * So the rule is on the SLOT, not on the effect, for the same reason
 * `madness/gate` is: the gate the player can see is the casting, and an
 * outcome whose text has already decided the person is a son must not be able
 * to be handed a daughter. `canExpress` implies male (invariant 1), which is
 * why it counts as a guard here as it does there.
 */
const careerGate: ValidationRule = {
  id: 'careers/gate',
  about: 'A career may only be assigned to a slot already gated to men — every post in §18 is a man\'s.',
  check(content) {
    const issues: Issue[] = [];
    for (const e of content.events) {
      for (const o of allOutcomes(e)) {
        for (const eff of o.effects) {
          if (eff.kind !== 'career' || eff.op !== 'assign') continue;
          const t = eff.target;
          const named = typeof t === 'object' && 'slot' in t ? t.slot : undefined;
          const at = `event:${e.id}/${o.id}`;
          if (named === undefined) {
            issues.push(err(this.id, at, `assigns a career to '${typeof t === 'string' ? t : 'a party'}', which is not a slot that can be gated to men — name a slot filtered \`{ sex: male }\``));
            continue;
          }
          const slot = e.slots[named];
          if (!slot) continue;   // `slots/references` owns the undeclared-slot report
          const guarded = isLadderRole(slot.role)
            || slot.filters.some((f) => 'sex' in f && f.sex === 'male')
            || slot.filters.some((f) => 'canExpress' in f && f.canExpress === true);
          if (!guarded) {
            issues.push(err(
              this.id,
              at,
              `assigns career '${eff.career ?? '?'}' to slot '${named}', which can cast a woman — every post is a man's, so the placement would silently do nothing (add \`{ sex: male }\`)`,
            ));
          }
        }
      }
    }
    return issues;
  },
};

const mysticRestriction: ValidationRule = {
  id: 'traits/mystic-restriction',
  about: 'Women practise only the Threshold four (concept §9), so a female-tagged elemental trait is unlearnable.',
  check(content) {
    const issues: Issue[] = [];
    for (const t of content.traits) {
      if (t.acquisition.kind !== 'threshold') continue;
      const attr = String(t.acquisition.attr);
      if (!canLearn('female', attr) && t.tags.includes('female' as never)) {
        issues.push(warn(this.id, `trait:${t.id}`, 'female-tagged trait keyed to an elemental affinity'));
      }
    }
    return issues;
  },
};

// ── Gene pools ────────────────────────────────────────────────────────────

const genePoolAlleles: ValidationRule = {
  id: 'houses/alleles',
  about: 'A house\'s gene pool must name loci and alleles that exist, or it is a '
    + 'characterisation the genome never receives.',
  check(content) {
    const issues: Issue[] = [];
    const allelesByLocus = new Map(content.loci.map((l) => [String(l.id), new Set(l.alleles.map((a) => String(a.id)))]));

    for (const h of content.houses) {
      for (const [locus, overrides] of Object.entries(h.genePool.frequencies)) {
        const known = allelesByLocus.get(locus);
        if (!known) {
          issues.push(err(this.id, `house:${h.id}`, `gene pool overrides unknown locus '${locus}'`));
          continue;
        }
        for (const o of overrides) {
          if (!known.has(String(o.allele))) {
            issues.push(err(
              this.id,
              `house:${h.id}/${locus}`,
              `unknown allele '${String(o.allele)}' — the override is dropped and the house rolls the world baseline`,
            ));
          }
        }
      }
    }
    return issues;
  },
};

// ── The land (issue #91, #93) ─────────────────────────────────────────────

/**
 * `ParcelKind` is a closed union, and this is the site that dispatches over
 * it end to end — `landIncome` (core/land.ts) treats every kind the same
 * way, by its authored `baseYield`, so nothing else in the engine switches
 * on `kind` at all. Without a real dispatch site the union would typecheck
 * and mean nothing, which is invariant 11's exact shape: a declared field
 * nothing reads.
 *
 * What the kind actually governs is CARDINALITY. §5 and §12 of the world
 * doc describe eleven tenant farms — plural, unremarkable, the kind of
 * thing a house has several of. Every other kind is one named holding whose
 * identity supplies its risk rule: the mill, one slate share, one Sarrow
 * bottom, one Bramme house. A second is not more acreage of the same kind;
 * it is content silently giving one unique risk shape two identities.
 */
const parcelsWiring: ValidationRule = {
  id: 'parcels/wiring',
  about: 'tenant_farm may repeat; every other kind names one unique holding and risk shape.',
  check(content) {
    const issues: Issue[] = [];
    const seenUnique = new Map<string, string>();
    for (const p of content.parcels) {
      const at = `parcel:${p.id}`;
      switch (p.kind) {
        case 'tenant_farm':
          break;
        case 'mill':
        case 'woodland':
        case 'common':
        case 'demesne':
        case 'slate_work':
        case 'sarrow_bottom':
        case 'town_house':
        case 'wetland': {
          const prior = seenUnique.get(p.kind);
          if (prior) {
            issues.push(err(this.id, at, `a second '${p.kind}' parcel (alongside '${prior}') — the house has exactly one`));
          } else {
            seenUnique.set(p.kind, p.id);
          }
          break;
        }
        default:
          assertNever(p.kind, 'parcel kind');
      }
    }
    return issues;
  },
};

/**
 * WAR/WIRING (issue #89, Stage 3 — #97).
 *
 * `PositionDefS` leaves `minRespect`, `discountWithCareer` and the
 * price/multiplier pairing unenforced at the schema level, on the same
 * reasoning `slots/counted`'s own comment gives above: a schema failure
 * aborts the whole content parse and never names the position. This rule is
 * what actually holds all three, and names the position or event that broke
 * one.
 *
 * A position with a `price` and no `multiplier` is deliberately NOT a
 * default (#97's own text: "not `0`. Zero makes the choice 'buy in or don't
 * play'"). Defaulting a missing multiplier to anything would silently price
 * a position wrong forever, which is exactly the kind of thing this
 * codebase fails at by doing nothing.
 */
const warWiring: ValidationRule = {
  id: 'war/wiring',
  about: 'A position an event sets exists; minRespect is a real Respect tier; discountWithCareer names a real career; a priced position has a multiplier.',
  check(content) {
    const issues: Issue[] = [];

    for (const p of content.positions) {
      const at = `position:${p.id}`;
      if (p.minRespect !== undefined && !(RESPECT_ORDER as string[]).includes(p.minRespect)) {
        issues.push(err(this.id, at, `minRespect '${p.minRespect}' is not a real Respect tier`));
      }
      if (p.discountWithCareer !== undefined && !content.career(p.discountWithCareer)) {
        issues.push(err(this.id, at, `discountWithCareer names unknown career '${p.discountWithCareer}'`));
      }
      if (p.price !== undefined && p.multiplier === undefined) {
        issues.push(err(this.id, at, 'has a price and no multiplier — an authoring error, not a default'));
      }
    }

    for (const e of content.events) {
      const at = `event:${e.id}`;
      for (const o of allOutcomes(e)) {
        for (const eff of o.effects) {
          if (eff.kind === 'muster' && eff.op === 'set_position' && eff.position && !content.position(eff.position)) {
            issues.push(err(this.id, `${at}/${o.id}`, `sets unknown position '${eff.position}'`));
          }
        }
      }
    }

    return issues;
  },
};

/**
 * Registered in the order the panel should show them: identity, then
 * obligations, then wiring, then writing. Order has no other meaning — every
 * rule is independent, and `runRule` takes any one of them alone.
 */
/**
 * COUNTED SLOTS (issue #90).
 *
 * `SlotSpec.count` was declared in `event.ts` and read by nothing for as long
 * as it had existed — a slot cast exactly one person, always, and three
 * shipped events reached for `SENT_A/B/C` by hand to say "a party". It is
 * honoured now, which makes a new class of authoring error possible and this
 * is the rule that refuses it.
 *
 * A counted slot is SEVERAL PEOPLE. Every way content has of naming one person
 * — a `{ slot: }` target, a `slot` pool, a `requires` row, an effect field
 * naming a slot, an arc binding — takes the FIRST cast, which is an arbitrary
 * man out of up to five. That reads as working: the effect lands, the check
 * scores, the chronicle names somebody. It is simply four men short, and
 * nothing anywhere reports it. `{ all: }` and `party_sum` are the plural
 * forms, and this rule is what makes an author reach for them.
 *
 * The shape checks are here too rather than in the Zod schema, because a
 * schema failure aborts the parse and never names the event.
 */
const countedSlots: ValidationRule = {
  id: 'slots/counted',
  about: 'A slot that casts a party may only be referenced as a party — `{ all: }` or `party_sum`.',
  check(content) {
    const issues: Issue[] = [];

    for (const e of content.events) {
      const counted = new Set<string>();

      for (const [sid, spec] of Object.entries(e.slots)) {
        if (!spec.count) continue;
        const at = `event:${e.id}/${sid}`;
        const { min, max } = spec.count;
        counted.add(sid);

        if (min < 1) {
          issues.push(err(this.id, at, `count.min is ${min} — a party of nobody is \`optional: true\`, not a count of zero`));
        }
        if (max < min) {
          issues.push(err(this.id, at, `count.max (${max}) is below count.min (${min}) — this slot can never be cast`));
        }
        if (max < 2) {
          issues.push(err(this.id, at, `count.max is ${max} — a slot that casts one person is a slot; drop the count`));
        }
        if (spec.bind === 'arc') {
          issues.push(err(this.id, at, 'a counted slot cannot bind to an arc — a binding is one person, so four of five would fall out of the story between scenes'));
        }
      }

      if (!counted.size) continue;

      const singular = (where: string, slot: string, how: string) => {
        if (counted.has(slot)) {
          issues.push(err(this.id, where, `${how} names counted slot '${slot}' as one person — use ${how.startsWith('target') ? "{ all: '" + slot + "' }" : 'a party_sum pool'}`));
        }
      };

      const walkTarget = (t: unknown, where: string) => {
        if (t && typeof t === 'object' && 'slot' in t) singular(where, String((t as { slot: string }).slot), 'target');
      };

      for (const o of allOutcomes(e)) {
        const at = `event:${e.id}/${o.id}`;
        for (const eff of o.effects) {
          walkTarget((eff as { target?: unknown }).target, at);
          for (const field of ['slot', 'to', 'ascendant', 'subject', 'claimedAs'] as const) {
            const named = (eff as Record<string, unknown>)[field];
            if (typeof named === 'string' && counted.has(named)) {
              issues.push(err(this.id, at, `effect '${eff.kind}' names counted slot '${named}' in '${field}', which takes one person out of the party`));
            }
          }
        }
      }

      for (const c of choicesOf(e)) {
        for (const r of c.requires) singular(`event:${e.id}/${c.id}`, r.slot, 'a requires row');
      }

      for (const check of e.checks ?? []) {
        if (check.pool.kind === 'slot') singular(`event:${e.id}/${check.id}`, check.pool.slot, 'a slot pool');
      }

      if (e.record) {
        for (const key of ['record', 'omit', 'embellish'] as const) {
          const opt = e.record.options[key];
          if ('claims' in opt) for (const claim of opt.claims) walkTarget(claim.target, `event:${e.id}/record/${key}`);
          for (const eff of opt.effects) walkTarget((eff as { target?: unknown }).target, `event:${e.id}/record/${key}`);
        }
      }
    }

    return issues;
  },
};

/**
 * A CHOICE THAT CHANGES NOTHING (issue #266).
 *
 * Three findings off `auditChoices`, one rule, so the editor's Issues panel
 * files them together:
 *
 *   error    two options on one event whose outcomes do the same things. The
 *            player is choosing a label. Shipped content has none, so this is
 *            an error from day one.
 *   warning  a prose-only option — no effect, or only memory nothing reads —
 *            that is not tagged `self_expression`. Its Chronicle page differs,
 *            which is why self-expression is a legitimate thing to declare; it
 *            has to be declared, not arrived at.
 *   warning  a flag, knowledge key or arc flag that content writes and no
 *            condition reads (invariant 11). Once per key, at its first writer.
 *
 * The warnings are Phase B's worklist. When they reach zero, promote them to
 * errors in the same PR.
 */
const choiceConsequence: ValidationRule = {
  id: 'choices/consequence',
  about: 'Every choice must change something that lasts, and every flag or knowledge key written must be read somewhere.',
  check(content) {
    const issues: Issue[] = [];
    const audit = auditChoices(content);
    for (const c of audit.converging) {
      issues.push(err(this.id, `event:${c.event}`,
        `options ${c.choices.join(', ')} have identical effects and callbacks — the player is choosing a label`));
    }
    for (const r of audit.rows) {
      if (!isProseOnly(r)) continue;
      issues.push(warn(this.id, `event:${r.event}/${r.choice}`,
        `changes nothing that lasts — give it a cost or a remembered consequence, or tag every outcome '${SELF_EXPRESSION_TAG}'`));
    }
    for (const w of audit.writeOnly) {
      const what = w.kind === 'arc_flag' ? 'arc flag' : w.kind === 'knowledge' ? 'knowledge' : 'flag';
      issues.push(warn(this.id, w.writers[0]!,
        `${what} '${w.key}' is written${w.writers.length > 1 ? ` in ${w.writers.length} places` : ''} and read by no condition — author a reader, or delete the write`));
    }
    return issues;
  },
};

export const CONTENT_RULES: readonly ValidationRule[] = [
  uniqueIds,
  threePurposes,
  frequencyObligations,
  recordClaimSymmetry,
  slotReferences,
  negatedRelationOnPlayerCast,
  arcBoundSlots,
  countedSlots,
  madnessGate,
  knownReferences,
  accountsContradict,
  discrepancyWiring,
  secretsWiring,
  arcWiring,
  arcExpiry,
  inlineCollision,
  arcFlags,
  deciderWiring,
  outcomeWeights,
  choiceShape,
  checksWiring,
  ageCoverage,
  clauseAssignment,
  prologueShape,
  endingsComplete,
  endingRing,
  mysticRestriction,
  careerGate,
  genePoolAlleles,
  parcelsWiring,
  warWiring,
  purposeDuplicates,
  voiceContract,
  bearingUnnamed,
  frameShape,
  attentionFloor,
  riteWiring,
  choiceConsequence,
];
