<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import type { SessionView } from '@ed/core';
import type { ProseMode } from '@ed/schema';
import type { GameActions } from '../lib/game';

const props = defineProps<{ view: SessionView; actions: GameActions; proseMode?: ProseMode }>();
const plain = computed(() => props.proseMode === 'plainenglish');
const choosing = ref(false);
// #1867 §4: the first ambition arrives with a reason. Pre-select what the
// house's situation points at; the player can still choose any other plan.
const firstChoice = () => props.view.ambition?.id ?? props.view.ambitionRecommendation?.id ?? props.view.ambitionOptions[0]?.id;
const selected = ref(firstChoice());
const recommended = computed(() => props.view.ambitionRecommendation);
// Shown beside a tracked ambition only when the situation has moved elsewhere,
// which is what a succession, a crisis or a lost candidate looks like here.
const pressing = computed(() => recommended.value && props.view.ambition
  && recommended.value.id !== props.view.ambition.id ? recommended.value : undefined);
type AmbitionRefusal = '' | 'unavailable' | 'set' | 'clear';
const refusal = ref<AmbitionRefusal>('');
function refusalText(kind: AmbitionRefusal): string {
  switch (kind) {
    case 'unavailable':
      return plain.value ? 'That plan is no longer available. Choose another.' : 'That ambition is no longer available. Choose another plan.';
    case 'set':
      return plain.value ? 'Could not select that plan. Choose another or try again.' : 'The house could not keep that ambition. Choose another plan or try again.';
    case 'clear':
      return plain.value ? 'Could not remove that plan. Try again.' : 'The house could not clear that ambition. Try again.';
    default:
      return '';
  }
}
const available = computed(() => props.view.ambitionOptions.some((option) => option.id === selected.value));

// A new sitting or an external ambition change must not leave an old selection
// behind. Preserve an in-progress draft unless its option has disappeared.
watch(() => props.view, () => {
  if (!choosing.value) {
    selected.value = firstChoice();
    refusal.value = '';
  } else if (!available.value) {
    refusal.value = 'unavailable';
  }
});

function beginChoosing(target?: string): void {
  selected.value = props.view.ambitionOptions.some((o) => o.id === target)
    ? target as typeof selected.value
    : props.view.ambition?.id ?? props.view.ambitionOptions[0]?.id;
  refusal.value = '';
  choosing.value = true;
}

// Changing and clearing an ambition share a single visible editor. Do not
// dispatch competing orders while Vue still shows the prior world's buttons.
let submitting = false;
function dispatchAmbition(id: Parameters<GameActions['setAmbition']>[0]): boolean | null {
  if (submitting) return null;
  submitting = true;
  try {
    return props.actions.setAmbition(id);
  } finally {
    // A refused or throwing order must not lock out a deliberate later retry.
    void nextTick(() => { submitting = false; });
  }
}

function apply(): void {
  if (submitting) return;
  if (!selected.value || !available.value) {
    refusal.value = 'unavailable';
    return;
  }
  const accepted = dispatchAmbition(selected.value);
  if (accepted === null) return;
  if (!accepted) {
    // The store publishes a fresh view even on refusal. Keep editing so the
    // view watcher cannot reset this first ambition's draft and error as if
    // the player had merely opened the idle, no-ambition screen.
    choosing.value = true;
    refusal.value = 'set';
    return;
  }
  refusal.value = '';
  choosing.value = false;
}

function clear(): void {
  const accepted = dispatchAmbition(null);
  if (accepted === null) return;
  if (!accepted) {
    refusal.value = 'clear';
    return;
  }
  refusal.value = '';
  choosing.value = false;
}

function cancel(): void {
  refusal.value = '';
  choosing.value = false;
}
</script>

<template>
  <section class="panel ambition" aria-labelledby="ambition-heading">
    <div class="ambition-head">
      <h3 id="ambition-heading" class="label">{{ plain ? 'Family goal' : 'House ambition' }}</h3>
      <button v-if="view.ambition && !choosing" class="quiet small" @click="beginChoosing()">{{ plain ? 'Change goal' : 'Change' }}</button>
    </div>

    <template v-if="view.ambition && !choosing">
      <strong>{{ view.ambition.name }}</strong>
      <p class="small ambition-purpose">{{ view.ambition.purpose }}</p>
      <p class="small ambition-progress">{{ view.ambition.progress.label }}</p>
      <p class="dim small">{{ view.ambition.status }}</p>
      <p class="small next"><span class="rubric">{{ plain ? 'Next step:' : 'Next:' }}</span> {{ view.ambition.next }}</p>
      <p v-if="pressing" class="small pressing">
        <span class="dim">{{ plain ? 'The family\'s situation now points to' : 'The house\'s situation now points to' }}</span>
        <strong>{{ pressing.name }}</strong>. {{ pressing.reason }}
        <button class="quiet small" @click="beginChoosing(pressing.id)">Consider it</button>
      </p>
    </template>

    <template v-else>
      <p class="dim small">{{ plain ? 'Choose a goal to track. It does not change the game rules or results.' : 'Choose one plan to keep in view. It changes no odds, rewards, or rules.' }}</p>
      <label class="small">
        {{ plain ? 'Choose a goal' : 'The house will try to' }}
        <select v-model="selected" @change="refusal = ''">
          <option v-for="option in view.ambitionOptions" :key="option.id" :value="option.id">
            {{ option.name }}{{ option.id === recommended?.id ? (plain ? ' (suggested)' : ' (recommended)') : '' }}
          </option>
        </select>
      </label>
      <p v-if="selected" class="dim small option-purpose">
        {{ view.ambitionOptions.find((o) => o.id === selected)?.purpose }}
      </p>
      <p v-if="recommended" class="small recommendation">
        <span class="rubric">{{ plain ? 'Suggested:' : 'Recommended:' }}</span>
        {{ recommended.name }}. {{ recommended.reason }}
      </p>
      <p v-if="refusal" class="small ambition-refusal" role="alert">{{ refusalText(refusal) }}</p>
      <div class="wrap ambition-actions">
        <button :disabled="!available" @click="apply">{{ plain ? 'Track this goal' : 'Keep this in view' }}</button>
        <button v-if="view.ambition" class="quiet" @click="clear">{{ plain ? 'Remove goal' : 'Clear ambition' }}</button>
        <button v-if="view.ambition" class="quiet" @click="cancel">{{ plain ? 'Keep current goal' : 'Keep current' }}</button>
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
.recommendation, .pressing { margin: 8px 0 0; }
.pressing { padding-top: 8px; border-top: 1px solid var(--rule); }
.ambition-refusal { color: var(--rubric); margin: 9px 0 0; }
</style>
