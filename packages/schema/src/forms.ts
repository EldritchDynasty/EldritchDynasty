import type { Sex } from './attributes.js';

/**
 * HOW PROSE REFERS TO A PERSON WITHOUT ASSUMING WHO THEY ARE (#1867, step 0).
 *
 * A slot token renders as a name — `{HEAD}` is "Aldous". Everything else in
 * the sentence used to be written by hand: "{HEAD} set down his cup". That is
 * correct exactly as long as the authored body knows the sex of whoever gets
 * cast, and the founder is the case where it cannot: the player chooses who
 * signed, and a guardian scene written in 1042 is read in 1542 by whoever that
 * turned out to be.
 *
 * So a token may name a FORM of the person as well as the person:
 *
 *   {HEAD.they} set down {HEAD.their} cup.     he / his · she / her · they / their
 *   {HEAD.They} {HEAD.is} late.                capitalised · verb agreement
 *   {HEAD.they} walk{HEAD.s} out.              "walks" — or "walk" for singular they
 *
 * The form names are the singular-they ones because those are the only set
 * that reads as a placeholder rather than as a guess. A counted slot holding
 * more than one person takes the plural forms.
 *
 * This file is the ONE token grammar. The engine renders with it, validation
 * checks it, the Original/Plain English parity check counts it, and the
 * editor highlights it — six hand-copied `/\{([A-Z_][A-Z0-9_]*)\}/` patterns
 * would each have read `{HEAD.they}` as plain text, silently.
 */

/** The grammatical class a person is referred to by. Not `Sex`, and never inferred from a name. */
export type Grammar = 'masculine' | 'feminine' | 'neutral';

export const PRONOUN_FORMS = ['they', 'them', 'their', 'theirs', 'themself'] as const;
export const VERB_FORMS = ['is', 'was', 'has', 's', 'es'] as const;
export const PERSON_FORMS = [...PRONOUN_FORMS, ...VERB_FORMS] as const;
export type PersonForm = (typeof PERSON_FORMS)[number];

/** A party of more than one is referred to as `plural`, whatever its members' grammar. */
export type FormNumber = Grammar | 'plural';

const FORMS: Record<FormNumber, Record<PersonForm, string>> = {
  masculine: { they: 'he', them: 'him', their: 'his', theirs: 'his', themself: 'himself', is: 'is', was: 'was', has: 'has', s: 's', es: 'es' },
  feminine: { they: 'she', them: 'her', their: 'her', theirs: 'hers', themself: 'herself', is: 'is', was: 'was', has: 'has', s: 's', es: 'es' },
  neutral: { they: 'they', them: 'them', their: 'their', theirs: 'theirs', themself: 'themself', is: 'are', was: 'were', has: 'have', s: '', es: '' },
  plural: { they: 'they', them: 'them', their: 'their', theirs: 'theirs', themself: 'themselves', is: 'are', was: 'were', has: 'have', s: '', es: '' },
};

/**
 * The grammar `Sex` implies when nothing else has been said about a person.
 * Every born character takes this; the founder is the one person whose
 * grammar the player states, and that seam is in core, not here.
 */
export function grammarOfSex(sex: Sex): Grammar {
  return sex === 'female' ? 'feminine' : 'masculine';
}

export function personForm(number: FormNumber, form: PersonForm): string {
  return FORMS[number][form];
}

/**
 * Parse the part after the dot. A pronoun form may be capitalised to start a
 * sentence (`They`, `Their`); a verb form may not, because "Is" and "S" begin
 * no sentence prose would write. Anything else is unknown, and `undefined`.
 */
export function parseForm(spec: string): { form: PersonForm; capital: boolean } | undefined {
  if ((PERSON_FORMS as readonly string[]).includes(spec)) return { form: spec as PersonForm, capital: false };
  const lowered = spec.charAt(0).toLowerCase() + spec.slice(1);
  if (lowered !== spec && (PRONOUN_FORMS as readonly string[]).includes(lowered)) {
    return { form: lowered as PersonForm, capital: true };
  }
  return undefined;
}

/** A form spec rendered for one grammatical number, or `undefined` when the spec is unknown. */
export function renderForm(number: FormNumber, spec: string): string | undefined {
  const parsed = parseForm(spec);
  if (!parsed) return undefined;
  const word = personForm(number, parsed.form);
  return parsed.capital ? word.charAt(0).toUpperCase() + word.slice(1) : word;
}

export interface SlotToken {
  /** The whole token as written: `{HEAD.their}`. */
  raw: string;
  slot: string;
  /** The text after the dot, as written. Absent for a plain name token. */
  form?: string;
  index: number;
}

/**
 * Slot tokens in authored prose, plain and form alike. A fresh pattern per
 * call, because a shared global RegExp carries `lastIndex` between callers.
 */
export function slotTokenPattern(): RegExp {
  return /\{([A-Z_][A-Z0-9_]*)(?:\.([A-Za-z]+))?\}/g;
}

export function slotTokens(text: string): SlotToken[] {
  return [...text.matchAll(slotTokenPattern())].map((m) => ({
    raw: m[0],
    slot: m[1]!,
    ...(m[2] !== undefined ? { form: m[2] } : {}),
    index: m.index!,
  }));
}

/**
 * Hand-written gendered pronouns. Used to find prose that assumes the sex of
 * someone whose grammar is the player's to state.
 */
export const GENDERED_PRONOUNS = ['he', 'him', 'his', 'himself', 'she', 'her', 'hers', 'herself'] as const;

export function genderedPronounsIn(text: string): string[] {
  const found = text.match(new RegExp(`\\b(${GENDERED_PRONOUNS.join('|')})\\b`, 'gi')) ?? [];
  return [...new Set(found.map((w) => w.toLowerCase()))];
}

/**
 * Rename a slot in prose, forms included: `{OLD}` and `{OLD.their}` both
 * follow the slot. A rename that only matched the bare token would orphan
 * every pronoun the author had written for it.
 */
export function renameSlotTokens(text: string, from: string, to: string): string {
  return text.replace(slotTokenPattern(), (m, slot: string, form: string | undefined) =>
    slot !== from ? m : form === undefined ? `{${to}}` : `{${to}.${form}}`);
}
