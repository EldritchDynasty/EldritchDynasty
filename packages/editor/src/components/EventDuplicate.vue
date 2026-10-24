<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { EventTemplate } from '@ed/schema';
import { createItem, fileOf, filesHolding, store } from '../lib/store';
import { duplicateEventDraft, suggestedDuplicateId } from '../lib/event-duplicate';

const props = defineProps<{ event: EventTemplate }>();
const open = ref(false);
const newId = ref('');
const busy = ref(false);
const error = ref('');
const created = ref('');

const sourcePath = computed(() => fileOf('events', props.event.id));
const writable = computed(() => !!sourcePath.value && filesHolding('events').includes(sourcePath.value));
const blockedByEdit = computed(() => !!sourcePath.value
  && (store.dirty.has(sourcePath.value) || store.saving.has(sourcePath.value)));

function start() {
  open.value = true;
  error.value = '';
  created.value = '';
  newId.value = suggestedDuplicateId(store.bundle, props.event);
}

watch(() => props.event.id, () => {
  open.value = false;
  error.value = '';
  created.value = '';
});

async function duplicate() {
  if (busy.value || !sourcePath.value || !writable.value || blockedByEdit.value) return;
  error.value = '';
  const result = duplicateEventDraft(store.bundle, props.event, newId.value);
  if (!result.ok) { error.value = result.error; return; }
  // createItem uses the same read-before-write, source-path guard and
  // file-level conflict detection as every other authoring operation.
  busy.value = true;
  try {
    const createdResult = await createItem('events', sourcePath.value, result.event);
    if (createdResult.ok) {
      created.value = result.event.id;
      open.value = false;
    } else {
      error.value = createdResult.error ?? 'Unable to save duplicate';
    }
  } finally { busy.value = false; }
}
</script>

<template>
  <section class="duplicate-event">
    <p v-if="created" role="status">Created {{ created }}. Select it from the Events list to edit.</p>
    <button v-if="!open" type="button" class="btn" :disabled="!writable" @click="start">
      Duplicate this event…
    </button>
    <template v-else>
      <p class="note">Creates a separate event in the same file. Referenced events and inline follow-ups cannot be copied without their substory.</p>
      <label>New event ID
        <input v-model="newId" type="text" placeholder="snake_case" aria-label="Duplicate event ID" />
      </label>
      <p v-if="blockedByEdit" class="issue warning">Save pending edits in this file before duplicating.</p>
      <div class="bar">
        <button class="btn primary" type="button" :disabled="busy || blockedByEdit || !writable || !newId.trim()" @click="duplicate">
          {{ busy ? 'Creating…' : 'Create duplicate' }}
        </button>
        <button class="btn" type="button" :disabled="busy" @click="open = false">Cancel</button>
      </div>
      <p v-if="error" role="alert" class="issue error">{{ error }}</p>
    </template>
  </section>
</template>

<style scoped>
.duplicate-event { border-top: 1px solid var(--rule); margin-top: 15px; padding-top: 10px; }
.duplicate-event input { margin-left: 10px; max-width: 300px; }
.duplicate-event .note { font-size: 12px; margin: 5px 0; }
</style>
