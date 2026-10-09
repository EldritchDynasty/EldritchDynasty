import { createApp } from 'vue';
import App from './App.vue';
import { installPlainEnglishCatalogue, installUserContent } from './lib/content.js';
import { loadAccessibility, saveAccessibility } from './lib/accessibility.js';
import { installPlatform, platformForWindow } from './platform.js';
import { installPseudoLocalisation, pseudoLocRequested } from './pseudo-loc.js';
import './styles.css';

const platform = platformForWindow();
installPlatform(platform);

const pseudoRoot = document.querySelector('#app');
if (import.meta.env.DEV && pseudoRoot && pseudoLocRequested(window.location.search)) {
  installPseudoLocalisation(pseudoRoot);
}

function startupFailure(error: unknown): void {
  const root = document.querySelector('#app');
  if (!root) return;
  const heading = document.createElement('h1');
  heading.textContent = 'The added pages cannot be read';
  const detail = document.createElement('pre');
  detail.textContent = error instanceof Error ? error.message : String(error);
  root.replaceChildren(heading, detail);
}

async function boot(): Promise<void> {
  try {
    await installUserContent(platform);
    // Normal Original-mode startup never imports the optional translated
    // catalogue. A returning Plain English reader opts into that extra
    // startup work, before the first GameSession uses the persisted mode.
    let preferences: ReturnType<typeof loadAccessibility> | undefined;
    try { preferences = loadAccessibility(window.localStorage); } catch { /* private storage */ }
    if (preferences?.proseMode === 'plainenglish') {
      try {
        await installPlainEnglishCatalogue();
      } catch {
        // This is optional presentation data, not a prerequisite for opening
        // a saved game. Return to Original just as the in-game selector does;
        // a later selection can retry the translation chunk.
        try {
          saveAccessibility(window.localStorage, { ...preferences, proseMode: 'original' });
        } catch { /* private storage */ }
      }
    }
  } catch (error) {
    startupFailure(error);
    return;
  }

  platform.onBack(() => {
    const dismissible = document.querySelector('[role="dialog"], .keys, .member.open') !== null;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    return dismissible;
  });
  createApp(App).mount('#app');
}

void boot();
