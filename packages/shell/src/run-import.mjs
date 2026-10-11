/**
 * Parse a selected on-disk run at the Electron transport boundary.
 *
 * Only the minimum envelope shape checked by writeSave belongs here.
 * loadGame in core owns schema, migration and semantic validation.
 * A present `null` file must never look like a cancelled file picker.
 */
export function parseImportedRun(text) {
  const save = JSON.parse(text);
  if (save === null || typeof save !== 'object' || Array.isArray(save) || typeof save.format !== 'number') {
    throw new TypeError('a save is an object with a numeric format');
  }
  return save;
}
