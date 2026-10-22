<script setup lang="ts">
import { computed, ref } from 'vue';
import { PrimordialResponseS, SceneSiteS, AgreedPriceS, potentialHarms, type Content, type EventTemplate, type Outcome } from '@ed/schema';
import { candidatesFor, fillOrder, previewPrimordial, TEST_FAMILIES, type SlotFill } from '@ed/core';
import EffectEditor from './EffectEditor.vue';

const props = defineProps<{ event: EventTemplate; outcome: Outcome; content?: Content }>();
const emit = defineEmits<{ change: [] }>();
const error = ref('');
const family = ref(TEST_FAMILIES[0]!.id);
const harms = computed(() => potentialHarms(props.outcome));
const preview = computed(() => {
  if (!props.content) return undefined;
  const fixture = TEST_FAMILIES.find(f => f.id === family.value)!;
  // A new private fixture on each read: editing/previewing cannot roll or
  // mutate any running simulation, its pending decision or its save.
  const ctx = fixture.build(props.content);
  const fill: SlotFill = {};
  for (const [slot, spec] of fillOrder(props.event.slots)) {
    const candidates = candidatesFor(spec, ctx, fill).map(p => p.id).sort();
    if (spec.count) fill[slot] = candidates.slice(0, spec.count.min);
    else if (candidates[0]) fill[slot] = candidates[0];
  }
  const reading = previewPrimordial(ctx, props.event, props.outcome, fill);
  return { ...reading, names: reading.candidates.map(p => ctx.world.people.get(p.id)!.name) };
});

function edit(field: 'site' | 'agreedPrices' | 'primordial', event: Event) {
  const text = (event.target as HTMLTextAreaElement).value;
  try {
    if (!text.trim()) delete props.outcome[field];
    else {
      const raw: unknown = JSON.parse(text);
      if (field === 'site') props.outcome.site = SceneSiteS.parse(raw);
      else if (field === 'agreedPrices') props.outcome.agreedPrices = AgreedPriceS.array().parse(raw);
      else props.outcome.primordial = PrimordialResponseS.parse(raw);
    }
    error.value = '';
    emit('change');
  } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause); }
}
</script>

<template>
  <details class="primordial-editor">
    <summary>Emergency intervention · {{ harms.length ? harms.join(', ') : 'no potential major harm' }}</summary>
    <p>Assess the ordinary result first. The response replaces its whole effect bundle; the actor is bound as PRIMORDIAL_ACTOR.</p>
    <label>Incident site (outcome override)
      <textarea :value="JSON.stringify(outcome.site ?? event.site, null, 2)" aria-label="Incident site" @change="edit('site', $event)" />
    </label>
    <label>Agreed prices (effect indexes and typed reasons)
      <textarea :value="JSON.stringify(outcome.agreedPrices, null, 2)" aria-label="Agreed prices" @change="edit('agreedPrices', $event)" />
    </label>
    <label>Complete response and public Record (paired wording is in Prose variants)
      <textarea class="contract" :value="JSON.stringify(outcome.primordial, null, 2)" aria-label="Primordial response" @change="edit('primordial', $event)" />
    </label>
    <EffectEditor v-if="outcome.primordial" v-model="outcome.primordial.effects" :slot-names="[...Object.keys(event.slots), 'PRIMORDIAL_ACTOR']" @update:model-value="emit('change')" />
    <p v-if="error" role="alert">{{ error }}</p>
    <label v-if="content">Preview family
      <select v-model="family"><option v-for="fixture in TEST_FAMILIES" :key="fixture.id" :value="fixture.id">{{ fixture.name }}</option></select>
    </label>
    <template v-if="preview">
      <p>Qualifying now: {{ preview.normal.categories.join(', ') || 'none' }}. Present eligible actors: {{ preview.names.join(', ') || 'none' }}.</p>
      <p>Combined chance: {{ (preview.probability * 100).toFixed(1) }}%. No roll is made by this preview.</p>
      <p v-if="preview.final">Threatened cash loss: {{ preview.normal.cashLoss }} → {{ preview.final.cashLoss }}. Deaths: {{ preview.normal.deaths.length }} → {{ preview.final.deaths.length }}.</p>
    </template>
  </details>
</template>

<style scoped>
.primordial-editor { margin-block: 8px; border-top: 1px solid var(--rule); padding-block: 6px; }
label { display: block; margin-block: 6px; }
textarea { width: 100%; min-height: 4em; }
.contract { min-height: 12em; }
</style>
