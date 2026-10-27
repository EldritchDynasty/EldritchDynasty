import type { Content, ContentBundle } from '@ed/schema';
import { dueArcSteps, startArc } from '../events/arcs.js';
import { queueChoice } from '../events/decisions.js';
import { place, testRng, testWorld } from '../testing.js';

/** #1932's constructed pending story, shared by persistence tests and scenarios. */
export function pendingArc(source: Content | ContentBundle) {
  const ctx = testWorld(source, 1932);
  const bindings = {
    TUTOR: place(ctx, { sex: 'male', age: 45, name: 'The tutor' }).id,
    SON: place(ctx, { sex: 'male', age: 8, name: 'The son' }).id,
    ELDER: place(ctx, { sex: 'female', age: 12, name: 'The elder' }).id,
    YOUNGER: place(ctx, { sex: 'female', age: 6, name: 'The younger' }).id,
  };
  const instance = startArc(ctx.content.mustArc('arc_the_tutors_good_years'), ctx, testRng(), bindings)!;
  const step = dueArcSteps(ctx, testRng()).find(s => s.instance.id === instance.id)!;
  const event = ctx.content.mustEvent(step.node.event);
  const pending = queueChoice(ctx, event, event.body, step.fill, step.playerCast, step);
  return { ctx, instance, pending };
}
