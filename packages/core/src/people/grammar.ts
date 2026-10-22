import { grammarOfSex, personForm, type Grammar, type Person, type PersonForm } from '@ed/schema';

/**
 * The grammar prose uses for a person — the ONE place core decides it.
 *
 * Today it is what `sex` implies, for everybody. #1867 makes the founder the
 * player and lets the player say how they are referred to; that answer lands
 * here and nowhere else, which is why `renderBody`'s `{SLOT.form}` tokens and
 * every hand-assembled chronicle line ask this rather than `p.sex`.
 */
export function grammarOf(p: Person): Grammar {
  return grammarOfSex(p.sex);
}

/** One form of one person: `formOf(ward, 'they')` is "he", "she" or "they". */
export function formOf(p: Person, form: PersonForm): string {
  return personForm(grammarOf(p), form);
}
