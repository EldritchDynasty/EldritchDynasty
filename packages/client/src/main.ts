import { createApp } from 'vue';
import App from './App.vue';
import { installPlainEnglishCatalogue, installUserContent } from './lib/content.js';
import { loadAccessibility } from './lib/accessibility.js';
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
    let storedProseMode = 'original';
    try { storedProseMode = loadAccessibility(window.localStorage).proseMode; } catch { /* private storage */ }
    if (storedProseMode === 'plainenglish') {
      try {
        await installPlainEnglishCatalogue();
      } catch {
        // This is optional presentation data, not a prerequisite for opening
        // a saved game. Fall back to the bundled Original words and allow a
        // later mode selection to retry loading the translation chunk.
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
