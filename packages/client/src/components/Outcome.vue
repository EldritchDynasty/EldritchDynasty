<script setup lang="ts">
import { onMounted, ref } from 'vue';
import type { Outcome } from '../lib/game';

/**
 * WHAT THE ANSWER DID (issue #84).
 *
 * The middle beat of the only loop this game has: decide → see what it did →
 * decide again. It was not implemented. `resolveChoice` returned the rendered
 * outcome prose — the authored sentence with the slots filled — and the store
 * dropped it, so a five-sentence dilemma somebody wrote carefully was answered
 * and the panel was replaced by the next dilemma. 304 times a run.
 *
 * It stands where the decision stood, because that is the whole point: the
 * consequence did reach the chronicle, as one unhighlighted line at the top of
 * a reversed sixty-entry column on the far right of the board, in a year that
 * also carried births, deaths, assize responses and Age namings. Being on the
 * screen somewhere was never the problem.
 *
 * The register is the chronicle's, not the log's: this is the authored
 * sentence, quoted, and the only words this component adds are the ones naming
 * what the player said.
 */
defineProps<{ outcome: Outcome }>();
defineEmits<{ (e: 'dismiss'): void }>();

/**
 * Focus lands on the button that closes this, so the keyboard can read and go
 * on without reaching for the mouse — and so a screen reader is put at the
 * thing to do rather than left where the answered decision used to be.
 */
const go = ref<HTMLButtonElement | null>(null);
onMounted(() => go.value?.focus());
</script>

<template>
  <!-- `assertive`, unlike the docket's `polite` reading: this panel exists
       because the answer was invisible, and waiting for a gap to say so would
       reproduce the bug for exactly the players who can least afford it. -->
  <section class="panel outcome" aria-live="assertive">
    <h3 class="label">{{ outcome.text || outcome.kind === 'record' ? 'What came of it' : 'The choice is made' }}</h3>

    <p v-if="outcome.said" class="dim small said">You said: {{ outcome.said }}</p>

    <p v-if="outcome.text" class="body">{{ outcome.text }}</p>

    <!-- A Record omission has no sentence, and that is the artefact rather
         than a missing value: the book carries a dated blank line where this
         event should have been. Said in words, because a panel that showed
         nothing here would be the bug this component was built to fix. -->
    <p v-else-if="outcome.kind === 'record'" class="body blank">
      The book carries a dated blank line where this would have been. Nothing was written down.
    </p>

    <!-- Some accepted choices have no immediate authored outcome sentence.
         Confirm the act without guessing at hidden callbacks, probabilities,
         or future event timing. The years and the Chronicle remain the only
         honest place for later consequences to become knowable. -->
    <p v-else class="body pending">
      The decision is made. Anything further will show itself as the years advance.
    </p>

    <button ref="go" class="primary" @click="$emit('dismiss')">Go on</button>
  </section>
</template>

<style scoped>
.outcome { max-width: 72ch; }
.said { margin: 0 0 8px; font-style: italic; }
.body { font-size: var(--t-body); line-height: 1.62; margin: 0 0 14px; }
/* An omission is the one thing here the house chose not to say. It reads as
   an absence rather than as a sentence. */
.blank { color: var(--ink-faint); font-style: italic; }
.pending { color: var(--ink-soft); }
</style>
