import type { ArcInstance, EventTemplate } from '@ed/schema';

/**
 * WHAT ELSE IS IN THE ROOM when a condition is asked or an effect is applied.
 *
 * Almost everything in the vocabulary is a question about the WORLD — the year,
 * the treasury, how angry the third hall is — and needs nothing but `SimCtx` to
 * answer. Arc memory is the exception, and it is a deliberate one: `arcFlag`
 * asks what THIS RUN OF THIS STORY remembers, and there can be three runs of
 * three stories in flight at once. The question has no answer without knowing
 * which of them is asking.
 *
 * The alternative was promoting story memory to world flags, which is what
 * authors were doing and why the flag namespace filled up with
 * `seal_challenger_paid_1204`. A flag every event in the game can see is not a
 * story remembering something; it is the world remembering it, forever.
 *
 * Absent scope, the arc-shaped questions answer FALSE. Never true — see the
 * comment at the foot of `evalCondition` for what a permissive default costs.
 */
export interface EvalScope {
  /** The substory being advanced, when one is. */
  arc?: ArcInstance;
  /**
   * The template whose outcome is being applied, when one is.
   *
   * A `SlotFill` is `{SLOT: personId}` and nothing more — it says who stands
   * where, never what standing there MEANS. `recast` is the effect that needs
   * the difference: freeing a slot's occupant means dropping the role that
   * slot casts for, and only the template knows that `VESSEL` casts
   * `family_member` while `HEAD` casts `head`. Absent the template the effect
   * does nothing, which is the same choice `arcFlag` makes above — a `recast`
   * that guesses a role frees the wrong person from the wrong chair.
   */
  event?: EventTemplate;
  /**
   * The Chronicle page this authored action is writing, when it writes one.
   *
   * Allocated before effects run so an effect that creates a delayed
   * consequence can remember the page that caused it without allocating a
   * second id or searching the Chronicle afterwards.
   */
  page?: string;
  /** Stable authored address of the Chronicle effect being committed, if any. */
  proseAddress?: string;
}
