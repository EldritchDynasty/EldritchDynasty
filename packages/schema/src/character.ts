import { z } from 'zod';
import { ConditionS } from './conditions.js';
import { FrequencyS } from './frequency.js';
import { RetainerContractS } from './person.js';
import { SexS } from './attributes.js';

/**
 * CHARACTER TEMPLATES — people who appear on their own.
 *
 * The seed cast in `characters/founding.yaml` is twelve authored individuals
 * who exist in 1042. Everyone else across the next five centuries — suitors,
 * grooms, rivals, tutors, midwives, wards — is minted from one of these.
 *
 * A template is not a person. It is a recipe: which house rolls the genome
 * (and therefore whether they carry anything), what age they arrive at, what
 * they are for, and how often the world produces one.
 *
 * Frequency is the SAME tier system events use, and it means the same thing:
 * a mythic character is rationed, not merely improbable. The world produces at
 * most a couple in a Long Line, and when it does, it is an event.
 */
export const CharacterRoleS = z.enum([
  'suitor',      // drafted in the marriage market
  'groom',       // marries into the house, matrilineally
  'rival',       // the named opposite number
  'retainer',    // hirelings and lifetime servants
  'the_match',   // the one that never comes
  'ward',
  'hostage',
  'wanderer',    // turns up, is not explained
  'practitioner', // a named professional found by an explicitly paid search
]);
export type CharacterRole = z.infer<typeof CharacterRoleS>;

/**
 * The one recurring-cast roster. maintainCast mints these roles again after
 * their slot becomes empty; content may only dismiss roles on this roster.
 * Keep the refill odds beside the role so validation never copies the list.
 */
export const RECURRING_CAST_ROLES = [
  { slot: 'rival', role: 'rival', chance: 0.5 },
  { slot: 'the_match', role: 'the_match', chance: 0.25 },
] as const satisfies readonly { slot: CharacterRole; role: CharacterRole; chance: number }[];

export const HouseWeightS = z.object({
  house: z.string(),
  weight: z.number().default(100),
});

export const CharacterTemplateS = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/),
  title: z.string(),
  role: CharacterRoleS,
  frequency: FrequencyS,
  weight: z.number().default(100),

  sex: z.union([SexS, z.literal('any')]).default('any'),
  ageAtArrival: z.object({ min: z.number(), max: z.number() }).default({ min: 18, max: 26 }),

  /**
   * Which gene pool rolls their genome. This is the single most consequential
   * field on the template: it decides whether this person carries anything,
   * and the player has no way to see it.
   */
  houses: z.array(HouseWeightS).min(1),

  /** Nudges the rolled genome toward an intent WITHOUT pinning it. */
  bias: z.record(z.string(), z.number()).default({}),
  traits: z.array(z.string()).default([]),
  /** Authored completed training, independent of rolled raw affinity. */
  spellsKnown: z.array(z.string()).optional(),
  castSlots: z.array(z.string()).default([]),
  contract: RetainerContractS.optional(),

  /** Surname style. `of_house` yields "Sable of Marrow". */
  naming: z.enum(['given', 'of_house']).default('given'),

  conditions: ConditionS.optional(),
  /** Never mint a second one while one is alive. */
  unique: z.boolean().default(false),

  blurb: z.string().optional(),
});
export type CharacterTemplate = z.infer<typeof CharacterTemplateS>;

export const CharacterTemplateFileS = z.object({
  characterTemplates: z.array(CharacterTemplateS),
});
