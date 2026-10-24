<script setup lang="ts">
import type { EventTemplate } from '@ed/schema';
import { EventTemplateS, fieldsOfSchema } from '@ed/schema';
import FieldInput from './FieldInput.vue';

type Rumour = NonNullable<EventTemplate['rumour']>;
const props = defineProps<{ modelValue?: Rumour; eventId: string }>();
const emit = defineEmits<{ 'update:modelValue': [Rumour | undefined] }>();

// The three rumour fields and their control types are derived from EventTemplateS.
const rumourSchema = EventTemplateS.innerType().shape.rumour.unwrap();
const specs = fieldsOfSchema(rumourSchema);

function valueAt(key: string): unknown {
  return props.modelValue?.[key as keyof Rumour];
}
function add() {
  emit('update:modelValue', { id: props.eventId + '_rumour', accuracy: 0.75, spread: 0.5 });
}
function setField(key: string, value: unknown) {
  if (!props.modelValue) return;
  emit('update:modelValue', { ...props.modelValue, [key]: value } as Rumour);
}
</script>

<template>
  <section class="rumour">
    <div v-if="!modelValue">
      <p class="note">No rumour is authored for this event.</p>
      <button type="button" class="btn" @click="add">+ add rumour</button>
    </div>
    <template v-else>
      <FieldInput v-for="spec in specs" :key="spec.key" :spec="spec"
                  :model-value="valueAt(spec.key)"
                  @update:model-value="(v) => setField(spec.key, v)" />
      <button type="button" class="btn tiny" @click="emit('update:modelValue', undefined)">remove rumour</button>
    </template>
  </section>
</template>

<style scoped>
.rumour { padding: 5px 0; }
.rumour .note { margin: 0 0 8px; }
</style>
