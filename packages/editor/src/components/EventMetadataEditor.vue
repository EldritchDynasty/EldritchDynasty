<script setup lang="ts">
import { computed } from 'vue';
import type { EventTemplate, RecordBlock } from '@ed/schema';
import { EventTemplateS, EventTierS, PurposeS, RecordBlockS, CampaignIdS, FREQUENCY_PROFILES, fieldsOfSchema } from '@ed/schema';
import FieldInput from './FieldInput.vue';
import { store } from '../lib/store';
import RecordEditor from './RecordEditor.vue';
import RumourEditor from './RumourEditor.vue';
import SceneSiteEditor from './SceneSiteEditor.vue';
import FrameReadsEditor from './FrameReadsEditor.vue';
import Mark from './Mark.vue';
import { PURPOSE_LABEL, PURPOSE_MARK } from '../lib/marks';

const props = defineProps<{ event: EventTemplate; ageIds: string[] }>();
const emit = defineEmits<{ change: [] }>();

// Read single-field control descriptions directly from EventTemplateS. The
// purposes array needs a specialised exactly-three distinct selector; its
// options still come from PurposeS rather than a parallel enum list.
const eventFields = fieldsOfSchema(EventTemplateS.innerType());
const tierSpec = eventFields.find((f) => f.key === 'tier')!;
const accountsSpec = eventFields.find((f) => f.key === 'accounts')!;
const tuningSpecs = eventFields.filter((f) => ['tags', 'weight', 'repeatable', 'cooldownYears'].includes(f.key));
const purposeOptions = PurposeS.options;
const campaignIds = CampaignIdS.options;
const obligations = computed(() => FREQUENCY_PROFILES[props.event.frequency]);
const choiceIds = computed(() => props.event.interaction.kind === 'narration'
  ? [] : props.event.interaction.choices.map((choice) => choice.id));
const outcomeIds = computed(() => props.event.interaction.kind === 'narration' ? []
  : props.event.interaction.choices.flatMap((choice) => choice.outcomes.map((outcome) => choice.id + '/' + outcome.id)));
type RecordRow = RecordBlock & { id: string };
type RecordScope = 'choice' | 'outcome';

function recordRows(scope: RecordScope): RecordRow[] {
  return (scope === 'choice' ? props.event.recordByChoice : props.event.recordByOutcome) ?? [];
}
function selectorIds(scope: RecordScope): string[] {
  return scope === 'choice' ? choiceIds.value : outcomeIds.value;
}
function updateRecordRows(scope: RecordScope, rows: RecordRow[]) {
  if (scope === 'choice') {
    if (rows.length) props.event.recordByChoice = rows;
    else delete props.event.recordByChoice;
  } else {
    if (rows.length) props.event.recordByOutcome = rows;
    else delete props.event.recordByOutcome;
  }
  touch();
}
function addRecordRow(scope: RecordScope) {
  const existing = new Set(recordRows(scope).map((row) => row.id));
  const id = selectorIds(scope).find((candidate) => !existing.has(candidate));
  if (!id) return;
  updateRecordRows(scope, [...recordRows(scope), { ...seedRecord(), id }]);
}
function removeRecordRow(scope: RecordScope, index: number) {
  updateRecordRows(scope, recordRows(scope).filter((_, i) => i !== index));
}
function setRecordRowId(scope: RecordScope, index: number, id: string) {
  if (!selectorIds(scope).includes(id) || recordRows(scope).some((row, i) => i !== index && row.id === id)) return;
  updateRecordRows(scope, recordRows(scope).map((row, i) => i === index ? { ...row, id } : row));
}


