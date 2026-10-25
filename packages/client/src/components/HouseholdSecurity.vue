<script setup lang="ts">
import { ref } from 'vue';
import type { TableView } from '@ed/core';
import type { ProseMode, TableOrder } from '@ed/schema';

const props = defineProps<{ security: TableView['security']; proseMode?: ProseMode; refusal?: string | null }>();
const emit = defineEmits<{ order: [TableOrder] }>();
const selected = ref<Record<string, string>>({});
const local = (original: string, plain: string) => props.proseMode === 'plainenglish' ? plain : original;
type Warning = TableView['security']['threats'][number];
const key = (option: Warning['options'][number]) => JSON.stringify(option.order);
const choice = (t: Warning) => t.options.find(o => key(o) === selected.value[t.id]);
function commit(t: Warning) {
  const option = choice(t);
  if (!option?.ok) return;
  const o = option.order;
  // Values, not a reactive prop, cross the session's command boundary.
  emit('order', { kind: 'covertDefend', threat: o.threat, response: o.response, guards: [...o.guards] });
}
</script>

<template>
  <section v-if="security.threats.length || security.history.length" class="panel security" data-testid="household-security">
    <h3 class="label">{{ local('Warnings at the door', 'Household security') }}</h3>
    <div v-for="warning in security.threats" :key="warning.id" class="security-warning">
      <p class="small"><strong>{{ warning.name }}</strong>
        <span class="dim"> · {{ local('precautions through', 'protection window ends in') }} {{ warning.due }}</span>
      </p>
      <p class="small" :class="warning.warned ? 'rubric' : 'dim'">
        {{ warning.warned ? local('An approach was seen. Lodging or an escort can be arranged.', 'An approach was detected. Safe lodging or an escort is available.')
          : local('A warning is outstanding. A named watch can still be arranged.', 'There is an early warning. You can arrange named guards.') }}
      </p>
      <p class="small dim">{{ local('Keeping watch:', 'Current guards:') }} {{ warning.watch.join(', ') || local('nobody', 'none') }}
        · {{ warning.spent }} {{ local('crowns committed', 'crowns already paid') }}</p>
      <div class="security-controls">
        <label class="small">
          {{ local('Precautions for', 'Choose protection for') }} {{ warning.name }}
          <select v-model="selected[warning.id]" :aria-label="local('Precautions for', 'Protection for') + ' ' + warning.name">
            <option value="">{{ local('Choose the watch', 'Choose a response') }}</option>
            <option v-for="option in warning.options" :key="key(option)" :value="key(option)" :disabled="!option.ok">
              {{ option.label }} · {{ option.guards.join(', ') || local('no guards', 'without guards') }} · {{ option.price }} crowns
              {{ option.reason ? ' · ' + option.reason : '' }}
            </option>
          </select>
        </label>
        <button class="small" :disabled="!choice(warning)?.ok" @click="commit(warning)">
          {{ local('Commit the precautions', 'Confirm protection') }}
        </button>
      </div>
      <p v-if="choice(warning)?.reason" class="small rubric">{{ choice(warning)?.reason }}</p>
    </div>
    <p v-if="refusal" class="small rubric" role="status">{{ refusal }}</p>
    <details v-if="security.history.length" class="security-history">
      <summary class="small">{{ local('The service account', 'Recent security outcomes') }}</summary>
      <div v-for="entry in security.history" :key="entry.id" class="security-warning">
        <p class="small"><span class="dim">{{ entry.year }} · </span>{{ entry.receipt }}</p>
        <div v-if="entry.prisoner" class="row small">
          <span>{{ entry.prisoner.name }} · {{ local('held here', 'in custody here') }}</span>
          <button class="small" @click="emit('order', { kind: 'releaseIntruder', threat: entry.id })">
            {{ local('Release the prisoner', 'Release this prisoner') }}
          </button>
        </div>
      </div>
    </details>
  </section>
</template>

<style scoped>
.security-warning + .security-warning { margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--rule); }
.security-warning p { margin: 4px 0; }
.security-controls { display: flex; flex-wrap: wrap; align-items: end; gap: 8px; margin-top: 8px; }
.security-controls label { display: grid; gap: 4px; min-width: 0; max-width: 100%; }
.security-controls select { max-width: 100%; min-height: 44px; }
.security-controls button, .security-history button { min-height: 44px; }
.security-history { margin-top: 12px; }
</style>
