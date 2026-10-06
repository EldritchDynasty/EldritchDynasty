import type { PrologueDef, PrologueOwed, Sex } from '@ed/schema';
import { RESPECT_ORDER } from '@ed/schema';
import type { SimCtx } from './world.js';
import { grantHeirloom } from './people/heirlooms.js';
import { hashSeed, makeRng } from './rng.js';
import { addGrudge } from './people/relationships.js';
import { MAX_FRIENDS, dealWindows, normaliseFriends, type FriendName } from './people/friends.js';
import { campaignDef, type CampaignDef } from './campaign.js';
import { dismissRetainer } from './people/succession.js';
import { selectedSigningTerms } from './sim.js';
import { renderContentProse } from './prose.js';

/**
 * THE SIGNING (concept §3, issue #38).
 *
 * Twelve to eighteen frame interludes a run refer back to a night the player
 * never saw. The frame is the promise every generation is played against, and
 * it was a promise about an event that happened off-screen to nobody.
 *
 * Two things make this more than a title card, and both are the reason it is
 * here rather than in the client:
 *
 * - **The two choices are simulation inputs.** The founding heirloom goes into
 *   `world.heirlooms`, where the ladder's Regalia gate, the auction and every
 *   `heirloom` condition can see it. The first grudge is a `Relationship`
 *   edge, and `grudgeAgainstUs` reads it across a Long Line.
 * - **The epilogue has to replay it.** §23's ring is this triad restated with
 *   exactly one element changed, which is only possible if the triad is data
 *   that both ends read.
 *
 * A world nobody founded is still a legal world. The harness bootstraps
 * hundreds a minute and answers no prologue, and every default is already
 * there: the house has a name in `houses.yaml`, holds its Regalia, and starts
 * with whatever grudges the seed cast brought with them. What the prologue
 * adds is the player's fingerprint on all three, kept in `world.founding` so
 * that at the term the ending can say which of them the Long Line changed.
 */

export interface PrologueView {
  id: string;
  opening: string;
  triad: { given: string; owed: string }[];
  /** The founder-name question. Blank keeps the authored seed name. */
  namePrompt?: string;
  /**
   * Examination copy only. Structured terms stay inside core/schema: a client
   * chooses authored answer ids and never receives the simulation operations
   * or numeric weights behind them.
   */
  examination: {
    id: string;
    situation: string;
    answers: { id: string; says: string; given: string; owed: string }[];
  }[];
  housePrompt: string;
  /** The last question, and the only one not about the house. */
  friendsPrompt: string;
  /** How many names it asks for. */
  friendsWanted: number;
  /** The founding gift, with the object's own name and blurb beside the ask. */
  heirlooms: { heirloom: string; name: string; blurb: string; line: string }[];
  /** The first grudge, with the house that will hold it. */
  grudges: { house: string; houseName: string; line: string }[];
  thesis: string;
  /**
   * One older house's account, when this run inherited a Library memory.
   *
   * The wrapper names the source and the voice; it never promotes the tale to
   * fact. The memory's own teller and bias remain visible because the game is
   * not the judge between attributed accounts.
   */
  inherited?: { houseName: string; teller: string; bias: string; text: string; line: string };
  /** What was chosen, once it has been. The prologue is a once-only screen. */
  founded?: { houseName: string; heirloom: string; grudge: string; year: number };
  /**
   * The five, once they have been given — name and sex only. Whether one has
   * been spent is deliberately NOT here: a screen that shows the player which
   * of their friends is still to come turns the one unannounced thing in the
   * game into a progress bar.
   */
  friends?: { name: string; sex: Sex }[];
}

export interface FoundingChoice {
  houseName: string;
  heirloom: string;
  grudge: string;
  /**
   * Five people the player could not have done without, in their own words.
   * Optional and allowed to be short: the signing ASKS, and a player who would
   * rather not answer is a player whose run simply never hands one out. See
   * `people/friends.ts`.
   */
  friends?: { name: string; sex: Sex }[];
  /** Stable Examination question id -> selected answer id. */
  answers?: Readonly<Record<string, string>>;
  /** GameSession uses this to rebuild the founding cast before this verb runs. */
  founderName?: string;
}

