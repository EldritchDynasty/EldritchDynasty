import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { indexContent, proseOriginalHash } from '@ed/schema';
import { setProseMode, setProseVariants } from './prose.js';
import { coreMessageEntries } from './tools/core-message-audit.js';
import { makeRng } from './rng.js';
import { testWorld } from './testing.js';
import { runYears } from './sim.js';
import { renameChild } from './sim.js';
import { saveGame, loadGame } from './save.js';
import { foundHouse, prologueView } from './prologue.js';
import {
  FRIEND_BLESSING_ATTRS, FRIEND_NAME_CHANCE, FRIEND_SPAN_YEARS, MAX_FRIENDS, applyFriendBlessing,
  claimFriendName, dealWindows, friendBlessing, normaliseFriends, releaseFriendName,
  type FriendName,
} from './people/friends.js';

/**
 * THE FIVE NAMES THE PLAYER GAVE AT THE SIGNING (`people/friends.ts`).
 *
 * The failure this file is really about is the one this repo is built around:
 * a feature that does nothing and looks exactly like a feature that works. A
 * roster that is asked for, stored, saved, and never once handed to anybody in
 * a full campaign passes every other check in the build — nothing throws, the
 * run is healthy, the names simply never arrive. So the last test here plays a
 * founded run to the collection and looks for a stranger wearing one.
 */

const content = indexContent(loadContent());

const FIVE = [
  { name: 'Marisol', sex: 'female' as const },
  { name: 'Tobias', sex: 'male' as const },
  { name: 'Priya', sex: 'female' as const },
  { name: 'Kwame', sex: 'male' as const },
  { name: 'Ines', sex: 'female' as const },
];

/** Five names, all due at once — the windows are dealt separately, and tested so. */
function bag(): FriendName[] {
  return FIVE.map((f) => ({ ...f, dueFrom: 1042 }));
}

