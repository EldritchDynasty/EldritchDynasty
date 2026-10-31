import { describe, expect, it } from 'vitest';
import type { ShareCodeProblem } from '@ed/core';
import { shareCodeProblem } from './share-code.js';

describe('share code import name prompts (#1995)', () => {
  it('requests each unnamed friend, not one name for the whole friends category', () => {
    // After a reader supplies a house name, the codec can return just
    // 'friends' even when several members of that roster lack names.
    const problem: ShareCodeProblem = { kind: 'names_needed', missing: ['friends'] };
    expect(shareCodeProblem(problem, 'plainenglish'))
      .toBe('Enter a name for every friend in this code.');
    expect(shareCodeProblem(problem, 'original'))
      .toBe('The code left the friends unnamed. Give each one a name.');
  });

  it('preserves precise singular and multi-category prompts', () => {
    const house: ShareCodeProblem = { kind: 'names_needed', missing: ['house'] };
    expect(shareCodeProblem(house, 'plainenglish'))
      .toBe('Enter the missing name: the family name.');
    expect(shareCodeProblem(house, 'original'))
      .toBe("The code left a name out. Give the house's name.");

    const multiple: ShareCodeProblem = { kind: 'names_needed', missing: ['house', 'friends'] };
    expect(shareCodeProblem(multiple, 'plainenglish'))
      .toBe("Enter the missing names: the family name and each friend's name.");
    expect(shareCodeProblem(multiple, 'original'))
      .toBe("The code left names out. Give the house's name and each friend's name.");
  });
});