function touch() { emit('change'); }
function setTier(value: unknown) {
  props.event.tier = EventTierS.parse(value);
  touch();
}
function setPurpose(index: number, value: string) {
  const purpose = PurposeS.parse(value);
  if (props.event.purposes.some((p, i) => i !== index && p === purpose)) return;
  const next = [...props.event.purposes];
  next[index] = purpose;
  props.event.purposes = next;
  touch();
}
function setTuning(key: string, value: unknown) {
  // The control comes from this field's Zod descriptor. Keep the existing
  // authored value intact unless its own control was edited.
  (props.event as unknown as Record<string, unknown>)[key] = value;
  touch();
}
function tuningValue(key: string): unknown {
  return (props.event as unknown as Record<string, unknown>)[key];
}
function setAccounts(value: unknown) {
  props.event.accounts = Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  touch();
}
function setCampaign(id: string, selected: boolean) {
  const campaign = CampaignIdS.parse(id);
  const scope = new Set(props.event.campaigns ?? []);
  if (selected) scope.add(campaign);
  else scope.delete(campaign);
  if (scope.size) props.event.campaigns = [...scope];
  else delete props.event.campaigns;
  touch();
}
function toggleForcing() {
  if (props.event.forcing) delete props.event.forcing;
  else props.event.forcing = { slot: Object.keys(props.event.slots)[0] ?? '', called: true };
  touch();
}
function setForcingSlot(slot: string) {
  if (!props.event.forcing) return;
  props.event.forcing.slot = slot;
  touch();
}
function setForcingCalled(called: boolean) {
  if (!props.event.forcing) return;
  props.event.forcing.called = called;
  touch();
}
function setReads(reads: EventTemplate['reads']) {
  props.event.reads = reads;
  touch();
}
function setSite(value: EventTemplate['site']) {
  if (value) props.event.site = value;
  else delete props.event.site;
  touch();
}
function setRumour(value: EventTemplate['rumour']) {
  if (value) props.event.rumour = value;
  else delete props.event.rumour;
  touch();
}

function seedRecord(): RecordBlock {
  const e = props.event;
  return RecordBlockS.parse({
    subject: e.title,
    options: {
      record: { chronicle: e.title + ' was entered in the family record.', effects: [], claims: [] },
      omit: { chronicle: null, effects: [] },
      embellish: {
        chronicle: e.title + ' was remembered differently by the family.',
        effects: [], claims: [],
        discrepancy: { id: e.id + '_embellishment', severity: 'minor', provableBy: [store.bundle.houses[0]?.id ?? ''] },
      },
    },
  });
}
function addRecord() {
  props.event.record = seedRecord();
  touch();
}
function removeRecord() {
  delete props.event.record;
  touch();
}

/** Keep the two Age scopes disjoint without touching any existing register. */
function setAge(kind: 'only' | 'never', id: string, selected: boolean) {
  const scope: NonNullable<EventTemplate['ages']> = { ...(props.event.ages ?? {}) };
  const other = kind === 'only' ? 'never' : 'only';
  const values = new Set(scope[kind] ?? []);
  if (selected) values.add(id);
  else values.delete(id);
  if (values.size) scope[kind] = [...values];
  else delete scope[kind];
  if (selected && scope[other]?.includes(id)) {
    const remaining = scope[other]!.filter((a) => a !== id);
    if (remaining.length) scope[other] = remaining;
    else delete scope[other];
  }
  if (scope.only?.length || scope.never?.length || scope.register?.length) props.event.ages = scope;
  else delete props.event.ages;
  touch();
}
</script>

