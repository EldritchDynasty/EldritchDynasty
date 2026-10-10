<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import type { FrameEntry } from '@ed/schema';
import type { GameActions } from '../lib/game';

const props = defineProps<{ entry: FrameEntry; actions: GameActions }>();

/**
 * THE ONE PLACE THE CLIENT COULD TRAP SOMEBODY (issue #58).
 *
 * A fixed full-viewport scrim at `z-index: 20` with no `role`, no Escape, and
 * no focus handling at all. Focus stayed wherever it had been — behind the
 * scrim, on controls a keyboard player could still tab to and still activate
 * and could no longer see — and there was no key that would close this. The
 * frame is quieter than the tale, and for them it was permanent.
 *
 * So: a real dialog. Focus moves in on open, is held while it is up, and goes
 * back where it came from on close.
 */
const card = ref<HTMLElement | null>(null);
const goOn = ref<HTMLButtonElement | null>(null);
/** Whoever had it before this took the screen. Returned to on close. */
let cameFrom: HTMLElement | null = null;

/** Everything inside that can hold focus, in document order. */
function focusable(): HTMLElement[] {
  if (!card.value) return [];
  return [...card.value.querySelectorAll<HTMLElement>(
    'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
  )];
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault();
    // One held key must dismiss at most one overlay, even when another mounts.
    if (e.repeat) return;
    props.actions.dismissInterlude();
    return;
  }
  if (e.key !== 'Tab') return;

  // The trap. Tab out of either end and you come back in the other — without
  // it, focus walks out of the dialog and onto the board behind the scrim,
  // which is exactly the state this component used to leave people in.
  const inside = focusable();
  if (!inside.length) {
    e.preventDefault();
    return;
  }
  const first = inside[0]!;
  const last = inside[inside.length - 1]!;
  const here = document.activeElement;
  if (e.shiftKey && (here === first || !card.value?.contains(here))) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (here === last || !card.value?.contains(here))) {
    e.preventDefault();
    first.focus();
  }
}

onMounted(() => {
  // NOT `activeElement instanceof HTMLElement`, which is the obvious line and
  // is wrong: with nothing focused, `document.activeElement` is `<body>` —
  // itself an HTMLElement — so `cameFrom` became the body, `body.focus()` on
  // the way out was a no-op that left `activeElement === cameFrom`, and the
  // "it worked" branch returned before the fallback could run. Focus stayed on
  // the body every time, which is exactly the state this component exists to
  // prevent, arrived at through the code that was supposed to prevent it.
  const active = document.activeElement;
  cameFrom = active instanceof HTMLElement && active !== document.body ? active : null;
  goOn.value?.focus();
  window.addEventListener('keydown', onKey);
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey);
  const back = cameFrom;
  // After the frame, so the board this is handing focus to has re-rendered.
  requestAnimationFrame(() => {
    // Often it is not there any more. An interlude arrives BECAUSE years
    // turned, and the clock button that was under the player's hands is
    // frequently disabled by a docket, or a fresh node, by the time this runs
    // — and `focus()` on either quietly does nothing, dropping focus on
    // `body`. A keyboard player then tabs in from the top of the page, which
    // is the same lost-in-the-dark this component was fixed to stop.
    if (back?.isConnected && !back.hasAttribute('disabled')) {
      back.focus();
      if (document.activeElement === back) return;
    }
    document.querySelector<HTMLElement>(
      '.clock button:not([disabled]), .board button:not([disabled])',
    )?.focus();
  });
});
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
      aria-label="an interlude"
      @click.stop
    >
      <p>{{ entry.text }}</p>
      <button ref="goOn" class="quiet small" @click="actions.dismissInterlude()">Go on</button>
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
