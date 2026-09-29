<script setup lang="ts">
import { computed, ref } from 'vue';
import type { PrologueView } from '@ed/core';
import type { GameActions } from '../lib/game';
import { initialProloguePresentation, prologueSeenText, revealPrologueBeat } from '../lib/accessibility';

const props = withDefaults(defineProps<{
  prologue: PrologueView;
  actions: GameActions;
  refused: string | null;
  startYear: number;
  skipSeenProse?: boolean;
}>(), {
  skipSeenProse: false,
});

function readingStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

const replayText = prologueSeenText(
  props.prologue.opening,
  props.prologue.triad,
  props.prologue.thesis,
);

/**
 * A DEBT OF THREE PARTS (concept §3, issue #38).
 *
 * Four minutes, non-interactive except for two choices, and the reason the
 * frame has anything to refer back to: twelve to eighteen interludes a run
 * point at a signing, and until this screen the signing had happened
 * off-screen to nobody.
 *
 * It is paced rather than dumped. The triad is announced — three things given,
 * three things owed — and delivered one beat at a time in ascending weight,
 * because the third is the one that hurts and it does not hurt in a list.
 * Nothing here is skippable by accident and everything is skippable on
 * purpose: the reader who wants the whole page can have it in three clicks.
 */
const initial = initialProloguePresentation(
  readingStorage(),
  props.skipSeenProse,
  replayText,
  props.prologue.triad.length,
  props.prologue.inherited !== undefined,
);
const shown = ref(initial.shown);
const houseName = ref('');
const heirloom = ref('');
const grudge = ref('');

/**
 * THE FIVE (`core/src/people/friends.ts`).
 *
 * Five rows, blank, each a name and one of two buttons. Answering is optional
 * and the sign button never waits on it — a player who does not want to put
 * their own life into a game about a family being eaten is a player whose bag
 * is simply empty, and every other thing on this screen still works.
 *
 * The rows carry no explanation of what the names are FOR. The screen asks,
 * the run answers, and it answers in about 1310 with a midwife. Printing "one
 * of these will be reused later" here would spend the whole effect before a
 * year has passed.
 */
const friends = ref(
  Array.from({ length: props.prologue.friendsWanted }, () => ({ name: '', sex: 'female' as 'male' | 'female' })),
);

function on(): void {
  shown.value = revealPrologueBeat(
    readingStorage(),
    replayText,
    shown.value,
    props.prologue.triad.length,
  );
}

/**
 * WHAT THE SIGNING IS STILL WAITING FOR (issue #59).
 *
 * Three requirements, one dead button, and a page long enough that all three
 * are off-screen from it by the time you reach it. This is the first
 * interaction in the game and the last beat of a set piece the frame refers
 * back to across a Long Line, and a player who filled in the house name,
 * scrolled down and found a dead button had been stopped without being told.
 *
 * `Docket.vue` already holds the rule: an unavailable choice is itself
 * information (§16), so it is shown greyed WITH THE REASON rather than
 * filtered away. The button stays disabled — this is the one page in the game
 * that must not be half-answered — and now it says what it wants.
 *
 * In the order they appear above, so the answer doubles as directions.
 */
const wanted = computed(() => {
  const out: string[] = [];
  if (!heirloom.value) out.push('the thing he asked for by name');
  if (!grudge.value) out.push('who paid for the rest of it');
  if (!houseName.value.trim()) out.push('what the family will be called');
  return out;
});

function sign(): void {
  const result = props.actions.found({
    houseName: houseName.value,
    heirloom: heirloom.value,
    grudge: grudge.value,
    friends: friends.value.filter((f) => f.name.trim()),
  });
  // The thesis takes the screen on its own. Landing the reader halfway down
  // the page they were already reading would waste it.
  if (result.ok) window.scrollTo({ top: 0 });
}
</script>

