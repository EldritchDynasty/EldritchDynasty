<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { CAMPAIGN_CHOICES, type GameActions } from '../lib/game';
import type { SaveSummary } from '../platform';
import type { LibraryRun, RunLibrary } from '@ed/schema';
import ReadingSettings from './ReadingSettings.vue';
import type { ReadingFont, TextScale } from '../lib/accessibility';

const props = withDefaults(defineProps<{
  actions: GameActions;
  resumable: boolean;
  library?: RunLibrary;
  libraryReady?: boolean;
  textScale?: TextScale;
  readingFont?: ReadingFont;
  skipSeenProse?: boolean;
  reduceMotion?: boolean;
}>(), {
  libraryReady: true,
  textScale: 'standard',
  readingFont: 'book',
  skipSeenProse: false,
  reduceMotion: false,
});

const emit = defineEmits<{
  'update:textScale': [value: TextScale];
  'update:readingFont': [value: ReadingFont];
  'update:skipSeenProse': [value: boolean];
  'update:reduceMotion': [value: boolean];
}>();

const campaign = ref(CAMPAIGN_CHOICES[0].id);
const selectedCampaign = computed(() => CAMPAIGN_CHOICES.find((c) => c.id === campaign.value) ?? CAMPAIGN_CHOICES[0]);
const seed = ref(CAMPAIGN_CHOICES[0].startYear);
const saves = ref<SaveSummary[]>([]);
const refused = ref<string | null>(null);
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
const namedSaves = computed(() => saves.value.filter((s) => !(props.resumable && s.slot === 'autosave')));
const completedHouses = computed(() => [...(props.library?.runs ?? [])].reverse());
const mayBegin = computed(() => props.libraryReady ?? true);

function survivingPage(run: LibraryRun): string | undefined {
  return [...run.entries].reverse().find((entry) => entry.said)?.said;
}

async function refreshSaves(): Promise<void> {
  saves.value = await props.actions.listSaves();
}

async function load(slot: string): Promise<void> {
  refused.value = await props.actions.load(slot) ? null : 'That saved run could not be read.';
}

async function importSave(): Promise<void> {
  refused.value = await props.actions.importSave() ? null : 'That file was not a run this version can read.';
}

async function exportSave(slot: string): Promise<void> {
  refused.value = await props.actions.exportSave(slot) ? null : 'That saved run could not be written out.';
}

onMounted(() => { void refreshSaves(); });
</script>

<template>
  <main class="start">
    <h1>Eldritch Dynasty</h1>

    <p class="frame">
      In the year {{ selectedCampaign.startYear }} an ancestor signed something.
      In {{ selectedCampaign.endYear }} the other party comes to collect.
    </p>
    <p class="frame">
      You are not any of the people in this house. You are the thing that goes on in it while
      they are born, married and buried — the will that decides who marries whom, who is
      spent, and what the book says about it afterwards.
    </p>
    <p class="frame dim small">
      It begins on the last of the Hollow Days, at a table, with three things on it.
    </p>

    <fieldset class="campaigns">
      <legend class="label">The length of the line</legend>
      <label v-for="choice in CAMPAIGN_CHOICES" :key="choice.id" class="campaign panel">
        <input v-model="campaign" type="radio" name="campaign" :value="choice.id" />
        <span>
          <strong>{{ choice.name }}</strong>
          <span class="dim small">
            {{ choice.years }} years
            <template v-if="choice.id === 'short'"> — the default. A three-clause Ledger to settle, with four endings shaped for a three-century line.</template>
            <template v-else> — the full nine-clause Ledger, the complete ladder including Apotheosis, and broader story reach.</template>
          </span>
        </span>
      </label>
    </fieldset>

    <div class="row primary-row">
      <button v-if="resumable" class="primary" @click="actions.resume()">Continue the last sitting</button>
      <button
        :class="resumable ? 'quiet' : 'primary'"
        :disabled="!mayBegin"
        @click="actions.begin(seed, campaign)"
      >
        {{ !mayBegin ? 'Reading the library…' : resumable ? 'Begin a new signing' : 'Begin the signing' }}
      </button>
    </div>

    <section class="reading panel" aria-label="Reading settings">
      <h2>Reading</h2>
      <ReadingSettings
        :text-scale="textScale"
        :reading-font="readingFont"
        :skip-seen-prose="skipSeenProse"
        :reduce-motion="reduceMotion"
        @update:text-scale="emit('update:textScale', $event)"
        @update:reading-font="emit('update:readingFont', $event)"
        @update:skip-seen-prose="emit('update:skipSeenProse', $event)"
        @update:reduce-motion="emit('update:reduceMotion', $event)"
      />
    </section>

    <section v-if="completedHouses.length" class="library panel" aria-label="Library of Houses">
      <div class="library-head">
        <div>
          <h2>The Library of Houses</h2>
          <p class="dim small">Finished lines remain here. A new house may hear them repeated badly.</p>
        </div>
        <button class="quiet small" @click="actions.clearLibrary()">Clear</button>
      </div>
      <article v-for="run in completedHouses" :key="run.id" class="library-run">
        <div class="library-title">
          <strong>{{ run.house }}</strong>
          <span class="dim small">— {{ run.ending.title }}, {{ run.endedYear }}</span>
          <button class="quiet small" @click="actions.deleteLibraryRun(run.id)">Remove</button>
        </div>
        <p v-if="survivingPage(run)" class="small excerpt">“{{ survivingPage(run) }}”</p>
      </article>
    </section>

    <section v-if="namedSaves.length" class="saved panel" aria-label="Saved runs">
      <h2>Runs written down</h2>
      <p class="dim small">They remain here when the application closes.</p>
      <ul>
        <li v-for="save in namedSaves" :key="save.slot">
          <button class="quiet" @click="load(save.slot)">
            {{ save.slot === 'autosave' ? 'The last sitting' : save.slot }}
            <span class="dim">— {{ save.year ?? 'an unread year' }}</span>
          </button>
          <button class="quiet small" @click="exportSave(save.slot)">Copy out</button>
        </li>
      </ul>
    </section>

    <div class="row">
      <button class="quiet small" @click="importSave()">Bring a run in</button>
      <p v-if="refused" class="rubric small" role="status">{{ refused }}</p>
    </div>

    <div class="advanced">
      <button
        class="quiet small"
        :aria-expanded="showAdvanced"
        @click="showAdvanced = !showAdvanced"
      >{{ showAdvanced ? 'Hide advanced' : 'Advanced' }}</button>
      <div v-if="showAdvanced" class="row">
        <label class="dim small" for="seed">seed</label>
        <input id="seed" type="number" v-model.number="seed" />
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
.library-run { padding: 9px 0; border-top: 1px solid var(--rule); }
.library-run:first-of-type { margin-top: 10px; }
.library-title strong { font-weight: 600; }
.library-title button { margin-left: auto; }
.excerpt { margin: 6px 0 0; line-height: 1.55; color: var(--ink-soft); font-style: italic; }
.saved h2 { margin: 0; font-size: var(--t-label); letter-spacing: .14em; text-transform: uppercase; }
.saved p { margin: 8px 0; }
.saved ul { list-style: none; padding: 0; margin: 0; }
.saved li + li { margin-top: 4px; }
.advanced { margin-top: 46px; }
.advanced .row { margin-top: 14px; }
</style>
