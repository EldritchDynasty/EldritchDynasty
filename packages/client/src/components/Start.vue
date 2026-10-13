<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';
import { CAMPAIGN_CHOICES, type GameActions } from '../lib/game';
import type { SaveSummary } from '../platform';
import type { LibraryRun, ProseMode, RunLibrary } from '@ed/schema';
import ReadingSettings from './ReadingSettings.vue';
import type { ReadingFont, TextScale } from '../lib/accessibility';

const props = withDefaults(defineProps<{
  actions: GameActions;
  resumable: boolean;
  library?: RunLibrary;
  libraryReady?: boolean;
  libraryReadError?: boolean;
  textScale?: TextScale;
  readingFont?: ReadingFont;
  proseMode?: ProseMode;
  skipSeenProse?: boolean;
  reduceMotion?: boolean;
}>(), {
  libraryReady: true,
  libraryReadError: false,
  textScale: 'standard',
  readingFont: 'book',
  proseMode: 'original',
  skipSeenProse: false,
  reduceMotion: false,
});

const emit = defineEmits<{
  'update:textScale': [value: TextScale];
  'update:readingFont': [value: ReadingFont];
  'update:proseMode': [value: ProseMode];
  'update:skipSeenProse': [value: boolean];
  'update:reduceMotion': [value: boolean];
}>();

const campaign = ref(CAMPAIGN_CHOICES[0].id);
const selectedCampaign = computed(() => CAMPAIGN_CHOICES.find((c) => c.id === campaign.value) ?? CAMPAIGN_CHOICES[0]);
/** Local interface wording only; never rewrite existing saves or Library pages. */
const plain = computed(() => props.proseMode === 'plainenglish');
const PLAIN_ERRORS: Record<string, string> = {
  'Saved runs could not be listed. Try again.': 'Could not list your saved games. Try again.',
  'The last sitting could not be resumed. Try a saved run or begin anew.': 'Could not continue your last game. Load a saved game or start a new one.',
  'That saved run could not be read.': 'Could not load this saved game.',
  'That file was not a run this version can read.': 'This file is not a saved game this version can open.',
  'That saved run could not be written out.': 'Could not export this saved game.',
  'The Library could not be cleared. Your saved houses are still here. Try again.': 'Could not clear the completed games. Nothing was removed. Try again.',
  'That house could not be removed from the Library. Try again.': 'Could not remove this completed house. Try again.',
};
function displayError(original: string | null): string | null {
  return original && plain.value ? (PLAIN_ERRORS[original] ?? original) : original;
}
/**
 * A start year belongs to the campaign; an RNG seed belongs to one playthrough.
 * They happened to be the same number (1042) for every ordinary new game.
 * Draw once per newly mounted front door, not on a reactive update, so the
 * Advanced seed remains stable while the player edits other settings.
 *
 * This is host-side entropy only: the engine still receives an explicit
 * numeric seed and remains deterministic for saves, replay and bug reports.
 */
function newRunSeed(): number {
  const value = new Uint32Array(1);
  crypto.getRandomValues(value);
  return value[0]!;
}

const seed = ref(newRunSeed());
const saves = ref<SaveSummary[]>([]);
const saveListError = ref<string | null>(null);
/** A delayed host listing must not race a second Retry and restore stale rows. */
const listingSaves = ref(false);
const refused = ref<string | null>(null);
/** Do not open two host import pickers or let a late refusal follow a success. */
const importingSave = ref(false);
/** A named-run refusal belongs beside that slot, not beneath the import picker. */
const saveActionError = ref<{ slot: string; message: string } | null>(null);
const resumeRefused = ref<string | null>(null);
/** Only one host resume can run at a time; a slow response must not race a retry. */
const resuming = ref(false);
/** Named-slot reads are asynchronous host selections, not just button clicks. */
const loadingSlot = ref<string | null>(null);
// Two rapid clicks must not open duplicate host export pickers for one slot.
// Different slots remain independently exportable while another is pending.
const exportingSlots = ref(new Set<string>());
const libraryError = ref<string | null>(null);
/** A slow host recovery must not overlap a second Library read. */
const retryingLibrary = ref(false);
const confirmingClearLibrary = ref(false);
/** A single completed house should never disappear on the first Remove click. */
const confirmingRemoveRun = ref<string | null>(null);
const removingRun = ref<string | null>(null);
/** Keep clear-all and single-run deletion from racing the same host Library. */
const clearingLibrary = ref(false);
/**
 * THE FRONT DOOR OFFERS A HOUSE, NOT AN IMPLEMENTATION DETAIL (issue #67).
 *
 * `false` by default and `v-if`, not a native `<details>` — the element must
 * be genuinely absent from the DOM until asked for, not merely hidden by a
 * stylesheet a test does not run. "Nobody sees the word seed unless they go
 * looking for it" is the acceptance line, and it is only true if the word
 * is not there to find.
 */
