import type { ProseMode } from '@ed/schema';

/**
 * Reader-local shell words. All gameplay and authored text stays with the
 * GameSession; only the labels surrounding those facts belong here.
 */
const COPY = {
  original: {
    noticeDismiss: 'Dismiss',
    ageRegion: 'What matters in these years',
    ageHeading: 'In these years',
    generationHeading: 'This generation',
    generationSince: 'since',
    previousQuestion: 'What became of the last question',
    clockHeading: 'The clock',
    advanceOne: 'A year',
    advanceFive: 'Five',
    advanceGeneration: 'A generation',
    advanceToYear: 'On, to',
    waitingSuffix: 'the year does not turn until it is answered.',
    waitForBlood: 'Wait for the blood',
    helpToggleOpen: 'Reading, marks and keys',
    helpToggleClose: 'Hide reading help',
    startLink: 'Saves & new game',
    helpReading: 'Reading',
    helpMarks: 'Marks',
    helpKeys: 'Keys',
    navHouse: 'The house',
    navTable: 'The table',
    navAbroad: 'Abroad',
    navChronicle: 'The chronicle',
  },
  plainenglish: {
    noticeDismiss: 'Close notice',
    ageRegion: 'Current pressures on the family',
    ageHeading: 'What matters during this period',
    generationHeading: 'Current generation',
    generationSince: 'started in',
    previousQuestion: 'Answer to the previous question',
    clockHeading: 'Advance time',
    advanceOne: 'Advance 1 year',
    advanceFive: 'Advance 5 years',
    advanceGeneration: 'Advance 25 years',
    advanceToYear: 'Advance to',
    waitingSuffix: 'answer these before advancing time.',
    waitForBlood: 'Advance until a man awakens (up to 25 years)',
    helpToggleOpen: 'Reading settings, symbols and keyboard shortcuts',
    helpToggleClose: 'Hide reading settings and help',
    startLink: 'Saved games and new game',
    helpReading: 'Reading settings',
    helpMarks: 'Meaning of symbols',
    helpKeys: 'Keyboard shortcuts',
    navHouse: 'Family',
    navTable: 'Family orders',
    navAbroad: 'Other families and rumours',
    navChronicle: 'Chronicle',
  },
} as const;

export function appShellCopy(mode: ProseMode): typeof COPY[ProseMode] {
  return COPY[mode];
}

/** Keeps queue counts intact while naming their consequences more clearly. */
export function clockBlockers(mode: ProseMode, decisions: number, children: number): string {
  const parts: string[] = [];
  if (mode === 'plainenglish') {
    if (decisions) parts.push(decisions + ' decision' + (decisions === 1 ? '' : 's') + ' awaiting an answer');
    if (children) parts.push(children + ' ' + (children === 1 ? 'child needs' : 'children need') + ' a name');
  } else {
    if (decisions) parts.push(decisions + ' decision' + (decisions === 1 ? '' : 's'));
    if (children) parts.push(children + ' ' + (children === 1 ? 'child' : 'children') + ' waiting');
  }
  return parts.join(' · ');
}

/**
 * A stretch earns its notice once it has lasted this long (issue #1803). A new
 * house begins frozen (the founding generation has not woken yet), and a
 * notice about dead decades in its first year would be noise, not news.
 */
export const FROZEN_NOTICE_YEARS = 10;

export function frozenNoticeShown(frozen: { years: number } | undefined): boolean {
  return frozen !== undefined && frozen.years >= FROZEN_NOTICE_YEARS;
}

/**
 * THE FROZEN LADDER, IN WORDS (issue #1803). Says only what the house knows:
 * no man of the blood has woken, since when, and for how long.
 */
export function frozenLine(mode: ProseMode, since: number, years: number): string {
  if (mode === 'plainenglish') {
    return years > 0
      ? `No man of the family has awakened since ${since} (${years} ${years === 1 ? 'year' : 'years'}). The Ascension Ladder cannot advance until one does.`
      : 'No man of the family has awakened. The Ascension Ladder cannot advance until one does.';
  }
  return years > 0
    ? `No man of the blood has woken since ${since}. The ladder has stood still for ${years} ${years === 1 ? 'year' : 'years'}.`
    : 'No man of the blood has woken. The ladder stands still until one does.';
}
