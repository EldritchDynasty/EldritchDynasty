import { z } from 'zod';
import type { Sex } from './attributes.js';
import type { Grammar } from './forms.js';
import { assertNever } from './exhaustive.js';

/**
 * THE FOUNDER IS THE PLAYER (#1867). Who signed in 1042 is an answer the
 * player gives, in three parts that are deliberately independent:
 *
 *   name           what the founder is called. Blank keeps the authored one.
 *   gender         how prose refers to them. Names and grammatical forms only.
 *   configuration  which body carried the blood into the house.
 *
 * The third is not the second. `Sex` in this game is a genetic fact with two
 * values, the font is X-linked, and who carries it decides the first
 * generations of every run — so the founding body is chosen explicitly, never
 * coerced from a pronoun and never inferred from a name:
 *
 *   blood_father  today's cast: the founder fathers the house's children and
 *                 passes his X to every daughter. A married-in wife bears them.
 *   blood_mother  the founder carries the font and bears the children; a
 *                 married-in husband fathers them. Her sons draw on her X.
 *
 * A man or a woman pre-selects the matching configuration; a nonbinary
 * founder chooses one; anyone may change it.
 */
export const GenderS = z.enum(['man', 'woman', 'nonbinary']);
export type Gender = z.infer<typeof GenderS>;

export const FoundingConfigurationS = z.enum(['blood_father', 'blood_mother']);
export type FoundingConfiguration = z.infer<typeof FoundingConfigurationS>;

/** The founder as the signing recorded it: every part resolved. */
export const FounderIdentityS = z.object({
  /** As typed. Blank or absent keeps the authored name. */
  name: z.string().optional(),
  gender: GenderS,
  configuration: FoundingConfigurationS,
});
export type FounderIdentity = z.infer<typeof FounderIdentityS>;

/** What a player may answer: any part may be left to its default. */
export interface FounderAnswer {
  name?: string;
  gender?: Gender;
  configuration?: FoundingConfiguration;
}

/** Old saves, headless runs and bundles without the question: the authored founder. */
export const AUTHORED_FOUNDER: Omit<FounderIdentity, 'name'> = { gender: 'man', configuration: 'blood_father' };

/** The configuration a gender pre-selects. A nonbinary founder has none until they choose. */
export function configurationFor(gender: Gender): FoundingConfiguration | undefined {
  switch (gender) {
    case 'man': return 'blood_father';
    case 'woman': return 'blood_mother';
    case 'nonbinary': return undefined;
    default: return assertNever(gender, 'gender');
  }
}

export class FounderIdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FounderIdentityError';
  }
}

/**
 * Fill an answer in. Throws for the one answer that cannot be completed: a
 * nonbinary founder who has not chosen which body carried the blood, because
 * guessing it would be exactly the silent coercion this file exists to refuse.
 */
export function resolveFounder(answer: FounderAnswer | undefined): FounderIdentity {
  const gender = answer?.gender ?? AUTHORED_FOUNDER.gender;
  const configuration = answer?.configuration ?? configurationFor(gender);
  if (!configuration) {
    throw new FounderIdentityError('a nonbinary founder chooses whether they are the blood father or the blood mother');
  }
  return {
    ...(answer?.name !== undefined ? { name: answer.name } : {}),
    gender: GenderS.parse(gender),
    configuration: FoundingConfigurationS.parse(configuration),
  };
}

/** The founding body each configuration names. */
export function founderSexOf(configuration: FoundingConfiguration): Sex {
  return configuration === 'blood_mother' ? 'female' : 'male';
}

export function grammarOfGender(gender: Gender): Grammar {
  switch (gender) {
    case 'man': return 'masculine';
    case 'woman': return 'feminine';
    case 'nonbinary': return 'neutral';
    default: return assertNever(gender, 'gender');
  }
}
