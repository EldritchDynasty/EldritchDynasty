import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { HOUSEHOLD_THREAT_SEVERITY } from './covert-lifecycle.js';
import { newGame, resumeGame } from './session.js';
import { replay } from './replay.js';
import { canonical, saveGame } from './save.js';

/**
 * THE FOUNDING GRUDGE, PLAYED (#1943). The built-state suite in
 * `covert.test.ts` proves a grudge against the seat reaches the main hall; this
 * proves an ordinary public session gets there by itself. The real bundle, a
 * public founding on the first grudge that clears the threshold, the
 * chronicler, no fixture event, no inserted threat and no replaced dice.
 *
 * Several seeds and a witness from at least one, rather than one seed pinned to
 * one lucky state. How OFTEN it happens is the batch report's question
 * (`tools/covert-exposure-report.ts`); this asks only whether it can, and
 * whether what happened survives replay and a JSON resume taken mid-plan.
 */
const bundle = loadContent().bundle;
const transport = <T>(value: T): T => JSON.parse(JSON.stringify(value));

describe('the founding grudge reaches the hall in an ordinary public session (#1943)', () => {
  it('a house founded on the Marrow grudge is approached through it, and the record replays and resumes', () => {
    const def = bundle.prologue[0]!;
    const marrow = def.grudges.find(g => g.severity >= HOUSEHOLD_THREAT_SEVERITY)!.house;
    let witnessed = 0;
    for (const seed of [1, 2, 3, 4]) {
      const game = newGame(bundle, { seed, decider: 'chronicler' });
      const prologue = game.prologue()!;
      expect(game.found({ houseName: 'The Remembered House', heirloom: prologue.heirlooms[0]!.heirloom, grudge: marrow }).ok).toBe(true);
      const founding = [...game.ctx.world.relationships.values()].flatMap(r => r.grudges)
        .find(g => g.originEvent === String(def.id))!;
      while (game.year < 1100 && !game.ctx.world.covert.threats.length) game.advance(1);
      const threat = game.ctx.world.covert.threats[0];
      if (!threat) continue;
      witnessed++;
      expect(threat.plan.motive).toEqual({ kind: 'grudge', grudge: founding.id });
      const target = game.ctx.world.people.mustGet(threat.plan.target);
      expect(target.becomesGuardian).toBeFalsy();
      expect(target.castSlots).not.toContain('head');
      const checkpoint = transport(game.save());
      for (let years = 0; years < 3; years++) game.advance(1);
      const saved = transport(game.save());
      expect(saved.covert.threats[0]!.stage).not.toMatch(/preparing|approach/);
      const played = replay(bundle, saved.decisionLog, saved.seed, 1042, saved.year - 1042, saved.campaign);
      expect(canonical(saveGame(played))).toBe(canonical(saved));
      const loaded = resumeGame(checkpoint, bundle, { decider: 'chronicler' });
      while (loaded.year < game.year) loaded.advance(1);
      expect(canonical(loaded.save())).toBe(canonical(saved));
    }
    expect(witnessed).toBeGreaterThan(0);
  });
});
