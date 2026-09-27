<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import type { FrameEntry } from '@ed/schema';
import type { SessionView } from '@ed/core';
import { findEntry, linksFor } from '../lib/causes';
import type { GameActions } from '../lib/game';
import Entry from './Entry.vue';

const props = defineProps<{
  view: SessionView;
  frame: FrameEntry[];
  /** Only the two reads behind a page's way back (issue #269). */
  actions: Pick<GameActions, 'causeOf' | 'answeredBy'>;
}>();
/** `open` with a page: the link names one older than this window holds. */
const emit = defineEmits<{ (e: 'open', page?: string): void }>();

const entries = computed(() => [...props.view.chronicle].reverse());
const links = computed(() => linksFor(entries.value, {
  causeOf: (id) => props.actions.causeOf(id),
  answeredBy: (id) => props.actions.answeredBy(id),
}));

const panel = ref<HTMLElement | null>(null);
const marked = ref<string | null>(null);
let unmark: ReturnType<typeof setTimeout> | undefined;

/**
 * THE WAY BACK (issue #269). A generation's echo points at a page fifty years
 * older, which is usually further back than this window's sixty lines; then
 * the volume opens at it instead.
 */
async function follow(id: string): Promise<void> {
  if (!entries.value.some((e) => e.id === id)) return emit('open', id);
  await nextTick();
  const el = findEntry(panel.value, id);
  el?.scrollIntoView({ block: 'center' });
  el?.focus({ preventScroll: true });
  marked.value = id;
  clearTimeout(unmark);
  unmark = setTimeout(() => { marked.value = null; }, 2400);
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

    <!-- FREQUENCY IS FELT HERE, as typography, and `Entry.vue` is where that
         lives now — one component for the panel, the reading pane and the
         creditor's account, because they draw the same artefact. -->
    <Entry
      v-for="(entry, i) in entries"
      :key="entry.id ?? entry.year + ':' + i"
      :entry="entry"
      :links="entry.id ? links.get(entry.id) : undefined"
      :marked="!!entry.id && marked === entry.id"
      @follow="follow"
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