<template>
  <main class="prologue">
    <p v-if="!prologue.founded" class="opening">{{ prologue.opening }}</p>

    <!-- Run-specific Library memory is NOT part of prologueSeenText. A reader
         may fast-reveal an old signing and still meets this new inherited voice. -->
    <aside
      v-if="!prologue.founded && initial.inheritedVisible && prologue.inherited"
      class="inherited"
      aria-label="An inherited account"
    >
      <p class="inherited-line">{{ prologue.inherited.line }}</p>
      <blockquote>{{ prologue.inherited.text }}</blockquote>
      <small>{{ prologue.inherited.bias }}</small>
    </aside>

    <ol v-if="!prologue.founded" class="triad">
      <li v-for="(beat, i) in prologue.triad.slice(0, shown)" :key="i">
        <p class="given">{{ beat.given }}</p>
        <p class="owed">{{ beat.owed }}</p>
      </li>
    </ol>

    <button v-if="shown < prologue.triad.length" class="on" @click="on()">
      {{ shown === 0 ? 'The first thing' : shown === 1 ? 'The second thing' : 'The third thing' }}
    </button>

    <template v-else-if="!prologue.founded">
      <!-- THE TWO CHOICES. Both are simulation inputs: the gift goes into the
           house's hands and the grudge into the world, and at the term the ending
           names which of them the selected line changed. -->
      <section class="choice">
        <h3 class="label">He asked for one thing by name</h3>
        <button
          v-for="option in prologue.heirlooms"
          :key="option.heirloom"
          class="option"
          :class="{ on: heirloom === option.heirloom }"
          :aria-pressed="heirloom === option.heirloom"
          @click="heirloom = option.heirloom"
        >
          <strong>{{ option.name }}</strong>
          <span class="line">{{ option.line }}</span>
          <small class="dim">{{ option.blurb }}</small>
        </button>
      </section>

      <section class="choice">
        <h3 class="label">And somebody paid for the rest of it</h3>
        <button
          v-for="option in prologue.grudges"
          :key="option.house"
          class="option"
          :class="{ on: grudge === option.house }"
          :aria-pressed="grudge === option.house"
          @click="grudge = option.house"
        >
          <strong>{{ option.houseName }}</strong>
          <span class="line">{{ option.line }}</span>
        </button>
      </section>

      <!-- THE LAST QUESTION, and the only one not about the house. It is the
           one place the game reaches outside itself, so it is asked in the
           frame's own voice and never explained. -->
      <section class="choice friends">
        <h3 class="label">And five who were not of his blood</h3>
        <p class="prompt">{{ prologue.friendsPrompt }}</p>
        <div v-for="(friend, i) in friends" :key="i" class="friend">
          <input
            v-model="friend.name"
            maxlength="32"
            :placeholder="`the ${['first', 'second', 'third', 'fourth', 'fifth'][i] ?? 'next'}`"
            :aria-label="`Name the ${['first', 'second', 'third', 'fourth', 'fifth'][i] ?? 'next'} friend`"
          />
          <div class="sex">
            <button
              class="which"
              :class="{ on: friend.sex === 'female' }"
              :aria-pressed="friend.sex === 'female'"
              @click="friend.sex = 'female'"
            >She</button>
            <button
              class="which"
              :class="{ on: friend.sex === 'male' }"
              :aria-pressed="friend.sex === 'male'"
              @click="friend.sex = 'male'"
            >He</button>
          </div>
        </div>
      </section>

      <section class="choice">
        <h3 class="label">The house</h3>
        <p class="prompt">{{ prologue.housePrompt }}</p>
        <input
          v-model="houseName"
          maxlength="48"
          placeholder="what the family will be called"
          aria-label="Name the house"
          @keyup.enter="sign()"
        />
      </section>

      <p v-if="refused" class="rubric small">{{ refused }}</p>

      <button class="primary sign" :disabled="wanted.length > 0" @click="sign()">
        Sign it
      </button>
      <p v-if="wanted.length" class="dim small waiting">
        It wants {{ wanted.join(', and ') }}.
      </p>

    </template>

    <!-- THE LAST LINE, AND IT GETS THE SCREEN. It states the emotional thesis
         of the whole run, every ending reaches back to it, and it is the one
         plain sentence in a screen of elevated prose — which is an effect that
         does not survive being printed above a family tree. -->
    <template v-else>
      <p class="thesis">{{ prologue.thesis }}</p>
      <button class="primary" @click="actions.enter()">{{ startYear }}</button>
    </template>
  </main>
</template>

<style scoped>
.prologue { max-width: 62ch; margin: 0 auto; padding: 70px 26px 90px; }
.opening, .given, .owed {
  font-size: var(--t-body); line-height: 1.8; color: var(--ink-soft);
  margin: 0 0 18px; white-space: pre-line;
}
.inherited {
  margin: 28px 0; padding: 18px 0;
  border-block: 1px solid var(--rule);
}
.inherited-line {
  margin: 0 0 12px; color: var(--ink-soft); font-size: var(--t-card); line-height: 1.7;
}
.inherited blockquote {
  margin: 0 0 10px; color: var(--ink); font-size: var(--t-body);
  line-height: 1.8; font-style: italic; white-space: pre-line;
}
.inherited small { display: block; color: var(--ink-faint); line-height: 1.55; }
.triad { list-style: none; margin: 26px 0 0; padding: 0; counter-reset: beat; }
.triad li {
  border-top: 1px solid var(--rule); padding-top: 18px; margin-bottom: 12px;
}
.given { color: var(--ink); }
.owed { font-style: italic; }
button.on, .on { }
.on { margin-top: 10px; }
.choice { margin-top: 30px; }
.choice .prompt { margin: 0 0 12px; line-height: 1.7; color: var(--ink-soft); font-size: var(--t-card); }
.option {
  display: block; width: 100%; text-align: left; margin-bottom: 8px;
  padding: 10px 12px; line-height: 1.55;
}
.option.on { border-color: var(--rubric); box-shadow: inset 2px 0 0 var(--rubric); }
.option strong { display: block; }
.option .line { display: block; font-size: var(--t-fine); color: var(--ink-soft); margin-top: 3px; }
.option small { display: block; margin-top: 5px; }
input { width: 100%; font-size: var(--t-body); }
/* The last question is two paragraphs and the break between them is the beat
   the whole passage turns on, so it survives the way the opening does. */
.friends .prompt { white-space: pre-line; }
.friend { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; }
.friend input { flex: 1 1 auto; font-size: var(--t-card); }
.sex { display: flex; flex: 0 0 auto; gap: 4px; }
/* `.on` above carries a margin for the triad's advance button; these two sit
   in a row beside an input and must not inherit it. */
.which { padding: 6px 12px; font-size: var(--t-fine); margin-top: 0; }
.which.on { border-color: var(--rubric); box-shadow: inset 2px 0 0 var(--rubric); }
.sign { margin-top: 26px; }
/* With the button, not above the three things it is about — those are already
   off the top of the screen by the time anybody reads this. */
.waiting { margin: 8px 0 0; }
.thesis {
  margin: 34vh 0 46px; font-size: var(--t-head); line-height: 1.6; color: var(--ink);
}
</style>
