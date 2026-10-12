<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import type { FrameEntry } from '@ed/schema';
import type { GameActions } from '../lib/game';
import { useModal } from '../lib/modal';

const props = defineProps<{ entry: FrameEntry; actions: GameActions }>();

/**
 * Every full-screen dialog shares one focus/keyboard policy. Interlude used
 * to copy that policy with a selector that could tab to disabled or hidden
 * controls; keep the visible Go on button and the reader's return focus, but
 * let the shared trap handle Tab, Escape (including IME), and restoration.
 */
const card = ref<HTMLElement | null>(null);

// An activation burst on the same rendered interlude must not consume the
// next frame scene before Vue has replaced this one. A failed/no-op dismissal
// becomes retryable after a render tick.
let dismissingEntry: FrameEntry | null = null;
function dismissOnce(): void {
  if (dismissingEntry !== null) return;
  const entry = props.entry;
  dismissingEntry = entry;
  try {
    props.actions.dismissInterlude();
  } finally {
    void nextTick(() => {
      if (dismissingEntry === entry) dismissingEntry = null;
    });
  }
}

// App may reuse the modal instance while moving through queued interludes.
// Reset as soon as a different frame entry has rendered.
watch(() => props.entry, () => { dismissingEntry = null; }, { flush: 'post' });
useModal(card, () => dismissOnce());
</script>

<template>
  <!-- THE FRAME IS QUIETER THAN THE TALE (concept §24). One interlude is held
       with the family out of the way and nothing to click but the way back:
       the temperature change IS the feature. A long jump does not stop here —
       twenty of these in a row is a column of panels, not an interruption. -->
  <div class="scrim" @click="dismissOnce()">
    <!-- No year in the label. `FrameEntry.year` is the simulated year this was
         SHOWN at — "pacing, not diegetic time" — and the frame is the collection looking
         back, so a date here would announce one the frame does not claim. -->
    <article
      ref="card"
      class="interlude"
      role="dialog"
      aria-modal="true"
      aria-label="an interlude"
      @click.stop
    >
      <p>{{ entry.text }}</p>
      <button class="quiet small" @click="dismissOnce()">Go on</button>
    </article>
  </div>
</template>

<style scoped>
.scrim {
  position: fixed; inset: 0; z-index: 20;
  background: color-mix(in srgb, var(--vellum-deep) 88%, transparent);
  display: grid; place-items: center; padding: 40px;
  /* NO OVERLAY HONOURED THE SAFE AREA (issue #106). See `Book.vue` for why
     these fall back to nothing on a device with no notch to clear. */
  padding-top: max(40px, env(safe-area-inset-top));
  padding-bottom: max(40px, env(safe-area-inset-bottom));
  padding-left: max(40px, env(safe-area-inset-left));
  padding-right: max(40px, env(safe-area-inset-right));
}
.interlude {
  max-width: 56ch; background: var(--vellum-deep);
  border-top: 1px solid var(--rule); border-bottom: 1px solid var(--rule);
  padding: 40px 44px; text-align: center;
}
.interlude p {
  font-size: var(--t-lead); line-height: 1.75; font-style: italic;
  color: var(--ink-soft); margin: 0 0 26px;
}
</style>
