import { describe, expect, it } from 'vitest';
import {
  compareDecisionStreams,
  libraryLines,
  replayLines,
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
