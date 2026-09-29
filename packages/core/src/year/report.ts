import type { FrameEntry, Person, PersonId } from '@ed/schema';
import type { PendingDecision } from '../events/decisions.js';
import type { ResolvedEvent } from '../events/effects.js';
import type { AssizeReport } from '../assize.js';
import type { Bearing } from '../bearing.js';
import type { HouseAscension } from '../ascension.js';
import type { LandRiskResult } from '../land.js';

/** What a year did. The only thing `stepYear` returns, and every phase writes to it. */
export interface YearReport {
  year: number;
  births: Person[];
  deaths: Person[];
  awakenings: Person[];
  agesBegan: string[];
  agesEnded: string[];
  agesNamed: string[];
  resolved: ResolvedEvent[];
  /** Decisions raised this year: choices, missions, and Record blocks. */
  pending: PendingDecision[];
  /**
   * Set when the year did NOT turn because the docket was not empty. A silent
   * no-op is the failure mode this codebase actually has, so it is said out
   * loud rather than inferred from the year not changing.
   */
  blocked?: PendingDecision[];
  /** Cadet branches founded this year (concept §16). */
  branchesFounded: string[];
  /**
   * Books finished this year — the years were spent when the study began.
   *
   * Carries the reader's ID as well as their name because this is what the
   * passage log draws a study line from (issue #82), and a log line a player
   * cannot click through to a person is a fact about nobody.
   */
  studiesFinished: { person: PersonId; name: string; book: string }[];
  /**
   * Service that ended this year (issue #87). Carries every ending, including
   * the ones the chronicle deliberately does not write down — the passage log
   * is where a house losing four retainers to one man's death is visible at
   * all, and it is visible nowhere else.
   */
  serviceEnded: { person: PersonId; text: string }[];
  /** Set on the single year the Narrator stops being a person. */
  guardianCrossed?: Person;
  /** Set on the years the frame cuts to 1542 (concept §2, issue #13). */
  frame?: FrameEntry;
  /**
   * What the world made of the house this year, and what it did about it
   * (`assize.ts`). Always present — the reading is taken every year even in the
   * eleven years out of twelve when nothing comes of it, because a client
   * showing the player which way the wind is blowing needs it every year.
   */
  assize?: AssizeReport;
  /** How the world has come to read the house's carriage (`bearing.ts`, §29). */
  bearing?: Bearing;
  /** Where the house stands on the ladder (`ascension.ts`, concept §22). */
  ascension?: HouseAscension;
  /**
   * What the ground did to the house this year (`tickLandRisks`, issue #100):
   * the village harvest and every holding a risk struck. Set on every year the
   * `land` phase ran. The chronicle carries the same losses as prose; this is
   * the copy a tool can count without reading English (issue #276).
   */
  landRisks?: LandRiskResult;
}

export function emptyReport(year: number): YearReport {
  return {
    year,
    births: [], deaths: [], awakenings: [],
    agesBegan: [], agesEnded: [], agesNamed: [],
    resolved: [], pending: [], branchesFounded: [], studiesFinished: [], serviceEnded: [],
  };
}
