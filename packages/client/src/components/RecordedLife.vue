<script setup lang="ts">
import { computed } from 'vue';
import type { RecordedMilestone } from '@ed/core';
import type { ProseMode } from '@ed/schema';
import type { GameStore } from '../lib/game';

const props = defineProps<{
  person: string;
  read: GameStore['milestones'];
  proseMode?: ProseMode;
}>();
const emit = defineEmits<{ (e: 'book', page: string): void }>();
const plain = computed(() => props.proseMode === 'plainenglish');
const pages = computed(() => props.read(props.person));
const all = computed(() => props.read(props.person, { limit: Infinity }));
const allLabel = computed(() => {
  const count = all.value.length;
  if (count === 1) return plain.value ? '1 Chronicle page' : '1 page in the book';
  return plain.value ? `All ${count} Chronicle pages` : `All ${count} pages in the book`;
});
const disputes = computed<Record<NonNullable<RecordedMilestone['disputed']>, string>>(() => plain.value
  ? { open: 'dispute open', proven: 'discrepancy proven', buried: 'dispute buried' }
  : { open: 'account questioned', proven: 'discrepancy proven', buried: 'dispute buried' });
function label(page: RecordedMilestone): string {
  switch (page.source) {
    case 'blank': return plain.value ? 'deliberately left blank' : 'left blank, on purpose';
    case 'deed':
    case 'title': return page.label ?? (plain.value ? 'Chronicle page' : 'a page of the book');
    default: {
      const unhandled: never = page.source;
      throw new Error(`Unhandled milestone source: ${unhandled}`);
    }
  }
}
function accessibleName(page: RecordedMilestone): string {
  const dispute = page.disputed ? ` — ${disputes.value[page.disputed]}` : '';
  return `${page.year}: ${label(page)}${dispute} — ${plain.value ? 'open Chronicle page' : 'open page'}`;
}
</script>

<template>
  <div class="recorded-life">
    <p class="heading small rubric">{{ plain ? 'Recorded history' : 'The recorded life' }}</p>
    <ol v-if="pages.length">
      <li v-for="page in pages" :key="page.entryId">
        <button type="button" class="quiet milestone" :data-milestone="page.entryId" :aria-label="accessibleName(page)" @click.stop="emit('book', page.entryId)">
          <span class="year dim">{{ page.year }}</span>
          <span>{{ label(page) }}<span v-if="page.disputed" class="rubric dispute"> · {{ disputes[page.disputed] }}</span></span>
        </button>
      </li>
    </ol>
    <p v-else class="small dim empty">{{ plain ? 'No Chronicle pages name this person.' : 'The book has no pages naming them.' }}</p>
    <details v-if="all.length" class="all-pages">
      <summary>{{ allLabel }}</summary>
      <ol>
        <li v-for="page in all" :key="page.entryId">
          <button type="button" class="quiet milestone" :data-history-page="page.entryId" :aria-label="accessibleName(page)" @click.stop="emit('book', page.entryId)">
            <span class="year dim">{{ page.year }}</span>
            <span>{{ label(page) }}<span v-if="page.disputed" class="rubric dispute"> · {{ disputes[page.disputed] }}</span></span>
          </button>
        </li>
      </ol>
    </details>
  </div>
</template>

<style scoped>
.recorded-life { min-width: 0; font-size: var(--t-fine); }
.heading { margin: 8px 0 4px; }
ol { margin: 0; padding: 0; list-style: none; }
.milestone { display: flex; align-items: baseline; gap: 8px; min-height: 44px; width: 100%; padding: 8px 0; text-align: left; color: var(--ink); font-size: var(--t-fine); line-height: 1.5; overflow-wrap: anywhere; }
.year { flex: 0 0 auto; font-variant-numeric: tabular-nums; }
.milestone > span:last-child { min-width: 0; }
.milestone:hover > span:last-child { text-decoration: underline; }
.all-pages { margin-top: 4px; }
summary { min-height: 44px; padding: 8px 0; cursor: pointer; color: var(--ink-soft); }
.empty { margin: 4px 0 8px; }
@media (max-width: 640px) {
  .milestone, summary { scroll-margin-block: 12px calc(7rem + env(safe-area-inset-bottom)); }
}
</style>
