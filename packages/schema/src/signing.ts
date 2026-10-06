import { z } from 'zod';
import { AttributeIdS, HouseIdS } from './ids.js';
import { GrudgeInheritanceS } from './house.js';

/** A stable authored id for an Examination question or answer. */
export const SigningIdS = z.string().regex(/^[a-z0-9_]+$/);

/**
 * An authored founding-cast key such as `founder` or `founders_wife`.
 *
 * Cross-reference validation belongs to `signing/refs`: the schema can say
 * that a non-empty key was supplied, while the content rule can prove that the
 * key exists in the same bundle.
 */
export const SigningWhoS = z.string().min(1);

/**
 * One paid-for term from the Examination (#343).
 *
 * The union is intentionally closed. It contains no Eldritch Power, Madness or
 * font operation: those systems are not schedulable rewards (concept §27).
 * Which AttributeIds may be biased is a bundle-level rule because AttributeIdS
 * itself cannot know an attribute's authored kind.
 */
export const SigningTermS = z.discriminatedUnion('kind', [
  // Heritable founding inputs. Core applies these before the seed genome rolls.
  z.object({
    kind: z.literal('bias'),
    who: z.array(SigningWhoS).min(1),
    attr: AttributeIdS,
    amount: z.number().min(-0.5).max(0.5),
  }),
  z.object({
    kind: z.literal('tithe'),
    who: z.array(SigningWhoS).min(1),
    amount: z.number().gt(0).max(0.2),
  }),

  // Founding-state terms. Core applies these atomically during foundHouse.
  z.object({ kind: z.literal('treasury'), amount: z.number().int() }),
  z.object({
    kind: z.literal('respect'),
    steps: z.union([z.literal(-1), z.literal(1)]),
  }),
  z.object({
    kind: z.literal('loyalty'),
    retainer: z.string().min(1),
    amount: z.number().int(),
  }),
  z.object({ kind: z.literal('dismiss'), retainer: z.string().min(1) }),
  z.object({
    kind: z.literal('grudge'),
    house: HouseIdS,
    severity: z.number().min(1).max(100),
    inheritance: GrudgeInheritanceS,
  }),
]);
export type SigningTerm = z.infer<typeof SigningTermS>;

/**
 * One deliberately coarse exchange table for the Examination (#343).
 *
 * This is only the authoring sanity floor. The paired-seed signing gate owns
 * the real "no right answers" claim. The rates are calibrated so the four
 * draft questions in #343 price to within one point without pretending that
 * a late secret, a grudge, and forty crowns are truly interchangeable.
 */
export const SIGNING_RATES = {
  bias: {
    core: 20,
    affinity: 10,
  },
  tithe: 60,
  treasury: 1 / 20,
  respect: 4,
  loyalty: 1 / 15,
  dismiss: 2,
  grudge: 1 / 10,
} as const;


export const SigningAnswerS = z.object({
  id: SigningIdS,
  /** What the founder says; deliberately plain enough to choose between. */
  says: z.string().min(1),
  /** The benefit line shown/read back after the choice. */
  given: z.string().min(1),
  /** The cost line shown/read back after the choice. */
  owed: z.string().min(1),
  terms: z.object({
    given: z.array(SigningTermS).min(1),
    owed: z.array(SigningTermS).min(1),
  }),
});
export type SigningAnswer = z.infer<typeof SigningAnswerS>;

export const SigningQuestionS = z.object({
  id: SigningIdS,
  /** Frame-register situation. Answer lines remain plain. */
  situation: z.string().min(1),
  answers: z.array(SigningAnswerS).length(3),
}).superRefine((question, ctx) => {
  const seen = new Set<string>();
  question.answers.forEach((answer, index) => {
    if (seen.has(answer.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['answers', index, 'id'],
        message: 'answer ids must be unique within a signing question',
      });
    }
    seen.add(answer.id);
  });
});
export type SigningQuestion = z.infer<typeof SigningQuestionS>;
