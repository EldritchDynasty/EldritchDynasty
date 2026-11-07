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
  const names = missing.map((name) => {
    switch (name) {
      case 'founder': return "the founder's name";
      case 'house': return plain ? 'the family name' : "the house's name";
      case 'friends': return "each friend's name";
      default: return assertNever(name, 'shared name');
    }
  });
  if (names.length <= 1) return names.join('');
  if (names.length === 2) return names.join(' and ');
  return `${names.slice(0, -1).join(', ')}, and ${names.at(-1)}`;
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
    case 'too_long': {
      // The codec supplies a positive integer. Older or hostile platform
      // bridges may not; never interpolate an arbitrary runtime object into
      // the refusal (or let a throwing toString interrupt Start).
      const max = Number.isSafeInteger(problem.max) && problem.max > 0 ? problem.max : null;
      if (max === null) {
        return plain
          ? 'This is too long to be a share code. Copy a shorter code.'
          : 'That is longer than a share code this game can read.';
      }
      return plain
        ? `This is too long to be a share code. Codes are at most ${max} characters.`
        : `That is longer than any code this game writes (${max} characters).`;
    }
    case 'not_a_code':
      return plain ? 'This is not a share code. Share codes start with ED1.' : 'That is not a share code. A code begins ED1.';
    case 'unsupported_version': {
      // The ED version is parsed from pasted text. Do not echo a thousands-digit
      // malformed prefix into the Start screen's refusal message (#2139).
      const label = typeof problem.version === 'string' && /^[0-9]{1,8}$/.test(problem.version)
        ? ` (ED${problem.version})` : '';
      return plain
        ? `This code uses a format this version cannot read${label}.`
        : `That code is written in a hand this game cannot read${label}.`;
    }
    case 'damaged':
      return plain ? 'Part of this code is missing or wrong. Copy the whole code again.' : 'Part of the code is missing or miscopied. Copy it again, whole.';
    case 'other_edition': {
      // A malformed bridge/old client may omit the detailed differences.
      // A refusal must remain useful without inventing a specific mismatch.
      // Array#every skips holes; a sparse list from an optional host used to
      // pass validation, then reach assertNever(undefined) in editionPart.
      const supplied = Array.isArray(problem.differs) ? [...problem.differs] : [];
      const differs = supplied.every((p) => p === 'format' || p === 'content' || p === 'build')
        ? [...new Set(supplied)] : [];
      const parts = differs.map((p) => editionPart(p, plain)).join(', ');
      const detail = parts ? ` (${parts})` : '';
      return plain
        ? `This code was made with a different version of the game${detail}. It would not start the same family, so it cannot be used.`
        : `That code was made by another edition of the game${detail}. It would not begin the same house, so it is not offered.`;
    }
    case 'demonstration':
      return plain ? 'This code is from the demo. Demo codes cannot start a full game.' : 'That code belongs to a Demonstration house, not a full Line. It cannot begin this one.';
    case 'invalid_names':
      return plain
        ? 'Names for a share code must be text, with no more than five friends.'
        : 'The names offered for this code must be words, and no more than five friends may be named.';
    case 'names_needed': {
      // A missing/empty list cannot yield a valid prompt with a missing noun.
      // Do not turn a refusal into an apparent success or echo code text.
      // Spread fills sparse slots with undefined, so every checks each slot.
      // Otherwise nameList could throw instead of showing a safe refusal.
      const supplied = Array.isArray(problem.missing) ? [...problem.missing] : [];
      const missing = supplied.every((name) => name === 'founder' || name === 'house' || name === 'friends')
        ? [...new Set(supplied)] : [];
      if (missing.length === 0) {
        return plain
          ? 'This founding still needs names before it can begin.'
          : 'This house lacks the names it needs before it may begin.';
      }
      // 'friends' is one missing-name category but can mean several people.
      // Counting categories would misleadingly ask for only one name.
      if (missing.length === 1 && missing[0] === 'friends') {
        return plain
          ? 'Enter a name for every friend in this code.'
          : 'The code left the friends unnamed. Give each one a name.';
      }
      const plural = missing.length !== 1;
      return plain
        ? `Enter the missing ${plural ? 'names' : 'name'}: ${nameList(missing, plain)}.`
        : `The code left ${plural ? 'names' : 'a name'} out. Give ${nameList(missing, plain)}.`;
    }
    case 'refused':
      // Core normally supplies the signing validator's own wording. An older
      // adapter or malformed result may supply invisible Unicode (format
      // controls or combining marks). trim() alone misses those; show an
      // actionable fallback instead of blank text. Preserve visible reasons.
      return typeof problem.reason === 'string'
        && /[^\s\p{Default_Ignorable_Code_Point}\p{Cc}\p{Mark}]/u.test(problem.reason)
        ? problem.reason
        : plain
          ? 'This code could not start a game. Check the founding details and try again.'
          : 'That code did not begin a house. Read the founding details and try again.';
    default:
      return assertNever(problem, 'share code problem');
  }
}