describe('claiming a friend’s name', () => {
  /**
   * THE RULE THAT KEEPS EVERY OTHER RUN IN THE GAME IDENTICAL. With no free
   * name of the sex asked for, this must return before it touches the stream —
   * the harness, the digest and every gate bootstrap with an empty bag, and a
   * coin flipped and discarded there would move every number in the game by
   * one draw. `npm run digest` is the check that would catch it; this is the
   * check that says why.
   */
  it('draws no dice at all when the bag holds nothing of that sex', () => {
    const rng = makeRng(7);
    const before = rng.int(1000);
    const rngA = makeRng(7);
    rngA.int(1000);
    expect(claimFriendName([], 'female', new Set(), 1200, rngA)).toBeUndefined();
    expect(claimFriendName([{ name: 'Tobias', sex: 'male', dueFrom: 1042 }], 'female', new Set(), 1200, rngA))
      .toBeUndefined();
    // And a name of the right sex whose year has not come is just as absent.
    expect(claimFriendName([{ name: 'Priya', sex: 'female', dueFrom: 1400 }], 'female', new Set(), 1200, rngA))
      .toBeUndefined();
    // The stream is where it was: the next number is the one it would have
    // been had neither call happened.
    const rngB = makeRng(7);
    rngB.int(1000);
    expect(rngA.int(1000)).toBe(rngB.int(1000));
    expect(before).toBe(makeRng(7).int(1000));
  });

  it('hands out a name of the sex asked for, and only that sex', () => {
    const friends = bag();
    const taken = new Set<string>();
    const seen = new Set<string>();
    // Enough attempts that a one-in-ten roll empties a three-name bag.
    for (let i = 0; i < 400; i++) {
      const got = claimFriendName(friends, 'female', taken, 1200 + i, makeRng(i));
      if (got) seen.add(got);
    }
    expect([...seen].sort()).toEqual(['Ines', 'Marisol', 'Priya']);
  });

  it('spends each name exactly once, and then stops', () => {
    const friends = bag();
    const taken = new Set<string>();
    const handed: string[] = [];
    for (let i = 0; i < 800; i++) {
      const got = claimFriendName(friends, i % 2 ? 'male' : 'female', taken, 1200 + i, makeRng(i));
      if (got) handed.push(got);
    }
    expect(handed.length).toBe(MAX_FRIENDS);
    expect(new Set(handed).size).toBe(MAX_FRIENDS);
    expect(friends.every((f) => f.spentIn !== undefined)).toBe(true);
    // And the bag is now empty, so the no-dice rule above is back in force.
    const rng = makeRng(99);
    expect(claimFriendName(friends, 'female', taken, 1400, rng)).toBeUndefined();
    expect(rng.int(1000)).toBe(makeRng(99).int(1000));
  });

  /**
   * A friend called Edric while a living Edric holds the name: the name cannot
   * be handed out, and a name that cannot be handed out has not been spent.
   * Getting this wrong loses one of five silently — the player's friend is
   * marked used and never appears.
   */
  it('will not hand out a name somebody living already holds, and does not spend it', () => {
    const friends: FriendName[] = [{ name: 'Marisol', sex: 'female', dueFrom: 1042 }];
    const taken = new Set(['Marisol']);
    for (let i = 0; i < 200; i++) claimFriendName(friends, 'female', taken, 1200, makeRng(i));
    expect(friends[0]!.spentIn).toBeUndefined();

    // Released by the death of the holder, it becomes available again.
    taken.delete('Marisol');
    let got: string | undefined;
    for (let i = 0; i < 200 && !got; i++) got = claimFriendName(friends, 'female', taken, 1300, makeRng(i));
    expect(got).toBe('Marisol');
  });

  it('rolls at about the rate it says it does', () => {
    let hits = 0;
    const attempts = 4000;
    for (let i = 0; i < attempts; i++) {
      // A fresh single-name bag each time, so this measures the coin and not
      // the emptying of the bag.
      const friends: FriendName[] = [{ name: 'Marisol', sex: 'female', dueFrom: 1042 }];
      if (claimFriendName(friends, 'female', new Set(), 1200, makeRng(i))) hits += 1;
    }
    const rate = hits / attempts;
    // Three standard errors of a 0.1 coin over 4,000 draws is 0.014.
    expect(Math.abs(rate - FRIEND_NAME_CHANCE), `measured ${rate.toFixed(3)}`).toBeLessThan(0.02);
  });

  it('puts a name back when it is released, and only a spent one', () => {
    const friends = bag();
    friends[0]!.spentIn = 1200;
    expect(releaseFriendName(friends, 'Marisol', 1200)).toBe(true);
    expect(friends[0]!.spentIn).toBeUndefined();
    expect(releaseFriendName(friends, 'Marisol', 1200)).toBe(false);
    expect(releaseFriendName(friends, 'Somebody Else', 1200)).toBe(false);
  });

  /**
   * A friend called Rowan is also a name in `names.ts`'s own pool. Spent in
   * 1050, buried, retired, and handed to an unrelated newborn by `uniqueName`
   * in 1200 — releasing on THAT rename would put the name back in a bag it
   * already came out of, and one arrival would become two.
   */
  it('will not release a name that was spent in some other century', () => {
    const friends: FriendName[] = [{ name: 'Rowan', sex: 'male', dueFrom: 1042, spentIn: 1050 }];
    expect(releaseFriendName(friends, 'Rowan', 1200)).toBe(false);
    expect(friends[0]!.spentIn).toBe(1050);
    expect(releaseFriendName(friends, 'Rowan', 1050)).toBe(true);
  });
});

