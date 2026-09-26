import type { SimCtx } from './world.js';

/**
 * EXTERNAL RELATIONSHIP THREADS (issue #217).
 *
 * This is a READ MODEL, not diplomacy state. The world already remembers the
 * facts that matter: who holds a grudge, who was offered in the Match, which
 * house can prove a lie, who carried a secret out, what is due at auction and
 * which marriages were promised. A second mutable "opinion" map would drift
 * from those facts and would have to be saved forever.
 *
 * The hot path is intentionally two-stage. Consumers that only need to know
 * which houses should recur inspect CURRENT facts plus the last two
 * generations of decision history. Only the 2-3 selected threads then scan
 * older append-only history for their earliest recoverable origin. Event
 * casting therefore never walks a thousand-year log once per candidate.
 */

export const RELATIONSHIP_THREAD_CAP = 3;
export const RELATIONSHIP_THREAD_RECALL_MULTIPLIER = 1.25;
const RECENT_CONTACT_YEARS = 60;
const PRESSURES_PER_THREAD = 3;

export type RelationshipThreadFactKind =
  | 'grudge'
  | 'courtship'
  | 'record'
  | 'secret'
  | 'auction'
  | 'marriage_promise'
  | 'family'
  | 'recent_contact';

export interface RelationshipThreadFact {
  kind: RelationshipThreadFactKind;
  year: number;
  detail: string;
  ref?: string;
}

export interface RelationshipThread {
  /** A HouseDef id where one exists; institutional pools use the same id space. */
  house: string;
  /** Player-facing name, resolved from content rather than invented here. */
  name: string;
  /** Earliest concrete fact recoverable for this currently active relationship. */
  origin: RelationshipThreadFact;
  /** Why this relationship matters now, strongest first. */
  pressures: RelationshipThreadFact[];
}

interface Fact extends RelationshipThreadFact {
  active: boolean;
  priority: number;
}

interface Builder {
  house: string;
  name: string;
  facts: Fact[];
}

interface Ranked {
  builder: Builder;
  score: number;
  latest: number;
}