const showAdvanced = ref(false);

/**
 * Named slots, minus the rolling autosave when Continue already offers it —
 * `resumable` and the listed slot are two independent reads of the same host
 * storage, so on the rare load where one lags the other this still leaves a
 * way to reach it.
 */
// A host can read a non-null autosave that the game cannot resume (e.g. an
// incompatible save format). Once Continue refuses it, reveal that slot so
// its original data is available through Copy out, without overwriting it.
// Hide the duplicate again if a later Continue succeeds.
const namedSaves = computed(() => saves.value.filter((s) =>
  !(props.resumable && resumeRefused.value === null && s.slot === 'autosave')));
const completedHouses = computed(() => [...(props.library?.runs ?? [])].reverse());
const libraryIsReady = computed(() => props.libraryReady ?? true);
/** The Advanced field is a user-editable number input: Vue's .number modifier
 * can yield an empty string at runtime when it is cleared. Never pass that,
 * a fractional number or an out-of-range value to the numeric game seed API.
 * Zero is a valid deterministic seed; do not replace invalid input silently.
 */
const validSeed = computed(() => Number.isInteger(seed.value) && seed.value >= 0 && seed.value <= 0xffffffff);
/** A pending host restore owns the session until it settles. */
/** Do not snapshot inherited houses while an asynchronous Library mutation is unsettled. */
const mayBegin = computed(() => libraryIsReady.value && validSeed.value
  && !resuming.value && loadingSlot.value === null && !importingSave.value
  && !retryingLibrary.value && !clearingLibrary.value && removingRun.value === null);
/** A double click can arrive before Vue replaces the Start screen with the prologue. */
let beginning = false;

function begin(): void {
  if (!mayBegin.value || beginning) return;
  beginning = true;
  try {
    props.actions.begin(seed.value, campaign.value);
  } finally {
    // Keep the latch until the old button has been repainted/removed. A
    // deliberate later attempt is still possible if the screen remains open.
    void nextTick().then(() => { beginning = false; });
  }
}

function survivingPage(run: LibraryRun): string | undefined {
  return [...run.entries].reverse().find((entry) => entry.said)?.said;
}

async function refreshSaves(): Promise<void> {
  // The retry button and a synthetic stale click must use the same guard.
  if (listingSaves.value) return;
  listingSaves.value = true;
  try {
    saves.value = await props.actions.listSaves();
    saveListError.value = null;
  } catch {
    // A failed host read says nothing about whether earlier runs exist.
    // Keep any previously listed saves, and give the reader a way to retry.
    saveListError.value = 'Saved runs could not be listed. Try again.';
  } finally {
    listingSaves.value = false;
  }
}

async function continueLastSitting(): Promise<void> {
  // A second click cannot start a competing host load or overwrite the result
  // of a successful continuation with an older, slower refusal.
  if (resuming.value || beginning || loadingSlot.value !== null || importingSave.value) return;
  resuming.value = true;
  // The rolling save may have become unreadable after the front door offered it.
  // Report this next to Continue, not down beside unrelated import/export actions.
  const explanation = 'The last sitting could not be resumed. Try a saved run or begin anew.';
  resumeRefused.value = null;
  try {
    if (!await props.actions.resume()) resumeRefused.value = explanation;
  } catch {
    resumeRefused.value = explanation;
  } finally {
    resuming.value = false;
  }
}

