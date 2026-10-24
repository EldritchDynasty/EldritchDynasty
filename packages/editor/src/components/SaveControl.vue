<script setup lang="ts">
import { computed, ref } from 'vue';
import { externalChange, fileOf, isDirty, markDirty, pendingText, saveItem, store } from '../lib/store';
import DiffView from './DiffView.vue';
import EventMetadataEditor from './EventMetadataEditor.vue';
import EventDuplicate from './EventDuplicate.vue';
import EventDelete from './EventDelete.vue';

/**
 * The write-back UI (issue #20), shared by every editing surface: a dirty
 * indicator, a diff before anything is written ("git-adjacent", issue #21),
 * and a check for whether the file moved on disk since the editor loaded it.
 */
const props = defineProps<{ collectionKey: string; id: string }>();

const dirty = computed(() => isDirty(props.collectionKey, props.id));
const path = computed(() => fileOf(props.collectionKey, props.id));

// An event's optional authoring fields can be edited here without touching
// EventEditor.vue while founder configuration work has an active claim on it.
const editableEvent = computed(() => props.collectionKey === 'events'
  ? store.bundle.events.find((e) => e.id === props.id) : undefined);
const ageIds = computed(() => store.bundle.ages.map((age) => age.id));
function changedEvent() {
  if (editableEvent.value) markDirty('events', editableEvent.value.id);
}

const reviewing = ref(false);
const saving = ref(false);
const saveError = ref<string | null>(null);
const conflictText = ref<string | null>(null);

const diff = computed(() => (reviewing.value ? pendingText(props.collectionKey, props.id) : undefined));

async function review() {
  saveError.value = null;
  conflictText.value = null;
  reviewing.value = true;
  const p = path.value;
  if (p) {
    const check = await externalChange(p);
    if (check.changed) conflictText.value = check.text ?? '';
  }
}

async function confirmSave() {
  saving.value = true;
  const res = await saveItem(props.collectionKey, props.id);
  saving.value = false;
  if (res.ok) reviewing.value = false;
  else saveError.value = res.error ?? 'save failed';
}
</script>

<template>
  <details v-if="editableEvent" class="panel" style="margin-top: 14px">
    <summary style="cursor: pointer; font-weight: 600">Edit tier, purposes, Record, rumour and Age scope</summary>
    <EventMetadataEditor :event="editableEvent" :age-ids="ageIds" @change="changedEvent" />
  </details>
  <EventDuplicate v-if="editableEvent" :event="editableEvent" />
  <EventDelete v-if="editableEvent" :id="editableEvent.id" />
  <div class="bar" style="margin: 14px 0 0">
    <span v-if="dirty" class="issue warning" style="margin: 0">unsaved changes — {{ path }}</span>
    <span v-else style="color: var(--ink-faint); font-size: 12px">saved</span>
    <button class="btn" :disabled="!dirty" @click="review">Review &amp; save</button>
  </div>

  <div v-if="reviewing" class="panel" style="margin-top: 10px">
    <h3>What would be written to {{ path }}</h3>

    <div v-if="conflictText" class="issue error">
      This file changed on disk since the editor loaded it — writing now would overwrite that
      change. Reload the editor to pick it up before saving.
    </div>

    <DiffView v-if="diff" :before="diff.before" :after="diff.after" />

    <div class="bar" style="margin-top: 10px">
      <button class="btn primary" :disabled="saving || !!conflictText" @click="confirmSave">
        {{ saving ? 'Writing…' : 'Write to disk' }}
      </button>
      <button class="btn" @click="reviewing = false">Cancel</button>
    </div>
    <div v-if="saveError" class="issue error" style="margin-top: 8px">{{ saveError }}</div>
  </div>
</template>
