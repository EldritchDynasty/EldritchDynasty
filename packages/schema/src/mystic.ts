/**
 * #1866 A / #1872 — PROPOSED type contract for the B pilot, not a shipped
 * content collection, command, saved field or promise of an active effect.
 * B must add Zod validation, references, editor round-trip and runtime readers
 * together. No second learned-spells list: prerequisites read spellsKnown.
 * This file intentionally is not exported from the public schema barrel yet.
 */
import type { AffinityName } from './attributes.js';
import type { SceneSite } from './primordial.js';

export interface MysticWorkingDef {
  id: string;
  name: string;
  affinity: AffinityName;
  /** ALL named books must be completed; raw scores and copies are insufficient. */
  books: string[];
  scope: string;
  preparation: { crowns: number; years: number };
  upkeep: number;
  capacity: 1;
  /** B pilots two distinct existing system readers. Others arrive with readers. */
  benefit:
    | { kind: 'life_care'; mortalityReduction: number; childbirthReduction: number }
    | { kind: 'estate_protection'; conditionLossPrevented: number; maxAcres: number };
  failureConditions: string[];
  /** Both public registers are authored and token-parity validated in B. */
  receipt: { original: string; plain: string };
}

export interface MysticAssignment {
  id: string;
  practitioner: string;
  working: string;
  /**
   * One shared site vocabulary with #1868, never an independent location union.
   * B extends SceneSite for resolved parcel/person/commitment/operation targets
   * before it accepts them. Existing slot references are bound to actual ids.
   */
  target: SceneSite;
  bindings: Record<string, string>;
  started: number;
  ready: number;
  paidPreparation: number;
  /** Last paid year prevents multiple incident readers charging upkeep twice. */
  paidThrough: number;
  status: 'preparing' | 'serving' | 'suspended' | 'ended';
  reason?: string;
}

export interface MysticStudyPause {
  person: string;
  book: string;
  remainingYears: number;
  pausedAt: number;
  assignment: string;
}

/**
 * B adoption contract:
 * - One live duty/person. Quote and every reader share capability/availability:
 *   living world-owned family member; learned books/canLearn; physical presence;
 *   no hostage, away career, deployment or disabling injury; reachable target.
 *   Practice does not call canHoldPost and has no Eldritch/Madness resource.
 * - Resolve presence before mortality, births, land and Muster consume coverage.
 *   Recheck liveness/access at each effect: a cached morning cannot employ a
 *   person killed or departed later that year. Never create an incident to pay
 *   a ward back. Each consumer has a finite nonstacking cap per actual target.
 * - Quote setup, readiness, yearly upkeep, study displacement and expiry before
 *   an order commits. Reserve/pay upkeep once through the economy money path,
 *   before benefits; no borrowing below the debt floor or unpaid free coverage.
 * - Intensive duty pauses study by remaining time, including automatic studies.
 *   Release resumes that time if copy/access still exists; otherwise say why.
 *   Paused study never completes or silently vanishes while serving.
 * - Continuing benefits require the available maintainer on each use. B has no
 *   persistent unattended ward. Suspend and report gaps on death, departure,
 *   captivity, injury, missing access or unpaid upkeep; no annual renewal popup.
 * - Table/session exposes quotes, named scope/target, readiness, payment, pause
 *   and the reason for lost coverage. Orders cancel/reassign through one path;
 *   the client consumes GameSession, and the editor previews the same evaluator.
 * - Persist assignments, pauses, paid years and world-owned ids; bump the next
 *   SAVE_FORMAT at rebase. Older saves start with empty duties/pauses. Log/replay
 *   every player order; save/reload includes effects, costs and rendered receipts.
 * - All deaths still use kill; guardian cannot be a target. Deliberate Mystic
 *   protection precedes primordial assessment. Assize alone reacts to evidence.
 * - Pilot gate: paired actual Short300/Long500 runs, trained/eligible/duty/incident
 *   denominators, net coin and separate opportunity years, useful effect within
 *   ten eligible years. Publish misses and re-plan before C–F; no new routine
 *   docket. Stable per-phase streams, no new draws in measurement observers.
 */