describe('the windows the five are dealt', () => {
  /**
   * THE FEATURE THIS REPLACED PACED THEM BADLY, and nothing reported it. At a
   * flat ten percent the bag emptied inside the first century — measured, first
   * arrival 1052 and last 1100 — and the rest of the campaign never saw
   * one. What the bands buy is the shape: the names occupy the first half, leaving the second half empty.
   */
  it('deals one name to each band across the span', () => {
    const friends = dealWindows(bag(), 1042, makeRng(3));
    const band = FRIEND_SPAN_YEARS / MAX_FRIENDS;
    const dues = friends.map((f) => f.dueFrom).sort((a, b) => a - b);

    expect(dues[0]).toBeGreaterThanOrEqual(1042);
    expect(dues[dues.length - 1]).toBeLessThan(1042 + FRIEND_SPAN_YEARS);
    // Exactly one to a band, which is what "spread" means and what a plain
    // uniform draw over the span would not give.
    for (const [i, due] of dues.entries()) {
      expect(due).toBeGreaterThanOrEqual(1042 + band * i);
      expect(due).toBeLessThan(1042 + band * (i + 1));
    }
  });

  it('still spans the campaign first half when the player names fewer than five', () => {
    const two = dealWindows(
      [{ name: 'Marisol', sex: 'female', dueFrom: 1042 }, { name: 'Tobias', sex: 'male', dueFrom: 1042 }],
      1042,
      makeRng(3),
    );
    const dues = two.map((f) => f.dueFrom).sort((a, b) => a - b);
    expect(dues[0]).toBeLessThan(1042 + FRIEND_SPAN_YEARS / 2);
    expect(dues[1]).toBeGreaterThanOrEqual(1042 + FRIEND_SPAN_YEARS / 2);
  });

  /**
   * The order the boxes were typed in must not predict the order the names
   * arrive in, or the first friend on the screen is the first to appear in
   * every run of every game — a pattern a player finds in one afternoon.
   */
  it('does not deal the bands in the order they were typed', () => {
    const firstIsFirst = Array.from({ length: 40 }, (_, i) => {
      const dealt = dealWindows(bag(), 1042, makeRng(i));
      const earliest = Math.min(...dealt.map((f) => f.dueFrom));
      return dealt[0]!.dueFrom === earliest;
    }).filter(Boolean).length;
    // One in five if the shuffle is fair; forty of forty if there is no shuffle.
    expect(firstIsFirst).toBeLessThan(20);
    expect(firstIsFirst).toBeGreaterThan(0);
  });

  it('leaves an empty roster alone', () => {
    expect(dealWindows([], 1042, makeRng(1))).toEqual([]);
  });
});

