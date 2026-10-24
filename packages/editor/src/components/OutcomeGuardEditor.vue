<script setup lang="ts">
import { computed } from 'vue';
import type { OutcomeGuard, Filter } from '@ed/schema';
import FilterBuilder from './FilterBuilder.vue';

const props = defineProps<{ modelValue?: OutcomeGuard; slotNames: string[] }>();
const emit = defineEmits<{ 'update:modelValue': [OutcomeGuard | undefined] }>();

const filters = computed(() => props.modelValue?.filters ?? []);

function create() {
  emit('update:modelValue', {
    slot: props.slotNames[0] ?? '',
    filters: [{ awakened: true }],
  });
}
function replace(patch: Partial<OutcomeGuard>) {
  if (props.modelValue) emit('update:modelValue', { ...props.modelValue, ...patch });
}
function updateFilter(index: number, filter: Filter) {
  replace({ filters: filters.value.map((item, i) => i === index ? filter : item) });
}
function addFilter() {
  replace({ filters: [...filters.value, { awakened: true }] });
}
function removeFilter(index: number) {
  const remaining = filters.value.filter((_, i) => i !== index);
  // GuardS requires at least one filter; remove the entire guard at zero.
  if (!remaining.length) emit('update:modelValue', undefined);
  else replace({ filters: remaining });
}
</script>

<template>
  <div class="outcome-guard">
    <button v-if="!modelValue" type="button" class="btn tiny" @click="create">+ guard outcome by slot</button>
    <template v-else>
      <label>Eligible slot
        <select aria-label="Guard slot" :value="modelValue.slot"
                @change="replace({ slot: ($event.target as HTMLSelectElement).value })">
          <option v-for="name in slotNames" :key="name" :value="name">{{ name }}</option>
          <option v-if="!slotNames.includes(modelValue.slot)" :value="modelValue.slot">{{ modelValue.slot || '—' }}</option>
        </select>
      </label>
      <div v-for="(filter, i) in filters" :key="i" class="filter-row">
        <FilterBuilder :model-value="filter" :slot-names="slotNames"
                       @update:model-value="(v) => updateFilter(i, v)" />
        <button type="button" class="btn tiny" @click="removeFilter(i)">remove filter</button>
      </div>
      <button type="button" class="btn tiny" @click="addFilter">+ filter</button>
      <button type="button" class="btn tiny" @click="emit('update:modelValue', undefined)">remove guard</button>
    </template>
  </div>
</template>

<style scoped>
.outcome-guard { padding: 7px 0; }
.outcome-guard label { font-size: 12px; }
.outcome-guard select { width: auto; margin-left: 7px; }
.filter-row { display: flex; align-items: flex-start; flex-wrap: wrap; gap: 8px; margin: 5px 0; }
</style>