/** Named save actions share one error row; older host replies must not replace newer actions. */
let saveActionRevision = 0;
async function load(slot: string): Promise<void> {
  // One named host read owns the session until it resolves. Prevent both a
  // second slot and Begin/Continue/Import from superseding it mid-read.
  if (loadingSlot.value !== null || resuming.value || importingSave.value || beginning) return;
  loadingSlot.value = slot;
  const revision = ++saveActionRevision;
  saveActionError.value = null;
  try {
    if (!await props.actions.load(slot) && revision === saveActionRevision) {
      saveActionError.value = { slot, message: 'That saved run could not be read.' };
    }
  } catch {
    if (revision === saveActionRevision) {
      saveActionError.value = { slot, message: 'That saved run could not be read.' };
    }
  } finally {
    // A refused/rejected read must let the player select a different slot.
    loadingSlot.value = null;
  }
}

async function importSave(): Promise<void> {
  if (importingSave.value || loadingSlot.value !== null || resuming.value || beginning) return;
  importingSave.value = true;
  refused.value = null;
  try {
    // Dismissing the browser picker is not a failed or invalid import.
    if (await props.actions.importSave() === false) refused.value = 'That file was not a run this version can read.';
  } catch {
    refused.value = 'That file was not a run this version can read.';
  } finally {
    importingSave.value = false;
  }
}

async function exportSave(slot: string): Promise<void> {
  // The DOM disabled state can lag an event within a tick; guard the verb too.
  if (exportingSlots.value.has(slot)) return;
  exportingSlots.value.add(slot);
  const revision = ++saveActionRevision;
  saveActionError.value = null;
  try {
    if (!await props.actions.exportSave(slot) && revision === saveActionRevision) {
      saveActionError.value = { slot, message: 'That saved run could not be written out.' };
    }
  } catch {
    if (revision === saveActionRevision) {
      saveActionError.value = { slot, message: 'That saved run could not be written out.' };
    }
  } finally {
    exportingSlots.value.delete(slot);
  }
}

async function retryLibrary(): Promise<void> {
  // Two host recovery reads could complete out of order and restore stale
  // Library history. Refuse a second attempt until the first has settled.
  if (retryingLibrary.value) return;
  retryingLibrary.value = true;
  // The store keeps the Library unavailable on failure and exposes retry.
  // A rejected retry must not become an unhandled button-click Promise.
  try { await props.actions.retryLibrary(); } catch { /* Retry remains visible. */ }
  finally { retryingLibrary.value = false; }
}

function requestClearLibrary(): void {
  // Disabled controls alone do not protect against a stale dispatched click.
  if (beginning || clearingLibrary.value || removingRun.value !== null) return;
  confirmingRemoveRun.value = null;
  confirmingClearLibrary.value = true;
}

async function clearLibrary(): Promise<void> {
  // Clear and Remove share one host Library. Refuse stale/programmatic clicks
  // as well as disabling the controls while either write is in flight.
  if (beginning || !confirmingClearLibrary.value || clearingLibrary.value || removingRun.value !== null) return;
  clearingLibrary.value = true;
  confirmingClearLibrary.value = false;
  libraryError.value = null;
  try {
    await props.actions.clearLibrary();
  } catch {
    libraryError.value = 'The Library could not be cleared. Your saved houses are still here. Try again.';
  } finally {
    clearingLibrary.value = false;
  }
}

function requestRemoveLibraryRun(id: string): void {
  if (beginning || removingRun.value !== null || clearingLibrary.value) return;
  confirmingClearLibrary.value = false;
  confirmingRemoveRun.value = id;
  libraryError.value = null;
}

function cancelRemoveLibraryRun(): void {
  if (removingRun.value !== null || clearingLibrary.value) return;
  confirmingRemoveRun.value = null;
}

async function removeLibraryRun(id: string): Promise<void> {
  // A stale click, or a second click while the host is deleting, cannot
  // remove another house or issue the same irreversible command twice.
  if (beginning || confirmingRemoveRun.value !== id || removingRun.value !== null || clearingLibrary.value) return;
  removingRun.value = id;
  libraryError.value = null;
  try {
    await props.actions.deleteLibraryRun(id);
    confirmingRemoveRun.value = null;
  } catch {
    // Keep the confirmation visible so the player can retry or cancel.
    libraryError.value = 'That house could not be removed from the Library. Try again.';
  } finally {
    removingRun.value = null;
  }
}

