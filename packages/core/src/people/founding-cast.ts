import { founderSexOf, type FoundingConfiguration, type SeedPerson, type Sex } from '@ed/schema';
import { hashSeed, makeRng } from '../rng.js';
import { uniqueName } from './names.js';

/**
 * WHICH BODY CARRIED THE BLOOD IN (#1867). The authored founding cast is one
 * configuration of the founding couple; the player's answer may ask for the
 * other. This is the one place the cast is turned around, before a single
 * genome is rolled, so every system after bootstrap meets an ordinary family
 * and nothing downstream has to know a choice was made.
 *
 * Turning it around is exactly three facts and no more:
 *
 *   the founder's body       `founderSexOf(configuration)`
 *   the co-parent's body     the other one, and so a name of that sex
 *   the founding children    mother and father swap places
 *
 * Everything else — keys, houses, memberships, traits, bias, birth years — is
 * the authored cast, untouched. Keys are what the Examination's terms and the
 * conception ordinals are keyed on, so they must not move. Bias included, by
 * decision: a blood mother at the authored 0.2 is the stronger, earlier
 * start, and that is the house the player chose (docs/BALANCE-LOG.md).
 *
 * A cast already in the asked-for configuration comes back as the SAME array:
 * the authored founder is not re-derived, and draws nothing.
 */
export function configureFoundingCast(
  seeds: readonly SeedPerson[],
  configuration: FoundingConfiguration,
  runSeed: number,
): readonly SeedPerson[] {
  const founder = seeds.find((s) => s.becomesGuardian);
  const sex = founderSexOf(configuration);
  if (!founder || founder.sex === sex) return seeds;

  const theirs = (s: SeedPerson) => s.motherKey === founder.key || s.fatherKey === founder.key;
  const coParents = new Set(seeds.filter(theirs)
    .map((s) => (s.motherKey === founder.key ? s.fatherKey : s.motherKey))
    .filter((k): k is string => k !== undefined));
  if (coParents.size > 1) {
    throw new Error(`founding configuration ${configuration} cannot turn around a founder with ${coParents.size} co-parents`);
  }
  const [spouseKey] = coParents;
  const stranded = seeds.find((s) => !theirs(s) && spouseKey !== undefined
    && (s.motherKey === spouseKey || s.fatherKey === spouseKey));
  if (stranded) {
    throw new Error(`founding configuration ${configuration} would turn around ${spouseKey}, who also parents ${stranded.key}`);
  }

  const other: Sex = sex === 'male' ? 'female' : 'male';
  // The authored spouse's name belongs to the other body. A fresh one, from
  // the run's own named stream, never colliding with an authored name — and
  // drawn only here, so the authored configuration's stream is untouched.
  const taken = new Set(seeds.map((s) => s.name));
  return seeds.map((s) => {
    if (s === founder) return { ...s, sex };
    if (s.key === spouseKey) {
      const name = uniqueName(other, taken, makeRng(hashSeed(runSeed, 'founding-spouse', s.key)));
      return { ...s, sex: other, name };
    }
    if (!theirs(s)) return s;
    const { motherKey, fatherKey, ...rest } = s;
    return {
      ...rest,
      ...(fatherKey !== undefined ? { motherKey: fatherKey } : {}),
      ...(motherKey !== undefined ? { fatherKey: motherKey } : {}),
    };
  });
}
