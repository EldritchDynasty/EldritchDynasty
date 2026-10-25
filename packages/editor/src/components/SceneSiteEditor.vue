<script setup lang="ts">
import { computed } from 'vue';
import { SceneSiteS, fieldsOfSchema, type SceneSite } from '@ed/schema';
import type { FieldSpec } from '@ed/schema';
import FieldInput from './FieldInput.vue';

const props = defineProps<{ modelValue?: SceneSite; slotNames?: string[] }>();
const emit = defineEmits<{ 'update:modelValue': [SceneSite | undefined] }>();

// Both the union's variants and the fields of each variant come from the Zod
// definition, not a second roster maintained by the editor.
const variants = SceneSiteS.options.filter(s => s.description !== 'runtime assignment target').map((schema) => ({
  kind: schema.shape.kind.value,
  fields: fieldsOfSchema(schema, ['kind']),
}));
const current = computed(() => variants.find((v) => v.kind === props.modelValue?.kind));
const fields = computed(() => current.value?.fields ?? []);
const hall = computed(() => props.modelValue?.kind === 'hall' ? props.modelValue.hall : undefined);
const hallMode = computed(() => typeof hall.value === 'string' ? 'main' : 'slot');
const hallSlot = computed(() => typeof hall.value === 'object' ? hall.value.slot : '');

function seed(spec: FieldSpec): unknown {
  if (spec.fallback !== undefined) return spec.fallback;
  switch (spec.control.kind) {
    case 'string': return '';
    case 'number': return 0;
    case 'boolean': return true;
    case 'enum': return spec.control.options[0] ?? '';
    case 'stringList': return [];
    case 'object': return {};
    default: return undefined;
  }
}

function setKind(kind: string) {
  if (!kind) return emit('update:modelValue', undefined);
  const variant = variants.find((v) => v.kind === kind);
  if (!variant) return;
  const row: Record<string, unknown> = { kind };
  for (const field of variant.fields) {
    if (field.optional) continue;
    row[field.key] = field.key === 'hall' ? 'main'
      : field.key === 'slots' && kind === 'party' ? (props.slotNames?.slice(0, 1) ?? [])
        : seed(field);
  }
  emit('update:modelValue', row as SceneSite);
}

function valueOf(key: string): unknown {
  return (props.modelValue as unknown as Record<string, unknown> | undefined)?.[key];
}
function setField(key: string, value: unknown) {
  if (!props.modelValue) return;
  const next = { ...props.modelValue } as Record<string, unknown>;
  if (value === undefined) delete next[key];
  else next[key] = value;
  emit('update:modelValue', next as SceneSite);
}
function setHallMode(value: string) {
  setField('hall', value === 'main' ? 'main' : { slot: hallSlot.value || props.slotNames?.[0] || '' });
}
</script>

<template>
  <div class="scene-site">
    <label class="field-label">Incident site
      <select aria-label="Incident site type" :value="modelValue?.kind ?? ''"
              @change="setKind(($event.target as HTMLSelectElement).value)">
        <option value="">— not specified —</option>
        <option v-for="variant in variants" :key="variant.kind" :value="variant.kind">{{ variant.kind }}</option>
      </select>
    </label>
    <div v-if="modelValue" class="scene-fields">
      <template v-for="field in fields" :key="field.key">
        <div v-if="field.key === 'hall'" class="hall-field">
          <label>Hall
            <select :value="hallMode" @change="setHallMode(($event.target as HTMLSelectElement).value)">
              <option value="main">main hall</option>
              <option value="slot">hall of a cast person</option>
            </select>
          </label>
          <select v-if="hallMode === 'slot'" aria-label="Hall owner slot" :value="hallSlot"
                  @change="setField('hall', { slot: ($event.target as HTMLSelectElement).value })">
            <option v-for="slot in slotNames ?? []" :key="slot" :value="slot">{{ slot }}</option>
            <option v-if="hallSlot && !(slotNames ?? []).includes(hallSlot)" :value="hallSlot">{{ hallSlot }}</option>
          </select>
        </div>
        <FieldInput v-else :spec="field" :slot-names="slotNames" :model-value="valueOf(field.key)"
                    @update:model-value="(v) => setField(field.key, v)" />
      </template>
    </div>
  </div>
</template>

<style scoped>
.scene-site { display: grid; gap: 6px; }
.scene-site select { width: auto; margin-left: 8px; }
.scene-fields { margin: 5px 0 0 12px; padding-left: 10px; border-left: 2px solid var(--rule); }
.hall-field { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin: 4px 0; }
</style>
