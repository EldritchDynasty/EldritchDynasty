import { z } from 'zod';
import { HeirloomIdS, HouseIdS } from './ids.js';
import { GrudgeInheritanceS } from './house.js';
import { SigningQuestionS } from './signing.js';

/**
 * THE PROLOGUE — A DEBT OF THREE PARTS (concept §3, issue #38).
 *
 * Twelve to eighteen frame interludes a run refer back to a signing the player
 * never saw. The frame is the promise every generation is played against, and
 * until this file it was a promise about an event that happened off-screen to
 * nobody.
 *
 * It is authored rather than written in the client for the reason everything
 * else here is: the epilogue has to be able to replay it. §23's ring is the
 * prologue's own triad restated with EXACTLY ONE element changed, which is
 * only possible if the triad is data both ends can read.
 *
 * ─── Register ───────────────────────────────────────────────────────────────
 *
 * Dunsanian — `.claude/skills/lovecraftian-prose`, never `rothfuss-prose`.
 * This is the single most likely place in the game for register bleed, because
 * it is the one screen where the mythic layer and the tutorial impulse meet.
 * `prose.ts` holds the frame register to its contract.
 *
 * ─── The founder's name ─────────────────────────────────────────────────────
 *
 * The frame can still call him "the man" or "your ancestor", but his actual
 * person name is no longer withheld: #343 lets the player supply it during the
 * Examination. Unsigned/headless runs keep the authored default, Daveed
 * Gearithy. The house name remains a separate field with a separate contract.
 */

/**
 * A passage whose legal numbers come from the selected campaign.
 *
 * The prose stays authored here; the clock does not. `core/campaign.ts` owns
 * the term, so a Short Line cannot inherit a Long Line's collection date just
 * because both products use the same signing.
 */
export const PrologueCampaignTextS = z.object({
  campaignText: z.string()
    .refine((text) => text.includes('{years}'), 'campaign text must name {years}')
    .refine((text) => text.includes('{endYear}'), 'campaign text must name {endYear}')
    .refine(
      (text) => [...text.matchAll(/\{([^}]+)\}/g)]
        .every((match) => match[1] === 'years' || match[1] === 'endYear'),
      'campaign text may only use {years} and {endYear}',
    ),
});
export const PrologueOwedS = z.union([z.string(), PrologueCampaignTextS]);
export type PrologueOwed = z.infer<typeof PrologueOwedS>;

/** One part of the announced triad: a thing given, and what is owed for it. */
export const PrologueBeatS = z.object({
  /** What the man was given. */
  given: z.string(),
  /** What the house owes for it. The third is the one that hurts. */
  owed: PrologueOwedS,
});
export type PrologueBeat = z.infer<typeof PrologueBeatS>;

/**
 * The founding heirloom: the one thing the man asked for by name.
 *
 * A real object in the house's hands across a Long Line — `grantHeirloom`
 * puts it in `world.heirlooms`, where the ladder's Regalia gate, the auction
 * and every `heirloom` condition can see it.
 */
export const PrologueHeirloomS = z.object({
  heirloom: HeirloomIdS,
  /** What asking for this one says about the man, in his own century's words. */
  line: z.string(),
});

/**
 * The first grudge: who the house stepped on to be where it is.
 *
 * A `Relationship` edge, held by a named house against yours, which
 * `grudgeAgainstUs` reads across a Long Line. `inheritance` decides whether
 * it dies with the man who took it or outlives everyone who remembers why.
 */
export const PrologueGrudgeS = z.object({
  house: HouseIdS,
  line: z.string(),
  severity: z.number().min(1).max(100).default(45),
  /**
   * The `Grudge` vocabulary, unchanged — a second spelling of a closed union
   * is a copy that rots.
   *
   * `house_wide` by default, and it is not a stylistic default. Rival-house
   * people are transient mints, so a feud of any narrower policy is deleted by
   * `tickRelationships` the first year its holder dies without a living heir
   * or sibling in the world — measured, that is how every feud in this game
   * used to end, and the founding one lasted four generations instead of
   * forty. A house-wide grudge goes DORMANT instead and waits for the house to
   * have somebody in the room again, which is what an institutional grievance
   * actually does.
   */
  inheritance: GrudgeInheritanceS.default('house_wide'),
});

export const PrologueDefS = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/),
  /**
   * The room, and the other party in it — described by what it displaces and
   * never by what it is. It appears on screen for the first of exactly two
   * times in a Long Line (§3, §18).
   */
  opening: z.string(),
  /** Three things given, three things owed, ascending in weight. */
  triad: z.array(PrologueBeatS).length(3, 'three things given, three things owed'),
  /**
   * The founder-name prompt is authored with the Examination. It stays
   * optional until that later content-lane slice lands, so this schema/rules
   * slice does not force placeholder frame prose into shipped content.
   */
  namePrompt: z.string().min(1).optional(),
  /**
   * The four paid-for questions. Defaulting empty is the migration seam:
   * current authored prologue remains valid until #343's content slice lands.
   */
  examination: z.array(SigningQuestionS).max(4).default([]),
  /** What the player is asked, above the box where the house gets its name. */
  housePrompt: z.string(),
  /**
   * THE LAST QUESTION, and the only one that is not about the house.
   *
   * The player is asked for five people they could not have done without, and
   * those names then come back through five centuries, once each, worn by
   * strangers (`core/src/people/friends.ts`). It is authored here for the same
   * reason everything else on this screen is: it is the game's most exposed
   * seam between the mythic register and the fourth wall, and prose that
   * decides which side of it to stand on does not belong in a Vue file.
   */
  friendsPrompt: z.string(),
  /** The first choice. */
  heirlooms: z.array(PrologueHeirloomS).min(2, 'a choice needs at least two things to choose between'),
  /** The second choice. */
  grudges: z.array(PrologueGrudgeS).min(2, 'a choice needs at least two things to choose between'),
  /**
   * The last line, and the only plain one. It states the emotional thesis of
   * the run, and every ending reaches back to it (§23).
   */
  thesis: z.string(),
  /**
   * The wrapper around an inherited Library account, when the run has one
   * (#342). `{house}` is the older house the account is about and `{teller}`
   * the voice now carrying it. It introduces who is speaking and must never
   * say whether the account is true. Authored here rather than in `core` for
   * the same reason as `friendsPrompt`: it is frame prose. Without it the
   * prologue shows no inherited account, rather than one in no one's voice.
   */
  inheritedLine: z.string().optional(),
});
export type PrologueDef = z.infer<typeof PrologueDefS>;

export const PrologueFileS = z.object({ prologue: z.array(PrologueDefS) });
