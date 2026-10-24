<script setup lang="ts">
import { computed } from 'vue';
import { ClaimS, fieldsOfSchema, type Claim, type FieldSpec } from '@ed/schema';
import FieldInput from './FieldInput.vue';

const props = defineProps<{ modelValue: Claim[]; slotNames?: string[] }>();
const emit = defineEmits<{ 'update:modelValue': [Claim[]] }>();

// The complete set of claim verbs and the fields each one needs come from
// ClaimS, not a separate table. This preserves the closed union's safety.
const variants = ClaimS.options.map((schema) => ({
  kind: schema.shape.kind.value,
  fields: fieldsOfSchema(schema, ['kind']),
}));
const kinds = variants.map((variant) => variant.kind);

function specs(kind: string): FieldSpec[] {
  return variants.find((v) => v.kind === kind)?.fields ?? [];
}
function seed(spec: FieldSpec): unknown {
  if (spec.fallback !== undefined) return spec.fallback;
  switch (spec.control.kind) {
    case 'number': return 0;
    case 'boolean': return true;
    case 'string': return '';
    case 'enum': return spec.control.options[0] ?? '';
    case 'target': return 'head';
    case 'stringList': return [];
    case 'object': return {};
    default: return '';
  }
}
function blank(kind: string): Claim {
  return Object.fromEntries([
    ['kind', kind],
    ...specs(kind).filter((f) => !f.optional).map((f) => [f.key, seed(f)] as [string, unknown]),
  ]) as Claim;
}
function replace(index: number, value: Claim) {
  emit('update:modelValue', props.modelValue.map((row, i) => i === index ? value : row));
}
function changeKind(index: number, kind: string) {
  if (kinds.includes(kind as never)) replace(index, blank(kind));
}
function updateField(index: number, key: string, value: unknown) {
  const row = { ...props.modelValue[index] } as Record<string, unknown>;
  if (value === undefined) delete row[key];
  else row[key] = value;
  replace(index, row as Claim);
}
function valueOf(row: Claim, key: string): unknown {
  return (row as unknown as Record<string, unknown>)[key];
}
function add() {
  const kind = kinds[0];
  if (kind) emit('update:modelValue', [...props.modelValue, blank(kind)]);
}
function remove(index: number) {
  emit('update:modelValue', props.modelValue.filter((_, i) => i !== index));
}
const rows = computed(() => props.modelValue);
</script>

<template>
  <section class="claim-editor">
    <div v-for="(row, i) in rows" :key="i" class="claim">
      <label>Claim
        <select :value="row.kind" aria-label="Claim kind"
                @change="changeKind(i, ($event.target as HTMLSelectElement).value)">
          <option v-for="kind in kinds" :key="kind" :value="kind">{{ kind }}</option>
        </select>
      </label>
      <FieldInput v-for="spec in specs(row.kind)" :key="spec.key" :spec="spec" :slot-names="slotNames"
                  :model-value="valueOf(row, spec.key)"
                  @update:model-value="(value) => updateField(i, spec.key, value)" />
      <button class="btn tiny" type="button" @click="remove(i)">remove claim</button>
    </div>
    <button class="btn tiny" type="button" @click="add">+ claim</button>
  </section>
</template>

<style scoped>
.claim-editor .claim { padding: 8px 0 8px 10px; margin: 6px 0; border-left: 2px solid var(--rule); }
.claim-editor select { width: auto; margin-left: 6px; }
</style>
