import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { HOUSE_NAME_MAX } from './prologue.js';
import { canonical } from './save.js';
import { hashSeed } from './rng.js';
import { CAMPAIGNS } from './campaign.js';
import { newGame, resumeGame, type GameSession } from './session.js';
import { libraryRunOf } from './run-library.js';
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

  it('refuses corrupt in-memory decision-log rows without crashing share exports (#1995)', () => {
    const session = founded();
    const original = codeOf(session, { names: true });
    // Native/recovered state can be modified at runtime after schema checking.
    // An invalid row used to throw at row.kind while drawing a share image.
    for (const corrupt of [null, undefined, 5, 'invalid']) {
      session.ctx.world.decisionLog.push(corrupt as never);
      for (const names of [false, true]) {
        expect(session.shareCode({ build: BUILD, names }))
          .toEqual({ ok: false, unavailable: 'unrepresentable' });
      }
      session.ctx.world.decisionLog.pop();
    }
    expect(codeOf(session, { names: true })).toBe(original);
  });

  it('preserves Unicode founding names exactly and redacts them from anonymous codes', () => {
    // Founding text is player-entered, not a mechanical id. A share code
    // must retain its exact UTF-8 spelling when names are explicitly included,
    // but cannot leak any of those names in the default anonymous version.
    const choices = {
      ...SIGNED,
      houseName: 'The House of 雲🌙',
      founder: { ...SIGNED.founder, name: 'Maud e\u0301 🌿' },
      friends: [
        { ...SIGNED.friends[0]!, name: 'Iona 👩‍🔬' },
        { ...SIGNED.friends[1]!, name: 'Corven 龍' },
        { ...SIGNED.friends[2]!, name: 'Edda à' },
      ],
    };
    const original = founded(choices);
    const named = codeOf(original, { names: true });
    const decoded = readShareCode(named, content, { build: BUILD });
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.founding.houseName).toBe(choices.houseName);
    expect(decoded.founding.founder?.name).toBe(choices.founder.name);
    expect(decoded.founding.friends.map((friend) => friend.name)).toEqual(choices.friends.map((friend) => friend.name));

    const restored = newGameFromShareCode(named, content, { build: BUILD });
    expect(restored.ok && saved(restored.session)).toBe(saved(original));

    const anonymous = codeOf(original);
    const raw = payloadOf(anonymous);
    for (const name of [choices.houseName, choices.founder.name, ...choices.friends.map((friend) => friend.name)]) {
      expect(raw).not.toContain(name);
    }
    const readAnonymous = readShareCode(anonymous, content, { build: BUILD });
    expect(readAnonymous.ok && readAnonymous.founding.missing).toEqual(['founder', 'house', 'friends']);
  });

  it('refuses names whose UTF-16 cannot survive the UTF-8 share-code transport (#1995)', () => {
    // A native bridge or recovered signing can pass a lone surrogate through
    // JavaScript string validation. TextEncoder replaces it with U+FFFD; a
    // named share code would then import a different signing and save.
    const invalid = { ok: false, unavailable: 'unrepresentable' };
    for (const lone of ['\uD800', '\uDC00', 'A\uD800', 'B\uDC00']) {
      const cases = [
        { ...SIGNED, houseName: `The House of ${lone}` },
        { ...SIGNED, founder: { ...SIGNED.founder, name: `Maud ${lone} Gearithy` } },
        { ...SIGNED, friends: SIGNED.friends.map((friend, i) =>
          i === 1 ? { ...friend, name: `Corven ${lone} Pike` } : friend) },
      ];
      for (const choice of cases) {
        const original = founded(choice);
        const before = saved(original);
        for (const names of [false, true]) {
          expect(original.shareCode({ build: BUILD, names })).toEqual(invalid);
          expect(saved(original)).toBe(before);
        }
      }
    }

    // Paired surrogates are valid Unicode scalar values and must still
    // reproduce the same founding, not get rejected as the lone case does.
    const emoji = founded({ ...SIGNED, houseName: 'The House of 🌙' });
    const named = codeOf(emoji, { names: true });
    const imported = newGameFromShareCode(named, content, { build: BUILD });
    expect(imported.ok && saved(imported.session)).toBe(saved(emoji));
  });

  it('refuses malformed UTF-16 recipient names before constructing a game', () => {
    const anonymous = codeOf(founded());
    const names = {
      founder: SIGNED.founder.name,
      house: SIGNED.houseName,
      friends: SIGNED.friends.map((friend) => friend.name),
    };
    for (const lone of ['\uD800', '\uDC00']) {
      const cases = [
        { ...names, founder: `Maud ${lone}` },
        { ...names, house: `House ${lone}` },
        { ...names, friends: ['Iona Vale', `Corven ${lone}`, 'Edda Rook'] },
      ];
      for (const supplied of cases) {
        expect(newGameFromShareCode(anonymous, content, { build: BUILD, names: supplied }))
          .toEqual({ ok: false, problem: { kind: 'invalid_names' } });
      }
    }
  });

  it('replays an explicitly blank founder-name answer in a named share code', () => {
    // Founding permits a blank answer: the authored name is shown, but the
    // signing log still records exactly what the player submitted.
    for (const name of ['', '   ']) {
      const original = founded({ ...SIGNED, founder: { ...SIGNED.founder, name } });
      const code = codeOf(original, { names: true });
      const read = readShareCode(code, content, { build: BUILD });
      expect(read.ok && read.founding.founder?.name).toBe(name);
      const imported = newGameFromShareCode(code, content, { build: BUILD });
      expect(imported.ok && saved(imported.session)).toBe(saved(original));
    }
  });

  it('preserves a recorded blank founder answer in an anonymous code without leaking names (#1995)', () => {
    // The signed answer is part of the canonical replay even though it does
    // not change the displayed, authored founder. Missing it is a different
    // signing from one that submitted a blank name.
    for (const name of ['', '   ']) {
      const original = founded({ ...SIGNED, founder: { ...SIGNED.founder, name } });
      const anonymous = codeOf(original);
      const payload = JSON.parse(payloadOf(anonymous)) as unknown[];
      expect(payload[5]).toEqual(['w', 'm', name]);
      expect(payloadOf(anonymous)).not.toContain('Maud Gearithy');
      expect(payloadOf(anonymous)).not.toContain('Iona Vale');
      const read = readShareCode(anonymous, content, { build: BUILD });
      expect(read.ok && read.founding.founder?.name).toBe(name);
      expect(read.ok && read.founding.missing).toEqual(['house', 'friends']);

      const recipient = {
        house: SIGNED.houseName,
        friends: SIGNED.friends.map((friend) => friend.name),
        // Left over from a different code: the recorded blank answer wins.
        founder: 'Stale Previous Founder',
      };
      const imported = newGameFromShareCode(anonymous, content, { build: BUILD, names: recipient });
      expect(imported.ok).toBe(true);
      if (!imported.ok) continue;
      expect(saved(imported.session)).toBe(saved(original));
      expect(codeOf(imported.session)).toBe(anonymous);
      expect(codeOf(imported.session, { names: true })).toBe(codeOf(original, { names: true }));
    }

    // The marker is exclusively for empty/whitespace answers. Re-sealing an
    // anonymous code with an actual founder name must still be refused.
    const anonymous = codeOf(founded());
    const smuggled = forge(anonymous, (payload) => { payload[5] = ['w', 'm', 'Hidden Person']; });
    expect(problemOf(smuggled)).toEqual({ kind: 'damaged' });
  });

  it('does not invent a blank founder-name answer when a recipient leaves it empty', () => {
    const original = founded({
      ...SIGNED,
      founder: { gender: 'woman', configuration: 'blood_mother' },
    });
    for (const founder of ['   ', ' '.repeat(PERSON_NAME_MAX + 5)]) {
      // An all-blank optional answer is not persisted, regardless of its
      // length. Only nonblank raw answers must fit the wire format.
      const imported = newGameFromShareCode(codeOf(original), content, {
        build: BUILD,
        names: {
          house: SIGNED.houseName,
          founder,
          friends: SIGNED.friends.map((friend) => friend.name),
        },
      });
      expect(imported.ok && saved(imported.session)).toBe(saved(original));
    }
  });

  it.each(['original', 'plainenglish'] as const)('preserves the same nonblank founder answer with excluded names (%s)', (proseMode) => {
    // The signing displays a trimmed name but records the original answer.
    // Re-entering that same answer must reproduce the whole founding, including
    // the signing log, rather than silently trimming its recorded spelling.
    const name = '\tMaud e\u0301 Gearithy\u2003 ';
    const original = newGame(content, {
      seed: 199500, campaign: 'short', proseMode,
    });
    expect(original.found({ ...SIGNED, founder: { ...SIGNED.founder, name } }).ok).toBe(true);
    const anonymous = codeOf(original);
    const imported = newGameFromShareCode(anonymous, content, {
      build: BUILD,
      proseMode,
      names: {
        founder: name,
        house: SIGNED.houseName,
        friends: SIGNED.friends.map((friend) => friend.name),
      },
    });
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(imported.session.ctx.world.decisionLog.find((row) => row.kind === 'signing'))
      .toEqual(original.ctx.world.decisionLog.find((row) => row.kind === 'signing'));
    expect(saved(imported.session)).toBe(saved(original));
    expect(codeOf(imported.session, { names: true })).toBe(codeOf(original, { names: true }));
    const resumed = resumeGame(imported.session.save(), content, { proseMode });
    expect(saved(resumed)).toBe(saved(original));
    original.advance(1);
    imported.session.advance(1);
    resumed.advance(1);
    expect(saved(imported.session)).toBe(saved(original));
    expect(saved(resumed)).toBe(saved(original));
  });

  it('keeps a complete named founding authoritative over unused recipient founder input (#3039)', () => {
    for (const name of [undefined, '', '   ', 'Maud Gearithy']) {
      const original = founded({
        ...SIGNED,
        founder: {
          gender: 'woman', configuration: 'blood_mother',
          ...(name !== undefined ? { name } : {}),
        },
      });
      const code = codeOf(original, { names: true });
      const read = readShareCode(code, content, { build: BUILD });
      expect(read.ok && read.founding.missing).toEqual([]);
      const continued = resumeGame(original.save(), content);
      continued.advance(1);
      for (const stale of ['Previous Founder', '\u200B', 'N'.repeat(PERSON_NAME_MAX + 1)]) {
        const imported = newGameFromShareCode(code, content, { build: BUILD, names: { founder: stale } });
        expect(imported.ok).toBe(true);
        if (!imported.ok) continue;
        expect(saved(imported.session)).toBe(saved(original));
        const resumed = resumeGame(imported.session.save(), content);
        expect(saved(resumed)).toBe(saved(original));
        imported.session.advance(1);
        resumed.advance(1);
        expect(saved(imported.session)).toBe(saved(continued));
        expect(saved(imported.session)).toBe(saved(resumed));
      }
    }
  });

  it.each(['original', 'plainenglish'] as const)(
    'imports complete named codes despite invalid unused recipient fields (%s, #3064)',
    (proseMode) => {
      // Both sides must use the same reading mode: prose choice is saved.
      const original = newGame(content, {
        seed: 199500, startYear: CAMPAIGNS.short.startYear, campaign: 'short', proseMode,
      });
      expect(original.found(SIGNED).ok).toBe(true);
      const code = codeOf(original, { names: true });
      const preview = readShareCode(code, content, { build: BUILD });
      expect(preview.ok && preview.founding.missing).toEqual([]);
      const continued = resumeGame(original.save(), content, { proseMode });
      continued.advance(1);
      for (const names of [
        null,
        ['left', 'over'],
        { founder: { value: 'Previous founder' }, house: 123 },
        { friends: Array.from({ length: MAX_FRIENDS + 1 }, (_, i) => `Old friend ${i}`) },
        { friends: ['A', 42, 'C'] },
      ]) {
        // A typed caller should not supply these shapes. A reused Start form
        // or native bridge still can; every name is already present in code.
        const imported = newGameFromShareCode(code, content, {
          build: BUILD, proseMode, names: names as never,
        });
        expect(imported.ok).toBe(true);
        if (!imported.ok) continue;
        expect(saved(imported.session)).toBe(saved(original));
        const resumed = resumeGame(imported.session.save(), content, { proseMode });
        expect(saved(resumed)).toBe(saved(original));
        imported.session.advance(1);
        resumed.advance(1);
        expect(saved(imported.session)).toBe(saved(continued));
        expect(saved(resumed)).toBe(saved(continued));
      }
    },
  );

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

  it('refuses invalid host-supplied name types before constructing a new run', () => {
    // Host plugins, saved deep links and JavaScript callers are not constrained
    // by the TypeScript SharedNames interface. A malformed value must not
    // throw during .trim() or silently become an incomplete founding.
    const code = codeOf(founded());
    const invalid = [
      { house: 42, friends: SIGNED.friends.map((friend) => friend.name) },
      { house: SIGNED.houseName, friends: ['Iona Vale', 3, 'Edda Rook'] },
      { founder: { value: 'Maud' }, house: SIGNED.houseName },
      { house: SIGNED.houseName, friends: Array.from({ length: MAX_FRIENDS + 1 }, (_, i) => `Friend ${i}`) },
      ['not', 'an', 'object'],
      null,
    ];
    for (const names of invalid) {
      expect(() => newGameFromShareCode(code, content, { build: BUILD, names: names as never })).not.toThrow();
      expect(newGameFromShareCode(code, content, { build: BUILD, names: names as never }))
        .toEqual({ ok: false, problem: { kind: 'invalid_names' } });
    }
    const accepted = newGameFromShareCode(code, content, {
      build: BUILD,
      names: { founder: SIGNED.founder.name, house: SIGNED.houseName, friends: SIGNED.friends.map((friend) => friend.name) },
    });
    expect(accepted.ok && saved(accepted.session)).toBe(saved(founded()));
  });

  it('refuses oversized recipient names before creating a world, without rejecting padded valid names (#1995)', () => {
    const code = codeOf(founded());
    const names = {
      founder: SIGNED.founder.name,
      house: SIGNED.houseName,
      friends: SIGNED.friends.map((friend) => friend.name),
    };
    for (const supplied of [
      { ...names, house: 'H'.repeat(HOUSE_NAME_MAX + 1) },
      { ...names, friends: [names.friends[0]!, 'F'.repeat(FRIEND_NAME_MAX + 1), names.friends[2]!] },
    ]) {
      // A fresh simulation must not even inspect the Library until the
      // recipient's names have passed the same limits as manual signing.
      const guarded = {
        build: BUILD,
        names: supplied,
        get libraryRuns(): never { throw new Error('oversized names reached newGame'); },
      };
      expect(newGameFromShareCode(code, content, guarded))
        .toEqual({ ok: false, problem: { kind: 'invalid_names' } });
    }

    const padded = newGameFromShareCode(code, content, {
      build: BUILD,
      names: {
        founder: names.founder,
        house: `  ${names.house}  `,
        friends: names.friends.map((name) => `  ${name}  `),
      },
    });
    expect(padded.ok && saved(padded.session)).toBe(saved(founded()));
  });

  it('refuses surplus recipient friend names instead of silently discarding them (#1995)', () => {
    const names = SIGNED.friends.map((friend) => friend.name);
    const code = codeOf(founded());
    expect(newGameFromShareCode(code, content, {
      build: BUILD,
      names: { house: SIGNED.houseName, friends: [...names, 'Extra Friend'] },
    })).toEqual({ ok: false, problem: { kind: 'invalid_names' } });

    // A roster of zero friends is still an exact roster, not a request for
    // arbitrary extra people whose names the game would ignore.
    const noFriends = codeOf(founded({ ...SIGNED, friends: [] }));
    expect(newGameFromShareCode(noFriends, content, {
      build: BUILD,
      names: { house: SIGNED.houseName, friends: ['Extra Friend'] },
    })).toEqual({ ok: false, problem: { kind: 'invalid_names' } });
  });

  it('asks for a missing house name when the supplied name is invisible-only (#1995)', () => {
    const code = codeOf(founded()); // An anonymous code still needs a visible house name.
    const friends = SIGNED.friends.map((friend) => friend.name);
    for (const invisible of ['\u200B', ' \u200D \u2060\t', '\uFE0F']) {
      const result = newGameFromShareCode(code, content, {
        build: BUILD,
        names: { house: invisible, friends },
      });
      expect(result).toEqual({ ok: false, problem: { kind: 'names_needed', missing: ['house'] } });
    }

    // Formatting characters inside an otherwise visible name are legitimate.
    const accepted = newGameFromShareCode(code, content, {
      build: BUILD,
      names: { house: 'House of \u200D Salt', friends },
    });
    expect(accepted.ok).toBe(true);
  });

  it('refuses invisible-only or overlong recipient founder names before making a world', () => {
    const code = codeOf(founded()); // names withheld, founder gender/body retained
    const names = { house: 'Salt', friends: ['Alice', 'Bran', 'Cora'] };
    for (const founder of ['\u200B', ' \u200D \u2060\t', '\uFE0F', 'A'.repeat(PERSON_NAME_MAX + 1)]) {
      expect(newGameFromShareCode(code, content, {
        build: BUILD, names: { ...names, founder },
      })).toEqual({ ok: false, problem: { kind: 'invalid_names' } });
    }
    // An empty optional answer still leaves the authored founder unchanged.
    const blank = newGameFromShareCode(code, content, { build: BUILD, names: { ...names, founder: '   ' } });
    expect(blank.ok).toBe(true);
  });

  it('rejects founder answers whose raw signing text cannot be re-exported (#1995)', () => {
    const code = codeOf(founded()); // Anonymous code asks for the original answer.
    const names = {
      house: SIGNED.houseName,
      friends: SIGNED.friends.map((friend) => friend.name),
    };
    // Founding checks the visible trimmed name, while the signing log keeps
    // raw text. An overlong padded answer would found successfully but make
    // the new house impossible to export as a named code.
    for (const founder of [
      `  ${'A'.repeat(PERSON_NAME_MAX)}`,
      `${'A'.repeat(PERSON_NAME_MAX)}\u2003`,
    ]) {
      const opts = {
        build: BUILD,
        names: { ...names, founder },
        get libraryRuns(): never { throw new Error('invalid name reached newGame'); },
      };
      expect(newGameFromShareCode(code, content, opts))
        .toEqual({ ok: false, problem: { kind: 'invalid_names' } });
    }

    // The last representable raw length still round-trips byte-for-byte,
    // including padding, even though the visible name is trimmed.
    const founder = ` ${'A'.repeat(PERSON_NAME_MAX - 2)} `;
    const original = founded({ ...SIGNED, founder: { ...SIGNED.founder, name: founder } });
    const imported = newGameFromShareCode(codeOf(original), content, {
      build: BUILD, names: { ...names, founder },
    });
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(saved(imported.session)).toBe(saved(original));
    expect(codeOf(imported.session, { names: true })).toBe(codeOf(original, { names: true }));
  });

  it('refuses invisible-only required friend names instead of dropping an encoded friend (#2264)', () => {
    const code = codeOf(founded()); // Anonymous: three friends of specified sexes.
    for (const invisible of ['\u200B', ' \u200D \u2060\t', '\uFE0F']) {
      const result = newGameFromShareCode(code, content, {
        build: BUILD,
        names: { house: 'Salt', friends: ['Alice', invisible, 'Cora'] },
      });
      expect(result).toEqual({ ok: false, problem: { kind: 'names_needed', missing: ['friends'] } });
    }

    // Interior formatting marks in a visible name are not stripped or rejected.
    const visible = newGameFromShareCode(code, content, {
      build: BUILD,
      names: { house: 'Salt', friends: ['Iona Vale', '家族\u200Dの友', 'Edda Rook'] },
    });
    expect(visible.ok).toBe(true);
    if (visible.ok) {
      // Founding deals friends into randomized windows: compare the roster,
      // not its scheduled order.
      const names = visible.session.ctx.world.friends.map((friend) => friend.name);
      expect(names).toHaveLength(3);
      expect(names).toEqual(expect.arrayContaining(['Iona Vale', '家族\u200Dの友', 'Edda Rook']));
    }
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

  it('keeps the recipient\'s Library separate from the encoded founding', () => {
    // An earlier completed house left a recorded claim that a second household
    // may inherit. It is deliberately not part of the code a player shares.
    const prior = newGame(content, { seed: 199499, campaign: 'short' });
    const person = prior.ctx.world.people.household(prior.ctx.world.playerHouse, prior.year)[0]!;
    prior.ctx.world.chronicle.push({
      id: 'library_share_page',
      year: 1200,
      weight: 'paragraph',
      text: `${person.name} was entered in the record.`,
      named: true,
      record: 'embellish',
      claims: [{ kind: 'attr', person: person.id, attr: 'madness', value: 0 }],
    });
    prior.ctx.world.ending = { id: 'forgotten', year: CAMPAIGNS.short.endYear };
    const library = libraryRunOf(prior.ctx);
    expect(library?.entries.length).toBeGreaterThan(0);
    if (!library) throw new Error('the prior run did not leave a Library');

    const original = founded();
    const code = codeOf(original, { names: true });
    const without = newGameFromShareCode(code, content, { build: BUILD });
    const withLibrary = newGameFromShareCode(code, content, { build: BUILD, libraryRuns: [library] });
    const repeated = newGameFromShareCode(code, content, { build: BUILD, libraryRuns: [library] });
    expect(without.ok && withLibrary.ok && repeated.ok).toBe(true);
    if (!without.ok || !withLibrary.ok || !repeated.ok) return;

    expect(saved(without.session)).toBe(saved(original));
    expect(without.session.save().libraryMemories).toEqual([]);
    expect(withLibrary.session.save().libraryMemories.length).toBeGreaterThan(0);
    expect(saved(withLibrary.session)).not.toBe(saved(without.session));
    // Equal local Library inputs still give an exact reproducible founding.
    expect(saved(withLibrary.session)).toBe(saved(repeated.session));
    expect(withLibrary.founding).toEqual(without.founding);
    expect(withLibrary.session.prologue()?.founded).toEqual(without.session.prologue()?.founded);
    expect(codeOf(withLibrary.session, { names: true })).toBe(code);
  });

  it('carries an authored founder as no founder at all, so there is no founder name to ask for', () => {
    const original = founded({ houseName: 'Hearth', heirloom: 'portion_of_agelessness', grudge: 'house_marrow' });
    const code = codeOf(original);
    const read = readShareCode(code, content, { build: BUILD });
    expect(read.ok && read.founding.missing).toEqual(['house']);
    const begun = newGameFromShareCode(code, content, { build: BUILD, names: { house: 'Hearth' } });
    expect(begun.ok && saved(begun.session)).toBe(saved(original));
  });

  it('does not let an unrequested founder name replace the authored founder', () => {
    const original = founded({ houseName: 'Hearth', heirloom: 'portion_of_agelessness', grudge: 'house_marrow' });
    // A stale name field can survive a previous pasted code in the client.
    // It is not part of either encoded founding, so it must not create a
    // new founder when the code used the authored founder.
    for (const names of [false, true]) {
      const imported = newGameFromShareCode(codeOf(original, { names }), content, {
        build: BUILD, names: { founder: 'Stale Previous Founder', house: 'Hearth' },
      });
      expect(imported.ok && saved(imported.session)).toBe(saved(original));
    }
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
    // Frequent line breaks still fit the bounded raw input envelope.
    expect(readShareCode(code.split('').join('\n '), content, { build: BUILD }).ok).toBe(true);
    // A scan may put an indented break between every character. The former
    // raw-input guard rejected this still-bounded valid code before decoding.
    const denselyWrapped = code.split('').join('\n  ');
    const withinRawLimit = denselyWrapped.padStart(SHARE_CODE_MAX * 2 + 1, ' ');
    expect(withinRawLimit.length).toBeLessThanOrEqual(SHARE_CODE_MAX * 4);
    expect(readShareCode(withinRawLimit, content, { build: BUILD }).ok).toBe(true);
  });

  it('reads copied codes containing invisible zero-width spaces (#1995)', () => {
    const code = codeOf(founded(), { names: true });
    // U+200B is not matched by JavaScript's whitespace class, but some apps
    // insert it when wrapping pasted text; it is not part of base64url.
    const wrapped = code.split('').join('\u200B\n');
    expect(readShareCode(wrapped, content, { build: BUILD }).ok).toBe(true);
    expect(newGameFromShareCode(wrapped, content, { build: BUILD }).ok).toBe(true);
    // U+2060 WORD JOINER is another invisible code-wrap separator. JavaScript
    // does not classify it as whitespace, but it cannot occur in our wire body.
    const wordJoined = code.split('').join('\u2060\n');
    expect(readShareCode(wordJoined, content, { build: BUILD }).ok).toBe(true);
    expect(newGameFromShareCode(wordJoined, content, { build: BUILD }).ok).toBe(true);
    // Ignoring invisible separators must not evade the raw-input limit.
    expect(problemOf('\u200B'.repeat(SHARE_CODE_MAX * 4) + code))
      .toEqual({ kind: 'too_long', max: SHARE_CODE_MAX });
    expect(problemOf('\u2060'.repeat(SHARE_CODE_MAX * 4) + code))
      .toEqual({ kind: 'too_long', max: SHARE_CODE_MAX });
  });

  it('reads copied rich-text codes with soft hyphens and zero-width joiners (#2392)', () => {
    const code = codeOf(founded(), { names: true });
    for (const separator of ['\u00AD', '\u200C', '\u200D']) {
      // Formatting may be introduced between any two visible code characters.
      const wrapped = code.split('').join(`${separator}\n`);
      expect(readShareCode(wrapped, content, { build: BUILD }).ok).toBe(true);
      expect(newGameFromShareCode(wrapped, content, { build: BUILD }).ok).toBe(true);
      // A flood of removed characters cannot bypass the raw input limit.
      expect(problemOf(separator.repeat(SHARE_CODE_MAX * 4) + code))
        .toEqual({ kind: 'too_long', max: SHARE_CODE_MAX });
    }
    // Actual visible substitutions still fail the checksum; separators are
    // formatting, never a licence to reinterpret or silently repair a code.
    const body = code.split('.')[1]!;
    const corrupt = code.replace(body, `A${body.slice(1)}`);
    expect(problemOf(corrupt)).toEqual({ kind: 'damaged' });
  });

  it('reads other default-ignorable formatting marks copied into a share code (#2633)', () => {
    const code = codeOf(founded(), { names: true });
    // These are invisible formatting characters that the former manual
    // separator list missed. All are impossible in the ED1 wire alphabet.
    for (const mark of ['\u034F', '\u180E', '\uFE0F', '\u206A']) {
      const copied = `${mark}${code.split('').join(mark)}${mark}`;
      expect(readShareCode(copied, content, { build: BUILD }).ok).toBe(true);
      expect(newGameFromShareCode(copied, content, { build: BUILD }).ok).toBe(true);
      // Ignorable marks still count against the unnormalized input bound.
      expect(problemOf(mark.repeat(SHARE_CODE_MAX * 4) + code))
        .toEqual({ kind: 'too_long', max: SHARE_CODE_MAX });
    }
    // Removing formatting is not an invitation to repair a visible mutation.
    const body = code.split('.')[1]!;
    const changed = code.replace(body, (body[0] === 'A' ? 'B' : 'A') + body.slice(1));
    expect(problemOf(`\u034F${changed}\uFE0F`)).toEqual({ kind: 'damaged' });
  });

  it('reads codes with legacy and modern RTL direction marks inserted by messaging apps (#2589, #2597)', () => {
    const code = codeOf(founded(), { names: true });
    // Directionality controls cannot occur in the ASCII wire format, but a
    // bidi text container may insert them around or inside copied characters.
    for (const mark of [
      '\u061C', '\u200E', '\u200F',
      '\u202A', '\u202B', '\u202C', '\u202D', '\u202E',
      '\u2066', '\u2067', '\u2068', '\u2069',
    ]) {
      const copied = `${mark}${code.split('').join(mark)}${mark}`;
      expect(readShareCode(copied, content, { build: BUILD }).ok).toBe(true);
      expect(newGameFromShareCode(copied, content, { build: BUILD }).ok).toBe(true);
      // Normalize only after the raw input is bounded.
      expect(problemOf(mark.repeat(SHARE_CODE_MAX * 4) + code))
        .toEqual({ kind: 'too_long', max: SHARE_CODE_MAX });
    }

    // Ignoring a bidi mark must not make a visible mutation pass the checksum.
    const body = code.split('.')[1]!;
    const altered = code.replace(body, (body[0] === 'A' ? 'B' : 'A') + body.slice(1));
    expect(problemOf(`\u200F${altered}\u200E`)).toEqual({ kind: 'damaged' });
    expect(problemOf(`\u202B${altered}\u202C`)).toEqual({ kind: 'damaged' });
  });

  it('bounds padded input before normalizing away whitespace', () => {
    const code = codeOf(founded());
    const padded = `${' \n'.repeat(SHARE_CODE_MAX * 2 + 1)}${code}`;
    expect(problemOf(padded)).toEqual({ kind: 'too_long', max: SHARE_CODE_MAX });
    // The actual decoded payload limit remains the declared SHARE_CODE_MAX.
    expect(problemOf(`ED1.${'A'.repeat(SHARE_CODE_MAX)}.0`))
      .toEqual({ kind: 'too_long', max: SHARE_CODE_MAX });
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

  it('refuses non-string QR and native clipboard inputs without throwing or founding (#1995)', () => {
    // UI and native adapters are untrusted at runtime even when declared string.
    // Do not coerce values: an array containing a valid code is still not a code.
    const malformed: unknown[] = [null, undefined, false, 123, {}, [code], new String(code)];
    for (const value of malformed) {
      const supplied = value as unknown as string;
      const refusal = { ok: false, problem: { kind: 'not_a_code' } };
      expect(readShareCode(supplied, content, { build: BUILD })).toEqual(refusal);
      expect(newGameFromShareCode(supplied, content, { build: BUILD })).toEqual(refusal);
    }
    expect(readShareCode(code, content, { build: BUILD }).ok).toBe(true);
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

  it('refuses a re-sealed JSON formatting alias for the same founding', () => {
    // The checksum is not an authentication tag, but a code must have the
    // unique wire representation emitted by this encoder. A pretty-printed
    // JSON tuple otherwise names the same founding under a different code.
    const pretty = JSON.stringify(JSON.parse(payloadOf(code)), null, 2);
    const body = btoa(pretty).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(body).not.toBe(code.split('.')[1]);
    expect(problemOf(`ED1.${body}.${hashSeed('ED1', body).toString(36)}`))
      .toEqual({ kind: 'damaged' });
    expect(readShareCode(code, content, { build: BUILD }).ok).toBe(true);
  });

  it('refuses a well-formed code whose places are not in this prologue', () => {
    expect(problemOf(forge(code, (p) => { p[7] = 99; }))).toEqual({ kind: 'damaged' });
    expect(problemOf(forge(code, (p) => { p[6] = [0, 0]; }))).toEqual({ kind: 'damaged' });
    expect(problemOf(forge(code, (p) => { p[6] = [-1, -1, -1, -1]; }))).toEqual({ kind: 'damaged' });
    // Names travel together: a house name without the friends' names is no export this build writes.
    expect(problemOf(forge(code, (p) => { p[11] = 0; }))).toEqual({ kind: 'damaged' });
  });

  it('refuses forged named codes with house names the signing would normalize or discard', () => {
    const named = codeOf(founded(), { names: true });
    for (const house of ['  The House of Salt  ', '\u200B', ' \u200D \u2060 ']) {
      const damaged = forge(named, (payload) => { payload[9] = house; });
      expect(problemOf(damaged)).toEqual({ kind: 'damaged' });
    }
    expect(readShareCode(named, content, { build: BUILD }).ok).toBe(true);
  });

  it('refuses invisible-only founder names in a forged named code', () => {
    const named = codeOf(founded(), { names: true });
    for (const founderName of ['\u200B', ' \u200D \u2060 ', '\uFE0F']) {
      const damaged = forge(named, (payload) => {
        payload[5] = ['w', 'm', founderName];
      });
      expect(problemOf(damaged)).toEqual({ kind: 'damaged' });
    }
    // Blank answers are deliberate and remain round-trippable (above).
    expect(readShareCode(named, content, { build: BUILD }).ok).toBe(true);
  });

  it('refuses forged named codes with noncanonical or invisible friend names', () => {
    const named = codeOf(founded(), { names: true });
    for (const friend of ['  Corven Pike', '\u200D', '  \u2060 \u200B ']) {
      const damaged = forge(named, (payload) => {
        payload[11] = ['Iona Vale', friend, 'Edda Rook'];
      });
      expect(problemOf(damaged)).toEqual({ kind: 'damaged' });
    }
  });

  it('refuses forged named codes with duplicate friend names ignoring case', () => {
    const named = codeOf(founded(), { names: true });
    const damaged = forge(named, (payload) => {
      payload[11] = ['Iona Vale', 'iona vale', 'Edda Rook'];
    });
    expect(problemOf(damaged)).toEqual({ kind: 'damaged' });
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

  it('refuses to export seeds the decoder cannot represent', () => {
    // The player UI restricts seeds to uint32, but programmatic games can
    // be founded with other numbers. No exporter may promise an unreadable code.
    for (const seed of [-1, 1.5, 0x100000000]) {
      const s = founded(SIGNED, seed);
      expect(s.shareCode({ build: BUILD })).toEqual({ ok: false, unavailable: 'unrepresentable' });
    }
  });

  it('never offers an unreadable code for a noncanonical logged friend roster', () => {
    const s = founded();
    const founding = s.ctx.world.decisionLog.find((row) => row.kind === 'founding');
    if (!founding) throw new Error('the signing did not record a founding');

    // A legacy/restored or programmatically changed log can exceed today's
    // signing limit even though the normal GameSession.found path cannot.
    // Previously both exports returned ok, but readShareCode rejected them.
    founding.friends.push(
      ...Array.from({ length: MAX_FRIENDS }, (_, i) => ({ name: `Extra ${i}`, sex: 'male' as const })),
    );
    const logBefore = JSON.stringify(s.ctx.world.decisionLog);
    for (const names of [false, true]) {
      expect(s.shareCode({ build: BUILD, names }))
        .toEqual({ ok: false, unavailable: 'unrepresentable' });
      expect(JSON.stringify(s.ctx.world.decisionLog)).toBe(logBefore);
    }
  });

  it('does not export a restored house name the signing would change or reject (#2659)', () => {
    const invalid = [
      ['leading/trailing whitespace', '  The House of Salt  '],
      ['repeated interior whitespace', 'The  House of Salt'],
      ['invisible-only', '\u200B\u2060'],
      ['blank', '   '],
      ['beyond the signing limit', 'H'.repeat(HOUSE_NAME_MAX + 1)],
    ] as const;

    for (const [description, houseName] of invalid) {
      const s = founded();
      const founding = s.ctx.world.decisionLog.find((row) => row.kind === 'founding');
      if (!founding) throw new Error('the signing did not record a founding');
      founding.houseName = houseName;
      const before = JSON.stringify(s.ctx.world.decisionLog);

      for (const names of [false, true]) {
        expect(s.shareCode({ build: BUILD, names }), `${description} / names=${names}`)
          .toEqual({ ok: false, unavailable: 'unrepresentable' });
      }
      // A read-only exporter must not "repair" the old decision log in place.
      expect(JSON.stringify(s.ctx.world.decisionLog)).toBe(before);
    }

    // Normal signing canonicalizes typed whitespace *before* logging it. Such
    // genuinely founded names remain exportable in both privacy modes.
    const valid = founded({ ...SIGNED, houseName: '  Harbour   House 🌙  ' });
    expect(valid.prologue()?.founded?.houseName).toBe('Harbour House 🌙');
    for (const names of [false, true]) {
      const code = codeOf(valid, { names });
      expect(readShareCode(code, content, { build: BUILD }).ok).toBe(true);
    }
    const restored = newGameFromShareCode(codeOf(valid, { names: true }), content, { build: BUILD });
    expect(restored.ok && saved(restored.session)).toBe(saved(valid));
  });

  it('refuses malformed restored founder identities rather than throwing into the ending UI', () => {
    // Founder details are encoded through exhaustive switches. A restored or
    // programmatically altered signing log may violate their closed enums or
    // name limit; neither an anonymous nor a named export may throw.
    const malformed = [
      // Falsy but present runtime values must not be mistaken for an omitted
      // founder and exported as the authored default in either privacy mode.
      { label: 'null founder', value: null },
      { label: 'false founder', value: false },
      { label: 'zero founder', value: 0 },
      { label: 'empty-string founder', value: '' },
      { label: 'unknown gender', value: { ...SIGNED.founder, gender: 'other' } },
      { label: 'unknown founding body', value: { ...SIGNED.founder, configuration: 'blood_ancestor' } },
      { label: 'non-text name', value: { ...SIGNED.founder, name: 42 } },
      { label: 'overlong name', value: { ...SIGNED.founder, name: 'N'.repeat(PERSON_NAME_MAX + 1) } },
      { label: 'invisible-only name', value: { ...SIGNED.founder, name: '\u200B\u2060' } },
    ];
    for (const { label, value } of malformed) {
      const s = founded();
      const signing = s.ctx.world.decisionLog.find((row) => row.kind === 'signing');
      if (!signing) throw new Error('the signing did not record its founder');
      signing.founder = value as typeof signing.founder;
      const before = JSON.stringify(s.ctx.world.decisionLog);
      for (const names of [false, true]) {
        expect(s.shareCode({ build: BUILD, names }), `${label} / names=${names}`)
          .toEqual({ ok: false, unavailable: 'unrepresentable' });
      }
      // The exporter is a read-only view even when its source is malformed.
      expect(JSON.stringify(s.ctx.world.decisionLog)).toBe(before);
    }
  });

  it('does not offer codes for restored friend rosters the signing would change or refuse', () => {
    // The compact wire schema checks only types, lengths, and the five-friend
    // limit. An older/corrupted decision log may still fail the production
    // friend normalizer on import, or silently change its recorded names.
    const changes: { label: string; edit: (roster: { name: string }[]) => void }[] = [
      {
        label: 'case-blind duplicate',
        edit: (roster) => { roster[1]!.name = roster[0]!.name.toUpperCase(); },
      },
      {
        label: 'invisible-only name',
        edit: (roster) => { roster[1]!.name = '\u200B'; },
      },
      {
        label: 'noncanonical spacing',
        edit: (roster) => { roster[1]!.name = '  Corven   Pike  '; },
      },
    ];

    for (const { label, edit } of changes) {
      const s = founded();
      const founding = s.ctx.world.decisionLog.find((row) => row.kind === 'founding');
      if (!founding) throw new Error('the signing did not record a founding');
      edit(founding.friends);
      const before = JSON.stringify(s.ctx.world.decisionLog);

      for (const names of [false, true]) {
        expect(s.shareCode({ build: BUILD, names }), `${label} / names=${names}`)
          .toEqual({ ok: false, unavailable: 'unrepresentable' });
      }
      // The read-only exporter must never repair or mutate an old save.
      expect(JSON.stringify(s.ctx.world.decisionLog)).toBe(before);
    }

    const valid = founded();
    for (const names of [false, true]) {
      const code = codeOf(valid, { names });
      expect(readShareCode(code, content, { build: BUILD }).ok).toBe(true);
    }
  });

  it('has nothing to say before the house is founded', () => {
    const s = newGame(content, { seed: 1, startYear: CAMPAIGNS.short.startYear, campaign: 'short' });
    expect(s.shareCode()).toEqual({ ok: false, unavailable: 'not_founded' });
  });

  it('refuses share codes when a recovered founding state is absent or contradicts the logged founding (#2965)', () => {
    const pristine = founded();
    expect(readShareCode(codeOf(pristine), content, { build: BUILD }).ok).toBe(true);
    const original = pristine.ctx.world.founding!;
    delete pristine.ctx.world.founding;
    expect(pristine.shareCode({ build: BUILD }))
      .toEqual({ ok: false, unavailable: 'unrepresentable' });

    for (const changed of [
      { ...original, houseName: 'Another House' },
      { ...original, heirloom: 'portion_of_agelessness' },
      { ...original, grudge: 'house_marrow' },
      { ...original, answers: { ...original.answers, the_ford: 'changed_record' } },
      { ...original, year: original.year + 1 },
    ]) {
      pristine.ctx.world.founding = changed;
      expect(pristine.shareCode({ build: BUILD }))
        .toEqual({ ok: false, unavailable: 'unrepresentable' });
    }

    const duplicate = founded();
    const row = duplicate.ctx.world.decisionLog.find((entry) => entry.kind === 'founding');
    if (!row) throw new Error('no logged founding');
    duplicate.ctx.world.decisionLog.push({ ...row });
    expect(duplicate.shareCode({ build: BUILD }))
      .toEqual({ ok: false, unavailable: 'unrepresentable' });
  });

  it('fails closed when recovered founding records contain malformed runtime values (#1995)', () => {
    // Invalid older/programmatic state must not crash the Chronicle or ending
    // share-code button. JSON-based save validation normally rejects these,
    // but a read-only projection must not assume every in-memory row is sound.
    const cases: { label: string; damage: (s: GameSession) => void }[] = [
      {
        label: 'a non-text house name in both copies of the founding',
        damage: (s) => {
          const row = s.ctx.world.decisionLog.find((entry) => entry.kind === 'founding');
          if (!row || !s.ctx.world.founding) throw new Error('missing founding');
          row.houseName = null as never;
          s.ctx.world.founding.houseName = null as never;
        },
      },
      {
        label: 'a missing logged friends list',
        damage: (s) => {
          const row = s.ctx.world.decisionLog.find((entry) => entry.kind === 'founding');
          if (!row) throw new Error('missing founding row');
          row.friends = null as never;
        },
      },
      {
        label: 'a missing live friends list',
        damage: (s) => { s.ctx.world.friends = null as never; },
      },
      {
        label: 'a null live friend entry',
        damage: (s) => { s.ctx.world.friends[0] = null as never; },
      },
      {
        label: 'a null logged friend entry',
        damage: (s) => {
          const row = s.ctx.world.decisionLog.find((entry) => entry.kind === 'founding');
          if (!row) throw new Error('missing founding row');
          row.friends[0] = null as never;
        },
      },
      {
        label: 'missing persisted answers',
        damage: (s) => {
          if (!s.ctx.world.founding) throw new Error('missing founding');
          s.ctx.world.founding.answers = null as never;
        },
      },
      {
        label: 'non-text persisted answer',
        damage: (s) => {
          if (!s.ctx.world.founding) throw new Error('missing founding');
          s.ctx.world.founding.answers = { the_ford: 123 } as never;
        },
      },
      {
        label: 'missing signing answers even when the persisted set is empty',
        damage: (s) => {
          const row = s.ctx.world.decisionLog.find((entry) => entry.kind === 'signing');
          if (!row || !s.ctx.world.founding) throw new Error('missing signing');
          row.answers = null as never;
          s.ctx.world.founding.answers = {};
        },
      },
    ];
    for (const { label, damage } of cases) {
      const s = founded();
      damage(s);
      const before = JSON.stringify({
        decisions: s.ctx.world.decisionLog,
        founding: s.ctx.world.founding,
        friends: s.ctx.world.friends,
      });
      for (const names of [false, true]) {
        expect(() => s.shareCode({ build: BUILD, names }), `${label} / names=${names}`).not.toThrow();
        expect(s.shareCode({ build: BUILD, names }), `${label} / names=${names}`)
          .toEqual({ ok: false, unavailable: 'unrepresentable' });
      }
      expect(JSON.stringify({
        decisions: s.ctx.world.decisionLog,
        founding: s.ctx.world.founding,
        friends: s.ctx.world.friends,
      })).toBe(before);
    }
  });

  it('uses only a single same-year signing that agrees with persisted answers (#2966)', () => {
    const invalid = { ok: false, unavailable: 'unrepresentable' };
    const misplaced = founded();
    const oldSigning = misplaced.ctx.world.decisionLog.find((entry) => entry.kind === 'signing');
    if (!oldSigning) throw new Error('no logged signing');
    oldSigning.year += 1;
    expect(misplaced.shareCode({ build: BUILD })).toEqual(invalid);

    const duplicated = founded();
    const duplicatedSigning = duplicated.ctx.world.decisionLog.find((entry) => entry.kind === 'signing');
    if (!duplicatedSigning) throw new Error('no logged signing');
    duplicated.ctx.world.decisionLog.push({ ...duplicatedSigning, answers: { ...duplicatedSigning.answers } });
    expect(duplicated.shareCode({ build: BUILD })).toEqual(invalid);

    const changed = founded();
    const changedSigning = changed.ctx.world.decisionLog.find((entry) => entry.kind === 'signing');
    if (!changedSigning) throw new Error('no logged signing');
    changedSigning.answers.the_ford = 'another_answer';
    expect(changed.shareCode({ build: BUILD })).toEqual(invalid);

    const missing = founded();
    const at = missing.ctx.world.decisionLog.findIndex((entry) => entry.kind === 'signing');
    if (at < 0) throw new Error('no logged signing');
    missing.ctx.world.decisionLog.splice(at, 1);
    expect(missing.shareCode({ build: BUILD })).toEqual(invalid);

    const unsigned = founded({ houseName: 'Hearth', heirloom: 'portion_of_agelessness', grudge: 'house_marrow' });
    expect(readShareCode(codeOf(unsigned), content, { build: BUILD }).ok).toBe(true);
  });

  it('rejects a live friend roster that no longer matches the founding record (#2967)', () => {
    const invalid = { ok: false, unavailable: 'unrepresentable' };
    const normal = founded();
    const before = codeOf(normal, { names: true });
    normal.advance(20);
    // Spending or rescheduling names within the run is not a different roster.
    expect(codeOf(normal, { names: true })).toBe(before);

    const renamed = founded();
    renamed.ctx.world.friends[0]!.name = 'Different friend';
    expect(renamed.shareCode({ build: BUILD })).toEqual(invalid);

    const changedSex = founded();
    changedSex.ctx.world.friends[0]!.sex = 'male';
    expect(changedSex.shareCode({ build: BUILD })).toEqual(invalid);

    const missing = founded();
    missing.ctx.world.friends.pop();
    expect(missing.shareCode({ build: BUILD })).toEqual(invalid);

    const reordered = founded();
    [reordered.ctx.world.friends[0], reordered.ctx.world.friends[1]] =
      [reordered.ctx.world.friends[1]!, reordered.ctx.world.friends[0]!];
    expect(reordered.shareCode({ build: BUILD })).toEqual(invalid);
  });

});
