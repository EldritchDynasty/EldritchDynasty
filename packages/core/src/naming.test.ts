import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { proseOriginalHash } from '@ed/schema';
import {
  bootstrap, stepYear, runYears, renameChild, clearNamingQueue, keepSuggestedName,
  givenName, ordinalSuffix, testRng, uniqueName, retireNames, NAME_MOURNING_YEARS,
  createProseRuntime, loadGame, newGame, saveGame, setProseMode,
} from '@ed/core';
import { coreMessageAddress } from './messages.js';
import { CAMPAIGN_YEARS } from './campaign.js';

const bundle = loadContent();

/** Advance until at least one child is waiting to be named. */
function untilBirth(seed = 1042, cap = 80) {
  const ctx = bootstrap(bundle, seed, 1042);
  for (let i = 0; i < cap && ctx.world.pendingNames.length === 0; i++) stepYear(ctx);
  return ctx;
}

describe('naming the children', () => {
  it('queues newborns of the house, and only of the house', () => {
    const ctx = untilBirth();
    expect(ctx.world.pendingNames.length).toBeGreaterThan(0);
    for (const n of ctx.world.pendingNames) {
      const p = ctx.world.people.get(n.person)!;
      expect(p).toBeDefined();
      expect(p.houseOfOrigin).toBe(ctx.world.playerHouse);
      expect(p.born).toBe(n.born);
    }
  });

  it('gives every newborn a name before queueing, so nothing holds a nameless person', () => {
    const ctx = untilBirth();
    for (const n of ctx.world.pendingNames) {
      const p = ctx.world.people.get(n.person)!;
      expect(p.name.trim().length).toBeGreaterThan(0);
      expect(n.suggested).toBe(p.name);
    }
  });

  it('applies the chosen name, logs it, and drains the queue', () => {
    const ctx = untilBirth();
    const target = ctx.world.pendingNames[0]!.person;
    const before = ctx.world.chronicle.length;
    const queued = ctx.world.pendingNames.length;

    expect(renameChild(ctx, target, 'Sorrel')).toBe(true);
    expect(ctx.world.people.get(target)!.name).toBe('Sorrel');
    expect(ctx.world.pendingNames.length).toBe(queued - 1);
    expect(ctx.world.chronicle.length).toBe(before + 1);
    expect(ctx.world.chronicle.at(-1)!.text).toContain('Sorrel');
  });

  /**
   * The bug this exists for: the child was renamed and vanished from the
   * household view. Naming must never change where a person lives.
   */
  it('keeps a renamed child in the household roster', () => {
    const ctx = untilBirth();
    const target = ctx.world.pendingNames[0]!.person;
    const inHouseholdBefore = ctx.world.people
      .household(ctx.world.playerHouse, ctx.world.year)
      .some((p) => p.id === target);

    renameChild(ctx, target, 'Sorrel');

    const roster = ctx.world.people.household(ctx.world.playerHouse, ctx.world.year);
    expect(roster.some((p) => p.id === target)).toBe(inHouseholdBefore);
    expect(inHouseholdBefore).toBe(true);
    expect(roster.map((p) => p.name)).toContain('Sorrel');
  });

  it('frees the old name and reserves the new one', () => {
    const ctx = untilBirth();
    const target = ctx.world.pendingNames[0]!.person;
    const old = ctx.world.people.get(target)!.name;

    renameChild(ctx, target, 'Sorrel');
    expect(ctx.takenNames.has('Sorrel')).toBe(true);
    expect(ctx.takenNames.has(old)).toBe(false);
  });

  it('refuses blank names and unknown people, without draining the queue', () => {
    const ctx = untilBirth();
    const queued = ctx.world.pendingNames.length;
    const target = ctx.world.pendingNames[0]!.person;

    expect(renameChild(ctx, target, '   ')).toBe(false);
    expect(renameChild(ctx, 'p_nonexistent', 'Sorrel')).toBe(false);
    expect(ctx.world.pendingNames.length).toBe(queued);
  });

  it('refuses to rename someone who is not in the queue', () => {
    const ctx = untilBirth();
    const head = ctx.world.people.living().find((p) => p.castSlots.includes('head'))!;
    const before = head.name;
    expect(renameChild(ctx, head.id, 'Impostor')).toBe(false);
    expect(head.name).toBe(before);
  });

  it('lets the chronicler keep the names', () => {
    const ctx = untilBirth();
    const names = ctx.world.pendingNames.map((n) => ctx.world.people.get(n.person)!.name);
    clearNamingQueue(ctx);
    expect(ctx.world.pendingNames).toEqual([]);
    // Ignoring the offer is a valid way to play: the names survive.
    for (const n of names) expect(ctx.world.people.all().some((p) => p.name === n)).toBe(true);
  });

  /**
   * NAMING THE DAUGHTER AND LETTING HIM HAVE THE FOUR SONS (issue #53).
   *
   * The queue was all-or-nothing: `clearNamingQueue` or nothing, which made
   * "keep the names he suggests" the button a player pressed to get their
   * clock back rather than a thing they meant.
   */
  it('keeps his name for one child and leaves the rest of the queue standing', () => {
    const ctx = untilBirth(909);
    // TWO IN THE QUEUE AT ONCE, built rather than waited for.
    //
    // This used to turn the clock until a seed happened to queue two, which
    // worked while every child of the seat raised a prompt. #62 cut that to
    // about 24 a run — the heir, a throwback, a broken run of sons — so two
    // standing in the same instant is now uncommon, and waiting for one is a
    // wait rather than a test. The claim is about draining ONE entry and
    // leaving the others, which needs two entries and nothing else.
    for (const spare of ctx.world.people.living()) {
      if (ctx.world.pendingNames.length >= 2) break;
      if (ctx.world.pendingNames.some((n) => n.person === spare.id)) continue;
      ctx.world.pendingNames.push({
        person: spare.id,
        born: ctx.world.year,
        suggested: spare.name,
        sex: spare.sex,
        because: 'the test means two of them',
      });
    }
    expect(ctx.world.pendingNames.length).toBeGreaterThan(1);

    const queued = ctx.world.pendingNames.length;
    const target = ctx.world.pendingNames[0]!.person;
    const kept = ctx.world.people.get(target)!.name;

    expect(keepSuggestedName(ctx, target)).toBe(true);
    expect(ctx.world.pendingNames.length).toBe(queued - 1);
    expect(ctx.world.pendingNames.some((n) => n.person === target)).toBe(false);
    // Accepted, not refused: he keeps the name he was given.
    expect(ctx.world.people.get(target)!.name).toBe(kept);
  });

  it('refuses a child who is not in the queue, and drains nothing', () => {
    const ctx = untilBirth();
    const queued = ctx.world.pendingNames.length;
    const head = ctx.world.people.living().find((p) => p.castSlots.includes('head'))!;

    expect(keepSuggestedName(ctx, head.id)).toBe(false);
    expect(keepSuggestedName(ctx, 'p_nonexistent')).toBe(false);
    expect(ctx.world.pendingNames.length).toBe(queued);
  });

  /**
   * THE TRAP THIS VERB EXISTS TO AVOID.
   *
   * `keepSuggestedName(p)` reads like `renameChild(p, theNameTheyAlreadyHave)`
   * and is the opposite of it. `renameChild` is the REFUSAL path: it hands the
   * friend-name back to the bag and takes the lift off the child. Run it with
   * the name already on the child and the name goes back in the bag while its
   * holder keeps it — so the bag deals it a second time, to somebody else, and
   * two living people carry a name the player gave once.
   *
   * This builds the collision directly rather than waiting for a run to
   * produce one: mark the queued child's own name as a friend-name spent this
   * year, then take both paths and look at the bag.
   */
  it('does not hand the friend-name back to the bag, the way a rename would', () => {
    const spend = (ctx: ReturnType<typeof untilBirth>, person: string) => {
      const name = ctx.world.people.get(person)!.name;
      ctx.world.friends = [{ name, sex: 'female', dueFrom: ctx.world.year, spentIn: ctx.world.year }];
      return name;
    };

    const keeping = untilBirth();
    const keptId = keeping.world.pendingNames[0]!.person;
    spend(keeping, keptId);
    keepSuggestedName(keeping, keptId);
    expect(
      keeping.world.friends[0]!.spentIn,
      'keeping his name put it back in the bag — it is now dealable twice',
    ).toBe(keeping.world.year);

    // The same setup down the refusal path, which SHOULD release it. Without
    // this the assertion above would pass against a `releaseFriendName` that
    // had simply stopped working.
    const refusing = untilBirth();
    const refusedId = refusing.world.pendingNames[0]!.person;
    spend(refusing, refusedId);
    renameChild(refusing, refusedId, 'Sorrel');
    expect(refusing.world.friends[0]!.spentIn).toBeUndefined();
  });

  it('does not grow the queue without bound over a long run', () => {
    const ctx = bootstrap(bundle, 909, 1042);
    runYears(ctx, CAMPAIGN_YEARS);
    // Unnamed children accumulate, but only one entry per child ever.
    const ids = ctx.world.pendingNames.map((n) => n.person);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

/**
 * THE NAME ITSELF.
 *
 * `uniqueName` is what stands between the simulation and two living Edrics in
 * one household — which is not a crash, it is a chronicle nobody can read and
 * a `takenNames` set that quietly stops meaning anything.
 */
describe('choosing a name', () => {
  it('draws from the list for the sex it was given', () => {
    const women = new Set(Array.from({ length: 200 }, (_, i) => givenName('female', testRng('n', i))));
    const men = new Set(Array.from({ length: 200 }, (_, i) => givenName('male', testRng('n', i))));
    expect(women.size).toBeGreaterThan(10);
    expect(men.size).toBeGreaterThan(10);
    for (const w of women) expect(men.has(w)).toBe(false);
  });

  it('retains the nine worded ordinals while using correct numeric endings', () => {
    expect(Array.from({ length: 9 }, (_, i) => ordinalSuffix(i + 1))).toEqual([
      'first', 'second', 'third', 'fourth', 'fifth', 'sixth',
      'seventh', 'eighth', 'ninth',
    ]);

    for (const [n, wording] of [
      [10, '10th'], [11, '11th'], [12, '12th'], [13, '13th'],
      [20, '20th'], [21, '21st'], [22, '22nd'], [23, '23rd'],
      [101, '101st'], [102, '102nd'], [103, '103rd'],
      [111, '111th'], [112, '112th'], [113, '113th'],
      [121, '121st'], [122, '122nd'], [123, '123rd'],
    ] as const) {
      expect(ordinalSuffix(n), String(n)).toBe(wording);
    }
  });

  it('keeps high collision disambiguations unique and grammatical', () => {
    const seed = testRng('high-ordinal-names');
    // Keep the same base name while exercising the real suffix/shuffle paths.
    // A large village can eventually exhaust all ordinary bynames.
    const rng = { ...seed, pick: <T>(options: readonly T[]): T => options[0]! };
    const taken = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const name = uniqueName('male', taken, rng, { place: 'Hesk' });
      expect(taken.has(name), `duplicate at iteration ${i}`).toBe(false);
      taken.add(name);
    }

    expect(taken.size).toBe(100);
    expect(taken.has('Aldous of Hesk the 21st')).toBe(true);
    expect(taken.has('Aldous of Hesk the 21th')).toBe(false);
  });

  it('numbers a name the chronicle can speak: third of that name', () => {
    expect(ordinalSuffix(1)).toBe('first');
    expect(ordinalSuffix(3)).toBe('third');
    expect(ordinalSuffix(9)).toBe('ninth');
    expect(ordinalSuffix(14)).toBe('14th');
  });

  it('hands back the plain name when nobody has it', () => {
    const name = uniqueName('male', new Set(), testRng('unique'));
    expect(name).not.toContain(' the ');
  });

  it('settles a repeat outside the house with a byname, never a number', () => {
    const base = uniqueName('female', new Set(), testRng('unique'));
    const second = uniqueName('female', new Set([base]), testRng('unique'));

    expect(second).not.toBe(base);
    expect(second.startsWith(`${base} `)).toBe(true);
    // A village tells two Ursels apart by where one is from or what she is
    // like. `Ursel 788` is a database key, and it is what shipped.
    expect(second).toMatch(/^\S+ (of .+|the .+)$/);
    expect(second).not.toMatch(/\d/);
  });

  it('takes the byname from where the person is from, when it knows', () => {
    const base = uniqueName('male', new Set(), testRng('unique'));
    const placed = uniqueName('male', new Set([base]), testRng('unique'), { place: 'Hesk' });
    expect(placed).toBe(`${base} of Hesk`);
  });

  /**
   * INSIDE the house a repeat is dynastic, and the ordinal counts every holder
   * ever — living or dead. `Edric the fourth` is a claim about three dead men,
   * which is the whole reason a family names a boy Edric.
   */
  it('numbers a child of the house against everyone who ever held the name', () => {
    const base = uniqueName('male', new Set(), testRng('unique'));
    const fourth = uniqueName('male', new Set(), testRng('unique'), {
      borne: (b) => (b === base ? 3 : 0),
    });
    expect(fourth).toBe(`${base} the fourth`);
  });

  it('stops counting at the ninth and reaches for a byname instead', () => {
    const base = uniqueName('male', new Set(), testRng('unique'));
    const tenth = uniqueName('male', new Set(), testRng('unique'), {
      borne: (b) => (b === base ? 12 : 0),
    });
    // `ordinalSuffix` prints digits from ten up, and a digit in a person's
    // name is the bug this module was rewritten to kill.
    expect(tenth).not.toMatch(/\d/);
    expect(tenth.startsWith(`${base} `)).toBe(true);
  });

  it('never returns a digit, however crowded the world gets', () => {
    // Eleven hundred people is one thousand-year run. The shipped code put a
    // number in sixty-eight percent of them.
    const taken = new Set<string>();
    const rng = testRng('a whole run');
    for (let i = 0; i < 1200; i++) {
      const name = uniqueName(i % 2 ? 'male' : 'female', taken, rng);
      expect(name, `${name} carries a digit`).not.toMatch(/\d/);
      taken.add(name);
    }
  });

  it('never returns a name already spoken for, however crowded the house', () => {
    // Every name in both lists, plus every ordinal of every one of them.
    const taken = new Set<string>();
    const rng = testRng('crowded');
    for (let i = 0; i < 400; i++) {
      const name = uniqueName(i % 2 ? 'male' : 'female', taken, rng);
      expect(taken.has(name), `${name} was already taken`).toBe(false);
      taken.add(name);
    }
    expect(taken.size).toBe(400);
  });
});


/**
 * RETIREMENT is what keeps the pool from draining. Without it the working set
 * is everyone who has ever lived — eleven hundred people against forty-eight
 * given names — and the first `Garrick 788` was born in 1153.
 */
describe('retiring the names of the dead', () => {
  const row = (name: string, o: { died?: number; alive?: boolean } = {}) =>
    ({ name, alive: o.alive ?? false, ...(o.died !== undefined ? { died: o.died } : {}) });

  it('gives a name back a generation after its holder died', () => {
    const taken = new Set(['Edric']);
    const died = 1200;
    expect(retireNames(taken, [row('Edric', { died })], died + NAME_MOURNING_YEARS - 1)).toEqual([]);
    expect(taken.has('Edric')).toBe(true);

    expect(retireNames(taken, [row('Edric', { died })], died + NAME_MOURNING_YEARS)).toEqual(['Edric']);
    expect(taken.has('Edric')).toBe(false);
  });

  it('keeps a name the living are using', () => {
    // The second Edric was born once the first one's name came free. When the
    // window closes on the FIRST Edric, releasing it again would hand the
    // living one's name out a third time.
    const taken = new Set(['Edric']);
    const freed = retireNames(
      taken,
      [row('Edric', { died: 1200 }), row('Edric', { alive: true })],
      1230,
    );
    expect(freed).toEqual([]);
    expect(taken.has('Edric')).toBe(true);
  });

  it('leaves the living alone', () => {
    const taken = new Set(['Alys']);
    expect(retireNames(taken, [row('Alys', { alive: true })], 1300)).toEqual([]);
    expect(taken.has('Alys')).toBe(true);
  });
});

describe('the founding and naming pages speak the reader\'s setting (#751)', () => {
  const PAGES: Record<string, [string, string]> = {
    'founding.debt_title': ['A Debt of Three Parts', 'A Three-Part Debt'],
    'founding.debt': [
      'In the year 1042 {FOUNDER} signed something, and the house has been paying for it ever since.',
      'In 1042, {FOUNDER} signed an agreement, and the family has been paying for it ever since.',
    ],
    'founding.debt_unnamed': [
      'In the year 1042 the head of the house signed something, and the house has been paying for it ever since.',
      'In 1042, the head of the family signed an agreement, and the family has been paying for it ever since.',
    ],
    'naming.named': ['{NAME} was born, and named.', '{NAME} was born and given a name.'],
  };
  const variants = Object.entries(PAGES).map(([key, [original, plain]]) => ({
    address: coreMessageAddress(key), of: proseOriginalHash(original), plainenglish: plain,
  }));
  const founder = () => bundle.characters.find((c) => c.becomesGuardian)!.name;
  const founding = (ctx: ReturnType<typeof bootstrap>) => ctx.world.chronicle.find((e) => e.year === 1042 && e.weight === 'illuminated')!;

  it('keeps the founding page Original byte for byte', () => {
    const page = founding(bootstrap(bundle, 1042, 1042));
    expect(page.title).toBe('A Debt of Three Parts');
    expect(page.text).toBe(`In the year 1042 ${founder()} signed something, and the house has been paying for it ever since.`);
  });

  it('writes the founding page in the setting the host chose before the run began', () => {
    const direct = bootstrap(bundle, 1042, 1042, 'long', [], undefined, createProseRuntime('plainenglish', variants));
    expect(founding(direct).title).toBe('A Three-Part Debt');
    expect(founding(direct).text)
      .toBe(`In 1042, ${founder()} signed an agreement, and the family has been paying for it ever since.`);

    // The session is the door a client uses, and it chose the wording AFTER
    // bootstrap — so the first page of every run was Original whatever the player picked.
    const session = newGame(bundle, { proseMode: 'plainenglish', proseVariants: variants });
    expect(founding(session.ctx).text).toBe(founding(direct).text);
    // Words only: the same seed founds the same house either way.
    const plain = saveGame(direct);
    const original = saveGame(bootstrap(bundle, 1042, 1042));
    const strip = (s: typeof plain) => JSON.parse(JSON.stringify(s, (key, value: unknown) =>
      key === 'savedAt' || key === 'title' || key === 'text' ? undefined : value)) as unknown;
    expect(strip(plain)).toEqual(strip(original));
  });

  it('writes the naming line in the reader\'s setting and keeps it', () => {
    for (const mode of ['original', 'plainenglish'] as const) {
      const ctx = untilBirth();
      ctx.prose = createProseRuntime(mode, variants);
      const target = ctx.world.pendingNames[0]!.person;
      expect(renameChild(ctx, target, 'Sorrel')).toBe(true);
      const line = ctx.world.chronicle.at(-1)!;
      expect(line.text).toBe(mode === 'original' ? 'Sorrel was born, and named.' : 'Sorrel was born and given a name.');
      setProseMode(ctx, mode === 'original' ? 'plainenglish' : 'original');
      expect(loadGame(saveGame(ctx), bundle).world.chronicle.at(-1)!.text).toBe(line.text);
    }
  });
});
