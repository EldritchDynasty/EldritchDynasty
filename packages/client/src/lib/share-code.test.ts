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

describe('unsupported share-code version refusals (#2139)', () => {
  it('keeps a useful short version number in both reading modes', () => {
    const problem: ShareCodeProblem = { kind: 'unsupported_version', version: '2' };
    expect(shareCodeProblem(problem, 'plainenglish'))
      .toBe('This code uses a format this version cannot read (ED2).');
    expect(shareCodeProblem(problem, 'original'))
      .toBe('That code is written in a hand this game cannot read (ED2).');
  });

  it('does not echo an oversized user-controlled version into either refusal', () => {
    // readShareCode recognises ED<digits>. before checking the code body.
    // A bounded paste may still contain thousands of digits in that prefix.
    const problem: ShareCodeProblem = { kind: 'unsupported_version', version: '9'.repeat(1500) };
    expect(shareCodeProblem(problem, 'plainenglish'))
      .toBe('This code uses a format this version cannot read.');
    expect(shareCodeProblem(problem, 'original'))
      .toBe('That code is written in a hand this game cannot read.');
  });

  it('bounds the label without discarding a concise edition number', () => {
    const longest: ShareCodeProblem = { kind: 'unsupported_version', version: '12345678' };
    const oversized: ShareCodeProblem = { kind: 'unsupported_version', version: '123456789' };
    expect(shareCodeProblem(longest, 'plainenglish')).toContain('(ED12345678)');
    expect(shareCodeProblem(oversized, 'plainenglish')).not.toContain('123456789');
  });
});
