import { describe, expect, it } from 'vitest';
import { SHARE_CODE_MAX, type ShareCodeProblem } from '@ed/core';
import { shareCodeProblem } from './share-code.js';

describe('share-code front-door refusals (#2532)', () => {
  it('asks for an empty input to be filled before import, in both reading modes', () => {
    const problem: ShareCodeProblem = { kind: 'empty' };
    expect(shareCodeProblem(problem, 'plainenglish')).toBe('Paste a share code first.');
    expect(shareCodeProblem(problem, 'original')).toBe('There is no code here yet.');
  });

  it('identifies an invalid code prefix without echoing pasted input', () => {
    const problem: ShareCodeProblem = { kind: 'not_a_code' };
    expect(shareCodeProblem(problem, 'plainenglish'))
      .toBe('This is not a share code. Share codes start with ED1.');
    expect(shareCodeProblem(problem, 'original'))
      .toBe('That is not a share code. A code begins ED1.');
  });

  it('states the actual import length limit in both reading modes', () => {
    const problem: ShareCodeProblem = { kind: 'too_long', max: SHARE_CODE_MAX };
    expect(shareCodeProblem(problem, 'plainenglish'))
      .toBe(`This is too long to be a share code. Codes are at most ${SHARE_CODE_MAX} characters.`);
    expect(shareCodeProblem(problem, 'original'))
      .toBe(`That is longer than any code this game writes (${SHARE_CODE_MAX} characters).`);
  });
});

