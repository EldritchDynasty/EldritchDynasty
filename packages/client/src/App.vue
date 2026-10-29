<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { createGame, type GameActions } from './lib/game';
import { installPlainEnglishCatalogue, loadBundle } from './lib/content';
import { createProseModeSelector } from './lib/prose-selection';
import { appShellCopy, clockBlockers, frozenLine, frozenNoticeShown } from './lib/app-shell-copy';
import Start from './components/Start.vue';
import Prologue from './components/Prologue.vue';
import Standing from './components/Standing.vue';
import Ambition from './components/Ambition.vue';
import Docket from './components/Docket.vue';
import Outcome from './components/Outcome.vue';
import Naming from './components/Naming.vue';
import PassageLog from './components/Passage.vue';
import Tree from './components/Tree.vue';
import TreeCounsel from './components/TreeCounsel.vue';
import TreeChanges from './components/TreeChanges.vue';
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
import ReadingSettings from './components/ReadingSettings.vue';
import { shortcutHelp, isControl, isField, shortcutFor } from './lib/keys';
import { LEGEND, markSays } from './lib/marks';
import {
  applyAccessibility,
  hasSeenProse,
  loadAccessibility,
  saveAccessibility,
  seenProseKey,
} from './lib/accessibility';
import {
  READING_LOG_NOTICE,
  ReadingLog,
  attachReadingLog,
  readingLogFilename,
  readingLogRequested,
  recordActions,
} from './lib/reading-log';
import { downloadBlob } from './lib/download';
import {
  loadRevealed,
  revealNotice,
  revealStorageKey,
  revealTransition,
  saveRevealed,
  type RevealElement,
} from './lib/reveal';
import { tableTasksFor, type OpenedTablePanels, type TableReveal, type TableTarget } from './lib/table-nav';

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
  view, table, land, prologue, openingSeen, epilogue, achievements, docket, passages, jump, interlude, chapter, frame, ended,
  refused, refusal, receipt, musterRefusal, outcome, refusedCard, resumable, saveStatus, library, libraryReady, libraryReadError, milestones,
} = game;

/**
 * THE READING LOG (#1945): research-only, and off unless the address asks for
 * it. When on, it only watches — every verb below passes through unchanged.
 */
const readingLog = typeof window !== 'undefined' && readingLogRequested(window.location.search)
  ? new ReadingLog(
    () => performance.now(),
    typeof __ED_BUILD__ === 'object' ? { ...__ED_BUILD__ } : { sha: 'unknown', platform: 'unrecorded' },
    new Date().toISOString(),
    { visible: document.visibilityState === 'visible', focused: document.hasFocus() },
  )
  : null;
const readingLogOn = ref(readingLog !== null);
const readingBreak = ref(false);
const actions = readingLog ? recordActions(game.actions, readingLog) : game.actions;

/**
 * Which of the three the middle column is showing. The docket, the clock and
 * the chronicle never move — what changes is what the player is looking AT:
 * the family, the orders the house is under, or what the world is saying about
 * it. A panel competing with the docket for the same column would lose.
 */
const pane = ref<'house' | 'table' | 'abroad' | 'chronicle'>('house');

/** Reading choices are local to this device and must not alter a saved world. */
const accessibility = ref(loadAccessibility(readingStorage()));
const shellCopy = computed(() => appShellCopy(accessibility.value.proseMode));
const readerShortcuts = computed(() => shortcutHelp(accessibility.value.proseMode));
// Presentation mode lives with the reader, not the saved world. Restoring
// the preference must fetch the optional catalogue just like a live toggle.
// Merely setting the mode leaves a restarted Plain English reader seeing
// Original wording until they manually flip the selector again.

/** Loading is presentation-only. Pending Chronicle pages keep the wording
 * they were written with; new read models refresh after the chunk arrives.
 * A superseded import cannot publish variants or override a newer selection.
 */
const selectProseMode = createProseModeSelector(
  (mode) => {
    accessibility.value.proseMode = mode;
    actions.setProseMode(mode);
  },
  installPlainEnglishCatalogue,
  (variants) => actions.setProseVariants(variants),
);

// Honour a persisted Plain English choice on the first visit after reload.
// Plain-to-Original remains synchronous; only the optional chunk is async.
void selectProseMode(accessibility.value.proseMode);

