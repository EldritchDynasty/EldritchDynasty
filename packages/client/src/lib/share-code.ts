import type { SharedName, ShareCodeProblem } from '@ed/core';
import type { ProseMode } from '@ed/schema';

/**
 * A SHARE CODE'S REFUSALS, IN THE READER'S WORDS (#1995).
 *
 * Core hands back what was wrong as a closed union and no English, so both
 * reading modes are written here, side by side, and a new kind of refusal
 * fails to compile until it has both.
 */

/** Local, as in `Entry.vue`: only the store imports the simulation's values. */
function assertNever(value: never, what: string): never {
  throw new Error(`unhandled ${what}: ${JSON.stringify(value)}`);
}

function nameList(missing: readonly SharedName[], plain: boolean): string {
  return missing.map((name) => {
    switch (name) {
      case 'founder': return plain ? 'the founder' : "the founder's";
      case 'house': return plain ? 'the family name' : "the house's";
      case 'friends': return plain ? 'every friend' : "each friend's";
      default: return assertNever(name, 'shared name');
    }
  }).join(', ');
}

function editionPart(part: 'format' | 'content' | 'build', plain: boolean): string {
  switch (part) {
    case 'format': return 'save format';
    case 'content': return plain ? 'game content' : 'content';
    case 'build': return plain ? 'game build' : 'build';
    default: return assertNever(part, 'edition part');
  }
}

export function shareCodeProblem(problem: ShareCodeProblem, mode: ProseMode | undefined): string {
  const plain = mode === 'plainenglish';
  switch (problem.kind) {
    case 'empty':
      return plain ? 'Paste a share code first.' : 'There is no code here yet.';
    case 'too_long':
      return plain
        ? `This is too long to be a share code. Codes are at most ${problem.max} characters.`
        : `That is longer than any code this game writes (${problem.max} characters).`;
    case 'not_a_code':
      return plain ? 'This is not a share code. Share codes start with ED1.' : 'That is not a share code. A code begins ED1.';
    case 'unsupported_version':
      return plain
        ? `This code uses a format this version cannot read (ED${problem.version}).`
        : `That code is written in a hand this game cannot read (ED${problem.version}).`;
    case 'damaged':
      return plain ? 'Part of this code is missing or wrong. Copy the whole code again.' : 'Part of the code is missing or miscopied. Copy it again, whole.';
    case 'other_edition': {
      const parts = problem.differs.map((p) => editionPart(p, plain)).join(', ');
      return plain
        ? `This code was made with a different version of the game (${parts}). It would not start the same family, so it cannot be used.`
        : `That code was made by another edition of the game (${parts}). It would not begin the same house, so it is not offered.`;
    }
    case 'demonstration':
      return plain ? 'This code is from the demo. Demo codes cannot start a full game.' : 'That code is from the Demonstration, which is not a house\'s beginning.';
    case 'names_needed':
      return plain
        ? `Enter the missing names: ${nameList(problem.missing, plain)}.`
        : `The code left names out. Give ${nameList(problem.missing, plain)}.`;
    case 'refused':
      // Already the signing's own refusal, worded by core in the reader's mode.
      return problem.reason;
    default:
      return assertNever(problem, 'share code problem');
  }
}