describe('share code import name prompts (#1995)', () => {
  it('gives a safe, complete refusal when a host omits the missing-name list', () => {
    const incomplete: ShareCodeProblem = { kind: 'names_needed', missing: [] };
    expect(shareCodeProblem(incomplete, 'plainenglish'))
      .toBe('This founding still needs names before it can begin.');
    expect(shareCodeProblem(incomplete, 'original'))
      .toBe('This house lacks the names it needs before it may begin.');
    expect(shareCodeProblem(incomplete, 'original')).not.toContain('undefined');
    // Native/foreign adapters are runtime values despite typed client hooks.
    const missingList = { kind: 'names_needed' } as ShareCodeProblem;
    const invalidList = { kind: 'names_needed', missing: ['raw user text'] } as unknown as ShareCodeProblem;
    expect(shareCodeProblem(missingList, 'plainenglish'))
      .toBe('This founding still needs names before it can begin.');
    expect(shareCodeProblem(invalidList, 'original'))
      .toBe('This house lacks the names it needs before it may begin.');
  });

  it('describes malformed platform name inputs in both reading modes', () => {
    const problem: ShareCodeProblem = { kind: 'invalid_names' };
    expect(shareCodeProblem(problem, 'plainenglish'))
      .toBe('Names for a share code must be text, with no more than five friends.');
    expect(shareCodeProblem(problem, 'original'))
      .toBe('The names offered for this code must be words, and no more than five friends may be named.');
  });

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

describe('share-code refusal wording in both reading modes (#1995)', () => {
  it('does not manufacture a mismatch detail when an older host supplies none', () => {
    const incomplete: ShareCodeProblem = { kind: 'other_edition', differs: [] };
    expect(shareCodeProblem(incomplete, 'plainenglish'))
      .toBe('This code was made with a different version of the game. It would not start the same family, so it cannot be used.');
    expect(shareCodeProblem(incomplete, 'original'))
      .toBe('That code was made by another edition of the game. It would not begin the same house, so it is not offered.');
    const malformed = { kind: 'other_edition', differs: ['untrusted field'] } as unknown as ShareCodeProblem;
    const absent = { kind: 'other_edition' } as ShareCodeProblem;
    expect(shareCodeProblem(malformed, 'original')).toBe(shareCodeProblem(incomplete, 'original'));
    expect(shareCodeProblem(absent, 'plainenglish')).toBe(shareCodeProblem(incomplete, 'plainenglish'));
  });

  it('identifies the incompatible edition fields rather than offering a divergent founding', () => {
    const difference: ShareCodeProblem = {
      kind: 'other_edition',
      differs: ['format', 'content', 'build'],
    };
    expect(shareCodeProblem(difference, 'plainenglish'))
      .toBe('This code was made with a different version of the game (save format, game content, game build). It would not start the same family, so it cannot be used.');
    expect(shareCodeProblem(difference, 'original'))
      .toBe('That code was made by another edition of the game (save format, content, build). It would not begin the same house, so it is not offered.');
  });

  it('distinguishes a damaged code from a demonstration code in each prose mode', () => {
    const damaged: ShareCodeProblem = { kind: 'damaged' };
    const demo: ShareCodeProblem = { kind: 'demonstration' };
    expect(shareCodeProblem(damaged, 'plainenglish'))
      .toBe('Part of this code is missing or wrong. Copy the whole code again.');
    expect(shareCodeProblem(damaged, 'original'))
      .toBe('Part of the code is missing or miscopied. Copy it again, whole.');
    expect(shareCodeProblem(demo, 'plainenglish'))
      .toBe('This code is from the demo. Demo codes cannot start a full game.');
    expect(shareCodeProblem(demo, 'original'))
      .toBe('That code belongs to a Demonstration house, not a full Line. It cannot begin this one.');
  });

  it('keeps the founding validator rejection unchanged in both modes', () => {
    // A name or choice refusal is already worded for the selected mode by
    // the founding validator. The client must not rewrite or hide its detail.
    const refusal: ShareCodeProblem = {
      kind: 'refused',
      reason: 'The named founder cannot make that choice.',
    };
    expect(shareCodeProblem(refusal, 'plainenglish')).toBe(refusal.reason);
    expect(shareCodeProblem(refusal, 'original')).toBe(refusal.reason);
  });

  it('falls back when a validator reason contains only invisible characters', () => {
    // trim() leaves zero-width format marks, bidi controls and combining marks.
    for (const reason of ['\u200b', '\u200d', '\u2060', '\u202e', '\u0301', '\u0000', ' \u200b\u0301']) {
      const problem = { kind: 'refused', reason } as ShareCodeProblem;
      expect(shareCodeProblem(problem, 'plainenglish'))
        .toBe('This code could not start a game. Check the founding details and try again.');
      expect(shareCodeProblem(problem, 'original'))
        .toBe('That code did not begin a house. Read the founding details and try again.');
    }

    // Legitimate explanations, including non-Latin writing, stay verbatim.
    for (const reason of ['  The founder cannot take that oath.  ', '请填写姓名', 'A\u0301 name is required.']) {
      const problem = { kind: 'refused', reason } as ShareCodeProblem;
      expect(shareCodeProblem(problem, 'plainenglish')).toBe(reason);
      expect(shareCodeProblem(problem, 'original')).toBe(reason);
    }
  });

  it('does not echo visible host refusals mixed with hidden or bidirectional controls (#3230)', () => {
    // A visible letter previously let a malformed native refusal through even
    // when a bidi override, zero-width character or control byte was present.
    for (const reason of [
      'Name denied.\u202eWrong direction',
      '\u2066Enter a valid name\u2069',
      'Name\u200b denied.',
      'Name\u0000 denied.',
      'Name\n denied.',
    ]) {
      const problem = { kind: 'refused', reason } as ShareCodeProblem;
      expect(shareCodeProblem(problem, 'plainenglish'))
        .toBe('This code could not start a game. Check the founding details and try again.');
      expect(shareCodeProblem(problem, 'original'))
        .toBe('That code did not begin a house. Read the founding details and try again.');
    }

    // A combining accent attached to a letter remains valid Unicode.
    const valid: ShareCodeProblem = { kind: 'refused', reason: 'A\u0301 name is required.' };
    expect(shareCodeProblem(valid, 'plainenglish')).toBe(valid.reason);
    expect(shareCodeProblem(valid, 'original')).toBe(valid.reason);
  });

  it('keeps a visible refusal when a legacy adapter omits the founding-validator reason', () => {
    // JavaScript and native bridges may return values outside the TypeScript
    // union. A rejection must never silently become an empty status message.
    for (const reason of [undefined, null, '', '   ']) {
      const incomplete = { kind: 'refused', reason } as unknown as ShareCodeProblem;
      expect(shareCodeProblem(incomplete, 'plainenglish'))
        .toBe('This code could not start a game. Check the founding details and try again.');
      expect(shareCodeProblem(incomplete, 'original'))
        .toBe('That code did not begin a house. Read the founding details and try again.');
    }
    // Valid authored refusal text stays exact, including surrounding spaces.
    const authoredReason = '  The founder cannot take that oath.  ';
    const refusal: ShareCodeProblem = { kind: 'refused', reason: authoredReason };
    expect(shareCodeProblem(refusal, 'plainenglish')).toBe(authoredReason);
    expect(shareCodeProblem(refusal, 'original')).toBe(authoredReason);
  });
});


describe('malformed native share-code refusal details (#1995)', () => {
  it('does not coerce an invalid maximum into refusal text', () => {
    const throwing = { toString(): never { throw new Error('untrusted length'); } };
    for (const max of [undefined, null, '99999', NaN, 0, -1, throwing]) {
      const problem = { kind: 'too_long', max } as unknown as ShareCodeProblem;
      expect(shareCodeProblem(problem, 'plainenglish'))
        .toBe('This is too long to be a share code. Copy a shorter code.');
      expect(shareCodeProblem(problem, 'original'))
        .toBe('That is longer than a share code this game can read.');
    }
  });

  it('bounds untrusted version values without invoking their conversion hooks', () => {
    const throwing = { toString(): never { throw new Error('untrusted version'); } };
    for (const version of [undefined, null, 22, throwing]) {
      const problem = { kind: 'unsupported_version', version } as unknown as ShareCodeProblem;
      expect(shareCodeProblem(problem, 'plainenglish'))
        .toBe('This code uses a format this version cannot read.');
      expect(shareCodeProblem(problem, 'original'))
        .toBe('That code is written in a hand this game cannot read.');
    }
  });

  it('requests each missing name category only once', () => {
    const friends = { kind: 'names_needed', missing: ['friends', 'friends'] } as ShareCodeProblem;
    expect(shareCodeProblem(friends, 'plainenglish')).toBe('Enter a name for every friend in this code.');
    expect(shareCodeProblem(friends, 'original')).toBe('The code left the friends unnamed. Give each one a name.');

    const mixed = { kind: 'names_needed', missing: ['house', 'house', 'friends'] } as ShareCodeProblem;
    expect(shareCodeProblem(mixed, 'plainenglish'))
      .toBe("Enter the missing names: the family name and each friend's name.");
    expect(shareCodeProblem(mixed, 'original'))
      .toBe("The code left names out. Give the house's name and each friend's name.");
  });


  it('treats sparse name-category lists as malformed, not as a render exception', () => {
    // every() skips unassigned slots. A host that passes a sparse list must
    // still get an actionable refusal in either prose mode.
    const withHole = new Array<'founder' | 'house' | 'friends'>(2);
    withHole[1] = 'friends';
    for (const missing of [new Array<'friends'>(1), withHole]) {
      const problem = { kind: 'names_needed', missing } as ShareCodeProblem;
      expect(shareCodeProblem(problem, 'plainenglish'))
        .toBe('This founding still needs names before it can begin.');
      expect(shareCodeProblem(problem, 'original'))
        .toBe('This house lacks the names it needs before it may begin.');
    }
  });

  it('treats sparse edition-difference lists as unknown instead of throwing', () => {
    const withHole = new Array<'format' | 'content' | 'build'>(2);
    withHole[1] = 'build';
    const unknown = { kind: 'other_edition', differs: [] } as ShareCodeProblem;
    for (const differs of [new Array<'format'>(1), withHole]) {
      const problem = { kind: 'other_edition', differs } as ShareCodeProblem;
      expect(shareCodeProblem(problem, 'plainenglish'))
        .toBe(shareCodeProblem(unknown, 'plainenglish'));
      expect(shareCodeProblem(problem, 'original'))
        .toBe(shareCodeProblem(unknown, 'original'));
    }
  });

  it('lists duplicated edition mismatch details once', () => {
    const problem = { kind: 'other_edition', differs: ['format', 'format', 'content'] } as ShareCodeProblem;
    expect(shareCodeProblem(problem, 'plainenglish'))
      .toBe('This code was made with a different version of the game (save format, game content). It would not start the same family, so it cannot be used.');
    expect(shareCodeProblem(problem, 'original'))
      .toBe('That code was made by another edition of the game (save format, content). It would not begin the same house, so it is not offered.');
  });
});
