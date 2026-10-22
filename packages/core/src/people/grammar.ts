import { grammarOfGender, grammarOfSex, personForm, type Grammar, type Person, type PersonForm } from '@ed/schema';

/**
 * The grammar prose uses for a person — the ONE place core decides it.
 *
 * The founder's is what the player said at the signing (#1867); everybody
 * else's is what `sex` implies. That answer lands here and nowhere else, which
 * is why `renderBody`'s `{SLOT.form}` tokens and every hand-assembled
 * chronicle line ask this rather than `p.sex`.
 */
export function grammarOf(p: Person): Grammar {
  return p.gender !== undefined ? grammarOfGender(p.gender) : grammarOfSex(p.sex);
}

/** One form of one person: `formOf(ward, 'they')` is "he", "she" or "they". */
export function formOf(p: Person, form: PersonForm): string {
  return personForm(grammarOf(p), form);
}