/** A house name is a line on a page, not an essay. */
export const HOUSE_NAME_MAX = 48;

function prosePathId(id: string): string {
  return encodeURIComponent(id);
}

function prologueProse(
  ctx: SimCtx,
  def: PrologueDef,
  path: string,
  original: string,
): string {
  const file = ctx.content.sourceOf(String(def.id));
  if (file === undefined) return original;
  return renderContentProse(
    ctx,
    file,
    `prologue[id=${prosePathId(String(def.id))}].${path}`,
    original,
  );
}

function identifiedContentProse(
  ctx: SimCtx,
  collection: string,
  id: string,
  field: string,
  original: string,
): string {
  const file = ctx.content.sourceOf(id);
  if (file === undefined) return original;
  return renderContentProse(
    ctx,
    file,
    `${collection}[id=${prosePathId(id)}].${field}`,
    original,
  );
}

export function prologueDef(ctx: SimCtx): PrologueDef | undefined {
  return ctx.content.prologue;
}

function inheritedRumour(
  ctx: SimCtx,
  def: PrologueDef,
): PrologueView['inherited'] | undefined {
  if (def.inheritedLine === undefined) return undefined;
  const memory = [...ctx.world.libraryMemories]
    .sort((a, b) => b.mutations - a.mutations || a.id.localeCompare(b.id))[0];
  if (!memory) return undefined;

  return {
    houseName: memory.sourceHouse,
    teller: memory.teller,
    bias: memory.bias,
    text: memory.text,
    // Authored frame prose: it names where the account came from and whose
    // voice carries it, and never tells the player whether it is true.
    line: prologueProse(ctx, def, 'inheritedLine', def.inheritedLine)
      .replaceAll('{house}', memory.sourceHouse)
      .replaceAll('{teller}', memory.teller),
  };
}

function renderOwed(
  ctx: SimCtx,
  def: PrologueDef,
  owed: PrologueOwed,
  campaign: CampaignDef,
  index: number,
): string {
  const path = `triad[${index}].owed`;
  const authored = typeof owed === 'string'
    ? prologueProse(ctx, def, path, owed)
    : prologueProse(ctx, def, `${path}.campaignText`, owed.campaignText);
  return authored
    .replaceAll('{years}', String(campaign.years))
    .replaceAll('{endYear}', String(campaign.endYear));
}

/**
 * The three promises exactly as this campaign states them.
 *
 * Both ends of a run consume this function. Keeping the interpolation here is
 * what makes the ring replay the signing the player actually saw rather than
 * the raw authored template underneath it.
 */
export function prologueTriad(ctx: SimCtx): PrologueView['triad'] | undefined {
  const def = prologueDef(ctx);
  if (!def) return undefined;
  const campaign = campaignDef(ctx.world.campaign);
  return def.triad.map((beat, index) => ({
    given: prologueProse(ctx, def, `triad[${index}].given`, beat.given),
    owed: renderOwed(ctx, def, beat.owed, campaign, index),
  }));
}

/**
 * The prologue as plain values. Undefined where the bundle has no prologue —
 * a hand-built test bundle, which is allowed to be a bundle of two events.
 */
