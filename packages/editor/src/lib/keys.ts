/**
 * WHETHER AN ENTER IS A SUBMISSION (#1303).
 *
 * Enter also confirms an input-method candidate, and its keyup can arrive after
 * `compositionend` — by which time `v-model` has committed the composed text, so
 * a keyup handler names a child with whatever was half-chosen. The game client
 * learned this one field at a time (#1286, #1294, #1296); the editor keeps the
 * rule in one place instead.
 *
 * Only a keydown counts, and not one inside a composition, not the legacy 229
 * process key some browsers still report after `isComposing` turns false, and
 * not a held key repeating an act that cannot be taken back.
 */
export function submitsOnEnter(
  event: Pick<KeyboardEvent, 'type' | 'key' | 'isComposing' | 'keyCode' | 'repeat'>,
): boolean {
  if (event.type !== 'keydown' || event.key !== 'Enter') return false;
  if (event.isComposing || event.keyCode === 229) return false;
  return !event.repeat;
}
