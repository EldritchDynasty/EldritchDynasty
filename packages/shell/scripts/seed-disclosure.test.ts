/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from 'vitest';
import { inspectSeedDisclosure } from '../src/seed-disclosure.mjs';

const seedControls = '<label for="seed">seed</label><input id="seed" type="number">';

function mountStart({ exposed = false, toggleWorks = true, hidesAfterClosing = true } = {}) {
  document.body.innerHTML = `
    <main class="start">
      <h1>Eldritch Dynasty</h1>
      <div class="advanced">
        <button aria-expanded="false">Advanced</button>
        <div class="controls"></div>
      </div>
    </main>`;
  const button = document.querySelector('.advanced > button')!;
  const controls = document.querySelector('.controls')!;
  if (exposed) controls.innerHTML = '<div hidden>' + seedControls + '</div>';

  if (toggleWorks) {
    button.addEventListener('click', () => {
      const opening = button.getAttribute('aria-expanded') === 'false';
      button.setAttribute('aria-expanded', opening ? 'true' : 'false');
      button.textContent = opening ? 'Hide advanced' : 'Advanced';
      if (opening) controls.innerHTML = seedControls;
      else if (hidesAfterClosing) controls.innerHTML = '';
    });
  }
}

beforeEach(() => { document.body.innerHTML = ''; });

describe('installed game Start smoke (#718)', () => {
  it('verifies the seed is absent until Advanced opens and disappears again on close', async () => {
    mountStart();
    expect(await inspectSeedDisclosure(document)).toBe('ok');
    expect(document.querySelector('input#seed')).toBeNull();
  });

  it('rejects a seed field hidden only with CSS before the user opens Advanced', async () => {
    mountStart({ exposed: true });
    expect(await inspectSeedDisclosure(document)).toBe('seed is exposed before Advanced is opened');
  });

  it('rejects an Advanced disclosure that cannot show the seed input', async () => {
    mountStart({ toggleWorks: false });
    expect(await inspectSeedDisclosure(document)).toBe(
      'opening Advanced did not reveal the numeric seed control',
    );
  });

  it('rejects an Advanced disclosure that leaves seed visible when closed', async () => {
    mountStart({ hidesAfterClosing: false });
    expect(await inspectSeedDisclosure(document)).toBe(
      'closing Advanced did not hide the seed control',
    );
  });

  it('rejects a missing Start screen instead of silently checking another view', async () => {
    document.body.innerHTML = '<main class="prologue">Not the Start screen</main>';
    expect(await inspectSeedDisclosure(document)).toBe('the game Start screen is missing');
  });

  it('rejects Advanced missing from the game Start screen', async () => {
    document.body.innerHTML = '<main class="start"><h1>Eldritch Dynasty</h1></main>';
    expect(await inspectSeedDisclosure(document)).toBe(
      'the Start screen has no closed Advanced disclosure',
    );
  });
});
