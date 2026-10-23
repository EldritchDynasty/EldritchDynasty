import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import type { FounderAnswer, Gender } from '@ed/schema';
import { digestOf, newGame, resumeGame, type GameSession } from '@ed/core';
import { epilogueOf } from './ending.js';
import { isRegent } from './world.js';

const bundle = loadContent();
const SEED = 18_670;

/** Answer whatever the docket holds the way a player would: the first open offer, every time. */
function drain(g: GameSession): void {
  const w = g.ctx.world;
  for (let guard = 0; w.pendingDecisions.length && guard < 200; guard++) {
    const d = w.pendingDecisions[0]!;
    if (d.kind === 'match') {
      const card = d.cards.find((c) => c.available);
      if (!card || !g.match(d.id, card.id).ok) g.declineHand(d.id);
    } else if (d.kind === 'record') {
      g.record(d.id, 'record');
    } else if (!d.choicesAreOpen) {
      g.send(d.id, {});
    } else {
      const choice = d.choices.find((c) => c.available);
      if (!choice || !g.choose(d.id, choice.id).ok) g.letHimDecide();
    }
  }
}

function playTo(g: GameSession, year: number): void {
  drain(g);
  while (g.year < year) {
    g.advance(1);
    drain(g);
  }
}

/**
 * The forms a page about the founder must use, and the ones it must not. A
 * bare "they" is not counted against a man or a woman: "They buried him in
 * the spring" is the mourners.
 */
const FORMS: Record<Gender, { they: string; never: RegExp; them: string }> = {
  man: { they: 'He', never: /\b(she|her|hers|herself)\b/i, them: 'him' },
  woman: { they: 'She', never: /\b(he|him|his|himself)\b/i, them: 'her' },
  nonbinary: { they: 'They', never: /\b(he|him|his|himself|she|her|hers|herself)\b/i, them: 'them' },
};

const IDENTITIES: [string, FounderAnswer & { name: string; gender: Gender }][] = [
  ['a man, blood father', { name: 'Arlen Vell', gender: 'man', configuration: 'blood_father' }],
  ['a woman, blood mother', { name: 'Ysolt Vell', gender: 'woman', configuration: 'blood_mother' }],
  ['a woman, blood father', { name: 'Maud Vell', gender: 'woman', configuration: 'blood_father' }],
  ['a man, blood mother', { name: 'Corin Vell', gender: 'man', configuration: 'blood_mother' }],
  ['nonbinary, blood father', { name: 'Ash Vell', gender: 'nonbinary', configuration: 'blood_father' }],
  ['nonbinary, blood mother', { name: 'Wren Vell', gender: 'nonbinary', configuration: 'blood_mother' }],
];

/**
 * EVERY OFFERED IDENTITY, END TO END (#1867 step 5, the issue's §7).
 *
 * The unit suites pin each rule on its own: the configuration, the charter,
 * the grammar, persistence. This plays each identity the way a player
 * would — signed through the session, the first generation answered at the
 * docket, the founder crossing over and the seal passing on — and asserts
 * the shape of a healthy run at each step rather than one seed's story.
 */
describe('the founder, signed as every offered identity', () => {
  it.each(IDENTITIES)('%s: signing, a first generation, the crossing and the guardian', (_label, founder) => {
    const g = newGame(bundle, { seed: SEED, campaign: 'long' });
    const prologue = g.prologue()!;
    expect(g.found({
      houseName: 'The House of Salt', heirloom: prologue.heirlooms[0]!.heirloom, grudge: prologue.grudges[0]!.house, founder,
    }).ok).toBe(true);

    const w = () => g.ctx.world;
    const me = w().people.get(w().narrator!)!;
    expect([me.name, me.gender]).toEqual([founder.name, founder.gender]);
    expect(me.sex).toBe(founder.configuration === 'blood_mother' ? 'female' : 'male');
    expect(g.view().narrator).toEqual({ name: founder.name, them: FORMS[founder.gender].them });

    // The founding children are the founder's own, on the side the configuration says.
    const children = w().people.all().filter((p) => p.trueParents.mother === me.id || p.trueParents.father === me.id);
    expect(children.length).toBeGreaterThan(0);
    for (const child of children) {
      expect(founder.configuration === 'blood_mother' ? child.trueParents.mother : child.trueParents.father).toBe(me.id);
    }

    // A first generation, answered at the docket. The founder holds the seal
    // in their own right throughout: the charter, whatever the body.
    playTo(g, 1060);
    expect(me.castSlots).toContain('head');
    expect(isRegent(w(), me)).toBe(false);

    // Persisted exactly. (Replay re-runs the chronicler and checks the log it
    // rebuilds, so it verifies auto-decided runs — `founder-identity.test.ts`
    // replays a signed one — not a log of a player's own answers.)
    expect(digestOf(resumeGame(g.save(), bundle).ctx)).toBe(digestOf(g.ctx));

    // The founder crosses over; the seal passes by ordinary succession. The
    // guardian phase takes the crossing the year after the death, and an heir
    // too young to hold the seal leaves it empty under a wardship — both the
    // rules as they stand for every founder, the authored one included.
    const died = w().year;
    w().people.kill(me.id, died, 'a test');
    expect(me.status).toBe('guardian');
    playTo(g, died + 2);
    const since = w().guardianSince!;
    expect(since).toBeGreaterThanOrEqual(died);
    expect(g.view().guardian).toMatchObject({ name: founder.name, since });
    const head = w().people.living().find((p) => p.castSlots.includes('head'));
    if (head) {
      expect(head.id).not.toBe(me.id);
      expect(isRegent(w(), head)).toBe(head.sex === 'female');
    } else {
      const ward = w().people.get(w().wardship!.ward)!;
      expect(w().year - ward.born, 'an empty seat waits only for a minor').toBeLessThan(16);
    }
    // The founder's reign closes when somebody takes the seal; a wardship keeps it open until the ward does.
    if (head) expect(w().succession.find((s) => s.person === me.id)!.to).toBeGreaterThanOrEqual(died);

    // The crossing names the founder as the player said, and nobody else's forms.
    const crossing = w().chronicle.find((e) => e.year === since && e.text?.includes(`${founder.name} had not`));
    expect(crossing, 'the crossing is written').toBeDefined();
    // The sentence that is about the founder alone takes their subject form.
    expect(crossing!.text).toContain(`${founder.name} had not gone anywhere. ${FORMS[founder.gender].they} had only`);
    expect(crossing!.text).not.toMatch(FORMS[founder.gender].never);

    // No authored token reached the player unrendered, anywhere it was written.
    const written = [
      ...w().chronicle.flatMap((e) => [e.title ?? '', e.text ?? '']),
      ...w().frame.entries.map((e) => JSON.stringify(e)),
    ];
    expect(written.filter((t) => /\{[A-Z_][A-Z0-9_]*(\.[A-Za-z]+)?\}/.test(t))).toEqual([]);

    // The guardian is kept across a save, and the collection opens on the signer.
    const resumed = resumeGame(g.save(), bundle);
    expect(resumed.view().guardian).toMatchObject({ name: founder.name, since });
    resumed.ctx.world.ending = { id: 'forgotten', year: resumed.ctx.world.year };
    expect(epilogueOf(resumed.ctx)?.beginning).toMatchObject({ founder: founder.name, guardianSince: since });
  });
});
