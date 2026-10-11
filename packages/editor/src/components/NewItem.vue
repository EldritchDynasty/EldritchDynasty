<script setup lang="ts">
import { computed, ref } from 'vue';
import { createItem, filesHolding } from '../lib/store';

/**
 * A NEW EVENT, OR A NEW SUBSTORY.
 *
 * It joins a file that already exists, which the author picks. Writing a
 * brand-new file would mean widening the path check in both write transports,
 * and content is organised by subject rather than one item per file anyway —
 * so the question "which file" is one an author has an opinion about and
 * should be asked.
 *
 * The seed is deliberately valid rather than empty: an event with no purposes
 * and a one-word body fails four rules the moment it exists, and an author
 * whose first experience of the New button is a wall of red learns to avoid
 * the button.
 */
const props = defineProps<{ collectionKey: string; seed: (id: string) => { id: string } }>();
const emit = defineEmits<{ created: [string] }>();

const open = ref(false);
const id = ref('');
const path = ref('');
const error = ref('');
const busy = ref(false);

const paths = computed(() => filesHolding(props.collectionKey));

function start() {
  open.value = true;
  error.value = '';
  path.value = paths.value[0] ?? '';
}

const cleanId = computed(() => id.value.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_'));

async function create() {
  // Keep the submitted ID across the asynchronous write: clearing the input
  // also clears cleanId, so emitting that computed after reset emits ''.
  const createdId = cleanId.value;
  if (busy.value || !createdId || !path.value) return;
  busy.value = true;
  const res = await createItem(props.collectionKey, path.value, props.seed(createdId));
  busy.value = false;
  if (!res.ok) { error.value = res.error ?? 'write failed'; return; }
  open.value = false;
  id.value = '';
  emit('created', createdId);
}
</script>

<template>
  <div class="newitem">
    <button v-if="!open" class="btn" @click="start">+ new</button>
    <template v-else>
      <input type="text" v-model="id" placeholder="snake_case id, never renamed after commit" style="max-width:280px" />
      <select v-model="path">
        <option v-for="p in paths" :key="p" :value="p">{{ p }}</option>
      </select>
      <button class="btn" :disabled="busy || !cleanId" @click="create">{{ busy ? 'writing…' : 'create' }}</button>
      <button class="btn" @click="open = false">cancel</button>
      <span v-if="cleanId && cleanId !== id.trim()" class="fk">will be created as {{ cleanId }}</span>
      <div v-if="error" class="issue error">{{ error }}</div>
    </template>
  </div>
</template>

<style scoped>
.newitem { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; margin-top: 8px; }
.newitem input, .newitem select { width: auto; margin: 0; font-size: 12.5px; padding: 5px 7px; }
.fk { font-size: 11px; color: var(--ink-faint); }
</style>
