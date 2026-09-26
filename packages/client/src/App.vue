<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { createGame, type GameActions } from './lib/game';
import { loadBundle } from './lib/content';
import Start from './components/Start.vue';
import Prologue from './components/Prologue.vue';
import Standing from './components/Standing.vue';
import Ambition from './components/Ambition.vue';
import Docket from './components/Docket.vue';
import Outcome from './components/Outcome.vue';
import Naming from './components/Naming.vue';
import PassageLog from './components/Passage.vue';
import Tree from './components/Tree.vue';
import Cast from './components/Cast.vue';
import Chronicle from './components/Chronicle.vue';
import GameTable from './components/Table.vue';
import Muster from './components/Muster.vue';
import Abroad from './components/Abroad.vue';
import Interlude from './components/Interlude.vue';
import Chapter from './components/Chapter.vue';
import Ending from './components/Ending.vue';
import Book from './components/Book.vue';
import Plat from './components/Plat.vue';
import Line from './components/Line.vue';
import { SHORTCUTS, isControl, isField, shortcutFor } from './lib/keys';
import { LEGEND } from './lib/marks';
import {
  applyAccessibility,
  loadAccessibility,
  saveAccessibility,
} from './lib/accessibility';

/**
 * THE WHOLE CLIENT, above one store and one read model.
 *
 * Nothing here imports `@ed/core` for anything but a type, and nothing touches
 * `session.ctx`. Every value on screen came out of `session.view()` or
 * `session.table()`, and every button goes back in through a verb. That is the
 * seam `core/src/session.ts` was written to be, and this is the first thing on
 * the other side of it.
 */
const game = createGame(loadBundle());
const {
  view, table, land, prologue, openingSeen, epilogue, docket, passages, jump, interlude, chapter, frame, ended,
  refused, refusal, receipt, musterRefusal, outcome, refusedCard, resumable, saveStatus, library, libraryReady, actions,
} = game;

/**
 * Which of the three the middle column is showing. The docket, the clock and
 * the chronicle never move — what changes is what the player is looking AT:
 * the family, the orders the house is under, or what the world is saying about
 * it. A panel competing with the docket for the same column would lose.
 */
const pane = ref<'house' | 'table' | 'abroad' | 'chronicle'>('house');

/** Reading choices are local to this device and must not alter a saved world. */
const accessibility = ref(loadAccessibility(
  typeof window === 'undefined' ? null : window.localStorage,
));
watch(accessibility, (preferences) => {
  if (typeof document === 'undefined') return;
  applyAccessibility(document.documentElement, preferences);
  saveAccessibility(window.localStorage, preferences);
}, { deep: true, immediate: true });

/**
 * WHAT THE MIDDLE COLUMN IS SHOWING, which is not quite what the switcher says.
 *
 * Below 1100px the chronicle becomes a fourth pane (issue #57) because the
 * three columns stack and the book ends up seventeen hundred pixels down, past
 * a family tree that grows across a Long Line, with no control anywhere that
 * would take you to it.
 *
 * Above the breakpoint the chronicle has its own column and the fourth tab is
 * not offered — so `chronicle` is a state only a narrow window can enter, and
 * a window widened while it is set would otherwise leave this column empty.
 * It falls back to the house, which is what that width already shows.
 */
const middle = computed(() => (pane.value === 'chronicle' ? 'house' : pane.value));

/**
 * WHOSE CARD IS OPEN. Held here rather than in the tree because the cast list
 * (issue #44) opens cards too, and two components each keeping their own
 * answer would put two different people on the screen at once.
 */
const selected = ref<string | null>(null);

function select(id: string): void {
  selected.value = selected.value === id ? null : id;
}

/**
 * FOLLOW A LINE IN THE PASSAGE LOG BACK TO THE PERSON.
 *
 * The log sits in the left column and is visible from all three panes, but
 * the card it opens is only drawn on `house` — so a click from The table
 * would set `selected` and change nothing on the screen, which is this
 * repository's whole failure mode rendered as a button.
 *
 * It sets rather than toggles, unlike `select`. Arriving at a pane to look at
 * somebody and finding their card shut because it was already open is not a
 * thing anybody asked for.
 */
function look(id: string): void {
  pane.value = 'house';
  selected.value = id;
}

/**
 * THE KEYBOARD (issue #58). A text game that needed a mouse for every input.
 *
 * The clock, Escape and the list live here because this is where the panes,
 * the open card and the interlude are. The numbers live in `Docket.vue`,
 * because taking a choice needs the half-filled cast that only that component
 * holds — reaching for it from up here would mean lifting a form into the
 * store, and it is not simulation state.
 */