export function prologueView(ctx: SimCtx): PrologueView | undefined {
  const def = prologueDef(ctx);
  const triad = prologueTriad(ctx);
  if (!def || !triad) return undefined;
  const w = ctx.world;

  const view: PrologueView = {
    id: def.id,
    opening: prologueProse(ctx, def, 'opening', def.opening),
    triad,
    ...(def.namePrompt !== undefined
      ? { namePrompt: prologueProse(ctx, def, 'namePrompt', def.namePrompt) }
      : {}),
    examination: def.examination.map((question) => ({
      id: question.id,
      situation: prologueProse(
        ctx,
        def,
        `examination[id=${prosePathId(question.id)}].situation`,
        question.situation,
      ),
      answers: question.answers.map((answer) => {
        const base = `examination[id=${prosePathId(question.id)}].answers[id=${prosePathId(answer.id)}]`;
        return {
          id: answer.id,
          says: prologueProse(ctx, def, `${base}.says`, answer.says),
          given: prologueProse(ctx, def, `${base}.given`, answer.given),
          owed: prologueProse(ctx, def, `${base}.owed`, answer.owed),
        };
      }),
    })),
    housePrompt: prologueProse(ctx, def, 'housePrompt', def.housePrompt),
    friendsPrompt: prologueProse(ctx, def, 'friendsPrompt', def.friendsPrompt),
    friendsWanted: MAX_FRIENDS,
    heirlooms: def.heirlooms.flatMap((h, index) => {
      const id = String(h.heirloom);
      const object = ctx.content.heirloom(id);
      // Content edited out from under a save — the same shrug `tickTales`
      // makes. An option pointing at nothing is not an option.
      if (!object) return [];
      return [{
        heirloom: id,
        name: identifiedContentProse(ctx, 'heirlooms', id, 'name', object.name),
        blurb: identifiedContentProse(ctx, 'heirlooms', id, 'blurb', object.blurb ?? ''),
        line: prologueProse(ctx, def, `heirlooms[${index}].line`, h.line),
      }];
    }),
    grudges: def.grudges.flatMap((g, index) => {
      const id = String(g.house);
      const house = ctx.content.house(id);
      if (!house) return [];
      return [{
        house: id,
        houseName: identifiedContentProse(ctx, 'houses', id, 'name', house.name),
        line: prologueProse(ctx, def, `grudges[${index}].line`, g.line),
      }];
    }),
    thesis: prologueProse(ctx, def, 'thesis', def.thesis),
  };
  const inherited = inheritedRumour(ctx, def);
  if (inherited) view.inherited = inherited;
  if (w.founding) view.founded = { ...w.founding };
  if (w.friends.length) view.friends = w.friends.map((f) => ({ name: f.name, sex: f.sex }));
  return view;
}

export interface FoundingResult {
  ok: boolean;
  reason?: string;
}

/**
 * Answer the prologue. Once, in 1042, and never again.
 *
 * The two choices are checked against the AUTHORED options rather than against
 * the content at large: a client may not found the house on an heirloom the
 * prologue never offered, and may not hand the first grudge to the Commons.
 * That is not defensiveness about a hostile client — it is that the ending
 * names what was chosen, and an ending naming something the prologue never
 * said is a ring with a hole in it.
 */
