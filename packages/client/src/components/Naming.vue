<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { FOUNDER_NAME_MAX as PERSON_NAME_MAX } from '../lib/game';
import type { SessionView } from '@ed/core';
import type { ProseMode } from '@ed/schema';
import type { GameActions } from '../lib/game';

const props = defineProps<{ view: SessionView; actions: GameActions; proseMode?: ProseMode }>();
const plain = computed(() => props.proseMode === 'plainenglish');

const drafts = ref<Record<string, string>>({});
type NamingRefusal = 'empty' | 'length' | 'name' | 'suggestion';
const refusals = ref<Record<string, NamingRefusal>>({});

/** Store an error's meaning, not its wording, so the current refusal follows
 * reader preference changes without losing a name draft or dispatching again. */
function refusalText(kind: NamingRefusal | undefined): string {
  switch (kind) {
    case 'empty':
      return plain.value ? 'Enter a name or use the suggested name.' : 'Enter a name, or let him keep his suggestion.';
    case 'length':
      return plain.value
        ? `Names must be no longer than ${PERSON_NAME_MAX} characters. Try a shorter name.`
        : `A name must be at most ${PERSON_NAME_MAX} characters. Shorten it and try again.`;
    case 'name':
      return plain.value ? 'That name was not accepted. Try another name.' : 'That name could not be accepted. Try a different name.';
    case 'suggestion':
      return plain.value
        ? 'The suggested name was not accepted. Enter a different name.'
        : 'His suggested name could not be accepted. Try naming this child yourself.';
    default:
      return '';
  }
}

// A declined name belongs to one child. Never carry a refusal into a later
// naming offer if that child has left the queue.
watch(() => props.view.namesWanted, (wanted) => {
  const waiting = new Set(wanted.map((child) => child.person));
  for (const person of Object.keys(drafts.value)) {
    if (!waiting.has(person)) delete drafts.value[person];
  }
  for (const person of Object.keys(refusals.value)) {
    if (!waiting.has(person)) delete refusals.value[person];
  }
});

function clearRefusal(person: string): void {
  delete refusals.value[person];
}

// A child must receive one naming order per render, even if Enter and both
// buttons are activated before the parent has refreshed namesWanted.
const submitting = new Set<string>();
function submitOnce(person: string, order: () => boolean, rejection: NamingRefusal): void {
  if (submitting.has(person)) return;
  submitting.add(person);
  try {
    if (order()) {
      delete drafts.value[person];
      clearRefusal(person);
    } else {
      refusals.value[person] = rejection;
    }
  } finally {
    // A refused order can be retried after the next render, and an exception
    // must not leave this child's controls locked forever.
    void nextTick(() => { submitting.delete(person); });
  }
}

/**
 * A QUEUE THAT SAYS HOW LONG IT IS (issue #53).
 *
 * It was a list with no number on it, which is a small thing until you have
 * pressed "a generation" and been handed five children at once — the panel
 * looked the same for one as for five, and the only way to find out was to
 * scroll it.
 */
const waiting = computed(() => props.view.namesWanted.length);

/**
 * NAMING IS THE ONE THING THE PLAYER DOES TO A PERSON rather than to a
 * bloodline, so it stops the clock the way a decision does. The chronicler has
 * a suggestion for every child and the player can take all of them at once —
 * ignoring the offer is a valid way to play, and refusing it forty times is a
 * way of playing too.
 */
function give(person: string): void {
  // Check before validation: the first successful action already cleared its
  // draft, but a second same-tick click must not create a false empty-name error.
  if (submitting.has(person)) return;
  const chosen = (drafts.value[person] ?? '').trim();
  if (!chosen) {
    refusals.value[person] = 'empty';
    return;
  }
  if (chosen.length > PERSON_NAME_MAX) {
    refusals.value[person] = 'length';
    return;
  }
  submitOnce(person, () => props.actions.name(person, chosen),
    'name');
}

