/**
 * Release smoke assertion for the installed game's Start screen (#321/#718).
 *
 * This function deliberately uses only DOM APIs, so Electron can serialize it
 * into the renderer via executeJavaScript without granting Node access. The
 * tested source itself is the function that runs against the installed app.
 */
export async function inspectSeedDisclosure(documentRef, afterToggle = () => new Promise((resolve) => setTimeout(resolve, 0))) {
  const start = documentRef.querySelector('main.start');
  if (!start) return 'the game Start screen is missing';

  const advanced = start.querySelector('.advanced > button');
  if (!advanced || advanced.textContent?.trim() !== 'Advanced') {
    return 'the Start screen has no closed Advanced disclosure';
  }

  const hasSeedField = () => start.querySelector('label[for="seed"]') !== null
    || start.querySelector('input#seed') !== null;
  const mentionsSeed = () => /\bseed\b/i.test(start.textContent ?? '');

  // This catches a CSS-hidden seed too: the label must not exist in the DOM
  // until the player explicitly opens Advanced (Start.vue uses v-if).
  if (hasSeedField() || mentionsSeed() || advanced.getAttribute('aria-expanded') !== 'false') {
    return 'seed is exposed before Advanced is opened';
  }

  advanced.click();
  await afterToggle();
  const label = start.querySelector('label[for="seed"]');
  const input = start.querySelector('input#seed');
  if (!label || label.textContent?.trim().toLowerCase() !== 'seed'
    || !input || input.getAttribute('type') !== 'number'
    || advanced.getAttribute('aria-expanded') !== 'true') {
    return 'opening Advanced did not reveal the numeric seed control';
  }

  advanced.click();
  await afterToggle();
  if (hasSeedField() || mentionsSeed() || advanced.getAttribute('aria-expanded') !== 'false') {
    return 'closing Advanced did not hide the seed control';
  }

  return 'ok';
}
