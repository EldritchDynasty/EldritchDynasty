<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue';
import { validateBundle } from '@ed/schema';
import { rawContent, store } from './lib/store';
import { eventIssueId } from './lib/event-issues';
import { Sound } from '../../client/src/lib/sound';
import { SOUND } from './lib/audio-key';
import type { MarkName } from './lib/marks';
import Mark from './components/Mark.vue';
import EventEditor from './components/EventEditor.vue';
import ArcEditor from './components/ArcEditor.vue';
import CharacterEditor from './components/CharacterEditor.vue';
import FamilyTree from './components/FamilyTree.vue';
import SimRunner from './components/SimRunner.vue';
import Instruments from './components/Instruments.vue';
import CoreProseEditor from './components/CoreProseEditor.vue';
import WorkingsEditor from './components/WorkingsEditor.vue';

/**
 * `content` is re-indexed from `store.bundle` — the live, shared, reactive
 * model every editing surface mutates directly (issue #20). Re-indexing is
 * cheap (a handful of `Map`s over arrays already in memory) and correct: a
 * cached `Content` would drift the moment an id changed, which is precisely
 * the kind of silent staleness this file used to have with local copies.
 *
 * It indexes the RAW bundle (`rawContent`, issue #1891): handing `core` Vue
 * proxies made every world build throw in the browser, and the render error
 * unmounted the whole editor on boot. Raw reads also take validation off the
 * proxy path. Being raw, `content` cannot track an edit; `store.revision`
 * tells it one happened.
 *
 * It follows the revision once typing pauses rather than on every key.
 * Re-indexing, validating 500-odd events and re-rendering every view that
 * reads `content` cost most of a second per keystroke. The fields being typed
 * into read `store.bundle` and stay live; validation and cross-references
 * trail the last key by SETTLE_MS, and the rail says so while they do.
 */
const SETTLE_MS = 250;
const settled = ref(store.revision);
let settleTimer: ReturnType<typeof setTimeout> | undefined;
watch(() => store.revision, (revision) => {
  clearTimeout(settleTimer);
  settleTimer = setTimeout(() => { settled.value = revision; }, SETTLE_MS);
});
onBeforeUnmount(() => clearTimeout(settleTimer));

// A file-level dirty set already owns the truth about unsaved YAML and core
// prose. Warn only when leaving the editor, never on internal tab navigation.
function warnBeforeUnload(event: BeforeUnloadEvent) {
  if (store.dirty.size === 0) return;
  event.preventDefault();
  event.returnValue = '';
}
onMounted(() => window.addEventListener('beforeunload', warnBeforeUnload));
onBeforeUnmount(() => window.removeEventListener('beforeunload', warnBeforeUnload));
const validating = computed(() => settled.value !== store.revision);
const content = computed(() => {
  void settled.value;
  return rawContent();
});
const tab = ref<Tab>('events');

const issues = computed(() => validateBundle(content.value.bundle));
const errors = computed(() => issues.value.filter((i) => i.level === 'error').length);
const warnings = computed(() => issues.value.length - errors.value);

// Link from the rail's global error count to a real, authored event, rather
// than presenting a validation total that cannot be acted on.
const firstEventErrorId = computed(() => {
  const eventIds = new Set(store.bundle.events.map((event) => event.id));
  for (const issue of issues.value) {
    const id = eventIssueId(issue);
    if (issue.level === 'error' && id && eventIds.has(id)) return id;
  }
  return undefined;
});
const focusEvent = ref<{ id: string; sequence: number }>();
function showFirstEventError() {
  if (!firstEventErrorId.value) return;
  focusEvent.value = { id: firstEventErrorId.value, sequence: (focusEvent.value?.sequence ?? 0) + 1 };
  tab.value = 'events';
}

/**
 * The one audio engine, provided to everything below (`lib/audio-key.ts`).
 * It is muted until somebody asks for it and it builds no `AudioContext`
 * until then — §24's sound is sparse, and silence is sparser.
 */