describe('what a friend’s name is worth', () => {
  const content2 = content;
  const genetics = testWorld(content2).genetics;

  it('lifts one or two core attributes, and only core ones', () => {
    const core = new Set<string>(genetics.attributes.filter((a) => a.kind === 'core').map((a) => String(a.id)));
    expect(core.size).toBeGreaterThan(1);

    for (let seed = 0; seed < 200; seed++) {
      const grants = friendBlessing(seed, genetics.attributes, genetics.expected);
      expect(grants.length).toBeGreaterThanOrEqual(FRIEND_BLESSING_ATTRS.min);
      expect(grants.length).toBeLessThanOrEqual(FRIEND_BLESSING_ATTRS.max);
      // Never the same attribute twice — a double draw is a lift of unbounded
      // size wearing the costume of a lift of two.
      expect(new Set(grants.map((g) => g.attr)).size).toBe(grants.length);
      for (const g of grants) {
        expect(core.has(g.attr), `lifted ${g.attr}, which is not a core attribute`).toBe(true);
        expect(g.delta).toBeGreaterThan(0);
      }
    }
  });

  /**
   * INVARIANT 10: anything mapping an attribute onto a real quantity centres on
   * `expected`. A flat "+6" stops meaning anything the next time `gen-loci.mjs`
   * changes how many loci an attribute carries, and nothing would report it.
   */
  it('scales with the population mean rather than a constant', () => {
    const halved = new Map([...genetics.expected].map(([k, v]) => [k, v / 2]));
    for (let seed = 0; seed < 40; seed++) {
      const full = friendBlessing(seed, genetics.attributes, genetics.expected);
      const half = friendBlessing(seed, genetics.attributes, halved);
      expect(half.map((g) => g.attr)).toEqual(full.map((g) => g.attr));
      for (const [i, g] of half.entries()) expect(g.delta).toBeCloseTo(full[i]!.delta / 2, 9);
    }
  });

  it('is the same blessing every time it is asked for', () => {
    expect(friendBlessing(77, genetics.attributes, genetics.expected))
      .toEqual(friendBlessing(77, genetics.attributes, genetics.expected));
  });

  /**
   * Applied to `acquired`, never to the phenotype cache — invariant 6. And it
   * subtracts to exactly nothing, which is what lets `renameChild` hand the
   * lift back without storing what it granted.
   */
  it('goes into the acquired layer and comes back out of it exactly', () => {
    const ctx = testWorld(content2);
    const p = ctx.world.people.living()[0]!;
    const before = { ...p.acquired };
    const grants = friendBlessing(9, genetics.attributes, genetics.expected);

    applyFriendBlessing(p, grants);
    expect(p.acquired).not.toEqual(before);
    for (const g of grants) expect(p.acquired[g.attr]).toBeCloseTo((before[g.attr] ?? 0) + g.delta, 9);

    applyFriendBlessing(p, grants, -1);
    for (const key of new Set([...Object.keys(before), ...Object.keys(p.acquired)])) {
      expect(p.acquired[key] ?? 0).toBeCloseTo(before[key] ?? 0, 9);
    }
  });
});

describe('the roster the signing takes', () => {
  it('trims, drops blanks, and keeps what is left', () => {
    const checked = normaliseFriends(testWorld(content), [
      { name: '  Marisol ', sex: 'female' },
      { name: '', sex: 'male' },
      { name: 'Tobias   Reyes', sex: 'male' },
    ], 1042);
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    expect(checked.friends).toEqual([
      { name: 'Marisol', sex: 'female', dueFrom: 1042 },
      { name: 'Tobias Reyes', sex: 'male', dueFrom: 1042 },
    ]);
  });

  /**
   * Two friends called Sam is a five-name bag that silently holds four: the
   * second can never be handed out, because the first put the name in
   * `takenNames`. It is refused at the door rather than deduplicated quietly,
   * so the player finds out on the screen where they can still fix it.
   */
  it('refuses two friends with the same name, however they were typed', () => {
    const checked = normaliseFriends(testWorld(content), [
      { name: 'Sam', sex: 'female' },
      { name: ' sam ', sex: 'male' },
    ], 1042);
    expect(checked.ok).toBe(false);
    if (checked.ok) return;
    expect(checked.reason).toMatch(/two of them/i);
  });

  it('refuses a sixth, and an essay', () => {
    const six = normaliseFriends(testWorld(content), [...FIVE, { name: 'Ondine', sex: 'female' }], 1042);
    expect(six.ok).toBe(false);
    const essay = normaliseFriends(testWorld(content), [{ name: 'x'.repeat(200), sex: 'female' }], 1042);
    expect(essay.ok).toBe(false);
  });
});