/** Locale-free tiebreak for simulation ordering. */
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function readableId(id: string): string {
  return id
    .replace(/^(house_|the_)/, '')
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function houseName(ctx: SimCtx, house: string): string {
  return ctx.content.house(house)?.name ?? readableId(house);
}

function refName(ctx: SimCtx, ref: string): string {
  return ctx.content.spellbook(ref)?.name
    ?? ctx.content.heirloom(ref)?.name
    ?? ctx.content.house(ref)?.name
    ?? readableId(ref);
}

function clip(text: string | null | undefined, max = 72): string | undefined {
  if (!text) return undefined;
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).trimEnd()}…`;
}

function addFact(
  builders: Map<string, Builder>,
  ctx: SimCtx,
  house: string | undefined,
  fact: Fact,
): void {
  if (!house || house === ctx.world.playerHouse) return;
  let builder = builders.get(house);
  if (!builder) {
    builder = { house, name: houseName(ctx, house), facts: [] };
    builders.set(house, builder);
  }
  const duplicate = builder.facts.some((f) =>
    f.kind === fact.kind && f.year === fact.year && f.ref === fact.ref && f.detail === fact.detail);
  if (!duplicate) builder.facts.push(fact);
}

function isOurPerson(ctx: SimCtx, id: string): boolean {
  const p = ctx.world.people.get(id);
  if (!p) return false;
  return String(p.houseOfOrigin) === ctx.world.playerHouse
    || p.membership.some((m) => String(m.house) === ctx.world.playerHouse);
}

/** Living marriage links survive the spouse while one of their children is still alive. */
function currentFamilyConnections(builders: Map<string, Builder>, ctx: SimCtx): void {
  const w = ctx.world;
  for (const person of w.people.all()) {
    const house = String(person.houseOfOrigin);
    if (house === w.playerHouse) continue;
    const joined = person.membership
      .filter((m) => String(m.house) === w.playerHouse && m.kind === 'married_in')
      .sort((a, b) => a.from - b.from)[0];
    if (!joined) continue;
    const connected = person.status === 'alive'
      || w.people.children(person.id).some((child) => child.status === 'alive');
    if (!connected) continue;
    addFact(builders, ctx, house, {
      kind: 'family',
      year: joined.from,
      detail: `${person.name} of ${houseName(ctx, house)} married into the family in ${joined.from}; the connection is still living.`,
      ref: String(person.id),
      active: true,
      priority: 72,
    });
  }
}

/**
 * Append-only decisions are chronological. Walk backwards only as far as two
 * generations: older scenes can explain an already-active thread, but cannot
 * by themselves keep a relationship in the active three.
 */
function recentOutcomeHistory(builders: Map<string, Builder>, ctx: SimCtx): void {
  const w = ctx.world;
  const floor = w.year - RECENT_CONTACT_YEARS;
  for (let i = w.decisionLog.length - 1; i >= 0; i -= 1) {
    const logged = w.decisionLog[i]!;
    if (logged.year < floor) break;
    if (logged.kind !== 'outcome') continue;
    const event = ctx.content.event(logged.event);
    if (!event?.purposes.includes('change_relationship')) continue;

    const ids = new Set<string>();
    for (const value of Object.values(logged.fill)) {
      if (Array.isArray(value)) for (const id of value) ids.add(id);
      else if (value) ids.add(value);
    }
    for (const id of ids) {
      const person = w.people.get(id);
      if (!person) continue;
      const house = String(person.houseOfOrigin);
      if (house === w.playerHouse) continue;
      addFact(builders, ctx, house, {
        kind: 'recent_contact',
        year: logged.year,
        detail: `${person.name} of ${houseName(ctx, house)} dealt with the family in “${event.title}” in ${logged.year}.`,
        ref: `${logged.event}:${id}`,
        active: true,
        priority: 42,
      });
    }
  }
}

function currentCourtships(builders: Map<string, Builder>, ctx: SimCtx): void {
  for (const [house, lineage] of ctx.world.rivalLineages) {
    for (const person of lineage.people) {
      const met = person.courtship;
      if (!met) continue;
      const actionable = person.died === undefined
        && person.left === undefined
        && person.spouse === undefined;
      if (!actionable) continue;
      addFact(builders, ctx, house, {
        kind: 'courtship',
        year: met.offered,
        detail: `${met.name} of ${houseName(ctx, house)} came before the Match in ${met.offered} and remains unmarried in that house.`,
        ref: person.id,
        active: true,
        priority: 76,
      });
    }
  }
}

function currentGrudges(builders: Map<string, Builder>, ctx: SimCtx): void {
  const w = ctx.world;
  for (const rel of w.relationships.values()) {
    const from = w.people.get(rel.from);
    const to = w.people.get(rel.to);
    if (!from || !to) continue;

    const fromUs = isOurPerson(ctx, rel.from);
    const toUs = isOurPerson(ctx, rel.to);
    if (fromUs === toUs) continue;

    const outsider = fromUs ? to : from;
    const house = String(outsider.houseOfOrigin);
    if (house === w.playerHouse) continue;

    for (const grudge of rel.grudges) {
      if (grudge.severity <= 1) continue;
      const entry = w.chronicle.find((c) =>
        c.year === grudge.originYear && c.eventId === grudge.originEvent);
      const namedOrigin = entry?.title ?? clip(entry?.text) ?? 'the quarrel';
      const holder = from === outsider ? `${from.name} of ${houseName(ctx, house)}` : from.name;
      const target = to === outsider ? `${to.name} of ${houseName(ctx, house)}` : to.name;
      addFact(builders, ctx, house, {
        kind: 'grudge',
        year: grudge.originYear,
        detail: `${holder} still holds a grudge against ${target} over ${namedOrigin} (${grudge.originYear}).`,
        ref: grudge.id,
        active: true,
        priority: 90 + Math.min(9, Math.floor(grudge.severity / 10)),
      });
    }
  }
}

function currentRecords(builders: Map<string, Builder>, ctx: SimCtx): void {
  const w = ctx.world;
  for (const [id, discrepancy] of w.discrepancies) {
    if (discrepancy.state !== 'open') continue;
    const entry = w.chronicle.find((c) => c.discrepancyId === id);
    const year = entry?.year ?? w.year;
    const claim = entry?.title
      ? `the ${year} entry “${entry.title}”`
      : entry?.text
        ? `the ${year} entry “${clip(entry.text)}”`
        : `a disputed ${year} entry`;
    for (const house of discrepancy.provableBy) {
      addFact(builders, ctx, house, {
        kind: 'record',
        year,
        detail: `${houseName(ctx, house)} can prove ${claim}.`,
        ref: id,
        active: true,
        priority: 100,
      });
    }
  }
}

function currentSecrets(builders: Map<string, Builder>, ctx: SimCtx): void {
  for (const secret of ctx.world.looseSecrets) {
    if (secret.told !== undefined) continue;
    addFact(builders, ctx, secret.house, {
      kind: 'secret',
      year: secret.since,
      detail: `${secret.carrierName} carried a household secret to ${houseName(ctx, secret.house)} in ${secret.since} and has not yet told it.`,
      ref: secret.secret,
      active: true,
      priority: 86,
    });
  }
}

function currentAuctions(builders: Map<string, Builder>, ctx: SimCtx): void {
  const w = ctx.world;
  for (const lot of w.auction.upcoming) {
    if (lot.saleYear < w.year) continue;
    addFact(builders, ctx, lot.house, {
      kind: 'auction',
      year: lot.announcedYear,
      detail: `${houseName(ctx, lot.house)} is bringing ${refName(ctx, lot.refId)} to auction in ${lot.saleYear}.`,
      ref: lot.id,
      active: true,
      priority: 64,
    });
  }

  for (const promise of w.marriagePromises) {
    addFact(builders, ctx, promise.toHouse, {
      kind: 'marriage_promise',
      year: promise.year,
      detail: `${houseName(ctx, promise.toHouse)} is owed the marriage pledged in ${promise.year} for ${refName(ctx, promise.lot)}.`,
      ref: promise.lot,
      active: true,
      priority: 88,
    });
  }
}

function currentBuilders(ctx: SimCtx): Map<string, Builder> {
  const builders = new Map<string, Builder>();
  currentFamilyConnections(builders, ctx);
  recentOutcomeHistory(builders, ctx);
  currentCourtships(builders, ctx);
  currentGrudges(builders, ctx);
  currentRecords(builders, ctx);
  currentSecrets(builders, ctx);
  currentAuctions(builders, ctx);
  return builders;
}

function rankedBuilders(ctx: SimCtx, builders: Map<string, Builder>, cap: number): Ranked[] {
  if (cap <= 0) return [];
  const ranked: Ranked[] = [];
  for (const builder of builders.values()) {
    const active = builder.facts.filter((f) => f.active);
    if (!active.length) continue;
    const pressures = [...active].sort((a, b) =>
      b.priority - a.priority || b.year - a.year || compareText(a.detail, b.detail));
    const strongest = pressures[0]!;
    const latest = Math.max(...pressures.map((f) => f.year));
    const age = Math.max(0, ctx.world.year - latest);
    const recency = Math.max(0, 20 - Math.floor(age / 5));
    const breadth = Math.min(12, pressures.length * 4);
    ranked.push({ builder, score: strongest.priority + recency + breadth, latest });
  }
  return ranked
    .sort((a, b) =>
      b.score - a.score
      || b.latest - a.latest
      || compareText(a.builder.house, b.builder.house))
    .slice(0, cap);
}

function historicalOrigins(
  builders: Map<string, Builder>,
  ctx: SimCtx,
  wanted: ReadonlySet<string>,
): void {
  const w = ctx.world;
  const wants = (house: string) => wanted.has(house) && house !== w.playerHouse;

  // Full decision history is consulted only for the already-selected houses.
  for (const logged of w.decisionLog) {
    if (logged.kind === 'match') {
      if (!logged.spouse) continue;
      const spouse = w.people.get(logged.spouse);
      if (!spouse) continue;
      const house = String(spouse.houseOfOrigin);
      if (!wants(house)) continue;
      addFact(builders, ctx, house, {
        kind: 'family',
        year: logged.year,
        detail: `${spouse.name} of ${houseName(ctx, house)} married into the family in ${logged.year}.`,
        ref: String(spouse.id),
        active: false,
        priority: 30,
      });
      continue;
    }

    if (logged.kind !== 'outcome') continue;
    const event = ctx.content.event(logged.event);
    if (!event?.purposes.includes('change_relationship')) continue;
    const ids = new Set<string>();
    for (const value of Object.values(logged.fill)) {
      if (Array.isArray(value)) for (const id of value) ids.add(id);
      else if (value) ids.add(value);
    }
    for (const id of ids) {
      const person = w.people.get(id);
      if (!person) continue;
      const house = String(person.houseOfOrigin);
      if (!wants(house)) continue;
      addFact(builders, ctx, house, {
        kind: 'recent_contact',
        year: logged.year,
        detail: `${person.name} of ${houseName(ctx, house)} dealt with the family in “${event.title}” in ${logged.year}.`,
        ref: `${logged.event}:${id}`,
        active: false,
        priority: 20,
      });
    }
  }

  for (const [house, lineage] of w.rivalLineages) {
    if (!wants(house)) continue;
    for (const person of lineage.people) {
      const met = person.courtship;
      if (!met) continue;
      addFact(builders, ctx, house, {
        kind: 'courtship',
        year: met.offered,
        detail: `${met.name} of ${houseName(ctx, house)} came before the Match in ${met.offered}.`,
        ref: person.id,
        active: false,
        priority: 20,
      });
    }
  }

  for (const [id, discrepancy] of w.discrepancies) {
    if (discrepancy.state === 'open') continue;
    const entry = w.chronicle.find((c) => c.discrepancyId === id);
    const year = entry?.year ?? w.year;
    const claim = entry?.title ? `the ${year} entry “${entry.title}”` : `a disputed ${year} entry`;
    for (const house of discrepancy.provableBy) {
      if (!wants(house)) continue;
      addFact(builders, ctx, house, {
        kind: 'record',
        year,
        detail: `${houseName(ctx, house)} was tied to the evidence behind ${claim}.`,
        ref: id,
        active: false,
        priority: 20,
      });
    }
  }

  for (const secret of w.looseSecrets) {
    if (secret.told === undefined || !wants(secret.house)) continue;
    addFact(builders, ctx, secret.house, {
      kind: 'secret',
      year: secret.since,
      detail: `${secret.carrierName} carried a household secret to ${houseName(ctx, secret.house)} in ${secret.since}; it was told in ${secret.told}.`,
      ref: secret.secret,
      active: false,
      priority: 20,
    });
  }

  for (const entry of w.auction.history) {
    const lot = entry.lot;
    if (wants(lot.house)) {
      addFact(builders, ctx, lot.house, {
        kind: 'auction',
        year: entry.year,
        detail: `${houseName(ctx, lot.house)} offered ${refName(ctx, lot.refId)} at the ${entry.year} auction.`,
        ref: lot.id,
        active: false,
        priority: 18,
      });
    }
    if (entry.winningHouse && entry.winningHouse !== lot.house && wants(entry.winningHouse)) {
      addFact(builders, ctx, entry.winningHouse, {
        kind: 'auction',
        year: entry.year,
        detail: `${houseName(ctx, entry.winningHouse)} took ${refName(ctx, lot.refId)} at the ${entry.year} auction.`,
        ref: `${lot.id}:winner`,
        active: false,
        priority: 20,
      });
    }
  }
}

function publicFact(fact: Fact): RelationshipThreadFact {
  const { kind, year, detail, ref } = fact;
  return { kind, year, detail, ...(ref !== undefined ? { ref } : {}) };
}

function materialize(builder: Builder): RelationshipThread {
  const origin = [...builder.facts].sort((a, b) =>
    a.year - b.year || b.priority - a.priority || compareText(a.detail, b.detail))[0]!;
  const pressures = builder.facts
    .filter((fact) => fact.active)
    .sort((a, b) =>
      b.priority - a.priority || b.year - a.year || compareText(a.detail, b.detail))
    .slice(0, PRESSURES_PER_THREAD)
    .map(publicFact);
  return {
    house: builder.house,
    name: builder.name,
    origin: publicFact(origin),
    pressures,
  };
}

/**
 * The two or three external names the game should currently be capable of
 * calling back. No state is written: save/load cannot make this list drift.
 */
export function relationshipThreads(
  ctx: SimCtx,
  cap = RELATIONSHIP_THREAD_CAP,
): RelationshipThread[] {
  const builders = currentBuilders(ctx);
  const ranked = rankedBuilders(ctx, builders, cap);
  const wanted = new Set(ranked.map((entry) => entry.builder.house));
  historicalOrigins(builders, ctx, wanted);
  return ranked.map((entry) => materialize(entry.builder));
}

/**
 * Hot recurrence query used by Match, auction and event casting. It does NOT
 * scan deep history: inactive facts cannot change which relationships are
 * active, only how an active one explains its origin.
 */
export function activeRelationshipThreadHouses(ctx: SimCtx): Set<string> {
  const builders = currentBuilders(ctx);
  return new Set(
    rankedBuilders(ctx, builders, RELATIONSHIP_THREAD_CAP)
      .map((entry) => entry.builder.house),
  );
}

/**
 * Recurrence, not affection. Active threads get a modest 25% recall preference
 * by an existing consumer; the value says nothing about whether the fact is
 * friendly, hostile or both.
 */
export function relationshipThreadRecallMultiplier(ctx: SimCtx, house: string): number {
  return activeRelationshipThreadHouses(ctx).has(house)
    ? RELATIONSHIP_THREAD_RECALL_MULTIPLIER
    : 1;
}


/** The active thread for one outside house, with its earliest concrete origin. */
export function externalThreadFor(ctx: SimCtx, house: string): RelationshipThread | undefined {
  return relationshipThreads(ctx).find((thread) => thread.house === house);
}

/**
 * The highest-ranked active thread represented by concrete people in a cast.
 * This keeps a callback attached to somebody actually present in the decision.
 */
export function externalThreadForPeople(
  ctx: SimCtx,
  personIds: Iterable<string>,
): RelationshipThread | undefined {
  const houses = new Set<string>();
  for (const id of personIds) {
    const person = ctx.world.people.get(id);
    if (!person) continue;
    const house = String(person.houseOfOrigin);
    if (house !== ctx.world.playerHouse) houses.add(house);
  }
  return relationshipThreads(ctx).find((thread) => houses.has(thread.house));
}