const sound = new Sound();
const muted = ref(sound.muted);
provide(SOUND, sound);
onBeforeUnmount(() => sound.close());

function toggleSound() {
  sound.muted = !sound.muted;
  muted.value = sound.muted;
  // The bell is the sound announcing itself. Turning it ON is the one moment
  // a cue is the whole message, and it doubles as proof the engine woke up.
  if (!sound.muted) sound.cue('bell');
}

type Tab = 'events' | 'arcs' | 'characters' | 'tree' | 'sim' | 'instruments' | 'core-prose' | 'workings';

const tabs: { id: Tab; label: string; mark: MarkName }[] = [
  { id: 'events', label: 'Events', mark: 'quill' },
  { id: 'arcs', label: 'Substories', mark: 'thread' },
  { id: 'characters', label: 'Characters', mark: 'escutcheon' },
  { id: 'workings', label: 'Workings', mark: 'quill' },
  { id: 'core-prose', label: 'Core prose', mark: 'quill' },
  { id: 'tree', label: 'Family tree', mark: 'bough' },
  { id: 'sim', label: 'Simulate', mark: 'hourglass' },
  { id: 'instruments', label: 'Instruments', mark: 'dividers' },
];

// A plain handler rather than an inline `as` cast: TS casts inside template
// expressions confuse the compiler's ref-assignment rewrite, and it fails
// silently — the click lands and nothing happens.
function select(id: Tab) {
  tab.value = id;
}
</script>

<template>
  <div class="shell">
    <nav class="rail" aria-label="Views">
      <h1>Eldritch Dynasty<small>editor · v0.1</small></h1>
      <button
        v-for="t in tabs" :key="t.id"
        :class="{ on: tab === t.id }"
        :aria-current="tab === t.id ? 'page' : undefined"
        @click="select(t.id)"
      ><Mark :name="t.mark" :size="17" />{{ t.label }}</button>
      <div class="spacer" />
      <div class="meta">
        <div class="counts">
          {{ content.events.length }} events · {{ content.arcs.length }} substories<br />
          {{ content.ages.length }} ages · {{ content.characters.length }} seed cast<br />
          {{ content.loci.length }} loci
        </div>
        <div class="state" role="status">
          <span v-if="validating">validating…</span>
          <template v-else>
            <button v-if="firstEventErrorId" type="button" class="issue-jump"
                    :class="{ bad: errors }" title="Find the first event error"
                    @click="showFirstEventError">{{ errors }} error{{ errors === 1 ? '' : 's' }}</button>
            <span v-else :class="{ bad: errors }">{{ errors }} error{{ errors === 1 ? '' : 's' }}</span>
            · {{ warnings }} warning{{ warnings === 1 ? '' : 's' }}
          </template><br />
          <span v-if="store.dirty.size" class="bad">
            {{ store.dirty.size }} file{{ store.dirty.size > 1 ? 's' : '' }} unsaved
          </span>
          <span v-else>nothing unsaved</span>
        </div>
        <button
          v-if="sound.available"
          class="sound" type="button"
          :aria-pressed="!muted"
          @click="toggleSound"
        >
          <Mark :name="muted ? 'bell-still' : 'bell'" :size="15" />
          {{ muted ? 'Sound off' : 'Sound on' }}
        </button>
      </div>
    </nav>

    <main class="main">
      <EventEditor v-if="tab === 'events'" :content="content" :issues="issues" :focus-event="focusEvent" />
      <ArcEditor v-else-if="tab === 'arcs'" :content="content" :issues="issues" />
      <CharacterEditor v-else-if="tab === 'characters'" :content="content" />
      <WorkingsEditor v-else-if="tab === 'workings'" />
      <FamilyTree v-else-if="tab === 'tree'" :content="content" />
      <SimRunner v-else-if="tab === 'sim'" :content="content" />
      <CoreProseEditor v-else-if="tab === 'core-prose'" />
      <Instruments v-else :content="content" :issues="issues" />
    </main>
  </div>
</template>
