import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { HOUSE_NAME_MAX } from './prologue.js';
import { canonical } from './save.js';
import { hashSeed } from './rng.js';
import { CAMPAIGNS } from './campaign.js';
import { newGame, resumeGame, type GameSession } from './session.js';
import { FRIEND_NAME_MAX, MAX_FRIENDS } from './people/friends.js';
import {
  contentEdition, newGameFromShareCode, readShareCode, SHARE_CODE_MAX, type ShareCodeProblem,
} from './share-code.js';
import { PERSON_NAME_MAX } from '@ed/schema';

const content = loadContent();
const BUILD = 'abc1234';

/** A signing with every part answered: a blood mother, all four answers, three friends. */
const SIGNED = {
  houseName: 'The House of Salt',
  heirloom: 'portion_of_fertility',
  grudge: 'house_calder',
  answers: { the_ford: 'wardens_men', the_two_letters: 'light_in_her', the_hard_winter: 'the_midwife', the_moved_stone: 'let_it_lie' },
  founder: { name: 'Maud Gearithy', gender: 'woman' as const, configuration: 'blood_mother' as const },
  friends: [
    { name: 'Iona Vale', sex: 'female' as const },
    { name: 'Corven Pike', sex: 'male' as const },
    { name: 'Edda Rook', sex: 'female' as const },
  ],
};

function founded(choice: Parameters<GameSession['found']>[0] = SIGNED, seed = 199500, campaign: 'short' | 'long' = 'short'): GameSession {
  const s = newGame(content, { seed, startYear: CAMPAIGNS[campaign].startYear, campaign });
  const result = s.found(choice);
  expect(result, result.reason).toMatchObject({ ok: true });
  return s;
}

function codeOf(s: GameSession, opts: { names?: boolean; build?: string } = {}): string {
  const made = s.shareCode({ build: BUILD, ...opts });
  if (!made.ok) throw new Error(`no code: ${made.unavailable}`);
  return made.code;
}

/** Decode, change, re-seal: a code this build would have refused to write. */
function forge(code: string, change: (payload: unknown[]) => void): string {
  const body = code.split('.')[1]!;
  const json = JSON.parse(new TextDecoder().decode(Uint8Array.from(
    atob(body.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))));
  change(json);
  const bytes = new TextEncoder().encode(JSON.stringify(json));
  const next = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `ED1.${next}.${hashSeed('ED1', next).toString(36)}`;
}

function payloadOf(code: string): string {
  const body = code.split('.')[1]!;
  return new TextDecoder().decode(Uint8Array.from(atob(body.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)));
}

function problemOf(code: string, build = BUILD): ShareCodeProblem {
  const read = readShareCode(code, content, { build });
  if (read.ok) throw new Error('the code was read');
  return read.problem;
}

const saved = (s: GameSession) => canonical(s.save());