<template>
  <section class="event-metadata">
    <h3>Event identity and folklore</h3>
    <FieldInput :spec="tierSpec" :model-value="event.tier" @update:model-value="setTier" />

    <fieldset>
      <legend>Purposes — exactly three distinct claims</legend>
      <div v-for="(purpose, i) in event.purposes" :key="i" class="purpose">
        <Mark :name="PURPOSE_MARK[purpose]" :size="16" />
        <select :aria-label="'Purpose ' + (i + 1)" :value="purpose"
                @change="setPurpose(i, ($event.target as HTMLSelectElement).value)">
          <option v-for="p in purposeOptions" :key="p" :value="p"
                  :disabled="p !== purpose && event.purposes.includes(p)">{{ PURPOSE_LABEL[p] }}</option>
        </select>
      </div>
    </fieldset>

    <fieldset>
      <legend>Everyday tuning</legend>
      <FieldInput v-for="spec in tuningSpecs" :key="spec.key" :spec="spec"
                  :model-value="tuningValue(spec.key)" @update:model-value="(v) => setTuning(spec.key, v)" />
    </fieldset>

    <fieldset>
      <legend>Event-level incident site</legend>
      <SceneSiteEditor :model-value="event.site" :slot-names="Object.keys(event.slots)"
                       @update:model-value="setSite" />
    </fieldset>

    <fieldset v-if="event.tier === 'frame'">
      <legend>Frame readings</legend>
      <FrameReadsEditor :model-value="event.reads" @update:model-value="setReads" />
    </fieldset>

    <fieldset>
      <legend>Record block</legend>
      <p v-if="obligations.record === 'required' && !event.record" class="issue error">
        This frequency requires Record / Omit / Embellish; add its block below.
      </p>
      <p v-if="obligations.record === 'forbidden' && event.record" class="issue error">
        This frequency forbids a Record block; remove it or change frequency.
      </p>
      <button v-if="!event.record" type="button" class="btn" @click="addRecord">+ add Record block</button>
      <template v-else>
        <RecordEditor :record="event.record" :slot-names="Object.keys(event.slots)" @change="touch" />
        <button type="button" class="btn tiny" @click="removeRecord">remove Record block</button>
      </template>
    </fieldset>

    <fieldset v-if="event.interaction.kind !== 'narration'">
      <legend>Choice-specific Records</legend>
      <p class="note">Choose an existing choice; no free-text IDs that can silently miss their branch.</p>
      <div v-for="(row, i) in recordRows('choice')" :key="i" class="record-row">
        <label>Choice
          <select :value="row.id"
                  @change="setRecordRowId('choice', i, ($event.target as HTMLSelectElement).value)">
            <option v-for="id in choiceIds" :key="id" :value="id"
                    :disabled="recordRows('choice').some((other, j) => i !== j && other.id === id)">{{ id }}</option>
            <option v-if="!choiceIds.includes(row.id)" :value="row.id">{{ row.id }} (no longer found)</option>
          </select>
        </label>
        <RecordEditor :record="row" :slot-names="Object.keys(event.slots)" @change="touch" />
        <button type="button" class="btn tiny" @click="removeRecordRow('choice', i)">remove choice Record</button>
      </div>
      <button type="button" class="btn tiny" :disabled="recordRows('choice').length >= choiceIds.length"
              @click="addRecordRow('choice')">+ choice Record</button>
    </fieldset>

    <fieldset v-if="event.interaction.kind !== 'narration'">
      <legend>Outcome-specific Records</legend>
      <p class="note">Choose an exact choice/outcome pair when the outcome changes what is true.</p>
      <div v-for="(row, i) in recordRows('outcome')" :key="i" class="record-row">
        <label>Choice / outcome
          <select :value="row.id"
                  @change="setRecordRowId('outcome', i, ($event.target as HTMLSelectElement).value)">
            <option v-for="id in outcomeIds" :key="id" :value="id"
                    :disabled="recordRows('outcome').some((other, j) => i !== j && other.id === id)">{{ id }}</option>
            <option v-if="!outcomeIds.includes(row.id)" :value="row.id">{{ row.id }} (no longer found)</option>
          </select>
        </label>
        <RecordEditor :record="row" :slot-names="Object.keys(event.slots)" @change="touch" />
        <button type="button" class="btn tiny" @click="removeRecordRow('outcome', i)">remove outcome Record</button>
      </div>
      <button type="button" class="btn tiny" :disabled="recordRows('outcome').length >= outcomeIds.length"
              @click="addRecordRow('outcome')">+ outcome Record</button>
    </fieldset>

    <fieldset>
      <legend>Rumour</legend>
      <p v-if="obligations.rumour === 'always' && !event.rumour" class="issue error">
        This frequency requires a rumour.
      </p>
      <RumourEditor :model-value="event.rumour" :event-id="event.id"
                    @update:model-value="setRumour" />
    </fieldset>

    <fieldset>
      <legend>Accounts</legend>
      <FieldInput :spec="accountsSpec" :model-value="event.accounts" @update:model-value="setAccounts" />
    </fieldset>

    <fieldset>
      <legend>Campaigns</legend>
      <p class="note">Leave every campaign unselected for an event available in all terms.</p>
      <label v-for="campaign in campaignIds" :key="campaign" class="tick">
        <input type="checkbox" :checked="event.campaigns?.includes(campaign) ?? false"
               @change="setCampaign(campaign, ($event.target as HTMLInputElement).checked)" />
        {{ campaign }}
      </label>
    </fieldset>

    <fieldset>
      <legend>Forcing rite</legend>
      <button type="button" class="btn tiny" @click="toggleForcing">
        {{ event.forcing ? 'remove forcing rite' : '+ forcing rite' }}
      </button>
      <div v-if="event.forcing" class="forcing-fields">
        <label>Boy cast in slot
          <select :value="event.forcing.slot"
                  @change="setForcingSlot(($event.target as HTMLSelectElement).value)">
            <option v-for="slot in Object.keys(event.slots)" :key="slot" :value="slot">{{ slot }}</option>
            <option v-if="!Object.keys(event.slots).includes(event.forcing.slot)" :value="event.forcing.slot">{{ event.forcing.slot || '—' }}</option>
          </select>
        </label>
        <label class="tick"><input type="checkbox" :checked="event.forcing.called"
                                  @change="setForcingCalled(($event.target as HTMLInputElement).checked)" />
          Called by the house
        </label>
      </div>
    </fieldset>

    <fieldset>
      <legend>Age scope</legend>
      <p class="note">With no selection, the event is available in every Age.</p>
      <div v-for="age in ageIds" :key="age" class="age">
        <span>{{ age.replace(/_/g, ' ') }}</span>
        <label><input type="checkbox" :checked="event.ages?.only?.includes(age) ?? false"
                      @change="setAge('only', age, ($event.target as HTMLInputElement).checked)" /> only</label>
        <label><input type="checkbox" :checked="event.ages?.never?.includes(age) ?? false"
                      @change="setAge('never', age, ($event.target as HTMLInputElement).checked)" /> never</label>
      </div>
    </fieldset>
  </section>
</template>

<style scoped>
.event-metadata { display: grid; gap: 10px; }
.event-metadata h3 { margin: 8px 0 0; }
.event-metadata fieldset { min-width: 0; border: 1px solid var(--rule); padding: 10px; }
.event-metadata legend { padding: 0 5px; font-size: 12px; font-weight: 600; }
.event-metadata .purpose, .event-metadata .age { display: flex; align-items: center; gap: 9px; margin: 5px 0; }
.event-metadata .purpose select { max-width: 320px; }
.event-metadata .age span { min-width: 170px; }
.event-metadata .age label { display: flex; align-items: center; gap: 3px; }
.event-metadata .age input { margin: 0; }
.event-metadata .note { margin: 0 0 8px; }
.event-metadata .tick { display: inline-flex; align-items: center; gap: 5px; margin-right: 12px; }
.event-metadata .tick input { margin: 0; }
.event-metadata .forcing-fields { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; padding: 8px 0; }
.event-metadata .forcing-fields select { width: auto; margin-left: 8px; }
.event-metadata .record-row { margin: 9px 0; padding: 8px; border-left: 2px solid var(--rule); }
.event-metadata .record-row select { width: auto; margin-left: 8px; }
</style>
