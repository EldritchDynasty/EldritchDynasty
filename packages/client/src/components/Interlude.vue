<script setup lang="ts">
import { ref } from 'vue';
import type { FrameEntry, ProseMode } from '@ed/schema';
import type { GameActions } from '../lib/game';
import { useModal } from '../lib/modal';

const props = defineProps<{ entry: FrameEntry; actions: GameActions; proseMode?: ProseMode }>();

/**
 * Every full-screen dialog shares one focus/keyboard policy. Interlude used
 * to copy that policy with a selector that could tab to disabled or hidden
 * controls; keep the visible Go on button and the reader's return focus, but
 * let the shared trap handle Tab, Escape (including IME), and restoration.
 */
const card = ref<HTMLElement | null>(null);
useModal(card, () => props.actions.dismissInterlude());
</script>

<template>
  <!-- THE FRAME IS QUIETER THAN THE TALE (concept §24). One interlude is held
       with the family out of the way and nothing to click but the way back:
       the temperature change IS the feature. A long jump does not stop here —
       twenty of these in a row is a column of panels, not an interruption. -->
  <div class="scrim" @click="actions.dismissInterlude()">
    <!-- No year in the label. `FrameEntry.year` is the simulated year this was
         SHOWN at — "pacing, not diegetic time" — and the frame is the collection looking
         back, so a date here would announce one the frame does not claim. -->
    <article
      ref="card"
      class="interlude"
      role="dialog"
      aria-modal="true"
      :aria-label="proseMode === 'plainenglish' ? 'Story interlude' : 'an interlude'"
      @click.stop
    >
      <!-- The scene, then the line it pays off (#2615). An interlude saved
           before the body was kept has only its line, and shows only that. -->
      <p v-if="entry.body" class="scene">{{ entry.body }}</p>
      <p>{{ entry.text }}</p>
      <button class="quiet small" @click="actions.dismissInterlude()">{{ proseMode === 'plainenglish' ? 'Continue' : 'Go on' }}</button>
    </article>
  </div>
</template>

<style scoped>
/* A scene and its line (#2615) can outgrow a phone held sideways. `margin:
   auto` on the card centres it as `place-items` did, and unlike it collapses
   to nothing when the card is taller than the scrim, so the top of the scene
   scrolls into view rather than being cut off above it. */
.scrim {
  position: fixed; inset: 0; z-index: 20;
  background: color-mix(in srgb, var(--vellum-deep) 88%, transparent);
  display: grid; overflow-y: auto; padding: 40px;
  /* NO OVERLAY HONOURED THE SAFE AREA (issue #106). See `Book.vue` for why
     these fall back to nothing on a device with no notch to clear. */
  padding-top: max(40px, env(safe-area-inset-top));
  padding-bottom: max(40px, env(safe-area-inset-bottom));
  padding-left: max(40px, env(safe-area-inset-left));
  padding-right: max(40px, env(safe-area-inset-right));
}
.interlude {
  margin: auto; max-width: 56ch; background: var(--vellum-deep);
  border-top: 1px solid var(--rule); border-bottom: 1px solid var(--rule);
  padding: 40px 44px; text-align: center;
}
.interlude p {
  font-size: var(--t-lead); line-height: 1.75; font-style: italic;
  color: var(--ink-soft); margin: 0 0 26px;
}
</style>
