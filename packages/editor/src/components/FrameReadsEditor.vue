<script setup lang="ts">
import { computed } from 'vue';
import { FrameReadS, fieldsOfSchema, type FieldSpec, type FrameRead } from '@ed/schema';
import FieldInput from './FieldInput.vue';

const props = defineProps<{ modelValue: FrameRead[] }>();
const emit = defineEmits<{ 'update:modelValue': [FrameRead[]] }>();

// FrameReadS is a closed union. Its variant names and nested form descriptors
// come from its actual Zod options; a new form variant cannot be silently omitted.
const variants = FrameReadS.options.map((schema) => ({
  key: Object.keys(schema.shape)[0]!,
  specs: fieldsOfSchema(schema),
}));

function kindOf(read: FrameRead): string {
  return Object.keys(read)[0] ?? '';
}
function fieldsFor(read: FrameRead): FieldSpec[] {
  return variants.find((variant) => variant.key === kindOf(read))?.specs ?? [];
}
function seed(spec: FieldSpec): unknown {
  if (spec.fallback !== undefined) return spec.fallback;
  switch (spec.control.kind) {
    case 'number': return 0;
    case 'boolean': return true;
    case 'enum': return spec.control.options[0] ?? '';
    case 'string': return '';
    case 'stringList': return [];
    case 'object': return Object.fromEntries(spec.control.fields
      .filter((field) => !field.optional).map((field) => [field.key, seed(field)]));
    default: return '';
  }
}
function blank(kind: string): FrameRead {
  const variant = variants.find((v) => v.key === kind);
  if (!variant) throw new Error('Unknown FrameRead variant: ' + kind);
  return Object.fromEntries(variant.specs.filter((f) => !f.optional)
    .map((field) => [field.key, seed(field)])) as FrameRead;
}
function replace(i: number, read: FrameRead) {
  emit('update:modelValue', props.modelValue.map((item, index) => index === i ? read : item));
}
function setKind(i: number, kind: string) { replace(i, blank(kind)); }
function updateField(i: number, key: string, value: unknown) {
  const next = { ...props.modelValue[i] } as Record<string, unknown>;
  if (value === undefined) delete next[key];
  else next[key] = value;
  replace(i, next as FrameRead);
}
function valueOf(read: FrameRead, key: string): unknown {
  return (read as Record<string, unknown>)[key];
}
function add() {
  const first = variants[0];
  if (first) emit('update:modelValue', [...props.modelValue, blank(first.key)]);
}
function remove(i: number) { emit('update:modelValue', props.modelValue.filter((_, index) => index !== i)); }
const count = computed(() => props.modelValue.length);
</script>

<template>
  <section class="frame-reads">
    <p class="note">Frame events inspect the chronicle and discrepancies, not the world's ordinary conditions.</p>
    <div v-for="(read, index) in modelValue" :key="index" class="read">
      <label>Record read {{ index + 1 }}
        <select :value="kindOf(read)" @change="setKind(index, ($event.target as HTMLSelectElement).value)">
          <option v-for="variant in variants" :key="variant.key" :value="variant.key">{{ variant.key }}</option>
        </select>
      </label>
      <FieldInput v-for="field in fieldsFor(read)" :key="field.key" :spec="field"
                  :model-value="valueOf(read, field.key)"
                  @update:model-value="(v) => updateField(index, field.key, v)" />
      <button class="btn tiny" type="button" @click="remove(index)">remove read</button>
    </div>
    <button class="btn tiny" type="button" @click="add">+ Record read</button>
    <span class="note">{{ count }} configured</span>
  </section>
</template>

<style scoped>
.frame-reads { padding: 5px 0; }
.frame-reads .read { padding: 8px 0 8px 10px; margin: 6px 0; border-left: 2px solid var(--rule); }
.frame-reads select { width: auto; margin-left: 7px; }
.frame-reads .note { margin: 5px 0; }
</style>