describe('the signing asks, and the world remembers', () => {
  function found(friends?: { name: string; sex: 'male' | 'female' }[]) {
    const ctx = testWorld(content);
    const view = prologueView(ctx)!;
    const result = foundHouse(ctx, {
      houseName: 'Vayne',
      heirloom: view.heirlooms[0]!.heirloom,
      grudge: view.grudges[0]!.house,
      ...(friends ? { friends } : {}),
    });
    return { ctx, result };
  }

  it('asks for them, in the frame’s own voice', () => {
    const view = prologueView(testWorld(content))!;
    expect(view.friendsWanted).toBe(MAX_FRIENDS);
    expect(view.friendsPrompt.length).toBeGreaterThan(80);
  });

  it('keeps the five it was given, and deals them across the first half', () => {
    const { ctx, result } = found(FIVE);
    expect(result.ok).toBe(true);
    expect(ctx.world.friends.map((f) => f.name).sort()).toEqual(FIVE.map((f) => f.name).sort());

    const dues = ctx.world.friends.map((f) => f.dueFrom).sort((a, b) => a - b);
    expect(new Set(dues).size, 'two of the five are due in the same year').toBe(MAX_FRIENDS);
    expect(dues[0]).toBeGreaterThanOrEqual(1042);
    expect(dues[dues.length - 1]).toBeLessThan(1042 + FRIEND_SPAN_YEARS);
  });

  it('founds perfectly well when nobody is named', () => {
    const { ctx, result } = found();
    expect(result.ok).toBe(true);
    expect(ctx.world.friends).toEqual([]);
    expect(ctx.world.founding).toBeDefined();
  });

  /**
   * A founding that half-happened is a run the player cannot restart and
   * cannot fix — the heirloom is in the house's hands, the grudge is in the
   * world, and `foundHouse` will refuse to run again because `w.founding` is
   * set. The roster is checked before any of that is written.
   */
  it('changes nothing at all when the roster is refused', () => {
    const ctx = testWorld(content);
    const view = prologueView(ctx)!;
    // The house holds its Regalia from `houses.yaml` before anybody founds
    // anything, so what is asserted is that the CHOSEN gift never arrived.
    const before = ctx.world.heirlooms.size;
    const gift = view.heirlooms[0]!.heirloom;
    expect(ctx.world.heirlooms.has(gift)).toBe(false);

    const result = foundHouse(ctx, {
      houseName: 'Vayne',
      heirloom: gift,
      grudge: view.grudges[0]!.house,
      friends: [{ name: 'Sam', sex: 'female' }, { name: 'Sam', sex: 'male' }],
    });

    expect(result.ok).toBe(false);
    expect(ctx.world.founding).toBeUndefined();
    expect(ctx.world.friends).toEqual([]);
    expect(ctx.world.heirlooms.size).toBe(before);
    expect(ctx.world.heirlooms.has(gift)).toBe(false);
  });

  it('crosses the save boundary with what it has already spent', () => {
    const { ctx } = found(FIVE);
    ctx.world.friends[1]!.spentIn = 1310;
    const after = loadGame(JSON.parse(JSON.stringify(saveGame(ctx))), content);
    expect(after.world.friends).toEqual(ctx.world.friends);
  });

  /**
   * The save must not SHARE the rows. A save is a snapshot, and one that kept
   * pointing at the live roster would go on spending names after it was taken
   * — a bug that only shows up in a save loaded much later, which is the worst
   * place in this codebase to find one.
   */
  it('takes a snapshot rather than a reference', () => {
    const { ctx } = found(FIVE);
    const saved = saveGame(ctx) as unknown as { friends: FriendName[] };
    ctx.world.friends[0]!.spentIn = 1400;
    expect(saved.friends[0]!.spentIn).toBeUndefined();
  });
});