/**
 * ACCEPT HIS NAME FOR THIS ONE, and leave the rest of the queue standing.
 *
 * Not `name(person, suggested)`, which reads like the same thing and is not:
 * that path is the REFUSAL path, and it would put the friend-name back in the
 * bag while the child kept it and strip a blessing nobody declined. The verb
 * exists on the session for exactly this reason.
 */
/**
 * IME candidate confirmation also uses Enter. Submitting on keyup would see
 * the release AFTER composition ends and accidentally accept a partial name.
 * The ordinary, non-composing keydown remains a keyboard shortcut for Name.
 */
function submitOnEnter(person: string, event: KeyboardEvent): void {
  if (event.isComposing || event.keyCode === 229 || event.repeat) return;
  give(person);
}

function keep(person: string): void {
  submitOnce(person, () => props.actions.keepSuggestedName(person),
    'suggestion');
}

function keepAll(): void {
  // Keeping the whole queue must not race an individual child's name/Keep.
  if (submitting.size > 0) return;
  const people = props.view.namesWanted.map((child) => child.person);
  for (const person of people) submitting.add(person);
  try {
    props.actions.keepSuggestedNames();
  } finally {
    void nextTick(() => {
      for (const person of people) submitting.delete(person);
    });
  }
}
</script>

<template>
  <section class="panel naming" aria-live="polite">
    <h3 class="label">
      {{ waiting }} {{ waiting === 1 ? 'child' : 'children' }} {{ plain ? (waiting === 1 ? 'needs a name' : 'need names') : 'waiting to be named' }}
    </h3>
    <div v-for="child in view.namesWanted" :key="child.person" class="child">
      <div class="small">
        <span class="dim">{{ child.born }} ·</span>
        {{ child.sex === 'female' ? 'a daughter' : 'a son' }}{{ plain ? ' —' : ',' }}
        <span class="dim">{{ plain ? 'suggested name:' : 'whom he would call' }} {{ child.suggested }}</span>
      </div>
      <!-- WHY THIS ONE (issue #62). Naming was 189 prompts a run because every
           child of the seat raised one; it is now raised only where the child
           is somebody, and this is the difference the player can see. Drawn in
           the engine's words — a client composing its own would be inventing
           facts about a person. -->
      <p class="small because">{{ child.because }}</p>
      <div class="row">
        <input
          v-model="drafts[child.person]"
          :placeholder="child.suggested"
          :aria-label="(plain ? 'Enter a name for the ' : 'Name the ') + (child.sex === 'female' ? 'daughter' : 'son') + ' born in ' + child.born"
          :aria-invalid="Boolean(refusals[child.person])"
          :aria-describedby="refusals[child.person] ? 'naming-refusal-' + child.person : undefined"
          @input="clearRefusal(child.person)"
          @keydown.enter="submitOnEnter(child.person, $event)"
        />
        <button @click="give(child.person)">{{ plain ? 'Use this name' : 'Name' }}</button>
        <!-- Per child, because the daughter and the four sons are not one
             decision. This was all-or-nothing, which made the accept-everything
             button the one a player pressed to get their clock back. -->
        <button class="quiet small" @click="keep(child.person)">
          {{ plain ? 'Use suggested name' : 'Let him name this one' }}
        </button>
      </div>
      <p
        v-if="refusals[child.person]"
        :id="'naming-refusal-' + child.person"
        class="small rubric"
        role="alert"
      >{{ refusalText(refusals[child.person]) }}</p>
    </div>
    <button v-if="waiting > 1" class="quiet small" @click="keepAll()">
      {{ plain ? 'Use all suggested names' : 'Keep the names he suggests' }}
    </button>
  </section>
</template>

<style scoped>
.child { margin-bottom: 14px; }
/* The reason gets the rubric, because it is the whole point of the prompt
   still existing. */
.because { margin: 3px 0 0; color: var(--rubric); font-style: italic; }
.child .row { margin-top: 4px; }
.child input { flex: 1; min-width: 0; }
</style>
