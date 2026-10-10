<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import type { ChapterBeat, GameActions } from '../lib/game';
import { chapterReplayDisposition } from '../lib/accessibility';

const props = withDefaults(defineProps<{
  beat: ChapterBeat;
  actions: GameActions;
  skipSeenProse?: boolean;
}>(), {
  skipSeenProse: false,
});

/**
 * THE AGE IS THE SESSION (issue #65).
 *
 * Two faces of one card. An `opening` is the mood of years the family does
 * not have a word for yet — shown once, nameless, when an Age begins (§20 r1:
 * naming it here would print "The Plague" over a year the house only knows as
 * a bad one). A `closing` is the verdict on years that just ended, and it
 * always gets one — every Age closing does, whether or not the span was long
 * enough to be a good stopping point (`ChapterView.boundary`).
 *
 * The dialog mechanics are `Interlude.vue`'s, wholesale — the focus trap,
 * Escape, and the return of focus were solved there the hard way (issue #58),
 * and a second full-screen card in this client does not get to re-learn that
 * lesson from nothing.
 */
const card = ref<HTMLElement | null>(null);
const goOn = ref<HTMLButtonElement | null>(null);
let cameFrom: HTMLElement | null = null;

function readingStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

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
    props.actions.dismissChapter();
    return;
  }
  if (e.key !== 'Tab') return;

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
  } else if (!e.shiftKey && here === last) {
    e.preventDefault();
    first.focus();
  }
}

onMounted(() => {
  /**
   * REPLAY COMPRESSION (#258). Only the nameless opening is passive prose.
   * A closing is a verdict on THIS house and therefore never enters this
   * history. Exact text is the identity on purpose: an edited variant is new
   * prose, even when it came from the same authored Age.
   */
  const replay = chapterReplayDisposition(
    readingStorage(),
    props.skipSeenProse,
    props.beat.kind === 'opening'
      ? { kind: 'opening', text: props.beat.opening.text }
      : { kind: 'closing' },
  );
  if (replay === 'skip') {
    props.actions.dismissChapter();
    return;
  }

  const active = document.activeElement;
  cameFrom = active instanceof HTMLElement && active !== document.body ? active : null;
  goOn.value?.focus();
  window.addEventListener('keydown', onKey);
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey);
  const back = cameFrom;
  requestAnimationFrame(() => {
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
  <div class="scrim" @click="actions.dismissChapter()">
    <article
      ref="card"
      class="chapter"
      role="dialog"
      aria-modal="true"
      :aria-label="beat.kind === 'opening' ? 'an Age begins' : 'an Age closes'"
      @click.stop
    >
      <template v-if="beat.kind === 'opening'">
        <p class="mood">{{ beat.opening.text }}</p>
        <button ref="goOn" class="quiet small" @click="actions.dismissChapter()">Go on</button>
      </template>

      <template v-else>
        <!-- No name is a valid reading, not a gap in the data (§20 r1): the
             family lived through years it never found a word for. -->
        <h2 class="name">{{ beat.view.name ?? 'These years' }}</h2>
        <ul class="verdict">
          <li v-for="(line, i) in beat.view.verdict" :key="i">{{ line.text }}</li>
        </ul>
        <p v-if="beat.view.boundary" class="invitation">
          You can put it down here. The house's memory of these years is kept.
        </p>
        <button ref="goOn" class="quiet small" @click="actions.dismissChapter()">
          {{ beat.view.boundary ? 'Put it down' : 'Read on' }}
        </button>
      </template>
    </article>
  </div>
</template>

<style scoped>
.scrim {
  position: fixed; inset: 0; z-index: 20;
  background: color-mix(in srgb, var(--vellum-deep) 88%, transparent);
  display: grid; place-items: center; padding: 40px;
  padding-top: max(40px, env(safe-area-inset-top));
  padding-bottom: max(40px, env(safe-area-inset-bottom));
  padding-left: max(40px, env(safe-area-inset-left));
  padding-right: max(40px, env(safe-area-inset-right));
}
.chapter {
  max-width: 56ch; background: var(--vellum-deep);
  border-top: 1px solid var(--rule); border-bottom: 1px solid var(--rule);
  padding: 40px 44px; text-align: center;
}
.chapter .mood {
  font-size: var(--t-lead); line-height: 1.75; font-style: italic;
  color: var(--ink-soft); margin: 0 0 26px;
}
.chapter .name {
  font-size: var(--t-card); margin: 0 0 20px; color: var(--ink);
}
.verdict {
  list-style: none; margin: 0 0 22px; padding: 0;
  text-align: left; display: flex; flex-direction: column; gap: 10px;
}
.verdict li {
  font-size: var(--t-body); line-height: 1.6; color: var(--ink-soft);
}
.invitation {
  font-size: var(--t-fine); font-style: italic; color: var(--ink-faint);
  margin: 0 0 22px;
}
</style>
