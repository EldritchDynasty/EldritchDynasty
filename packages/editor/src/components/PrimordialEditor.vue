<script setup lang="ts">
import { computed, ref } from 'vue';
import { PrimordialResponseS, AgreedPriceS, RecordBlockS, fieldsOfSchema, potentialHarms, type AgreedPrice, type Content, type EventTemplate, type Outcome } from '@ed/schema';
import { candidatesFor, fillOrder, previewPrimordial, TEST_FAMILIES, type SlotFill } from '@ed/core';
import EffectEditor from './EffectEditor.vue';
import { store } from '../lib/store';
import FieldInput from './FieldInput.vue';
import RecordEditor from './RecordEditor.vue';

const props = defineProps<{ event: EventTemplate; outcome: Outcome; content?: Content }>();
const emit = defineEmits<{ change: [] }>();
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

// The two price lists use the same schema and control descriptors. No raw
// JSON parsing or hand-kept copy of permitted price reasons.
const priceSpecs = fieldsOfSchema(AgreedPriceS);
const responseSpecs = fieldsOfSchema(PrimordialResponseS)
  .filter((spec) => ['id', 'text', 'tags', 'triggers', 'next'].includes(spec.key));
type PriceScope = 'ordinary' | 'response';

function prices(scope: PriceScope): AgreedPrice[] {
  return (scope === 'ordinary' ? props.outcome.agreedPrices : props.outcome.primordial?.agreedPrices) ?? [];
}
function setPrices(scope: PriceScope, updated: AgreedPrice[]) {
  if (scope === 'ordinary') {
    if (updated.length) props.outcome.agreedPrices = updated;
    else delete props.outcome.agreedPrices;
  } else if (props.outcome.primordial) {
    if (updated.length) props.outcome.primordial.agreedPrices = updated;
    else delete props.outcome.primordial.agreedPrices;
  }
  emit('change');
}
function priceValue(price: AgreedPrice, key: string): unknown {
  return (price as unknown as Record<string, unknown>)[key];
}
function updatePrice(scope: PriceScope, index: number, key: string, value: unknown) {
  const updated = prices(scope).map((price, i) => {
    if (i !== index) return price;
    const next = { ...price } as Record<string, unknown>;
    if (value === undefined) delete next[key];
    else next[key] = value;
    return next as AgreedPrice;
  });
  setPrices(scope, updated);
}
function addPrice(scope: PriceScope) {
  const price = AgreedPriceS.parse({ effect: 0, reason: 'contract' });
  setPrices(scope, [...prices(scope), price]);
}
function removePrice(scope: PriceScope, index: number) {
  setPrices(scope, prices(scope).filter((_, i) => i !== index));
}

function toggleResponse() {
  if (props.outcome.primordial) {
    delete props.outcome.primordial;
  } else {
    props.outcome.primordial = PrimordialResponseS.parse({
      id: (props.outcome.id + '_primordial').replace(/[^a-z0-9_]/g, '_'),
      text: 'An awakened member of the family intervenes.',
      effects: [],
      tags: [],
      record: null,
    });
  }
  emit('change');
}
function responseValue(key: string): unknown {
  return props.outcome.primordial
    ? (props.outcome.primordial as unknown as Record<string, unknown>)[key] : undefined;
}
function setResponseField(key: string, value: unknown) {
  const response = props.outcome.primordial;
  if (!response) return;
  const next = { ...response } as Record<string, unknown>;
  if (value === undefined) delete next[key];
  else next[key] = value;
  props.outcome.primordial = next as Outcome['primordial'];
  emit('change');
}
function toggleRecord() {
  const response = props.outcome.primordial;
  if (!response) return;
  if (response.record) response.record = null;
  else response.record = RecordBlockS.parse({
    subject: props.event.title,
    options: {
      record: { chronicle: props.event.title + ' was faithfully recorded.' },
      omit: { chronicle: null },
      embellish: {
        chronicle: 'The witnesses told a different story.',
        discrepancy: { id: props.outcome.id + '_primordial_account', severity: 'minor', provableBy: [store.bundle.houses[0]?.id ?? ''] },
      },
    },
  });
  emit('change');
}
const slotNames = computed(() => [...Object.keys(props.event.slots), 'PRIMORDIAL_ACTOR']);

</script>

<template>
  <details class="primordial-editor">
    <summary>Emergency intervention · {{ harms.length ? harms.join(', ') : 'no potential major harm' }}</summary>
    <p>Assess the ordinary result first. The response replaces its whole effect bundle; the actor is bound as PRIMORDIAL_ACTOR.</p>
    <p class="note">Incident sites are edited beside outcome eligibility above, without a separate JSON copy here.</p>

    <fieldset>
      <legend>Prices agreed for the ordinary outcome</legend>
      <div v-for="(price, i) in prices('ordinary')" :key="i" class="price-row">
        <FieldInput v-for="spec in priceSpecs" :key="spec.key" :spec="spec"
                    :model-value="priceValue(price, spec.key)"
                    @update:model-value="(v) => updatePrice('ordinary', i, spec.key, v)" />
        <button type="button" class="btn tiny" @click="removePrice('ordinary', i)">remove price</button>
      </div>
      <button type="button" class="btn tiny" @click="addPrice('ordinary')">+ agreed price</button>
    </fieldset>

    <fieldset>
      <legend>Complete emergency response</legend>
      <button type="button" class="btn tiny" @click="toggleResponse">
        {{ outcome.primordial ? 'remove response' : '+ response' }}
      </button>
      <template v-if="outcome.primordial">
        <FieldInput v-for="spec in responseSpecs" :key="spec.key" :spec="spec"
                    :model-value="responseValue(spec.key)"
                    @update:model-value="(v) => setResponseField(spec.key, v)" />
        <label class="sub">Committed effects</label>
        <EffectEditor v-model="outcome.primordial.effects" :slot-names="slotNames" @update:model-value="emit('change')" />

        <label class="sub">Prices agreed for the response</label>
        <div v-for="(price, i) in prices('response')" :key="i" class="price-row">
          <FieldInput v-for="spec in priceSpecs" :key="spec.key" :spec="spec"
                      :model-value="priceValue(price, spec.key)"
                      @update:model-value="(v) => updatePrice('response', i, spec.key, v)" />
          <button type="button" class="btn tiny" @click="removePrice('response', i)">remove price</button>
        </div>
        <button type="button" class="btn tiny" @click="addPrice('response')">+ response price</button>

        <label class="sub">Public Record</label>
        <button type="button" class="btn tiny" @click="toggleRecord">
          {{ outcome.primordial.record ? 'set public Record to absent' : '+ public Record' }}
        </button>
        <RecordEditor v-if="outcome.primordial.record" :record="outcome.primordial.record"
                      :slot-names="slotNames" @change="emit('change')" />
      </template>
    </fieldset>

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
.primordial-editor fieldset { min-width: 0; border: 1px solid var(--rule); margin: 8px 0; padding: 9px; }
.primordial-editor legend { font-weight: 600; }
.price-row { padding: 5px 0 7px 10px; border-left: 2px solid var(--rule); margin: 7px 0; }
.sub { display: block; font-size: 11px; margin: 9px 0 5px; }
.note { font-size: 12px; }
</style>