describe('a share code is the founding and nothing after it (#1995)', () => {
  it('begins the same canonical founding when the names travel with it', () => {
    const original = founded();
    const begun = newGameFromShareCode(codeOf(original, { names: true }), content, { build: BUILD });
    expect(begun.ok).toBe(true);
    if (!begun.ok) return;
    expect(begun.founding.missing).toEqual([]);
    expect(saved(begun.session)).toBe(saved(original));
    // And the two houses then live the same years, because nothing differs.
    original.advance(20);
    begun.session.advance(20);
    expect(saved(begun.session)).toBe(saved(original));
  });

  it('leaves every typed name out unless asked, and says which the recipient supplies', () => {
    const code = codeOf(founded());
    const payload = payloadOf(code);
    for (const typed of ['Salt', 'Maud', 'Iona', 'Corven', 'Edda']) expect(payload).not.toContain(typed);
    const read = readShareCode(code, content, { build: BUILD });
    expect(read.ok && read.founding.missing).toEqual(['founder', 'house', 'friends']);
    expect(read.ok && read.founding.friends).toEqual([{ sex: 'female' }, { sex: 'male' }, { sex: 'female' }]);
  });

  it('refuses to begin until the recipient names the house and every friend', () => {
    const code = codeOf(founded());
    expect(newGameFromShareCode(code, content, { build: BUILD })).toEqual({
      ok: false, problem: { kind: 'names_needed', missing: ['house', 'friends'] },
    });
    expect(newGameFromShareCode(code, content, { build: BUILD, names: { house: 'Salt', friends: ['A', '', 'C'] } }))
      .toEqual({ ok: false, problem: { kind: 'names_needed', missing: ['friends'] } });
  });

  it('is the same founding when the recipient gives the same names, and a disclosed different one otherwise', () => {
    const original = founded();
    const names = { founder: 'Maud Gearithy', house: 'The House of Salt', friends: ['Iona Vale', 'Corven Pike', 'Edda Rook'] };
    const same = newGameFromShareCode(codeOf(original), content, { build: BUILD, names });
    expect(same.ok && saved(same.session)).toBe(saved(original));

    const other = newGameFromShareCode(codeOf(original), content, {
      build: BUILD, names: { founder: 'Agnes', house: 'Thornfield', friends: ['Ann', 'Bran', 'Cass'] },
    });
    expect(other.ok).toBe(true);
    if (!other.ok) return;
    // The mechanics the code carries arrived intact; only the names differ.
    expect(other.session.prologue()?.founded).toMatchObject({ heirloom: SIGNED.heirloom, grudge: SIGNED.grudge, houseName: 'Thornfield' });
    expect(other.session.save().seed).toBe(original.save().seed);
    expect(saved(other.session)).not.toBe(saved(original));
  });

  it('carries an authored founder as no founder at all, so there is no founder name to ask for', () => {
    const original = founded({ houseName: 'Hearth', heirloom: 'portion_of_agelessness', grudge: 'house_marrow' });
    const code = codeOf(original);
    const read = readShareCode(code, content, { build: BUILD });
    expect(read.ok && read.founding.missing).toEqual(['house']);
    const begun = newGameFromShareCode(code, content, { build: BUILD, names: { house: 'Hearth' } });
    expect(begun.ok && saved(begun.session)).toBe(saved(original));
  });

  it('says the same thing at year one and year forty: no later decision is in it', () => {
    const s = founded(SIGNED, 199501, 'long');
    const atSigning = codeOf(s, { names: true });
    s.advance(40);
    s.letHimDecide();
    s.advance(10);
    expect(codeOf(s, { names: true })).toBe(atSigning);
    // And through a save, too.
    const reopened = codeOf(resumeGame(s.save(), content), { names: true });
    expect(reopened).toBe(atSigning);
  });

  it('is not a reading-mode fact: Plain English writes the same code', () => {
    const plain = newGame(content, { seed: 199500, startYear: CAMPAIGNS.short.startYear, campaign: 'short', proseMode: 'plainenglish' });
    expect(plain.found(SIGNED).ok).toBe(true);
    expect(codeOf(plain, { names: true })).toBe(codeOf(founded(), { names: true }));
  });

  it('fits the largest founding the signing can write inside its stated limit', () => {
    // Three UTF-8 bytes a character: the widest script a typed name is likely to use.
    const longest = (n: number, ch: string) => ch.repeat(n);
    const s = founded({
      ...SIGNED,
      houseName: longest(HOUSE_NAME_MAX, '家'),
      founder: { ...SIGNED.founder, name: longest(PERSON_NAME_MAX, '創') },
      friends: Array.from({ length: MAX_FRIENDS }, (_, i) => ({ name: longest(FRIEND_NAME_MAX - 1, '友') + '一二三四五'[i], sex: 'male' as const })),
    }, 0xffffffff);
    const code = codeOf(s, { names: true, build: 'f'.repeat(40) });
    expect(code.length).toBeLessThanOrEqual(SHARE_CODE_MAX);
    const read = readShareCode(code, content, { build: 'f'.repeat(40) });
    expect(read.ok && read.founding.houseName).toBe(longest(HOUSE_NAME_MAX, '家'));
    // And the everyday code, with no names, fits on a plate.
    expect(codeOf(s).length).toBeLessThan(160);
  });

  it('reads a code that arrived wrapped across lines', () => {
    const code = codeOf(founded(), { names: true });
    const wrapped = code.replace(/(.{40})/g, '$1\n  ');
    expect(readShareCode(wrapped, content, { build: BUILD }).ok).toBe(true);
  });
});

