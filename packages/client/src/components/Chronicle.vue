<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import type { FrameEntry } from '@ed/schema';
import type { HelpTier, SessionView } from '@ed/core';
import { findEntry, linksFor } from '../lib/causes';
import type { GameActions } from '../lib/game';
import Entry from './Entry.vue';
import AdviserHelp from './AdviserHelp.vue';

const props = defineProps<{
  view: SessionView;
  frame: FrameEntry[];
  /** Only the two reads behind a page's way back (issue #269). */
  actions: Pick<GameActions, 'causeOf' | 'answeredBy' | 'advice'>;
}>();
/** `open` with a page: the link names one older than this window holds. */
const emit = defineEmits<{
  (e: 'open', page?: string): void;
  (e: 'person', id: string): void;
}>();

const entries = computed(() => [...props.view.chronicle].reverse());

/**
 * STRUCTURAL PEOPLE LINKS (#268). A Chronicle page outlives its cast:
 * current halls omit the dead, so resolve the IDs against the engine's
 * window-scoped provenance names. Never infer identities from prose.
 */
const chronicleNamesById = computed(() => new Map(
  (props.view.chroniclePeople ?? []).map((person) => [person.id, person.name]),
));
const navigableIds = computed(() => new Set(
  (props.view.halls ?? []).flatMap((hall) => hall.members.map((member) => member.id)),
));
function peopleFor(entry: SessionView['chronicle'][number]): { id: string; name: string; available: boolean }[] {
  const seen = new Set<string>();
  const out: { id: string; name: string; available: boolean }[] = [];
  for (const id of entry.people ?? []) {
    if (seen.has(id)) continue;
    seen.add(id);
    const name = chronicleNamesById.value.get(id);
    if (name) out.push({ id, name, available: navigableIds.value.has(id) });
  }
  return out;
}

const links = computed(() => linksFor(entries.value, {
  causeOf: (id) => props.actions.causeOf(id),
  answeredBy: (id) => props.actions.answeredBy(id),
}));

const panel = ref<HTMLElement | null>(null);
const marked = ref<string | null>(null);
let unmark: ReturnType<typeof setTimeout> | undefined;

function askAdviser(tier: HelpTier) {
  return props.actions.advice('chronicle', 'chronicle', tier);
}

/**
 * THE WAY BACK (issue #269). A generation's echo points at a page fifty years
 * older, which is usually further back than this window's sixty lines; then
 * the volume opens at it instead.
 */
async function follow(id: string): Promise<void> {
  if (!entries.value.some((e) => e.id === id)) return emit('open', id);
  // Entry is focusable only while marked (tabindex=-1). Render that state
  // BEFORE attempting focus so keyboard readers follow the cause link too.
  clearTimeout(unmark);
  marked.value = id;
  await nextTick();
  // Two links may be followed before Vue finishes rendering the first one.
  // Only the latest destination may take focus or clear its highlight.
  if (marked.value !== id) return;
  const el = findEntry(panel.value, id);
  el?.scrollIntoView({ block: 'center' });
  el?.focus({ preventScroll: true });
  unmark = setTimeout(() => {
    if (marked.value === id) marked.value = null;
  }, 2400);
}
</script>

<template>
  <section ref="panel" class="chronicle">
    <!-- The way in to the volume (issue #48). This panel is a rolling window
         on the last sixty entries; everything before it was unreachable from
         any client, in a game that is about what gets written down. -->
    <h3 class="label row top">
      <span>The chronicle</span>
      <button class="quiet small" @click="emit('open')">Read it whole</button>
    </h3>
    <AdviserHelp :ask="askAdviser" :reset-key="`chronicle:${view.house}`" />

    <!-- FREQUENCY IS FELT HERE, as typography, and `Entry.vue` is where that
         lives now — one component for the panel, the reading pane and the
         creditor's account, because they draw the same artefact. -->
    <Entry
      v-for="(entry, i) in entries"
      :key="entry.id ?? entry.year + ':' + i"
      :entry="entry"
      :links="entry.id ? links.get(entry.id) : undefined"
      :marked="!!entry.id && marked === entry.id"
      :people="peopleFor(entry)"
      @follow="follow"
      @person="emit('person', $event)"
    />

    <!-- THE FRAME, WHICH IS QUIETER THAN THE TALE. The term has been writing while
         the family wrote its own, and it is kept apart from the chronicle
         because it is not the same book. -->
    <template v-if="frame.length">
      <h3 class="label frame-label">{{ view.campaign.endYear }}</h3>
      <article v-for="entry in frame" :key="entry.eventId + entry.year" class="entry frame">
        <p>{{ entry.text }}</p>
      </article>
    </template>
  </section>
</template>

<style scoped>
.chronicle { max-width: 46ch; }
.top { justify-content: space-between; align-items: baseline; gap: 10px; }
.frame-label { margin-top: 26px; border-top: 1px solid var(--rule); padding-top: 14px; }
.entry.frame { margin: 0 0 14px; }
.entry.frame p { margin: 2px 0 0; line-height: 1.6; font-style: italic; color: var(--ink-soft); }
</style>
