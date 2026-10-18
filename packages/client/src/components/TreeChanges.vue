<script setup lang="ts">
import { computed } from 'vue';
import type { GenerationChange, GenerationChanges } from '@ed/core';
import type { ProseMode } from '@ed/schema';

const props = defineProps<{ reading?: GenerationChanges; proseMode?: ProseMode }>();
const emit = defineEmits<{
  (e: 'tenure', index: number | undefined): void;
  (e: 'select', person: string): void;
  (e: 'book', page?: string): void;
}>();
const plain = computed(() => props.proseMode === 'plainenglish');
const copy = computed(() => plain.value ? {
  title: 'Changes during this leader’s time', empty: 'No family changes are recorded for these years yet.',
  noTenure: 'No leadership history has been recorded yet.', earlier: 'Previous leader', later: 'Next leader', current: 'Current leader',
  kinds: { birth: 'Born', death: 'Death recorded', marriage: 'Married', succession: 'Became house leader',
    branch: 'Changed household', rite_loss: 'Lost in a rite', blank: 'Blank Chronicle entry' },
  page: 'Read entry', blank: 'Read blank entry', unwritten: 'No Chronicle page was kept.',
  parents: 'Recorded parents:', spouse: 'with',
  more: (n: number) => `${n} more changes — read the Chronicle`,
} : {
  title: 'What changed under this seal', empty: 'The family has no changes recorded in these years yet.',
  noTenure: 'The line has not yet kept a tenure.', earlier: 'Earlier seal', later: 'Later seal', current: 'This seal',
  kinds: { birth: 'Born', death: 'Death in the book', marriage: 'Married', succession: 'Took the seal',
    branch: 'Changed halls', rite_loss: 'Spent in a rite', blank: 'A dated blank' },
  page: 'Read the page', blank: 'Read the blank', unwritten: 'The book has no page for this.',
  parents: 'The book names:', spouse: 'to',
  more: (n: number) => `${n} more changes — open the book`,
});
const heading = computed(() => {
  const held = props.reading?.tenure;
  if (!held) return copy.value.noTenure;
  const through = props.reading!.through;
  return plain.value
    ? `${held.name} led the house from ${held.from}${held.to === undefined ? `; shown through ${through}` : ` to ${through}`}.`
    : held.to === undefined ? `Since ${held.name} took the seal in ${held.from}; through ${through}.`
      : `${held.name} held the seal from ${held.from} to ${through}.`;
});
function follow(change: GenerationChange): void {
  if (change.inTree && change.person) emit('select', change.person);
  else if (change.pageId) emit('book', change.pageId);
}
function label(change: GenerationChange): string {
  if (change.inTree && change.person) return `${plain.value ? 'Show' : 'Find'} ${change.name} ${plain.value ? 'in the family tree' : 'in the halls'}`;
  return `${plain.value ? 'Read the Chronicle entry for' : 'Read the page for'} ${change.name ?? change.year}`;
}
</script>

<template>
  <section class="panel tree-changes" aria-labelledby="generation-changes-title">
    <h3 id="generation-changes-title" class="label">{{ copy.title }}</h3>
    <p class="small interval">{{ heading }}</p>
    <nav v-if="reading && reading.count > 1" class="tenures" :aria-label="plain ? 'Choose a leader’s time in office' : 'Choose a tenure of the seal'">
      <button class="quiet small" :disabled="reading.index === 0" @click="emit('tenure', reading.index - 1)">{{ copy.earlier }}</button>
      <span class="small dim">{{ reading.index + 1 }} / {{ reading.count }}</span>
      <button class="quiet small" :disabled="reading.index >= reading.count - 1" @click="emit('tenure', reading.index + 1)">{{ copy.later }}</button>
      <button v-if="reading.index !== reading.count - 1" class="quiet small" @click="emit('tenure', undefined)">{{ copy.current }}</button>
    </nav>
    <ol v-if="reading?.changes.length" class="changes">
      <li v-for="change in reading.changes" :key="change.id" :data-change="change.id">
        <span class="year dim">{{ change.year }}</span>
        <div class="change">
          <span class="small kind">{{ copy.kinds[change.kind] }}<template v-if="change.name">: </template></span>
          <button v-if="change.name && (change.inTree || change.pageId)" class="quiet person" :aria-label="label(change)" @click="follow(change)">{{ change.name }}</button>
          <span v-else-if="change.name" class="person">{{ change.name }}</span>
          <p v-if="change.related?.length" class="small dim related">
            {{ change.kind === 'marriage' ? copy.spouse : copy.parents }} {{ change.related.map((p) => p.name).join(', ') }}
          </p>
          <button v-if="change.pageId && (change.inTree || change.kind === 'blank')" class="quiet small page" :aria-label="`${change.kind === 'blank' ? copy.blank : copy.page}, ${change.year}${change.name ? `, ${change.name}` : ''}`" @click="emit('book', change.pageId)">{{ change.kind === 'blank' ? copy.blank : copy.page }}</button>
          <span v-else-if="!change.pageId && !change.inTree" class="small dim unwritten">{{ copy.unwritten }}</span>
        </div>
      </li>
    </ol>
    <p v-else-if="reading?.tenure" class="small dim empty">{{ copy.empty }}</p>
    <button v-if="reading?.more" class="quiet small more" @click="emit('book')">{{ copy.more(reading.more) }}</button>
  </section>
</template>

<style scoped>
.tree-changes { margin-bottom: 18px; min-width: 0; }
.interval { margin: 8px 0 12px; overflow-wrap: anywhere; }
.tenures { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; margin-bottom: 12px; }
.changes { list-style: none; padding: 0; margin: 0; }
.changes li { display: grid; grid-template-columns: 3.5rem minmax(0, 1fr); gap: 10px; padding: 9px 0; border-top: 1px solid var(--rule); }
.year { font-variant-numeric: tabular-nums; font-size: var(--t-fine); padding-top: 3px; }
.change { min-width: 0; overflow-wrap: anywhere; }
.person { font: inherit; text-align: left; }
button.person { padding: 0; text-decoration: underline; text-underline-offset: 3px; }
.related { margin: 4px 0; }
.page, .unwritten { display: block; margin-top: 5px; }
.more { margin-top: 12px; text-align: left; }
button:focus-visible { outline: 2px solid currentColor; outline-offset: 3px; }
@media (max-width: 420px) { .changes li { grid-template-columns: 3rem minmax(0, 1fr); gap: 8px; } }
</style>
