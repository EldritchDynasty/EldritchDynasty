import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { EventTemplateS, SeedPersonS, type ProseMode, type SavedGame } from '@ed/schema';
import { newGame, resumeGame } from './session.js';
import { replay } from './replay.js';
import { canonical, saveGame } from './save.js';

const bundle = loadContent().bundle;
const house = bundle.prologue[0]!.grudges[0]!.house;
// An ordinary event supplies completed learning and a directed grievance.
// No live world is edited, no threat is inserted, and no dice are replaced.
const introduction = EventTemplateS.parse({
  id: 'security_reader_fixture', title: 'A Reader Is Ready', tier: 'family', frequency: 'common',
  weight: 1e9, repeatable: false,
  purposes: ['test_magic_rule', 'worldbuild_through_action', 'change_relationship'],
  conditions: { all: [{ year: { op: 'lte', value: 1050 } }, { grudgeAgainstUs: { op: 'gte', value: 0 } }] },
  slots: { READER: { role: 'tutor', filters: [{ sex: 'female' }] }, ENEMY: { role: 'rival' } },
  body: 'The reader opens the primer.',
  interaction: { kind: 'narration', outcomes: [{ id: 'learned', text: 'The working has been learned.', effects: [
    { kind: 'relationship', from: { slot: 'READER' }, to: { slot: 'ENEMY' }, sentiment: -20,
      grudge: { severity: 80, inheritance: 'none' } },
    { kind: 'awakening', target: { slot: 'READER' } },
    { kind: 'spellbook', op: 'gain', target: { slot: 'READER' }, book: 'lesser_workings_of_life' },
  ] }] },
});
const source = { ...bundle, characters: [...bundle.characters,
  SeedPersonS.parse({ key: 'security_reader', name: 'Maud Threadkeeper', sex: 'female', born: 1007,
    house: 'house_gearithy', castSlots: ['tutor'] }),
  SeedPersonS.parse({ key: 'security_enemy', name: 'Known Hostile Neighbour', sex: 'male', born: 1002,
    house, castSlots: ['rival'] }),
], events: [...bundle.events, introduction] };
const transport = <T>(value: T): T => JSON.parse(JSON.stringify(value));

describe('public household-security commands (#1875)', () => {
  it.each<ProseMode>(['original', 'plainenglish'])('replays and resumes the paid response and actual incident in %s', mode => {
    const game = newGame(source, { seed: 3, decider: 'chronicler', proseMode: mode });
    const prologue = game.prologue()!;
    expect(game.found({ houseName: 'The Guarded House', heirloom: prologue.heirlooms[0]!.heirloom, grudge: house }).ok).toBe(true);
    let checkpoint: SavedGame | undefined;
    let assigned = false;
    let responded = false;
    while (game.year < 1053) {
      const table = game.table();
      const warning = table.security.threats[0];
      if (warning && !assigned) {
        const offer = table.mystic.offers.find(o => o.working === 'the_bedside_thread')!;
        const reader = offer.practitioners[0]!;
        expect(reader.name).toBe('Maud Threadkeeper');
        expect(game.order({ kind: 'mysticAssign', person: reader.person, working: offer.working,
          target: { kind: 'person', person: warning.target } }).ok).toBe(true);
        assigned = true;
        const response = game.table().security.threats[0]!.options.find(o => o.ok && o.order.guards.length === 1 && o.order.response === 'ordinary')!;
        expect(response.price).toBe(8);
        expect(game.order(response.order).ok).toBe(true);
        responded = true;
        checkpoint = transport(game.save());
        expect(checkpoint.covert.threats[0]!.stage).toBe('preparing');
      }
      game.advance(1);
    }
    expect({ assigned, responded }).toEqual({ assigned: true, responded: true });
    const saved = transport(game.save());
    expect(saved.covert.threats[0]).toMatchObject({ stage: 'resolved', observation: { result: 'wounded' } });
    expect(saved.mystic.assignments[0]!.service.protections).toBe(1);
    expect(saved.decisionLog.some(d => d.kind === 'command' && d.command.kind === 'order' && d.command.order.kind === 'covertDefend')).toBe(true);
    const played = replay(source, saved.decisionLog, saved.seed, 1042, saved.year - 1042, saved.campaign);
    expect(canonical(saveGame(played))).toBe(canonical(saved));
    const loaded = resumeGame(checkpoint!, source, { decider: 'chronicler', proseMode: mode });
    while (loaded.year < game.year) loaded.advance(1);
    expect(canonical(loaded.save())).toBe(canonical(saved));
    expect(resumeGame(saved, source, { proseMode: mode === 'original' ? 'plainenglish' : 'original' }).table().security.history)
      .toEqual(game.table().security.history);
  });
});
