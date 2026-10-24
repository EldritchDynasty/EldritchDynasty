<script setup lang="ts">
import type { Claim, Effect, RecordBlock } from '@ed/schema';
import { RecordBlockS, fieldsOfSchema } from '@ed/schema';
import EffectEditor from './EffectEditor.vue';
import ClaimEditor from './ClaimEditor.vue';
import FieldInput from './FieldInput.vue';

const props = defineProps<{ record: RecordBlock; slotNames?: string[] }>();
const emit = defineEmits<{ change: [] }>();

// The field controls are walked from the same Zod schema that validates YAML.
// In particular, discrepancy severity and its allowed values are not copied
// into another hand-maintained editor vocabulary.
const subjectSpec = fieldsOfSchema(RecordBlockS).find((f) => f.key === 'subject')!;
const optionSchemas = RecordBlockS.shape.options.shape;
const recordSpecs = fieldsOfSchema(optionSchemas.record).filter((f) => f.key !== 'effects' && f.key !== 'claims');
const embellishSpecs = fieldsOfSchema(optionSchemas.embellish).filter((f) => f.key !== 'effects' && f.key !== 'claims');

function recordValue(key: string): unknown {
  return (props.record.options.record as unknown as Record<string, unknown>)[key];
}
function embellishValue(key: string): unknown {
  return (props.record.options.embellish as unknown as Record<string, unknown>)[key];
}

function setSubject(value: unknown) {
  props.record.subject = String(value ?? '');
  emit('change');
}
function setRecord(key: string, value: unknown) {
  if (key === 'chronicle') props.record.options.record.chronicle = String(value ?? '');
  else if (key === 'grantsKnowledge') {
    if (value === undefined) delete props.record.options.record.grantsKnowledge;
    else props.record.options.record.grantsKnowledge = String(value);
  }
  emit('change');
}
function setEmbellish(key: string, value: unknown) {
  if (key === 'chronicle') props.record.options.embellish.chronicle = String(value ?? '');
  else if (key === 'discrepancy' && value && typeof value === 'object') {
    props.record.options.embellish.discrepancy = value as RecordBlock['options']['embellish']['discrepancy'];
  }
  emit('change');
}
function setClaims(option: 'record' | 'embellish', claims: Claim[]) {
  props.record.options[option].claims = claims;
  emit('change');
}
function setEffects(option: 'record' | 'omit' | 'embellish', effects: Effect[]) {
  props.record.options[option].effects = effects;
  emit('change');
}
</script>

<template>
  <section class="record-editor">
    <h4>Record / Omit / Embellish</h4>
    <FieldInput :spec="subjectSpec" :model-value="record.subject"
                @update:model-value="setSubject" />
    <fieldset>
      <legend>Record — what happened</legend>
      <FieldInput v-for="f in recordSpecs" :key="f.key" :spec="f"
                  :model-value="recordValue(f.key)"
                  @update:model-value="(v) => setRecord(f.key, v)" />
      <EffectEditor :model-value="record.options.record.effects" :slot-names="slotNames"
                    @update:model-value="(v) => setEffects('record', v)" />
      <label class="sub">Record claims</label>
      <ClaimEditor :model-value="record.options.record.claims" :slot-names="slotNames"
                   @update:model-value="(v) => setClaims('record', v)" />
    </fieldset>
    <fieldset>
      <legend>Omit — a dated blank line</legend>
      <p class="note">Omission has no chronicle text; it leaves a deliberate blank.</p>
      <EffectEditor :model-value="record.options.omit.effects" :slot-names="slotNames"
                    @update:model-value="(v) => setEffects('omit', v)" />
    </fieldset>
    <fieldset>
      <legend>Embellish — the account the family invents</legend>
      <FieldInput v-for="f in embellishSpecs" :key="f.key" :spec="f"
                  :model-value="embellishValue(f.key)"
                  @update:model-value="(v) => setEmbellish(f.key, v)" />
      <EffectEditor :model-value="record.options.embellish.effects" :slot-names="slotNames"
                    @update:model-value="(v) => setEffects('embellish', v)" />
      <label class="sub">Claims made in the embellished account</label>
      <ClaimEditor :model-value="record.options.embellish.claims" :slot-names="slotNames"
                   @update:model-value="(v) => setClaims('embellish', v)" />
    </fieldset>

  </section>
</template>

<style scoped>
.record-editor { display: grid; gap: 8px; padding: 8px 0; }
.record-editor h4 { margin: 2px 0; }
.record-editor fieldset { border: 1px solid var(--rule); padding: 10px; min-width: 0; }
.record-editor legend { padding: 0 5px; font-size: 12px; font-weight: 600; }
.record-editor .note { margin: 4px 0 8px; }
.record-editor .sub { display: block; font-size: 11px; margin: 7px 0 2px; }
</style>