onMounted(() => { void refreshSaves(); });
</script>

<template>
  <main class="start">
    <h1>Eldritch Dynasty</h1>

    <p class="frame">
      <template v-if="plain">In {{ selectedCampaign.startYear }}, an ancestor made an agreement.
        In {{ selectedCampaign.endYear }}, the other party comes to collect what is owed.</template>
      <template v-else>In the year {{ selectedCampaign.startYear }} an ancestor signed something.
        In {{ selectedCampaign.endYear }} the other party comes to collect.</template>
    </p>
    <p class="frame">
      <template v-if="plain">You guide this family across generations. You decide whom they marry,
        what they sacrifice, and what their records say happened.</template>
      <template v-else>You are not any of the people in this house. You are the thing that goes on in it while
        they are born, married and buried — the will that decides who marries whom, who is
        spent, and what the book says about it afterwards.</template>
    </p>
    <p class="frame dim small">
      {{ plain ? 'The story begins during the Hollow Days, at a table with three objects.' : 'It begins on the last of the Hollow Days, at a table, with three things on it.' }}
    </p>

    <fieldset class="campaigns">
      <legend class="label">{{ plain ? 'Choose the length of your game' : 'The length of the line' }}</legend>
      <label v-for="choice in CAMPAIGN_CHOICES" :key="choice.id" class="campaign panel">
        <input v-model="campaign" type="radio" name="campaign" :value="choice.id" />
        <span>
          <strong>{{ choice.name }}</strong>
          <span class="dim small">
            {{ choice.years }} years
            <template v-if="choice.id === 'short'">{{ plain ? ' — the default. Resolve three Ledger clauses, with four possible endings over 300 years.' : ' — the default. A three-clause Ledger to settle, with four endings shaped for a three-century line.' }}</template>
            <template v-else>{{ plain ? ' — resolve all nine Ledger clauses, reach every ascension level including Apotheosis, and encounter more stories.' : ' — the full nine-clause Ledger, the complete ladder including Apotheosis, and broader story reach.' }}</template>
          </span>
        </span>
      </label>
    </fieldset>

    <div class="row primary-row">
      <button v-if="resumable" class="primary" :disabled="resuming || loadingSlot !== null || importingSave" @click="continueLastSitting()">{{ resuming ? (plain ? 'Loading…' : 'Continuing…') : (plain ? 'Continue your last game' : 'Continue the last sitting') }}</button>
      <button
        :class="resumable ? 'quiet' : 'primary'"
        :disabled="!mayBegin"
        @click="begin()"
      >
        {{ !libraryIsReady ? (plain ? 'Loading completed games…' : 'Reading the library…') : resumable ? (plain ? 'Start a new game' : 'Begin a new signing') : (plain ? 'Start playing' : 'Begin the signing') }}
      </button>
    </div>
    <p v-if="resumeRefused" class="resume-refusal rubric small" role="status">{{ displayError(resumeRefused) }}</p>
    <div v-if="!libraryIsReady && libraryReadError" class="save-list-error" role="alert">
      <p class="rubric small">{{ plain ? 'Could not load your completed games. Nothing has been changed.' : 'The Library of Houses could not be read. Its saved history has not been changed.' }}</p>
      <button class="quiet small" :disabled="retryingLibrary" @click="retryLibrary()">{{ retryingLibrary ? 'Retrying…' : (plain ? 'Try loading completed games again' : 'Retry reading the Library') }}</button>
    </div>

    <section class="reading panel" aria-label="Reading settings">
      <h2>{{ plain ? 'Reading settings' : 'Reading' }}</h2>
      <ReadingSettings
        :text-scale="textScale"
        :reading-font="readingFont"
        :prose-mode="proseMode"
        :skip-seen-prose="skipSeenProse"
        :reduce-motion="reduceMotion"
        @update:text-scale="emit('update:textScale', $event)"
        @update:reading-font="emit('update:readingFont', $event)"
        @update:prose-mode="emit('update:proseMode', $event)"
        @update:skip-seen-prose="emit('update:skipSeenProse', $event)"
        @update:reduce-motion="emit('update:reduceMotion', $event)"
      />
    </section>

    <section v-if="completedHouses.length" class="library panel" aria-label="Library of Houses">
      <div class="library-head">
        <div>
          <h2>{{ plain ? 'Completed houses' : 'The Library of Houses' }}</h2>
          <p class="dim small">{{ plain ? 'Finished games are kept here. Their stories can appear in later games.' : 'Finished lines remain here. A new house may hear them repeated badly.' }}</p>
        </div>
        <button
          v-if="!confirmingClearLibrary"
          class="quiet small"
          :disabled="removingRun !== null || clearingLibrary"
          @click="requestClearLibrary()"
        >{{ clearingLibrary ? (plain ? 'Removing…' : 'Clearing…') : (plain ? 'Remove all' : 'Clear') }}</button>
        <div v-else class="library-clear-confirm" role="group" aria-label="Confirm clearing the Library of Houses">
          <p class="rubric small">{{ plain ? 'Remove all' : 'Clear all' }} {{ completedHouses.length }} completed houses? This cannot be undone.</p>
          <button class="quiet small confirm-clear" :disabled="removingRun !== null || clearingLibrary" @click="clearLibrary()">{{ plain ? 'Yes, remove all' : 'Yes, clear all' }}</button>
          <button class="quiet small" @click="confirmingClearLibrary = false">Cancel</button>
        </div>
      </div>
      <p v-if="libraryError" class="rubric small" role="alert">{{ displayError(libraryError) }}</p>
      <article v-for="run in completedHouses" :key="run.id" class="library-run">
        <div class="library-title">
          <strong>{{ run.house }}</strong>
          <span class="dim small">— {{ run.ending.title }}, {{ run.endedYear }}</span>
          <button
            v-if="confirmingRemoveRun !== run.id"
            class="quiet small"
            :disabled="removingRun !== null || clearingLibrary"
            @click="requestRemoveLibraryRun(run.id)"
          >Remove</button>
          <div
            v-else
            class="library-remove-confirm"
            role="group"
            :aria-label="`Confirm removing ${run.house}`"
          >
            <span class="rubric small">Remove {{ run.house }}? This cannot be undone.</span>
            <button
              class="quiet small confirm-remove"
              :disabled="removingRun !== null || clearingLibrary"
              @click="removeLibraryRun(run.id)"
            >{{ removingRun === run.id ? 'Removing…' : (plain ? 'Yes, remove this house' : 'Yes, remove') }}</button>
            <button class="quiet small" :disabled="removingRun !== null || clearingLibrary" @click="cancelRemoveLibraryRun()">Cancel</button>
          </div>
        </div>
        <p v-if="survivingPage(run)" class="small excerpt">“{{ survivingPage(run) }}”</p>
      </article>
    </section>

    <section v-if="namedSaves.length" class="saved panel" aria-label="Saved runs">
      <h2>{{ plain ? 'Saved games' : 'Runs written down' }}</h2>
      <p class="dim small">{{ plain ? 'These games remain saved after you close the app.' : 'They remain here when the application closes.' }}</p>
      <ul>
        <li v-for="save in namedSaves" :key="save.slot">
          <button class="quiet" :disabled="loadingSlot !== null || resuming || importingSave" @click="load(save.slot)">
            {{ save.slot === 'autosave' ? (plain ? 'Most recent game' : 'The last sitting') : save.slot }}
            <span class="dim">— {{ save.year ?? (plain ? 'unknown year' : 'an unread year') }}</span>
            <span v-if="loadingSlot === save.slot" class="dim"> · Loading…</span>
          </button>
          <button
            class="quiet small"
            :disabled="exportingSlots.has(save.slot)"
            @click="exportSave(save.slot)"
          >{{ exportingSlots.has(save.slot) ? (plain ? 'Exporting…' : 'Copying out…') : (plain ? 'Export' : 'Copy out') }}</button>
          <p v-if="saveActionError?.slot === save.slot" class="rubric small save-action-error" role="status">
            {{ displayError(saveActionError.message) }}
          </p>
        </li>
      </ul>
    </section>

    <div v-if="saveListError" class="save-list-error" role="alert">
      <p class="rubric small">{{ displayError(saveListError) }}</p>
      <button class="quiet small" :disabled="listingSaves" @click="refreshSaves()">{{ listingSaves ? 'Retrying…' : (plain ? 'Reload saved games' : 'Retry saved runs') }}</button>
    </div>

    <div class="row">
      <button class="quiet small" :disabled="importingSave || loadingSlot !== null || resuming" @click="importSave()">{{ importingSave ? 'Importing…' : (plain ? 'Import a saved game' : 'Bring a run in') }}</button>
      <p v-if="refused" class="rubric small" role="status">{{ displayError(refused) }}</p>
    </div>

    <div class="advanced">
      <button
        class="quiet small"
        :aria-expanded="showAdvanced"
        @click="showAdvanced = !showAdvanced"
      >{{ showAdvanced ? (plain ? 'Hide advanced options' : 'Hide advanced') : (plain ? 'Advanced options' : 'Advanced') }}</button>
      <div v-if="showAdvanced" class="row">
        <label class="dim small" for="seed">{{ plain ? 'Random seed' : 'seed' }}</label>
        <input
          id="seed"
          v-model.number="seed"
          type="number"
          min="0"
          max="4294967295"
          step="1"
          :aria-invalid="!validSeed"
          :aria-describedby="!validSeed ? 'seed-error' : undefined"
        />
        <p v-if="!validSeed" id="seed-error" class="rubric small" role="alert">
          {{ plain ? 'Enter a whole number between 0 and 4294967295.' : 'Use a whole number from 0 to 4294967295.' }}
        </p>
      </div>
    </div>

  </main>
