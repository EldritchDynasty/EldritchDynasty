<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue';
import type { ChapterBeat, GameActions } from '../lib/game';
import { chapterReplayDisposition } from '../lib/accessibility';
import { useModal } from '../lib/modal';

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
// Chapter remains mounted while App replaces the head of its queue. A burst of
// button, backdrop and Escape events must not dismiss multiple unseen beats.
let dismissingBeat: ChapterBeat | null = null;
function dismissOnce(): void {
  if (dismissingBeat !== null) return;
  const beat = props.beat;
  dismissingBeat = beat;
  try {
    props.actions.dismissChapter();
  } finally {
    // A refused/no-op dismissal can be retried after Vue updates. Only the
    // dismissal which set this latch may clear it: a later beat may already
    // have auto-skipped during the post-flush watcher.
    void nextTick(() => {
      if (dismissingBeat === beat) dismissingBeat = null;
    });
  }
}
useModal(card, () => dismissOnce());

function readingStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * REPLAY COMPRESSION (#258). Only the nameless opening is passive prose.
 * A closing is a verdict on THIS house and therefore never enters this
 * history. Exact text is the identity on purpose: an edited variant is new
 * prose, even when it came from the same authored Age.
 */
function skipSeenOpening(beat: ChapterBeat): boolean {
  return chapterReplayDisposition(
    readingStorage(),
    props.skipSeenProse,
    beat.kind === 'opening'
      ? { kind: 'opening', text: beat.opening.text }
      : { kind: 'closing' },
  ) === 'skip';
}

onMounted(() => {
  // The shared hook has already installed the keyboard trap, even if this
  // opening is skipped and the same instance later shows the next beat.
  if (skipSeenOpening(props.beat)) dismissOnce();
});

// App keeps the same Chapter component mounted as the chapter queue shifts.
// Checking only onMounted misses every subsequent Age opening: repeats cannot
// be skipped and fresh wording never enters the reader's seen history.
watch(() => props.beat, (beat) => {
  // The successor has actually rendered; a new Age beat may now be dismissed.
  dismissingBeat = null;
  if (skipSeenOpening(beat)) {
    dismissOnce();
    return;
  }
  // A closing and an unseen opening both keep the dialog active. After Vue
  // swaps the card's button, restore keyboard focus inside the active overlay.
  goOn.value?.focus();
}, { flush: 'post' });

</script>

<template>
  <div class="scrim" @click="dismissOnce()">
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
        <button ref="goOn" class="quiet small" @click="dismissOnce()">Go on</button>
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
        <button ref="goOn" class="quiet small" @click="dismissOnce()">
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
