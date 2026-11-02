<script setup lang="ts">
import { ref, watch } from 'vue';
import { deleteEvent, externalChange, pendingDeleteEvent } from '../lib/store';
import DiffView from './DiffView.vue';

const props = defineProps<{ id: string }>();
const reviewing = ref(false);
const working = ref(false);
const checking = ref(false);
const confirmation = ref('');
const error = ref('');
const preview = ref<{ id: string; path: string; before: string; after: string } | undefined>();

// Review includes an asynchronous disk check. Selection changes, cancellation
// and a newer review must invalidate an earlier check before it may display
// a confirmation for a different event.
let reviewRevision = 0;

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

watch(() => props.id, () => cancel());

async function review() {
  if (checking.value || working.value) return;
  const reviewedId = props.id;
  const revision = ++reviewRevision;
  error.value = '';
  confirmation.value = '';
  reviewing.value = false;
  preview.value = undefined;
  const result = pendingDeleteEvent(reviewedId);
  if (!result.ok) { error.value = result.error; return; }
  checking.value = true;
  try {
    const changed = await externalChange(result.path);
    // A selected event or review may change while the host reads the file.
    if (revision !== reviewRevision || props.id !== reviewedId) return;
    if (changed.changed) {
      error.value = 'This file changed on disk. Reload before reviewing deletion.';
      return;
    }
    preview.value = { id: reviewedId, path: result.path, before: result.before, after: result.after };
    reviewing.value = true;
  } catch (cause) {
    // A failed host read cannot authorize deletion, or report on a newer event.
    if (revision === reviewRevision && props.id === reviewedId) {
      error.value = 'Could not check the source file: ' + errorMessage(cause);
    }
  } finally {
    if (revision === reviewRevision) checking.value = false;
  }
}
function cancel() {
  ++reviewRevision;
  checking.value = false;
  reviewing.value = false;
  preview.value = undefined;
  confirmation.value = '';
  error.value = '';
}
async function remove() {
  if (working.value || confirmation.value !== props.id || preview.value?.id !== props.id) return;
  const removedId = props.id;
  const revision = reviewRevision;
  working.value = true;
  error.value = '';
  try {
    const result = await deleteEvent(removedId);
    if (revision !== reviewRevision || props.id !== removedId) return;
    if (!result.ok) error.value = result.error ?? 'Deletion failed; the original remains available.';
    else cancel(); // The selected event vanishes from the live list on success.
  } catch (cause) {
    // Keep the reviewed diff/confirmation so the author can retry or cancel.
    if (revision === reviewRevision && props.id === removedId) {
      error.value = 'Deletion failed; the original may remain available: ' + errorMessage(cause);
    }
  } finally {
    working.value = false;
  }
}
</script>

<template>
  <section class="delete-event">
    <button v-if="!reviewing" class="btn" type="button" :disabled="checking || working" @click="review">
      {{ checking ? 'Checking source file…' : 'Review event deletion…' }}
    </button>
    <template v-if="reviewing && preview">
      <h4>Delete {{ id }} from {{ preview.path }}?</h4>
      <p class="note">
        Deletion cannot be undone here. It is refused for referenced events,
        read-only files, conflicting disk changes and unsaved edits.
      </p>
      <DiffView :before="preview.before" :after="preview.after" />
      <label>Type the exact event ID to confirm:
        <input v-model="confirmation" aria-label="Confirm event deletion" type="text" />
      </label>
      <div class="bar">
        <button class="btn" type="button" :disabled="working || confirmation !== id" @click="remove">
          {{ working ? 'Deleting…' : 'Delete event permanently' }}
        </button>
        <button class="btn" type="button" :disabled="working" @click="cancel">Cancel deletion</button>
      </div>
    </template>
    <p v-if="error" class="issue error" role="alert">{{ error }}</p>
  </section>
</template>

<style scoped>
.delete-event { border-top: 1px solid var(--rule); margin-top: 11px; padding-top: 9px; }
.delete-event h4 { margin: 8px 0 3px; }
.delete-event .note { font-size: 12px; }
.delete-event input { margin-left: 7px; max-width: 280px; }
</style>