</template>

<style scoped>
.start { max-width: 58ch; margin: 0 auto; padding: 110px 26px; }
h1 { font-size: var(--t-display); font-weight: 400; margin: 0 0 26px; letter-spacing: .04em; }
.frame { font-size: var(--t-lead); line-height: 1.75; color: var(--ink-soft); margin: 0 0 18px; }
.row { margin-top: 34px; }
.campaigns { border: 0; padding: 0; margin: 34px 0 0; }
.campaigns legend { margin-bottom: 10px; }
.campaign { display: flex; gap: 10px; align-items: flex-start; cursor: pointer; }
.campaign + .campaign { margin-top: 8px; }
.campaign input { width: auto; margin-top: 4px; }
.campaign strong, .campaign span { display: block; }
.primary-row { display: flex; gap: 12px; flex-wrap: wrap; }
input { width: 9ch; }
.saved { margin-top: 26px; }
.reading { margin-top: 26px; }
.reading h2 {
  margin: 0 0 12px; font-size: var(--t-label); letter-spacing: .14em;
  text-transform: uppercase; color: var(--ink-faint); font-weight: 600;
}
.library { margin-top: 26px; }
.library-head, .library-title { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
.library-head h2 { margin: 0; font-size: var(--t-label); letter-spacing: .14em; text-transform: uppercase; }
.library-head p { margin: 8px 0 0; }
.library-clear-confirm { display: flex; flex-wrap: wrap; gap: 8px; align-items: baseline; }
.library-clear-confirm p { margin: 0; }
.library-run { padding: 9px 0; border-top: 1px solid var(--rule); }
.library-run:first-of-type { margin-top: 10px; }
.library-title strong { font-weight: 600; }
.library-title button { margin-left: auto; }
.excerpt { margin: 6px 0 0; line-height: 1.55; color: var(--ink-soft); font-style: italic; }
.saved h2 { margin: 0; font-size: var(--t-label); letter-spacing: .14em; text-transform: uppercase; }
.saved p { margin: 8px 0; }
.saved ul { list-style: none; padding: 0; margin: 0; }
.saved li + li { margin-top: 4px; }
.saved .save-action-error { margin: 6px 0 0; }
.save-list-error { margin-top: 14px; }
.save-list-error p { margin: 0 0 8px; }
.advanced { margin-top: 46px; }
.advanced .row { margin-top: 14px; }
</style>