describe('a name the player refused', () => {
  /**
   * The chronicler names every newborn and the player may overrule it. A
   * friend's name offered and declined has not been used, so it goes back in
   * the bag — the alternative spends one of five on a suggestion the player
   * never accepted, and nothing anywhere would report it.
   */
  it('goes back in the bag when the player renames the child', () => {
    // Play until one of the five has been spent on a child.
    //
    // It used to wait for a child who was BOTH given a friend-name and put on
    // the naming queue, and that intersection all but closed when #62 cut
    // naming from 189 prompts a run to 24: the queue now carries only the
    // heir, a throwback, a broken run of sons. Waiting for a coincidence is
    // not what this test is about.
    //
    // So the child is found by the name they were given, and put on the queue
    // here — which is building the state the test means, and is what
    // `renameChild` needs to have something to refuse.
    //
    // NOT PINNED TO ONE SEED REACHING ONE STATE (this repo's own rule): a
    // friend's name being spent inside two hundred years is common, not a
    // coin flip that deserves a margin, so a handful of seeds is generous
    // rather than a statistical claim — and it is what keeps this test from
    // being retuned every time an unrelated draw upstream (a genome, a
    // meiosis) re-rolls which year the first one lands in.
    let ctx: ReturnType<typeof testWorld> | undefined;
    let offered: { person: string; name: string } | undefined;
    for (const seed of [1042, 7, 13, 29, 101]) {
      ctx = testWorld(content, seed);
      ctx.world.friends = bag();
      for (let y = 0; y < 200 && !offered; y++) {
        runYears(ctx, 1);
        const spent = ctx.world.friends.find((f) => f.spentIn !== undefined);
        const who = spent && ctx.world.people.all().find((p) => p.name === spent.name);
        if (spent && who) offered = { person: who.id, name: spent.name };
      }
      if (offered) break;
    }
    expect(offered, 'none of the five was spent in two hundred years, across five seeds').toBeDefined();
    const world = ctx!.world;

    if (!world.pendingNames.some((n) => n.person === offered!.person)) {
      world.pendingNames.push({
        person: offered!.person,
        born: world.year,
        suggested: offered!.name,
        sex: 'male',
        because: 'the test means this one',
      });
    }

    expect(world.friends.find((f) => f.name === offered!.name)!.spentIn).toBeDefined();
    expect(renameChild(ctx!, offered!.person, 'Wystan')).toBe(true);
    expect(world.friends.find((f) => f.name === offered!.name)!.spentIn).toBeUndefined();
  });
});

describe('the roster refuses in the reader\'s setting (#829)', () => {
  const keyed = coreMessageEntries(readFileSync(new URL('./people/friends.ts', import.meta.url), 'utf8'))
    .filter((entry) => /#friends\.refuse\./.test(entry.address));

  it('keys every refusal', () => {
    expect(Object.fromEntries(keyed.map((entry) => [entry.address.split('#')[1], entry.text]))).toEqual({
      'friends.refuse.too_long': "'{NAME}' is longer than a name",
      'friends.refuse.sex': '{NAME} needs to be one or the other',
      'friends.refuse.duplicate': 'two of them are called {NAME}',
      'friends.refuse.too_many': 'five names, not {COUNT}',
    });
  });

  it('gives a refused roster its Plain English reason, and refuses it all the same', () => {
    const refuse = (mode: 'original' | 'plainenglish') => {
      const ctx = testWorld(content);
      setProseVariants(ctx, keyed.map((entry) => ({
        address: entry.address, of: proseOriginalHash(entry.text), plainenglish: `plain: ${entry.text}`,
      })));
      setProseMode(ctx, mode);
      return [
        normaliseFriends(ctx, [{ name: 'x'.repeat(200), sex: 'female' }], 1042),
        normaliseFriends(ctx, [{ name: 'Sam', sex: 'neither' as 'female' }], 1042),
        normaliseFriends(ctx, [{ name: 'Sam', sex: 'female' }, { name: ' sam ', sex: 'male' }], 1042),
        normaliseFriends(ctx, [...FIVE, { name: 'Ondine', sex: 'female' }], 1042),
      ].map((r) => ({ ok: r.ok, reason: r.ok ? undefined : r.reason }));
    };
    const original = refuse('original');
    expect(original.map((r) => r.reason)).toEqual([
      `'${'x'.repeat(200)}' is longer than a name`, 'Sam needs to be one or the other', 'two of them are called sam',
      'five names, not 6',
    ]);
    expect(refuse('plainenglish')).toEqual(original.map((r) => ({ ...r, reason: `plain: ${r.reason}` })));
  });
});