const helpOpen = ref(false);

/**
 * THE VOLUME, WHEN THE PLAYER ASKS FOR IT (issue #48).
 *
 * Held as the entries rather than a boolean: the book is a read taken at the
 * moment it is opened, and a pane that re-read the world under itself while
 * somebody was scrolling would be a client holding live simulation state.
 *
 * SHALLOW, and that is #69's third acceptance clause: *"the client never holds
 * the whole book in a reactive structure it re-renders."* A plain `ref` walks
 * seven hundred entry objects and makes every field of every one of them
 * reactive, to track mutations that cannot happen — the book is a snapshot of
 * values and nothing writes to it. `shallowRef` tracks the one thing that does
 * change, which is whether the book is open.
 */
const bookOpen = shallowRef<ReturnType<GameActions['book']> | null>(null);
function openBook(): void {
  bookOpen.value = actions.book();
}

/** THE PLAT (issue #96) — reachable only from the click inside `GameTable`. */
const platOpen = ref(false);

/** The seal's line, taken when it is asked for (issue #56). Same rule as the book. */
const lineOpen = ref<ReturnType<GameActions['line']> | null>(null);
function openLine(): void {
  lineOpen.value = actions.line();
}

function onKey(e: KeyboardEvent): void {
  const el = document.activeElement;
  const press = shortcutFor({
    key: e.key,
    shift: e.shiftKey,
    modified: e.ctrlKey || e.metaKey || e.altKey,
    inField: isField(el),
    onControl: isControl(el),
  });
  if (!press) return;

  switch (press.kind) {
    case 'help':
      e.preventDefault();
      helpOpen.value = !helpOpen.value;
      return;

    case 'dismiss':
      // In the order a player would expect to leave them: the thing on top
      // first. The interlude traps and handles its own Escape, so by the time
      // one reaches here there is not one.
      if (bookOpen.value) bookOpen.value = null;
      else if (platOpen.value) platOpen.value = false;
      else if (lineOpen.value) lineOpen.value = null;
      else if (helpOpen.value) helpOpen.value = false;
      else if (selected.value) selected.value = null;
      return;

    case 'advance':
      // Only the states where the clock is actually offered. Pressing space
      // on the signing screen must not found a house.
      if (!view.value || ended.value || waiting.value || interlude.value) return;
      if (bookOpen.value || platOpen.value || lineOpen.value) return;
      if (prologue.value && !openingSeen.value) return;
      e.preventDefault();
      actions.advance(press.years);
      return;

    // Docket.vue's business — it holds the cast these would need.
    case 'take':
      return;

    default:
      return;
  }
}

onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));

/** The clock only turns when nothing is waiting for an answer. */
const waiting = computed(() => docket.value.length > 0 || (view.value?.namesWanted.length ?? 0) > 0);

/**
 * WHY THE CLOCK WILL NOT TURN, COUNTED (issue #53).
 *
 * The count is the useful half. A queue with no number on it is why a player
 * presses the same button six times: pressing "a generation" from 1042 and
 * arriving in 1045 is what a naming queue looks like from the outside when
 * nothing says how many are in it.
 */
const blocking = computed(() => {
  const decisions = docket.value.length;
  const children = view.value?.namesWanted.length ?? 0;
  const parts: string[] = [];
  if (decisions) parts.push(`${decisions} decision${decisions === 1 ? '' : 's'}`);
  if (children) parts.push(`${children} ${children === 1 ? 'child' : 'children'} waiting`);
  return parts.join(' · ');
});

/** The two changes that otherwise happen outside a screen reader's cursor. */
const yearAndBirths = computed(() => {
  if (!view.value) return '';
  const births = passages.value.flatMap((passage) => passage.lines)
    .filter((line) => line.kind === 'birth')
    .map((line) => line.text);
  return [`Year ${view.value.year}.`, ...births].join(' ');
});
</script>