describe('a code it cannot honour is refused, with the reason, before any run changes', () => {
  const code = codeOf(founded(), { names: true });

  it('refuses what is not a code', () => {
    expect(problemOf('   ')).toEqual({ kind: 'empty' });
    expect(problemOf('hello there')).toEqual({ kind: 'not_a_code' });
    expect(problemOf(`ED${'x'.repeat(SHARE_CODE_MAX)}`)).toEqual({ kind: 'too_long', max: SHARE_CODE_MAX });
    expect(problemOf(code.replace(/^ED1/, 'ED2'))).toEqual({ kind: 'unsupported_version', version: '2' });
  });

  it('refuses a truncated or mistyped code as damaged, never as a different founding', () => {
    expect(problemOf(code.slice(0, -12))).toEqual({ kind: 'damaged' });
    const body = code.split('.')[1]!;
    const flipped = body.slice(0, 10) + (body[10] === 'A' ? 'B' : 'A') + body.slice(11);
    expect(problemOf(code.replace(body, flipped))).toEqual({ kind: 'damaged' });
    expect(problemOf(forge(code, (p) => { p[4] = -1; }))).toEqual({ kind: 'damaged' });
    expect(problemOf(forge(code, (p) => { p.push(1); }))).toEqual({ kind: 'damaged' });
  });

  it('refuses a non-canonical base64url alias, even with a matching check', () => {
    // A final base64 character contains unused padding bits when the byte
    // length is not divisible by three. Changing just one of those bits used
    // to produce a second valid-looking code for the same founding.
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    let original = '';
    for (const length of [1, 2, 3]) {
      const candidate = forge(code, (p) => { p[9] = 'A'.repeat(length); });
      if (candidate.split('.')[1]!.length % 4 !== 0) {
        original = candidate;
        break;
      }
    }
    expect(original).not.toBe('');
    const body = original.split('.')[1]!;
    const last = body[body.length - 1]!;
    const changed = alphabet[alphabet.indexOf(last) ^ 1]!;
    const alias = body.slice(0, -1) + changed;
    // The changed code decodes to the same bytes; a reissued checksum alone
    // must not make it a code our encoder would have produced.
    expect(problemOf(`ED1.${alias}.${hashSeed('ED1', alias).toString(36)}`))
      .toEqual({ kind: 'damaged' });
    expect(readShareCode(original, content, { build: BUILD }).ok).toBe(true);
  });

  it('refuses a well-formed code whose places are not in this prologue', () => {
    expect(problemOf(forge(code, (p) => { p[7] = 99; }))).toEqual({ kind: 'damaged' });
    expect(problemOf(forge(code, (p) => { p[6] = [0, 0]; }))).toEqual({ kind: 'damaged' });
    expect(problemOf(forge(code, (p) => { p[6] = [-1, -1, -1, -1]; }))).toEqual({ kind: 'damaged' });
    // Names travel together: a house name without the friends' names is no export this build writes.
    expect(problemOf(forge(code, (p) => { p[11] = 0; }))).toEqual({ kind: 'damaged' });
  });

  it('refuses a code from another edition, and says which part differs', () => {
    expect(problemOf(code, 'other-build')).toEqual({ kind: 'other_edition', differs: ['build'] });
    expect(problemOf(forge(code, (p) => { p[0] = 1; })))
      .toEqual({ kind: 'other_edition', differs: ['format'] });
    const edited = { ...content.bundle, events: content.bundle.events.slice(1) };
    expect(contentEdition(edited)).not.toBe(contentEdition(content));
    expect(readShareCode(code, edited, { build: BUILD })).toEqual({ ok: false, problem: { kind: 'other_edition', differs: ['content'] } });
  });

  it('keeps prose catalogues out of the edition', () => {
    expect(content.bundle.proseVariants.length).toBeGreaterThan(0);
    expect(contentEdition({ ...content.bundle, proseVariants: [] })).toBe(contentEdition(content));
  });

  it('neither writes nor reads a Demonstration code', () => {
    const demo = newGame(content, { seed: 7, startYear: CAMPAIGNS.demo.startYear, campaign: 'demo' });
    expect(demo.shareCode()).toEqual({ ok: false, unavailable: 'demonstration' });
    expect(problemOf(forge(code, (p) => { p[3] = 'd'; }))).toEqual({ kind: 'demonstration' });
  });

  it('hands the signing\'s own refusal back, and no run', () => {
    const anonymous = codeOf(founded());
    const begun = newGameFromShareCode(anonymous, content, {
      build: BUILD, names: { house: 'Salt', friends: ['Iona Vale', 'Iona Vale', 'Edda Rook'] },
    });
    expect(begun.ok).toBe(false);
    expect(!begun.ok && begun.problem.kind).toBe('refused');
    expect(!begun.ok && 'session' in begun).toBe(false);
  });

  it('has nothing to say before the house is founded', () => {
    const s = newGame(content, { seed: 1, startYear: CAMPAIGNS.short.startYear, campaign: 'short' });
    expect(s.shareCode()).toEqual({ ok: false, unavailable: 'not_founded' });
  });
});
