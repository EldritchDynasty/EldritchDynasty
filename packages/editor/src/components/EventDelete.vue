<script setup lang="ts">
import { ref, watch } from 'vue';
import { deleteEvent, externalChange, pendingDeleteEvent } from '../lib/store';
import DiffView from './DiffView.vue';

const props = defineProps<{ id: string }>();
const reviewing = ref(false);
const working = ref(false);
const confirmation = ref('');
const error = ref('');
const preview = ref<{ path: string; before: string; after: string } | undefined>();

watch(() => props.id, () => cancel());

async function review() {
  error.value = '';
  confirmation.value = '';
  const result = pendingDeleteEvent(props.id);
  if (!result.ok) { error.value = result.error; return; }
  const changed = await externalChange(result.path);
  if (changed.changed) {
    error.value = 'This file changed on disk. Reload before reviewing deletion.';
    return;
  }
  preview.value = { path: result.path, before: result.before, after: result.after };
  reviewing.value = true;
}
function cancel() {
  reviewing.value = false;
  preview.value = undefined;
  confirmation.value = '';
  error.value = '';
}
async function remove() {
  if (working.value || confirmation.value !== props.id) return;
  working.value = true;
  try {
    const result = await deleteEvent(props.id);
    if (!result.ok) error.value = result.error ?? 'Deletion failed; the original remains available.';
    else cancel(); // The selected event vanishes from the live list on success.
  } finally { working.value = false; }
}
</script>

<template>
  <section class="delete-event">
    <button v-if="!reviewing" class="btn" type="button" @click="review">Review event deletion…</button>
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