<template>
  <Start v-if="!view" :actions="actions" :resumable="resumable" :library="library" :library-ready="libraryReady" />

  <!-- A DEBT OF THREE PARTS. Once, at the head of the run, before a year has
       turned — and never again: `founded` is what the world remembers of it. -->
  <Prologue
    v-else-if="prologue && !openingSeen"
    :prologue="prologue"
    :actions="actions"
    :refused="refused"
    :start-year="view.campaign.startYear"
  />

  <template v-else-if="ended && epilogue">
    <Ending :view="view" :epilogue="epilogue" :actions="actions" @open="openBook()" />
    <Book v-if="bookOpen" :book="bookOpen" :ages="view.ages" :house-name="view.houseName" :close="() => (bookOpen = null)" />
    <Line v-if="lineOpen" :line="lineOpen" :close="() => (lineOpen = null)" />
  </template>

  <template v-else>
    <Standing :view="view" :jump="jump" :save-status="saveStatus" />

    <p class="said-not-shown" role="status" aria-live="polite" aria-atomic="true">
      {{ yearAndBirths }}
    </p>

    <!-- WHAT THESE YEARS MAKE VALUABLE (#216). No Age name or onset date:
         this is the household's actionable reading from inside the years. -->
    <aside v-if="view.agePressures.length" class="age-pressures panel" aria-label="What matters in these years">
      <h3 class="label">In these years</h3>
      <ul class="small">
        <li v-for="pressure in view.agePressures" :key="pressure">{{ pressure }}</li>
      </ul>
    </aside>

    <div class="board" :data-pane="pane">
      <div class="left stack">
        <!-- ONE QUESTION, ONE ANSWER (issue #213). This is framing, not a
             docket item: it never stops the clock and promises no outcome. -->
        <section v-if="view.generationArc" class="panel generation-arc">
          <p class="label">This generation</p>
          <p class="generation-question">{{ view.generationArc.question }}</p>
          <details v-if="view.generationArc.previous">
            <summary class="dim small">What became of the last question</summary>
            <p class="small">{{ view.generationArc.previous.answer }}</p>
          </details>
        </section>
        <!-- One decision at a time. The docket can hold several; answering the
             top one is how a player gets to the next, and a column of four
             open decisions is a form, not a game.

             KEYED ON THE DECISION, because without it Vue reuses the component
             for the next one and the half-filled cast of the answered decision
             is still sitting in it — a party sent to a thing they were never
             named for, and nothing anywhere would say so. -->
        <!-- WHAT THE LAST ANSWER DID, BEFORE THE NEXT QUESTION (issue #84).
             First in the chain on purpose: the outcome stands where the
             decision stood, and the next decision waits behind it. Answering
             and being handed the next dilemma with nothing in between is the
             loop with its middle beat missing. -->
        <Outcome v-if="outcome" :outcome="outcome" @dismiss="actions.dismissOutcome()" />

        <Docket
          v-else-if="docket.length"
          :key="docket[0]!.id"
          :decision="docket[0]!"
          :actions="actions"
          :age-match-priorities="view.ageMatchPriorities"
          :age-record-priorities="view.ageRecordPriorities"
          :refused-card="refusedCard"
        />

        <Naming v-else-if="view.namesWanted.length" :view="view" :actions="actions" />

        <!-- THE CLOCK IS FURNITURE (issue #53). Always drawn, same place, same
             size, whatever else is on the board. It used to be the third arm of
             a v-if chain with the docket and the naming panel, so the game's
             primary verb left the screen the moment anything wanted answering —
             and the line explaining why sat forty pixels below the pane
             switcher, which is not where the player is looking.

             Disabled with the reason ON it, which is the courtesy `Docket.vue`
             already extends to a choice nobody can take: "an unavailable choice
             is itself information (concept §16), so it is shown greyed with the
             reason rather than filtered away." -->
        <Ambition :view="view" :actions="actions" />

        <div class="panel clock">
          <h3 class="label">The clock</h3>
          <div class="wrap">
            <button :disabled="waiting" :title="blocking" @click="actions.advance(1)">A year</button>
            <button :disabled="waiting" :title="blocking" @click="actions.advance(5)">Five</button>
            <button :disabled="waiting" :title="blocking" @click="actions.advance(25)">A generation</button>
            <button
              :disabled="waiting"
              :title="blocking"
              @click="actions.advance(view.campaign.endYear - view.year)"
            >On, to {{ view.campaign.endYear }}</button>
          </div>
          <p v-if="waiting" class="dim small why">
            {{ blocking }} — the year does not turn until it is answered.
          </p>
        </div>

        <!-- A CONTROL, NOT A KEYSTROKE (issue #107). The panel below is the
             one place in the game that teaches the six marks, and it opened on
             `?` and nothing else — which on a phone is nowhere. The legend is
             the route that teaches; the tooltips on the cards are a third
             channel and stay where they are. -->
        <button
          class="quiet small legend"
          :aria-expanded="helpOpen"
          @click="helpOpen = !helpOpen"
        >{{ helpOpen ? 'Hide reading help' : 'Reading, marks and keys' }}</button>

        <!-- Not a modal: it has no focus to trap and nothing to answer, and a
             second dialog in a client that just got its first one would be two
             traps to keep right instead of one. -->
        <section v-if="helpOpen" class="panel keys">
          <!-- Reading controls first, then the legend a non-visual reader
               needs before meeting the same marks throughout the tree. -->
          <h3 class="label">Reading</h3>
          <div class="reading-settings stack">
            <label class="small">
              Text size
              <select v-model="accessibility.textScale">
                <option value="standard">Standard</option>
                <option value="large">Large</option>
                <option value="largest">Largest</option>
              </select>
            </label>
            <label class="small">
              Typeface
              <select v-model="accessibility.readingFont">
                <option value="book">Book face</option>
                <option value="readable">Readable sans</option>
              </select>
            </label>
          </div>
          <h3 class="label">Marks</h3>
          <dl class="legend-list">
            <template v-for="m in LEGEND" :key="m.kind">
              <dt :class="m.kind" aria-hidden="true">{{ m.glyph }}</dt>
              <dd class="dim small">{{ m.says }}</dd>
            </template>
          </dl>
          <h3 class="label">Keys</h3>
          <dl>
            <template v-for="k in SHORTCUTS" :key="k.keys">
              <dt><kbd>{{ k.keys }}</kbd></dt>
              <dd class="dim small">{{ k.does }}</dd>
            </template>
          </dl>
        </section>

        <div class="wrap panes">
          <!-- `aria-pressed` mirrors `.on` exactly (issue #58). Which pane you
               are in was a colour and a box-shadow and nothing else, which is
               also a problem for anyone who cannot tell --rubric from --rule. -->
          <button
            class="quiet small"
            :class="{ on: middle === 'house' && pane !== 'chronicle' }"
            :aria-pressed="middle === 'house' && pane !== 'chronicle'"
            @click="pane = 'house'"
          >The house</button>
          <button
            class="quiet small"
            :class="{ on: pane === 'table' }"
            :aria-pressed="pane === 'table'"
            @click="pane = 'table'"
          >The table</button>
          <button
            class="quiet small"
            :class="{ on: pane === 'abroad' }"
            :aria-pressed="pane === 'abroad'"
            @click="pane = 'abroad'"
          >Abroad</button>
          <!-- Only where the columns have stacked. Above the breakpoint the
               chronicle is always on screen and a tab for it would be a
               control that does nothing. -->
          <button
            class="quiet small book"
            :class="{ on: pane === 'chronicle' }"
            :aria-pressed="pane === 'chronicle'"
            @click="pane = 'chronicle'"
          >The chronicle</button>
        </div>

        <!-- BELOW THE PANE SWITCHER, not above it, and outside the docket's
             v-if chain on purpose: what the last jump did is still the answer
             to "what just happened" while a decision is standing on top of
             it. It is also the one panel here that survives all three states
             of the column. -->
        <PassageLog :passages="passages" @select="look" />
      </div>

      <div class="middle">
        <template v-if="middle === 'table' && table && land">
          <!-- THE MUSTER (issue #89, Stage 2 — #95). Only reachable while a
               commitment is standing — a panel for a war nobody sent men to
               would be furniture, and #90 measures a median gap of ~250
               years between them. -->
          <Muster v-if="view.muster" :view="view" :actions="actions" :refusal="musterRefusal" />
          <GameTable
            :table="table"
            :land="land"
            :actions="actions"
            :refusal="refusal"
            :receipt="receipt"
            @open-plat="platOpen = true"
          />
        </template>
        <Abroad v-else-if="middle === 'abroad'" :view="view" />
        <template v-else>
          <!-- Five or six people out of seventy, each with the one thing that
               is true of them and of nobody else. The tree is still under it;
               this is the way in. -->
          <Cast :cast="view.cast" :selected="selected" @select="select" />
          <Tree :view="view" :selected="selected" @select="select" @line="openLine()" />
        </template>
      </div>

      <div class="right">
        <Chronicle :view="view" :frame="frame" @open="openBook()" />
      </div>
    </div>

    <Interlude v-if="interlude" :entry="interlude" :actions="actions" />
    <Chapter v-if="chapter" :beat="chapter" :actions="actions" />
    <Book v-if="bookOpen" :book="bookOpen" :ages="view.ages" :house-name="view.houseName" :close="() => (bookOpen = null)" />
    <Plat v-if="platOpen && land" :land="land" :house-name="view.houseName" :actions="actions" :close="() => (platOpen = false)" />
    <Line v-if="lineOpen" :line="lineOpen" :close="() => (lineOpen = null)" />
  </template>
</template>

<style scoped>
.board {
  display: grid; grid-template-columns: minmax(0, 24rem) minmax(0, 1fr) minmax(0, 24rem);
  gap: 26px; padding: 22px 26px 70px; align-items: start;
}
/* THE FOURTH PANE (issue #57). Above the breakpoint nothing here applies and
   the board is what it always was: three columns, chronicle always on screen,
   three tabs. Below it the columns stack, and stacking is what put the book
   seventeen hundred pixels down the page behind a tree that grows for a
   five centuries — so down there the chronicle takes its turn in the column
   instead of queueing after it. */
.panes .book { display: none; }
@media (max-width: 1100px) {
  /* `minmax(0, 1fr)`, not a bare `1fr` (issue #106). A bare `fr` track's
     automatic minimum is content-based, so a descendant that scrolls
     internally — the Match's snap-scrolling deck below 640px — still forced
     this single column, and the whole board with it, wider than the
     viewport: the exact grid-blowout the three-column rule above already
     avoids with the same `minmax(0, ...)`. */
  .board { grid-template-columns: minmax(0, 1fr); }
  .panes .book { display: inline-block; }
  .board[data-pane='chronicle'] .middle { display: none; }
  .board:not([data-pane='chronicle']) .right { display: none; }
}
.generation-arc { border-left: 3px solid var(--rubric); }
.generation-arc .label { margin-top: 0; }
.generation-question { margin-bottom: 8px; }
.generation-arc details p { margin-bottom: 0; }
.clock button { flex: 1; }
/* Four buttons across 390px is 64px each, which is not a label. Two rows.
   After the rule it overrides, not before it — same specificity, later wins,
   and this sat above it for one measurement and did exactly nothing. */
@media (max-width: 1100px) {
  .clock button { flex: 1 1 44%; }
}
/* Sits with the buttons it is about, not forty pixels below a pane switcher. */
.clock .why { margin: 8px 0 0; }
.panes button.on { color: var(--ink); background: var(--vellum-deep); border-color: var(--rule); }

/* THE PHONE TIER (issue #106), nested under the 1100px stack rather than
   replacing it. `Kin.vue` recurses one level a GENERATION and the hall holds
   the living, so the deepest chain measured across five thousand-year runs
   was 5 — 90px of indent, nothing like the forty-generation reading a naive
   look at the recursion suggests. What actually breaks under 390px is
   vertical, not horizontal: the pane switcher competing with the clock and
   the passage log for the same column, and a member card whose only reader
   was a mouse. 640 is the width where the switcher stops having room to sit
   inline above the clock without pushing it below the fold on a phone held
   in one hand — measured, not guessed, so the next person does not have to
   re-derive it. Nothing here touches a rule above 1100px. */
@media (max-width: 640px) {
  /* THE PANE SWITCHER BECOMES THE THUMB'S FURNITURE. Same buttons, same
     click handlers — no second control that could drift from the first, just
     where they sit. Fixed to the foot of the screen because that is where
     `App.vue:236`'s reasoning about the clock already points: "furniture
     belongs where the thumb is." Above this tier the rule below does not
     apply and the switcher sits exactly where it always has, inline above
     the passage log. */
  .panes {
    position: fixed; left: 0; right: 0; bottom: 0; z-index: 15;
    margin: 0; gap: 0; background: var(--vellum-deep); border-top: 1px solid var(--rule);
    padding: 4px 6px calc(4px + env(safe-area-inset-bottom));
  }
  .panes button { flex: 1 1 0; text-align: center; }
  /* Room at the foot of the page for the bar that now lives there, plus the
     device's own gesture chrome under it. */
  .board { padding-bottom: calc(64px + env(safe-area-inset-bottom)); }
}
.keys dl { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; margin: 0; }
.keys dt, .keys dd { margin: 0; }
.keys h3.label:not(:first-child) { margin-top: 14px; }
.reading-settings label { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
/* The glyphs in the legend are the glyphs on the cards, in the same ink, or
   the legend is teaching a different alphabet. */
.legend-list dt { text-align: center; }
.legend-list .seal, .legend-list .madness, .legend-list .given { color: var(--rubric); }
.legend-list .carries { color: var(--ink-soft); }
.legend-list .drift { color: var(--ink-faint); }
/* Sits with the panel it opens, and is a real control on a screen with no
   keyboard. */
.legend { align-self: flex-start; }
.keys kbd {
  font: inherit; font-size: var(--t-label); border: 1px solid var(--rule);
  border-radius: 3px; padding: 1px 5px; white-space: nowrap;
}
</style>