watch(accessibility, (preferences) => {
  if (typeof document === 'undefined') return;
  applyAccessibility(document.documentElement, preferences);
  saveAccessibility(readingStorage(), preferences);
}, { deep: true, immediate: true });


/**
 * Experienced readers may opt out of the progressive introduction. null is an
 * intentional "automatic" preference: once the Library contains a completed
 * house, a returning reader starts expanded until they choose otherwise.
 */
const showEverythingFromStart = computed<boolean>({
  get: () => accessibility.value.showEverythingFromStart
    ?? (libraryReady.value && library.value.runs.length > 0),
  set: (value) => { accessibility.value.showEverythingFromStart = value; },
});

function readingStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

const revealStorage = readingStorage();
const revealed = ref<Set<RevealElement>>(new Set());
const openedTablePanels = ref<OpenedTablePanels>({});
const tableReveal = ref<TableReveal | null>(null);
let tableRevealToken = 0;
const tableOrigin = shallowRef<{ element: HTMLElement; pane: typeof pane.value; ambitionId: string } | null>(null);
const tableTasks = computed(() => view.value && table.value ? tableTasksFor(view.value, table.value, {
  revealed: revealed.value, showEverything: showEverythingFromStart.value, proseMode: accessibility.value.proseMode,
}) : []);
const ambitionTask = computed(() => tableTasks.value.find(task => task.id === view.value?.ambition?.id) ?? null);
const tableReturnLabel = computed(() => tableOrigin.value
  ? (accessibility.value.proseMode === 'plainenglish' ? 'Back to goal' : 'Back to ambition') : undefined);

function resetTableNavigation(): void {
  openedTablePanels.value = {};
  tableReveal.value = null;
  tableOrigin.value = null;
}

function navigateTable(target: TableTarget): void {
  if (!isRevealed('table')) return;
  openedTablePanels.value = { ...openedTablePanels.value, [target]: true };
  tableReveal.value = { target, token: ++tableRevealToken };
  pane.value = 'table';
}

function navigateFromAmbition(target: TableTarget, origin: HTMLElement): void {
  if (!isRevealed('table')) return;
  // A rendered cross-reference may outlive its quote or ambition for one tick.
  // Its destination is still safe: navigate to today's section, carrying no order.
  tableOrigin.value = { element: origin, pane: pane.value, ambitionId: view.value?.ambition?.id ?? '' };
  navigateTable(target);
}

function consumeTableReveal(token: number): void {
  if (tableReveal.value?.token === token) tableReveal.value = null;
}

async function returnToAmbition(): Promise<void> {
  const origin = tableOrigin.value;
  if (!origin) return;
  pane.value = origin.pane;
  tableReveal.value = null;
  tableOrigin.value = null;
  await nextTick();
  const destination = origin.element.isConnected && !origin.element.closest('details:not([open])')
    && view.value?.ambition?.id === origin.ambitionId
    ? origin.element : document.getElementById('ambition-heading');
  destination?.focus();
}
/** Store stable identities, so the current reader mode always owns the visible words. */
const revealNotices = ref<RevealElement[]>([]);
let revealRunKey: string | null = null;

function isRevealed(element: RevealElement): boolean {
  return revealed.value.has(element);
}

function dismissReveal(element: RevealElement): void {
  revealNotices.value = revealNotices.value.filter((notice) => notice !== element);
}

/**
 * Reveal state is reader-local and run-specific. The simulation does not know
 * whether a panel is currently visible. A Muster is an explicit safety
 * override because its controls live on The table and must never be hidden.
 */
watch([view, table, showEverythingFromStart], ([nextView, nextTable, showEverything]) => {
  if (!nextView) {
    resetTableNavigation();
    revealRunKey = null;
    revealed.value = new Set();
    revealNotices.value = [];
    return;
  }

  const key = revealStorageKey(nextView);
  const prior = key === revealRunKey
    ? revealed.value
    : loadRevealed(revealStorage, key);
  if (key !== revealRunKey) {
    revealNotices.value = [];
    resetTableNavigation();
  }

  const transition = revealTransition(nextView, nextTable, prior, {
    showEverything,
    needed: nextView.muster || nextTable?.security?.threats.length || nextTable?.expeditions?.offers.length
      || nextTable?.expeditions?.current.length ? ['table'] : [],
  });

  revealRunKey = key;
  revealed.value = transition.shown;
  if (!transition.newlyShown.length) return;

  saveRevealed(revealStorage, key, transition.shown);
  // "Show everything" is the experienced-reader escape hatch, so do not turn
  // it into six onboarding notices at once.
  if (!showEverything) {
    revealNotices.value = [
      ...revealNotices.value,
      ...transition.newlyShown,
    ];
  }
}, { immediate: true });

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
/** Undefined follows the current tenure; an explicit index reads an earlier one. */
const generationIndex = ref<number | undefined>(undefined);