export function foundHouse(ctx: SimCtx, choice: FoundingChoice): FoundingResult {
  const w = ctx.world;
  const def = prologueDef(ctx);
  if (!def) return { ok: false, reason: 'this bundle has no prologue' };
  if (w.founding) return { ok: false, reason: 'the house has already been founded' };

  const houseName = choice.houseName.trim().replace(/\s+/g, ' ');
  if (!houseName) return { ok: false, reason: 'the house needs a name' };
  if (houseName.length > HOUSE_NAME_MAX) return { ok: false, reason: 'that is a paragraph, not a name' };

  const heirloom = def.heirlooms.find((h) => String(h.heirloom) === choice.heirloom);
  if (!heirloom) return { ok: false, reason: 'he did not ask for that' };
  const grudge = def.grudges.find((g) => String(g.house) === choice.grudge);
  if (!grudge) return { ok: false, reason: 'nobody was wronged in that direction' };

  const object = ctx.content.heirloom(String(heirloom.heirloom));
  const house = ctx.content.house(String(grudge.house));
  if (!object || !house) return { ok: false, reason: 'the content no longer holds that' };

  // THE FIVE, CHECKED BEFORE ANYTHING IS WRITTEN. Everything below this line
  // mutates the world — the heirloom into the house's hands, the grudge into
  // the world — and a founding that half-happened because the sixth name was
  // a duplicate is a run the player cannot restart and cannot fix.
  const roster: FriendName[] = [];
  if (choice.friends?.length) {
    const checked = normaliseFriends(choice.friends, w.year);
    if (!checked.ok) return { ok: false, reason: checked.reason };
    // One to a band across five centuries, in an order the boxes on the screen
    // do not predict. Its own stream, so adding or removing a name changes when
    // the five arrive and nothing else in 1042.
    roster.push(...dealWindows(checked.friends, w.year, makeRng(hashSeed(w.seed, 'friend-windows'))));
  }

  // THE EXAMINATION, RESOLVED BEFORE THE FIRST MUTATION. Rules validate the
  // shipped bundle, but user content may still disappear between selection
  // and this verb. Founding is all-or-nothing either way.
  let signingTerms: ReturnType<typeof selectedSigningTerms>;
  try {
    signingTerms = selectedSigningTerms(ctx.content, { answers: choice.answers });
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : 'the Examination answer was not understood',
    };
  }
  const signingRetainers = new Map<string, NonNullable<ReturnType<typeof seedPerson>>>();
  for (const term of signingTerms) {
    if (term.kind === 'loyalty' || term.kind === 'dismiss') {
      const person = seedPerson(ctx, term.retainer);
      if (!person?.contract) {
        return { ok: false, reason: `the signing names unavailable retainer '${term.retainer}'` };
      }
      signingRetainers.set(term.retainer, person);
    } else if (term.kind === 'grudge' && !ctx.content.house(String(term.house))) {
      return { ok: false, reason: `the signing names missing house '${String(term.house)}'` };
    }
  }
  const signingAnswers = Object.fromEntries(
    Object.entries(choice.answers ?? {}).sort(([a], [b]) => a.localeCompare(b)),
  );
  const selectedAnswers = def.examination.flatMap((question) => {
    const answerId = signingAnswers[question.id];
    if (answerId === undefined) return [];
    const answer = question.answers.find((candidate) => candidate.id === answerId);
    return answer ? [answer] : [];
  });

  grantHeirloom(ctx, String(heirloom.heirloom));

  // HELD BY A PERSON, AGAINST A PERSON. Both ends of a grudge are people —
  // every authored `relationship` effect in the content is person to person,
  // `grudgeAgainstUs` looks the target up in the person store, and
  // `tickRelationships` re-points each end down the generations as its holders
  // die. An edge with a HOUSE id on the end of it reads as an edge whose
  // holder is dead, and is deleted the first year it is ticked unless it is
  // house-wide — which is a founding grudge that quietly lasts one generation,
  // and looks exactly like one that lasts a Long Line.
  const holder = eldestOf(ctx, String(grudge.house));
  const head = ours(ctx);
  addGrudge(
    ctx,
    holder ?? String(grudge.house),
    head ?? w.playerHouse,
    {
      severity: grudge.severity,
      // Nobody of that house is currently alive to hold it — a hand-built
      // bundle, or a house the seed cast does not staff. House-wide is then
      // the only policy that survives: `tickRelationships` lets an
      // institutional feud go dormant and waits, and deletes every other kind.
      inheritance: holder ? grudge.inheritance : 'house_wide',
    },
    def.id,
  );

  // FOUNDING-STATE TERMS. Heritable terms were already paid into bootstrap;
  // only state terms belong here. Dismissals run last so a loyalty term on
  // the same retainer affects the shared release/leak calculation.
  const dismissals: Extract<(typeof signingTerms)[number], { kind: 'dismiss' }>[] = [];
  for (const term of signingTerms) {
    switch (term.kind) {
      case 'treasury':
        w.treasury += term.amount;
        break;
      case 'respect': {
        const current = RESPECT_ORDER.indexOf(w.respect);
        const next = Math.max(0, Math.min(RESPECT_ORDER.length - 1, current + term.steps));
        if (next !== current) {
          w.respect = RESPECT_ORDER[next]!;
          w.respectChanged = w.year;
        }
        break;
      }
      case 'loyalty': {
        const retainer = signingRetainers.get(term.retainer)!;
        const contract = retainer.contract!;
        contract.loyalty = Math.max(0, Math.min(100, contract.loyalty + term.amount));
        break;
      }
      case 'dismiss':
        dismissals.push(term);
        break;
      case 'grudge': {
        const grudgeHolder = eldestOf(ctx, String(term.house));
        const ourHolder = ours(ctx);
        addGrudge(
          ctx,
          grudgeHolder ?? String(term.house),
          ourHolder ?? w.playerHouse,
          {
            severity: term.severity,
            inheritance: grudgeHolder ? term.inheritance : 'house_wide',
          },
          def.id,
        );
        break;
      }
      case 'bias':
      case 'tithe':
        break;
    }
  }
  for (const term of dismissals) {
    dismissRetainer(
      ctx,
      signingRetainers.get(term.retainer)!,
      makeRng(hashSeed(w.seed, 'signing-dismiss', term.retainer)),
    );
  }

  w.friends = roster;

  w.founding = {
    houseName,
    heirloom: String(heirloom.heirloom),
    grudge: String(grudge.house),
    answers: { ...signingAnswers },
    year: w.year,
  };

  const examinationReadback = selectedAnswers.map((answer) => {
    const plain = (line: string) => line.trim().replace(/[.!?]+$/, '');
    return `${plain(answer.given)}; ${plain(answer.owed)}.`;
  }).join(' ');

  // The chronicle, in the chronicle's own voice — plain, and from inside the
  // house. The frame's register stops at the prologue screen; this is the
  // family writing down what it did, and it is what the creditor reads in
  // the term, which is why both choices have to be legible in it.
  w.chronicle.push({
    year: w.year,
    weight: 'page',
    title: 'What Was Asked For',
    text: `${object.name} was asked for by name, and given. ${house.name} paid for part of `
      + 'that night and has not been paid back, and the house has known it the whole time.'
      + (examinationReadback ? ` ${examinationReadback}` : ''),
    named: true,
  });

  // THE FOUNDING IS AN EXTERNAL ANSWER (issue #391), not deterministic weather.
  // Log it here, at the one verb that applies it, after all validation has
  // succeeded. Replay calls this same verb so heirloom, grudge, friend windows,
  // founding state and the Chronicle page are rebuilt by their real owners.
  const hasSigning = choice.founderName !== undefined || Object.keys(signingAnswers).length > 0;
  if (hasSigning) {
    w.decisionLog.push({
      kind: 'signing',
      year: w.year,
      ...(choice.founderName !== undefined ? { founderName: choice.founderName } : {}),
      answers: { ...signingAnswers },
    });
  }
  w.decisionLog.push({
    kind: 'founding',
    year: w.year,
    houseName,
    heirloom: String(heirloom.heirloom),
    grudge: String(grudge.house),
    friends: roster.map(({ name, sex }) => ({ name, sex })),
  });

  return { ok: true };
}

/**
 * Who of that house takes it up. The eldest living member, so the founding
 * grudge is held by somebody who was there rather than by a child — and
 * chosen by birth year with the id as a tie-break, so it is the same person
 * on every run of a seed.
 */
function eldestOf(ctx: SimCtx, house: string): string | undefined {
  const them = ctx.world.people.living()
    .filter((p) => p.houseOfOrigin === house)
    .sort((a, b) => a.born - b.born || (a.id < b.id ? -1 : 1));
  return them[0]?.id;
}

/** Find a founding seed without adding a save-only key to Person. */
function seedPerson(ctx: SimCtx, key: string) {
  const sigilSeed = hashSeed(ctx.world.seed, key);
  return ctx.world.people.all().find((person) => person.sigilSeed === sigilSeed);
}

/** Whoever holds the seal, or anybody of the house if the seal is between hands. */
function ours(ctx: SimCtx): string | undefined {
  const w = ctx.world;
  const household = w.people.household(w.playerHouse, w.year);
  return (household.find((p) => p.castSlots.includes('head')) ?? household[0])?.id;
}
