<script setup lang="ts">
import { ref } from 'vue';
import type { SessionView } from '@ed/core';
import type { GameActions } from '../lib/game';

const props = defineProps<{ view: SessionView; actions: GameActions }>();
const choosing = ref(false);
const selected = ref(props.view.ambition?.id ?? props.view.ambitionOptions[0]?.id);

function apply(): void {
  if (!selected.value) return;
  props.actions.setAmbition(selected.value);
  choosing.value = false;
}
function clear(): void {
  props.actions.setAmbition(null);
  choosing.value = false;
}
</script>

<template>
  <section class="panel ambition" aria-labelledby="ambition-heading">
    <div class="ambition-head">
      <h3 id="ambition-heading" class="label">House ambition</h3>
      <button v-if="view.ambition && !choosing" class="quiet small" @click="choosing = true">Change</button>
    </div>

    <template v-if="view.ambition && !choosing">
      <strong>{{ view.ambition.name }}</strong>
      <p class="small ambition-purpose">{{ view.ambition.purpose }}</p>
      <p class="small ambition-progress">{{ view.ambition.progress.label }}</p>
      <p class="dim small">{{ view.ambition.status }}</p>
      <p class="small next"><span class="rubric">Next:</span> {{ view.ambition.next }}</p>
    </template>

    <template v-else>
      <p class="dim small">Choose one plan to keep in view. It changes no odds, rewards, or rules.</p>
      <label class="small">
        The house will try to
        <select v-model="selected">
          <option v-for="option in view.ambitionOptions" :key="option.id" :value="option.id">
            {{ option.name }}
          </option>
        </select>
      </label>
      <p v-if="selected" class="dim small option-purpose">
        {{ view.ambitionOptions.find((o) => o.id === selected)?.purpose }}
      </p>
      <div class="wrap ambition-actions">
        <button :disabled="!selected" @click="apply">Keep this in view</button>
        <button v-if="view.ambition" class="quiet" @click="clear">Clear ambition</button>
        <button v-if="view.ambition" class="quiet" @click="choosing = false">Keep current</button>
      </div>
    </template>
  </section>
</template>

<style scoped>
.ambition-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.ambition-head .label { margin: 0; }
.ambition-purpose { margin: 5px 0 0; }
.ambition-progress {
  margin: 10px 0 3px; padding-top: 8px; border-top: 1px solid var(--rule);
  font-variant-numeric: tabular-nums;
}
.next { margin-bottom: 0; }
.rubric { color: var(--rubric); }
label { display: grid; gap: 6px; }
select { width: 100%; }
.option-purpose { margin: 8px 0 0; }
.ambition-actions { margin-top: 10px; }
</style>