/**
 * An explicit request to make a person visible in the tree. Selection alone
 * cannot carry this meaning: clicking a visible card also changes `selected`,
 * but must not discard the planning filters the player deliberately chose.
 * The token makes repeated links to the same person a fresh navigation.
 */
const treeReveal = ref<{ id: string; token: number; focus?: boolean } | null>(null);
let treeRevealToken = 0;

function select(id: string): void {
  selected.value = selected.value === id ? null : id;
}

/**
 * The Cast sits ABOVE the tree: its people may be hidden by a selected hall,
 * a planning filter, a direct-line view or a focused branch. Unlike selecting
 * a visible card inside the tree, opening a Cast member must reveal that card.
 * Keep click-again-to-close, and leave in-tree selection's filters untouched.
 */
function selectFromCast(id: string): void {
  const opening = selected.value !== id;
  selected.value = opening ? id : null;
  if (opening) treeReveal.value = { id, token: ++treeRevealToken };
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
function look(id: string, focus = false): void {
  pane.value = 'house';
  selected.value = id;
  treeReveal.value = { id, token: ++treeRevealToken, focus };
}

const matchReveal = ref<{ card: string; token: number } | null>(null);
function lookAtMatch(decision: string, card: string): void {
  if (docket.value[0]?.id !== decision || docket.value[0]?.kind !== 'match') return;
  pane.value = 'house';
  matchReveal.value = { card, token: ++treeRevealToken };
  // Following a named Match is an explicit request to open the next decision.
  if (outcome.value) actions.dismissOutcome();
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
/** The page a link asked the volume to open at (issue #269). */
const bookFocus = ref<string | undefined>(undefined);
const bookPerson = ref<string | undefined>(undefined);
function openBook(page?: string): void {
  bookPerson.value = undefined;
  bookFocus.value = page;
  bookOpen.value = actions.book();
}

/** Living relatives retain the tree route; an ancestor's kept account opens in the Book. */
function lookOrReadLife(person: string): void {
  if (view.value?.halls.some((hall) => hall.members.some((member) => member.id === person))) return look(person, true);
  if (!view.value?.chroniclePeople.some((recorded) => recorded.id === person)) return;
  bookFocus.value = undefined;
  bookPerson.value = person;
  bookOpen.value = actions.book();
}

/** THE PLAT (issue #96) — reachable only from the click inside `GameTable`. */
const platOpen = ref(false);

/** The seal's line, taken when it is asked for (issue #56). Same rule as the book. */
const lineOpen = ref<ReturnType<GameActions['line']> | null>(null);
function openLine(): void {
  lineOpen.value = actions.line();
}

/**
 * Return to the front door without throwing the sitting away.
 *
 * App-owned overlays are presentation state just like the store's receipts:
 * if they survive this transition, Continue can reopen an old book/help panel
 * over the resumed run. The store owns persistence; this wrapper owns only
 * what App.vue itself opened.
 */
function leaveToStart(): void {
  bookOpen.value = null;
  bookFocus.value = undefined;
  bookPerson.value = undefined;
  platOpen.value = false;
  lineOpen.value = null;
  helpOpen.value = false;
  selected.value = null;
  generationIndex.value = undefined;
  treeReveal.value = null;
  pane.value = 'house';
  actions.leave();
}

function onKey(e: KeyboardEvent): void {
  // Even if the top dialog preserves an IME Escape, this global handler must
  // not close a different panel underneath it (or dispatch another shortcut).
  if (e.isComposing || e.keyCode === 229) return;
  const el = document.activeElement;
  const press = shortcutFor({
    key: e.key,
    repeat: e.repeat,
    shift: e.shiftKey,
    modified: e.ctrlKey || e.metaKey || e.altKey,
    inField: isField(el),
    onControl: isControl(el),
    // A child dialog's focus trap owns Escape and all other keys while open.
    // App's window listener registers earlier, so it must defer explicitly.
    modalOpen: Boolean(document.querySelector('[aria-modal="true"]')),
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

if (readingLog) {
  let detach = () => {};
  onMounted(() => { detach = attachReadingLog(readingLog, document, window, () => { readingLogOn.value = false; }); });
  onBeforeUnmount(() => detach());

  // Pre-flush watchers, so a decision is checked against reader history
  // before `Docket.vue` renders it and remembers it.
  watch(() => view.value && { campaign: view.value.campaign.id, seed: view.value.seed }, (run) => {
    if (run) readingLog.note({ kind: 'run', ...run });
  }, { immediate: true });
  watch(() => accessibility.value.proseMode, (mode) => readingLog.note({ kind: 'prose', mode }), { immediate: true });
  watch(pane, (next) => readingLog.note({ kind: 'pane', pane: next }), { immediate: true });
  watch(readingBreak, (on) => readingLog.note({ kind: 'break', on }));
  watch(() => view.value?.year, (year) => {
    if (year !== undefined) readingLog.note({ kind: 'year', year });
  }, { immediate: true });
  watch(() => view.value?.chronicle, (pages) => readingLog.chronicle(pages), { immediate: true });
  watch(interlude, (shown) => {
    if (shown) readingLog.interlude(shown.year, shown.eventId);
  }, { immediate: true });
  watch(() => docket.value[0], (decision) => {
    if (!decision || !view.value) return;
    const event = decision.kind === 'match' ? 'match' : String(decision.event.id);
    const seen = decision.kind === 'choice'
      && hasSeenProse(readingStorage(), seenProseKey('scene', `${event}\u0000${decision.event.body}`));
    readingLog.note({ kind: 'decision', year: view.value.year, decision: decision.id, event, seen });
  }, { immediate: true });
  watch(ended, (done) => { if (done) readingLog.note({ kind: 'ended' }); }, { immediate: true });
}

/** Export ends the log: a gap still open at the export is censored there. */
function exportReadingLog(): void {
  if (!readingLog) return;
  readingLog.end('exported');
  const artifact = readingLog.artifact();
  downloadBlob(new Blob([JSON.stringify(artifact, null, 2)], { type: 'application/json' }), readingLogFilename(readingLog));
  readingLogOn.value = false;
}

function stopReadingLog(): void {
  readingLog?.end('stopped');
  readingLogOn.value = false;
}

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
const blocking = computed(() => clockBlockers(
  accessibility.value.proseMode,
  docket.value.length,
  view.value?.namesWanted.length ?? 0,
));

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
  <aside v-if="readingLog" class="panel small reading-log" role="region" aria-label="Reading log">
    <p v-if="readingLogOn">{{ READING_LOG_NOTICE }}</p>
    <p v-else>Reading log stopped. Nothing more is being recorded{{ readingLog.ended === 'exported' ? '; the export is the only copy' : '' }}.</p>
    <p class="reading-log-actions">
      <button v-if="readingLogOn" class="quiet small" :aria-pressed="readingBreak" @click="readingBreak = !readingBreak">
        {{ readingBreak ? 'End break' : 'Take a break' }}
      </button>
      <button v-if="readingLog.ended !== 'exported'" class="quiet small" @click="exportReadingLog">Export reading log</button>
      <button v-if="readingLogOn" class="quiet small" @click="stopReadingLog">Turn off</button>
    </p>
  </aside>

  <Start
    v-if="!view"
    :actions="actions"
    :resumable="resumable"
    :library="library"
    :library-ready="libraryReady"
    :library-read-error="libraryReadError"
    :text-scale="accessibility.textScale"
    :reading-font="accessibility.readingFont"
    :prose-mode="accessibility.proseMode"
    :skip-seen-prose="accessibility.skipSeenProse"
    :reduce-motion="accessibility.reduceMotion"
    @update:text-scale="accessibility.textScale = $event"
    @update:reading-font="accessibility.readingFont = $event"
    @update:prose-mode="void selectProseMode($event)"
    @update:skip-seen-prose="accessibility.skipSeenProse = $event"
    @update:reduce-motion="accessibility.reduceMotion = $event"
  />

  <!-- A DEBT OF THREE PARTS. Once, at the head of the run, before a year has
       turned — and never again: `founded` is what the world remembers of it. -->
  <Prologue
    v-else-if="prologue && !openingSeen"
    :prologue="prologue"
    :actions="actions"
    :refused="refused"
    :start-year="view.campaign.startYear"
    :skip-seen-prose="accessibility.skipSeenProse"
    :prose-mode="accessibility.proseMode"
  />

  <template v-else-if="ended && epilogue">
    <Ending :view="view" :epilogue="epilogue" :achievements="achievements" :actions="actions" :prose-mode="accessibility.proseMode" @update:prose-mode="void selectProseMode($event)" @open="openBook()" />
    <Line v-if="lineOpen" :line="lineOpen" :prose-mode="accessibility.proseMode" :milestones="milestones" :close="() => (lineOpen = null)" @book="openBook" />
    <Book v-if="bookOpen" :book="bookOpen" :ages="view.ages" :house-name="view.houseName" :actions="actions" :prose-mode="accessibility.proseMode" :focus="bookFocus" :person="bookPerson" :people="view.chroniclePeople" :milestones="milestones" :close="() => (bookOpen = null)" />
  </template>

  <template v-else>
    <Standing
      :view="view"
      :prose-mode="accessibility.proseMode"
      :jump="jump"
      :save-status="saveStatus"
      :show-assize="isRevealed('assize')"
      :show-ladder="isRevealed('ladder')"
      @look="look"
      @match="lookAtMatch"
    />

    <div v-if="revealNotices.length" class="reveal-notices" aria-live="polite">
      <p v-for="notice in revealNotices" :key="notice" class="panel small reveal-note">
        <span>{{ revealNotice(notice, accessibility.proseMode) }}</span>
        <button class="quiet small" @click="dismissReveal(notice)">{{ shellCopy.noticeDismiss }}</button>
      </p>
    </div>

    <p class="said-not-shown" role="status" aria-live="polite" aria-atomic="true">
      {{ yearAndBirths }}
    </p>

    <!-- WHAT THESE YEARS MAKE VALUABLE (#216). No Age name or onset date:
         this is the household's actionable reading from inside the years. -->
    <aside v-if="view.agePressures.length" class="age-pressures panel" :aria-label="shellCopy.ageRegion">
      <h3 class="label">{{ shellCopy.ageHeading }}</h3>
      <ul class="small">
        <li v-for="pressure in view.agePressures" :key="pressure">{{ pressure }}</li>
      </ul>
    </aside>

    <div class="board" :data-pane="pane">
      <div class="left stack">
        <!-- ONE QUESTION, ONE ANSWER (issue #213). This is framing, not a
             docket item: it never stops the clock and promises no outcome. -->
        <section v-if="view.generationArc" class="panel generation-arc">
          <p class="label">{{ shellCopy.generationHeading }} <span class="dim small">· {{ shellCopy.generationSince }} {{ view.generationArc.opened }}</span></p>
          <p class="generation-question">{{ view.generationArc.question }}</p>
          <details v-if="view.generationArc.previous">
            <summary class="dim small">{{ shellCopy.previousQuestion }}</summary>
            <p class="small">{{ view.generationArc.previous.answer }}</p>
            <p v-if="view.generationArc.previous.ambition" class="small dim">{{ view.generationArc.previous.ambition }}</p>
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
        <Outcome v-if="outcome" :outcome="outcome" :prose-mode="accessibility.proseMode" @dismiss="actions.dismissOutcome()" />

        <Docket
          v-else-if="docket.length"
          :key="docket[0]!.id"
          :decision="docket[0]!"
          :actions="actions"
          :prose-mode="accessibility.proseMode"
          :age-match-priorities="view.ageMatchPriorities"
          :age-record-priorities="view.ageRecordPriorities"
          :founded-year="view.campaign.startYear"
          :narrator="view.narrator"
          :refused-card="refusedCard"
          :reveal-card="matchReveal"
        />

        <Naming v-else-if="view.namesWanted.length" :view="view" :actions="actions" :prose-mode="accessibility.proseMode" />

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
        <Ambition :view="view" :actions="actions" :prose-mode="accessibility.proseMode"
          :navigation="ambitionTask" @navigate="navigateFromAmbition" />

        <div class="panel clock">
          <h3 class="label">{{ shellCopy.clockHeading }}</h3>
          <div class="wrap">
            <button :disabled="waiting" @click="actions.advance(1)">{{ shellCopy.advanceOne }}</button>
            <button
              v-if="isRevealed('clock-five')"
              :disabled="waiting"
              :title="blocking"
              @click="actions.advance(5)"
            >{{ shellCopy.advanceFive }}</button>
            <button
              v-if="isRevealed('clock-long')"
              :disabled="waiting"
              :title="blocking"
              @click="actions.advance(25)"
            >{{ shellCopy.advanceGeneration }}</button>
            <button
              v-if="isRevealed('clock-long')"
              :disabled="waiting"
              @click="actions.advance(view.campaign.endYear - view.year)"
            >{{ shellCopy.advanceToYear }} {{ view.campaign.endYear }}</button>
          </div>
          <p v-if="waiting" class="dim small why">
            {{ blocking }} — {{ shellCopy.waitingSuffix }}
          </p>
          <!-- THE FROZEN LADDER (issue #1803). Named once, in the house's own
               knowledge, with the one control that lets the dead decades pass:
               the same years, stopping at the first decision, the first waking,
               or twenty-five years, whichever comes first. -->
          <template v-if="view.ascension.frozen && frozenNoticeShown(view.ascension.frozen) && !view.ending">
            <p class="small frozen" role="status">
              {{ frozenLine(accessibility.proseMode, view.ascension.frozen.since, view.ascension.frozen.years) }}
            </p>
            <button
              :disabled="waiting"
              :title="blocking"
              @click="actions.advance(25, { untilThawed: true })"
            >{{ shellCopy.waitForBlood }}</button>
          </template>
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
        >{{ helpOpen ? shellCopy.helpToggleClose : shellCopy.helpToggleOpen }}</button>

        <button
          class="quiet small legend"
          @click="leaveToStart"
        >{{ shellCopy.startLink }}</button>

        <!-- Not a modal: it has no focus to trap and nothing to answer, and a
             second dialog in a client that just got its first one would be two
             traps to keep right instead of one. -->
        <section v-if="helpOpen" class="panel keys">
          <!-- Reading controls first, then the legend a non-visual reader
               needs before meeting the same marks throughout the tree. -->
          <h3 class="label">{{ shellCopy.helpReading }}</h3>
          <ReadingSettings
            v-model:text-scale="accessibility.textScale"
            v-model:reading-font="accessibility.readingFont"
            :prose-mode="accessibility.proseMode"
            v-model:skip-seen-prose="accessibility.skipSeenProse"
            v-model:reduce-motion="accessibility.reduceMotion"
            v-model:show-everything-from-start="showEverythingFromStart"
            @update:prose-mode="void selectProseMode($event)"
            :show-progressive-reveal-option="true"
          />
          <h3 class="label">{{ shellCopy.helpMarks }}</h3>
          <dl class="legend-list">
            <template v-for="m in LEGEND" :key="m.kind">
              <dt :class="m.kind" aria-hidden="true">{{ m.glyph }}</dt>
              <dd class="dim small">{{ markSays(m.kind, accessibility.proseMode) }}</dd>
            </template>
          </dl>
          <h3 class="label">{{ shellCopy.helpKeys }}</h3>
          <dl>
            <template v-for="k in readerShortcuts" :key="k.keys">
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
          >{{ shellCopy.navHouse }}</button>
          <button
            v-if="isRevealed('table')"
            class="quiet small"
            :class="{ on: pane === 'table' }"
            :aria-pressed="pane === 'table'"
            @click="pane = 'table'"
          >{{ shellCopy.navTable }}<span v-if="table?.security.threats.length" class="rubric"> · {{ table.security.threats.length }} {{ accessibility.proseMode === 'plainenglish' ? 'security warning' : 'warning at the door' }}</span></button>
          <button
            v-if="isRevealed('abroad')"
            class="quiet small"
            :class="{ on: pane === 'abroad' }"
            :aria-pressed="pane === 'abroad'"
            @click="pane = 'abroad'"
          >{{ shellCopy.navAbroad }}</button>
          <!-- Only where the columns have stacked. Above the breakpoint the
               chronicle is always on screen and a tab for it would be a
               control that does nothing. -->
          <button
            class="quiet small book"
            :class="{ on: pane === 'chronicle' }"
            :aria-pressed="pane === 'chronicle'"
            @click="pane = 'chronicle'"
          >{{ shellCopy.navChronicle }}</button>
        </div>

        <!-- BELOW THE PANE SWITCHER, not above it, and outside the docket's
             v-if chain on purpose: what the last jump did is still the answer
             to "what just happened" while a decision is standing on top of
             it. It is also the one panel here that survives all three states
             of the column. -->
        <PassageLog :passages="passages" :halls="view.halls" @select="look" :prose-mode="accessibility.proseMode" />
      </div>

      <div class="middle">
        <template v-if="middle === 'table' && table && land">
          <!-- THE MUSTER (issue #89, Stage 2 — #95). Only reachable while a
               commitment is standing — a panel for a war nobody sent men to
               would be furniture, and #90 measures a median gap of ~250
               years between them. -->
          <Muster v-if="view.muster" :view="view" :prose-mode="accessibility.proseMode" :actions="actions" :refusal="musterRefusal" />
          <GameTable
            v-model:opened="openedTablePanels"
            :table="table"
            :prose-mode="accessibility.proseMode"
            :land="land"
            :actions="actions"
            :refusal="refusal"
            :receipt="receipt"
            :reveal="tableReveal"
            :tasks="tableTasks"
            :show-everything="showEverythingFromStart"
            :return-label="tableReturnLabel"
            :milestones="milestones"
            @book="openBook"
            @open-plat="platOpen = true"
            @navigate="navigateTable"
            @revealed="consumeTableReveal"
            @return="returnToAmbition"
          />
        </template>
        <Abroad v-else-if="middle === 'abroad'" :view="view" :prose-mode="accessibility.proseMode" />
        <template v-else>
          <!-- Five or six people out of seventy, each with the one thing that
               is true of them and of nobody else. The tree is still under it;
               this is the way in. -->
          <Cast :cast="view.cast" :selected="selected" :prose-mode="accessibility.proseMode" @select="selectFromCast" />
          <TreeCounsel :view="view" :selected="selected" :actions="actions" :prose-mode="accessibility.proseMode" />
          <TreeChanges
            :reading="actions.generationChanges ? actions.generationChanges(generationIndex) : undefined"
            :prose-mode="accessibility.proseMode"
            @tenure="generationIndex = $event"
            @select="look($event, true)"
            @book="openBook"
          />
          <Tree
            :view="view"
            :selected="selected"
            :prose-mode="accessibility.proseMode"
            :reveal="treeReveal"
            :line="actions.line()"
            :milestones="milestones"
            @select="select"
            @line="openLine()"
            @book="openBook"
          />
        </template>
      </div>

      <div class="right">
        <Chronicle
          :view="view"
          :history="true"
          :frame="frame"
          :actions="actions"
          :prose-mode="accessibility.proseMode"
          @open="openBook"
          @person="lookOrReadLife"
        />
      </div>
    </div>

    <Interlude v-if="interlude" :entry="interlude" :actions="actions" :prose-mode="accessibility.proseMode" />
    <Chapter
      v-if="chapter"
      :beat="chapter"
      :actions="actions"
      :prose-mode="accessibility.proseMode"
      :skip-seen-prose="accessibility.skipSeenProse"
    />
    <Plat v-if="platOpen && land" :land="land" :halls="view.halls" :house-name="view.houseName" :prose-mode="accessibility.proseMode" :actions="actions" :close="() => (platOpen = false)" />
    <Line v-if="lineOpen" :line="lineOpen" :prose-mode="accessibility.proseMode" :milestones="milestones" :close="() => (lineOpen = null)" @book="openBook" />
    <Book v-if="bookOpen" :book="bookOpen" :ages="view.ages" :house-name="view.houseName" :actions="actions" :prose-mode="accessibility.proseMode" :focus="bookFocus" :person="bookPerson" :people="view.chroniclePeople" :milestones="milestones" :close="() => (bookOpen = null)" />
  </template>
</template>

<style scoped>
.reading-log {
  margin: 0.5rem auto;
  max-width: 60rem;
  padding: 0.5rem 1rem;
}
.reading-log-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

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
  /* Wrapped pane labels grow with the reader's text. Keep the final history
     links clear of that bar, including when focus returns from the Book. */
  .board { padding-bottom: calc(7rem + env(safe-area-inset-bottom)); }
}
.keys dl { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; margin: 0; }
.keys dt, .keys dd { margin: 0; }
.keys h3.label:not(:first-child) { margin-top: 14px; }
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
