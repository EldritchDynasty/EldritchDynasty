<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import type { PrologueView } from '@ed/core';
import type { FoundingConfiguration, Gender, ProseMode } from '@ed/schema';
import { FOUNDER_NAME_MAX, founderConfigurationFor, type GameActions } from '../lib/game';
import { initialProloguePresentation, initialPrologueShown, prologueSeenText, revealPrologueBeat } from '../lib/accessibility';

const props = withDefaults(defineProps<{
  prologue: PrologueView;
  actions: GameActions;
  refused: string | null;
  startYear: number;
  skipSeenProse?: boolean;
  proseMode?: ProseMode;
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

const plain = computed(() => props.proseMode === 'plainenglish');

const replayText = computed(() => prologueSeenText(
  props.prologue.opening,
  props.prologue.triad,
  props.prologue.thesis,
));

/**
 * A DEBT OF THREE PARTS (concept §3, issue #38).
 *
 * Four minutes of paced framing before the founding choices, and the reason
 * the frame has anything to refer back to: twelve to eighteen interludes a run
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
  replayText.value,
  props.prologue.triad.length,
  props.prologue.inherited !== undefined,
);
const shown = ref(initial.shown);

// A translation change is a new reading identity, and the reader can also
// change Skip seen prose while this prologue is on-screen. Re-evaluate both:
// neither should leave an outdated reveal state or silently mark unread words.
watch([replayText, () => props.skipSeenProse], ([text]) => {
  if (!props.prologue.founded) {
    shown.value = initialPrologueShown(
      readingStorage(), props.skipSeenProse, text, props.prologue.triad.length,
    );
  }
});
const founderName = ref('');

/**
 * WHO SIGNED (#1867). Two answers beside the name, and deliberately two: how
 * the founder is referred to, and which parent carried the blood into the
 * house. A man or a woman pre-selects the matching body; a nonbinary founder
 * chooses; anyone can change it. Neither is ever guessed from the other or
 * from the name, so both must be answered before the signing.
 */
const gender = ref<Gender | null>(null);
const configuration = ref<FoundingConfiguration | null>(null);
function chooseGender(next: Gender): void {
  gender.value = next;
  configuration.value = founderConfigurationFor(next) ?? configuration.value;
}
const GENDERS: readonly { id: Gender; original: string; plain: string }[] = [
  { id: 'man', original: 'A man', plain: 'Man' },
  { id: 'woman', original: 'A woman', plain: 'Woman' },
  { id: 'nonbinary', original: 'Nonbinary', plain: 'Nonbinary' },
];
const CONFIGURATIONS: readonly { id: FoundingConfiguration; original: string; plain: string; line: string; plainLine: string }[] = [
  {
    id: 'blood_father',
    original: 'The father of the house',
    plain: 'You are the father of the family',
    line: 'The blood is yours, and every daughter takes it from you. A wife of another house bears the children.',
    plainLine: 'You carry the family blood and pass it to your daughters. A wife from another house bears your children.',
  },
  {
    id: 'blood_mother',
    original: 'The mother of the house',
    plain: 'You are the mother of the family',
    line: 'The blood is yours, and your sons take it from you. A husband of another house fathers them, and the seal is yours in your own right.',
    plainLine: 'You carry the family blood and pass it to your sons. A husband from another house fathers your children. You hold the seal yourself, not as a regent.',
  },
];
const answers = ref<Record<string, string>>({});
const houseName = ref('');
const heirloom = ref('');
const grudge = ref('');

/**
 * Owner decision #343. The recommended behaviour is to show the paid-for
 * terms immediately after a choice. Keeping that presentation behind one
 * constant makes "Chronicle page only" a one-line review change without
 * changing the simulation payload or authored copy.
 */
const REVEAL_SIGNING_TERMS_ON_CHOICE = true;

function chooseAnswer(questionId: string, answerId: string): void {
  answers.value = { ...answers.value, [questionId]: answerId };
}

function selectedAnswer(questionId: string): string | undefined {
  return answers.value[questionId];
}

/**
 * THE FIVE (`core/src/people/friends.ts`).
 *
 * Up to five rows, each a name and one of two buttons, are disclosed only
 * when requested. Answering is optional and signing never waits on it — a player who does not want to put
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

// The DOM still carries the previous beat's advance button until Vue patches
// it. A second click on that stale button must not consume another reveal (or
// mark the whole Prologue as read before its final beat was displayed).
let revealing = false;
function on(): void {
  if (revealing || shown.value >= props.prologue.triad.length) return;
  revealing = true;
  try {
    shown.value = revealPrologueBeat(
      readingStorage(),
      replayText.value,
      shown.value,
      props.prologue.triad.length,
    );
  } finally {
    // Successive deliberate reveals remain possible after the new beat is
    // actually displayed. Match the other single-flight controls in this view.
    void nextTick(() => { revealing = false; });
  }
}

/**
 * WHAT THE SIGNING IS STILL WAITING FOR (issue #59).
 *
 * Four requirements, one dead button, and a page long enough that several
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
  if (props.prologue.namePrompt !== undefined) {
    // The player signs as themselves (#1867): the authored name is the
    // headless default, never the interactive one.
    if (!founderName.value.trim()) out.push('what you are called');
    if (!gender.value) out.push('who signed it');
    if (!configuration.value) out.push('whose blood the house carries');
  }
  if (props.prologue.examination.some((question) => !answers.value[question.id])) {
    out.push('an answer to each Examination question');
  }
  if (!heirloom.value) out.push('the thing you asked for by name');
  if (!grudge.value) out.push('who paid for the rest of it');
  if (!houseName.value.trim()) out.push('what the family will be called');
  return out;
});

/** Keep the same validation prerequisites and action payload in both registers.
 * Only the reader-facing explanation of missing inputs is translated. */
function waitingText(): string {
  if (!plain.value) return `It wants ${wanted.value.join(', and ')}.`;
  const labels: Record<string, string> = {
    'what you are called': 'your name',
    'who signed it': 'your gender',
    'whose blood the house carries': 'which parent carries the family blood',
    'an answer to each Examination question': 'an answer to every question',
    'the thing you asked for by name': 'a selected heirloom',
    'who paid for the rest of it': 'a selected rival house',
    'what the family will be called': 'a family name',
  };
  return `Before signing, provide ${wanted.value.map((item) => labels[item] ?? item).join(', and ')}.`;
}

// A successful founding replaces this view at the next render, not before
// another synchronous click or Enter can reach this component. Guard both
// submission routes until Vue has had a chance to apply that update.
let signing = false;
function sign(): void {
  // Keyboard submission must obey the same requirements as the disabled button.
  if (wanted.value.length > 0 || signing) return;
  signing = true;
  try {
    const result = props.actions.found({
      houseName: houseName.value,
      heirloom: heirloom.value,
      grudge: grudge.value,
      friends: friends.value.filter((f) => f.name.trim()),
      ...(props.prologue.namePrompt !== undefined
        ? {
          founder: {
            name: founderName.value,
            ...(gender.value ? { gender: gender.value } : {}),
            ...(configuration.value ? { configuration: configuration.value } : {}),
          },
        }
        : {}),
      ...(props.prologue.examination.length > 0 ? { answers: { ...answers.value } } : {}),
    });
    // The thesis takes the screen on its own. Landing the reader halfway down
    // the page they were already reading would waste it.
    if (result.ok) window.scrollTo({ top: 0 });
  } finally {
    // A refused founding must remain retryable on a subsequent deliberate act.
    void nextTick(() => { signing = false; });
  }
}

/**
 * Enter also confirms an IME candidate, and its keyup can arrive after
 * `compositionend` — so a keyup handler sees an ordinary Enter and founds the
 * house while the player is still choosing the characters of its name. Only a
 * deliberate keydown signs: not one inside a composition, not the legacy 229
 * process key, and not a held key repeating an irreversible act.
 */
function signOnEnter(event: KeyboardEvent): void {
  if (event.isComposing || event.keyCode === 229 || event.repeat) return;
  sign();
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
      :aria-label="plain ? 'A story passed down by the family' : 'An inherited account'"
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

    <button v-if="!prologue.founded && shown < prologue.triad.length" class="on" @click="on()">
      {{ plain ? (shown === 0 ? 'Read the first part' : shown === 1 ? 'Read the second part' : 'Read the third part') : (shown === 0 ? 'The first thing' : shown === 1 ? 'The second thing' : 'The third thing') }}
    </button>

    <template v-else-if="!prologue.founded">
      <section v-if="prologue.namePrompt" class="founder-section" aria-labelledby="founder-section-heading">
        <h2 id="founder-section-heading" class="stage-title">{{ plain ? 'About the founder' : 'Who signs the book' }}</h2>
        <div class="choice founder-name">
        <h3 class="label">{{ plain ? 'Your name' : 'The name' }}</h3>
        <p class="prompt">{{ prologue.namePrompt }}</p>
        <input
          v-model="founderName"
          :maxlength="FOUNDER_NAME_MAX"
          :placeholder="plain ? 'Your name' : 'what are you called?'"
          :aria-label="plain ? 'Enter the founder name' : 'Name the founder'"
        />
        <div class="identity" role="group" :aria-label="plain ? 'Your gender' : 'Who signed it'">
          <button
            v-for="option in GENDERS"
            :key="option.id"
            class="which"
            :class="{ on: gender === option.id }"
            :aria-pressed="gender === option.id"
            @click="chooseGender(option.id)"
          >{{ plain ? option.plain : option.original }}</button>
        </div>
        </div>

        <div class="choice founding-configuration">
        <h3 class="label">{{ plain ? 'Which parent carries the family blood' : 'Whose blood the house carries' }}</h3>
        <button
          v-for="option in CONFIGURATIONS"
          :key="option.id"
          class="option"
          :class="{ on: configuration === option.id }"
          :aria-pressed="configuration === option.id"
          @click="configuration = option.id"
        >
          <strong>{{ plain ? option.plain : option.original }}</strong>
          <span class="line">{{ plain ? option.plainLine : option.line }}</span>
        </button>
        </div>
      </section>

      <section
        v-if="prologue.examination.length"
        class="choice examination"
        aria-labelledby="examination-heading"
      >
        <h3 id="examination-heading" class="label">{{ plain ? 'The questions' : 'The Examination' }}</h3>
        <fieldset v-for="question in prologue.examination" :key="question.id" class="question">
          <legend class="prompt">{{ question.situation }}</legend>
          <button
            v-for="answer in question.answers"
            :key="answer.id"
            class="option"
            :class="{ on: selectedAnswer(question.id) === answer.id }"
            :aria-pressed="selectedAnswer(question.id) === answer.id"
            @click="chooseAnswer(question.id, answer.id)"
          >
            <strong>{{ answer.says }}</strong>
            <span
              v-if="REVEAL_SIGNING_TERMS_ON_CHOICE && selectedAnswer(question.id) === answer.id"
              class="signing-terms"
              aria-live="polite"
            >
              <span class="given">{{ answer.given }}</span>
              <span class="owed">{{ answer.owed }}</span>
            </span>
          </button>
        </fieldset>
      </section>

      <!-- THE FOUNDING CHOICES. Both are simulation inputs: the gift goes into
           the house's hands and the grudge into the world, and at the term the ending
           names which of them the selected line changed. -->
      <section class="choice">
        <h3 class="label">{{ plain ? 'Choose an heirloom' : 'You asked for one thing by name' }}</h3>
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
        <h3 class="label">{{ plain ? 'Choose the house that paid the price' : 'And somebody paid for the rest of it' }}</h3>
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
        <h3 class="label">{{ plain ? 'Up to five friends outside the family' : 'And five who were not of your blood' }}</h3>
        <p class="prompt">{{ prologue.friendsPrompt }}</p>
        <!-- Keep the personal names optional and out of the required signing
             path. Native details preserve keyboard/touch disclosure and keep
             entered names mounted when the reader closes this section. -->
        <details v-if="friends.length" class="friend-names">
          <summary>{{ plain ? 'Add friends (optional)' : 'Name them, if you wish' }}</summary>
          <div class="friends-fields">
            <div v-for="(friend, i) in friends" :key="i" class="friend">
              <input
                v-model="friend.name"
                maxlength="32"
                :placeholder="plain ? `Friend ${i + 1}` : `the ${['first', 'second', 'third', 'fourth', 'fifth'][i] ?? 'next'}`"
                :aria-label="plain ? `Name friend ${i + 1}` : `Name the ${['first', 'second', 'third', 'fourth', 'fifth'][i] ?? 'next'} friend`"
              />
              <div class="sex">
                <button
                  class="which"
                  :class="{ on: friend.sex === 'female' }"
                  :aria-pressed="friend.sex === 'female'"
                  @click="friend.sex = 'female'"
                >{{ plain ? 'Female' : 'She' }}</button>
                <button
                  class="which"
                  :class="{ on: friend.sex === 'male' }"
                  :aria-pressed="friend.sex === 'male'"
                  @click="friend.sex = 'male'"
                >{{ plain ? 'Male' : 'He' }}</button>
              </div>
            </div>
          </div>
        </details>
      </section>

      <section class="choice">
        <h3 class="label">{{ plain ? 'Family name' : 'The house' }}</h3>
        <p class="prompt">{{ prologue.housePrompt }}</p>
        <input
          v-model="houseName"
          maxlength="48"
          :placeholder="plain ? 'Enter the family name' : 'what the family will be called'"
          :aria-label="plain ? 'Enter the family name' : 'Name the house'"
          @keydown.enter="signOnEnter($event)"
        />
      </section>

      <p v-if="refused" class="rubric small">{{ refused }}</p>

      <button class="primary sign" :disabled="wanted.length > 0" @click="sign()">
        {{ plain ? 'Sign the agreement' : 'Sign it' }}
      </button>
      <p v-if="wanted.length" class="dim small waiting">
        {{ waitingText() }}
      </p>

    </template>

    <!-- THE LAST LINE, AND IT GETS THE SCREEN. It states the emotional thesis
         of the whole run, every ending reaches back to it, and it is the one
         plain sentence in a screen of elevated prose — which is an effect that
         does not survive being printed above a family tree. -->
    <template v-else>
      <p class="thesis">{{ prologue.thesis }}</p>
      <button class="primary" @click="actions.enter()">{{ plain ? `Begin in ${startYear}` : startYear }}</button>
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
.founder-section { margin-top: 30px; }
.founder-section .choice { margin-top: 16px; }
.stage-title { margin: 0 0 16px; color: var(--ink-soft); font-size: var(--t-card); font-weight: 600; }
.choice .prompt { margin: 0 0 12px; line-height: 1.7; color: var(--ink-soft); font-size: var(--t-card); }
.question { border: 0; padding: 0; margin: 0 0 24px; min-width: 0; }
.question legend { padding: 0; width: 100%; }
.signing-terms { display: block; margin-top: 7px; }
.signing-terms .given, .signing-terms .owed {
  display: block; margin: 3px 0 0; font-size: var(--t-fine); line-height: 1.55;
}
.signing-terms .given { color: var(--ink); }
.signing-terms .owed { color: var(--ink-soft); font-style: italic; }
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
.friend-names { margin-top: 14px; }
.friend-names summary { color: var(--ink); cursor: pointer; padding: 10px 0; min-height: 44px; line-height: 24px; }
.friend-names summary:focus-visible { outline: 2px solid var(--rubric); outline-offset: 3px; }
.friends-fields { padding-top: 10px; }
.friend { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; }
.friend input { flex: 1 1 auto; font-size: var(--t-card); }
.sex { display: flex; flex: 0 0 auto; gap: 4px; }
/* `.on` above carries a margin for the triad's advance button; these two sit
   in a row beside an input and must not inherit it. */
.which { padding: 6px 12px; font-size: var(--t-fine); margin-top: 0; }
.which.on { border-color: var(--rubric); box-shadow: inset 2px 0 0 var(--rubric); }
.sign { margin-top: 26px; }
.identity { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 8px; }
/* With the button, not above the three things it is about — those are already
   off the top of the screen by the time anybody reads this. */
.waiting { margin: 8px 0 0; }
.thesis {
  margin: 34vh 0 46px; font-size: var(--t-head); line-height: 1.6; color: var(--ink);
}
</style>
