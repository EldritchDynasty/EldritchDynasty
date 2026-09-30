import { describe, expect, it } from 'vitest';
import {
  compareDecisionStreams,
  concentrationLines,
  libraryLines,
  replayLines,
  shapeConcentration,
  type DecisionVisit,
} from './replay-divergence.js';

describe('replay divergence comparison (#272)', () => {
  it('measures B against ids already seen in A and locates the first new decision', () => {
    const a: DecisionVisit[] = [
      { id: 'bread', year: 1044 },
      { id: 'book', year: 1048 },
      { id: 'bell', year: 1050 },
    ];
    const b: DecisionVisit[] = [
      { id: 'book', year: 1043 },
      { id: 'bread', year: 1045 },
      { id: 'door', year: 1049 },
      { id: 'bell', year: 1052 },
    ];

    expect(compareDecisionStreams(a, b)).toEqual({
      compared: 4,
      repeatedIds: 3,
      idOverlap: 0.75,
      firstNewIndex: 2,
      firstNewYear: 1049,
    });
  });

  it('accepts #271 shapeOf as a dependency without defining a second shape vocabulary', () => {
    const a: DecisionVisit[] = [{ id: 'a', year: 1 }, { id: 'b', year: 2 }];
    const b: DecisionVisit[] = [{ id: 'c', year: 3 }, { id: 'd', year: 4 }];
    const shapes: Record<string, string> = { a: 'choose', b: 'record', c: 'choose', d: 'match' };

    expect(compareDecisionStreams(a, b, (decision) => shapes[decision.id]!)).toMatchObject({
      idOverlap: 0,
      shapeOverlap: 0.5,
      firstNewIndex: 0,
    });
  });

  it('formats deterministic report rows without playing a run', () => {
    const reading = compareDecisionStreams(
      [{ id: 'old', year: 1042 }],
      [{ id: 'old', year: 1043 }, { id: 'new', year: 1044 }],
    );
    expect(replayLines([{ a: 901, b: 902, opening: reading, overall: reading }])).toEqual([
      'pair     B first 30 in A  B overall in A  first new B decision',
      '-------  ---------------  --------------  --------------------',
      '901→902  50%              50%             #2 (1044)           ',
      'mean     50%              50%                                 ',
    ]);
    expect(libraryLines({
      sourceEntries: 12,
      inheritedMemories: 4,
      since: 1042,
      surfaced: 'Abroad / SessionView.tales',
    })).toContain('  inherited memories at founding: 4');
  });

  it('prints the shape columns only when every reading carries a shape', () => {
    const a = [{ id: 'old', year: 1042, shape: '[money]' }];
    const b = [{ id: 'old', year: 1043, shape: '[money]' }, { id: 'new', year: 1044, shape: '[lasting | money]' }];
    const reading = compareDecisionStreams(a, b, (visit) => visit.shape!);
    const lines = replayLines([{ a: 901, b: 902, opening: reading, overall: reading }]);
    expect(lines[0]).toContain('shape first 30');
    expect(lines[2]).toBe('901→902  50%              50%             50%             50%            #2 (1044)           ');

    // One row without shapes: the columns go rather than printing it as 0%.
    const bare = compareDecisionStreams(a, b);
    const mixed = replayLines([
      { a: 901, b: 902, opening: reading, overall: reading },
      { a: 903, b: 904, opening: bare, overall: bare },
    ]);
    expect(mixed[0]).not.toContain('shape');
  });
});

describe('shape concentration (#341)', () => {
  const v = (id: string, shape: string): DecisionVisit => ({ id, year: 1100, shape });
  // Run A asks the race twice and the book once; run B asks the race again,
  // a NEW event with the race's shape, and a new event with a new shape.
  const a = [v('race', '[lasting+money | money]'), v('race', '[lasting+money | money]'), v('book', '[lasting | relationship]')];
  const b = [v('race', '[lasting+money | money]'), v('gallery', '[lasting+money | money]'), v('margins', '[lasting+record | relationship]')];

  it('ranks shapes by share, counts the events carrying each, and names the heaviest', () => {
    const c = shapeConcentration([a, b], [[0, 1]]);
    expect(c.choices).toBe(6);
    expect(c.shapes).toBe(3);
    expect(c.events).toBe(4);
    expect(c.top[0]).toEqual({
      shape: '[lasting+money | money]', count: 4, share: 4 / 6, events: 2,
      heaviest: [{ id: 'race', fires: 3 }, { id: 'gallery', fires: 1 }],
    });
    // A tie on count breaks on the shape key, so the table never reorders itself.
    expect(c.top.slice(1).map((row) => row.shape)).toEqual(['[lasting | relationship]', '[lasting+record | relationship]']);
    expect(c.moneyInTop).toBe(1);
  });

  it('counts a new event asking a question run A already asked, and only that', () => {
    const c = shapeConcentration([a, b], [[0, 1]]);
    // race: A showed the event. margins: A never showed the shape. gallery: new event, old shape.
    expect(c.familiar).toEqual({
      compared: 3, count: 1, share: 1 / 3,
      top: [{ shape: '[lasting+money | money]', count: 1, share: 1 }],
    });
  });

  it('prints the same table every time, and refuses a stream read without shapes', () => {
    const c = shapeConcentration([a, b], [[0, 1]]);
    expect(concentrationLines(c)).toEqual(concentrationLines(shapeConcentration([a, b], [[0, 1]])));
    expect(concentrationLines(c)[0]).toBe('Shape concentration: 6 choices, 3 distinct shapes, 4 distinct events');
    expect(() => shapeConcentration([[{ id: 'x', year: 1100 }]], [])).toThrow(/without a shape/);
  });
});
