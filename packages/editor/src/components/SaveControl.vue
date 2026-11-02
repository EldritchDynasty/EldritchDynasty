<script setup lang="ts">
import { computed, ref, watch } from 'vue';
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
const checking = ref(false);
const saving = ref(false);
const saveError = ref<string | null>(null);
const conflictText = ref<string | null>(null);
const checkedSelection = ref<{ collectionKey: string; id: string } | null>(null);
let reviewRevision = 0;

const diff = computed(() => (reviewing.value ? pendingText(props.collectionKey, props.id) : undefined));
const canWrite = computed(() => reviewing.value && !checking.value && !saving.value
  && !conflictText.value && checkedSelection.value?.collectionKey === props.collectionKey
  && checkedSelection.value?.id === props.id);

// The same SaveControl instance survives switching an event, arc or working.
// A review of one item must never remain available for a different selection.
function cancelReview(): void {
  ++reviewRevision;
  reviewing.value = false;
  checking.value = false;
  checkedSelection.value = null;
  conflictText.value = null;
  saveError.value = null;
}
watch([() => props.collectionKey, () => props.id], cancelReview, { flush: 'sync' });

async function review(): Promise<void> {
  if (checking.value || saving.value) return;
  const collectionKey = props.collectionKey;
  const id = props.id;
  const revision = ++reviewRevision;
  saveError.value = null;
  conflictText.value = null;
  checkedSelection.value = null;
  reviewing.value = true;
  checking.value = true;
  try {
    const p = path.value;
    if (!p) {
      saveError.value = 'The selected item has no source file to review.';
      return;
    }
    const check = await externalChange(p);
    // An older asynchronous disk response cannot authorize a newer selection
    // or a review the author already cancelled.
    if (revision !== reviewRevision || props.collectionKey !== collectionKey || props.id !== id) return;
    if (check.changed) {
      // Empty files must still block the write and explain the conflict.
      conflictText.value = check.text || '(the source file is empty)';
    } else {
      checkedSelection.value = { collectionKey, id };
    }
  } catch (cause) {
    if (revision === reviewRevision) {
      saveError.value = cause instanceof Error ? cause.message : String(cause);
    }
  } finally {
    if (revision === reviewRevision) checking.value = false;
  }
}

async function confirmSave(): Promise<void> {
  if (!canWrite.value) return;
  const revision = reviewRevision;
  const collectionKey = props.collectionKey;
  const id = props.id;
  saving.value = true;
  try {
    const res = await saveItem(collectionKey, id);
    if (revision !== reviewRevision || props.collectionKey !== collectionKey || props.id !== id) return;
    if (res.ok) cancelReview();
    else saveError.value = res.error ?? 'save failed';
  } catch (cause) {
    if (revision === reviewRevision) {
      saveError.value = cause instanceof Error ? cause.message : String(cause);
    }
  } finally {
    saving.value = false;
  }
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
    <button class="btn" :disabled="!dirty || checking || saving" @click="review">Review &amp; save</button>
  </div>

  <div v-if="reviewing" class="panel" style="margin-top: 10px">
    <h3>What would be written to {{ path }}</h3>

    <div v-if="conflictText" class="issue error">
      This file changed on disk since the editor loaded it — writing now would overwrite that
      change. Reload the editor to pick it up before saving.
    </div>

    <p v-if="checking" role="status" class="note">Checking the source file before writing…</p>
    <DiffView v-if="diff" :before="diff.before" :after="diff.after" />

    <div class="bar" style="margin-top: 10px">
      <button class="btn primary" :disabled="!canWrite" @click="confirmSave">
        {{ saving ? 'Writing…' : 'Write to disk' }}
      </button>
      <button class="btn"  :disabled="saving" @click="cancelReview">Cancel</button>
    </div>
    <div v-if="saveError" class="issue error" style="margin-top: 8px">{{ saveError }}</div>
  </div>
</template>
