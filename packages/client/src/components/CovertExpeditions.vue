<script setup lang="ts">
import { computed, ref } from 'vue';
import type { TableView } from '@ed/core';
import type { ProseMode, TableOrder } from '@ed/schema';

const props = defineProps<{ expeditions: TableView['expeditions']; proseMode?: ProseMode; refusal?: string | null }>();
const emit = defineEmits<{ order: [TableOrder] }>();
const selection = ref('');
const selected = computed(() => props.expeditions.offers.find(o => JSON.stringify(o.order) === selection.value));
const local = (original: string, plain: string) => props.proseMode === 'plainenglish' ? plain : original;
function prepare() {
  const offer = selected.value;
  if (offer?.ok) emit('order', { ...offer.order });
}
</script>

<template>
  <section v-if="expeditions.offers.length || expeditions.current.length || expeditions.history.length || expeditions.cases.length"
    class="panel expeditions" data-testid="covert-expeditions">
    <h3 class="label">{{ local('Covert expeditions', 'Covert operations') }}</h3>
    <p class="small dim">{{ expeditions.terms }}</p>
    <div v-if="expeditions.offers.length" class="expedition-choice">
      <label class="small">
        {{ local('Name the purpose and the person to risk', 'Choose the target, purpose and operative') }}
        <select v-model="selection" :aria-label="local('The expedition to prepare', 'Choose a covert operation')">
          <option value="">{{ local('Choose the undertaking', 'Choose an operation') }}</option>
          <option v-for="offer in expeditions.offers" :key="JSON.stringify(offer.order)" :value="JSON.stringify(offer.order)" :disabled="!offer.ok">
            {{ offer.targetName }} · {{ offer.purpose }} · {{ offer.operativeName }} · {{ offer.preparation }} · {{ offer.price }} crowns
            {{ offer.reason ? ' · ' + offer.reason : '' }}
          </option>
        </select>
      </label>
      <p v-if="selected" class="small">{{ selected.price }} {{ local('crowns paid now', 'crowns charged now') }}
        · {{ local('attempt in', 'attempt year') }} {{ selected.ready }} · {{ local('return no earlier than', 'earliest return') }} {{ selected.returnYear }}</p>
      <button class="small" :disabled="!selected?.ok" @click="prepare">{{ local('Commit the expedition', 'Prepare this operation') }}</button>
    </div>
    <div v-for="operation in expeditions.current" :key="operation.id" class="expedition-record">
      <p class="small"><strong>{{ operation.name }}</strong> · {{ operation.stageName }}</p>
      <p class="small dim">{{ operation.operative }} · {{ operation.paid }} {{ local('crowns spent', 'crowns paid') }}
        · {{ local('attempt in', 'attempt year') }} {{ operation.attemptYear }}
        <template v-if="operation.returnsAt"> · {{ local('return in', 'return year') }} {{ operation.returnsAt }}</template></p>
      <p class="small dim">{{ local('Committed to the journey:', 'Expedition members:') }} {{ operation.crew.join(', ') }}</p>
      <p v-if="operation.result" class="small">{{ operation.result }}<template v-if="operation.fate"> · {{ operation.fate }}</template></p>
      <p v-if="operation.receipt" class="small">{{ operation.receipt }}</p>
      <p v-else class="small dim">{{ local('Learned support can be set to this expedition under the duties below.', 'Assign learned support to this operation in the Mystic duties below.') }}</p>
      <button v-if="operation.canWithdraw" class="small" @click="emit('order', { kind: 'covertWithdraw', operation: operation.id })">
        {{ local('Recall the expedition', 'Withdraw before the attempt') }}
      </button>
    </div>
    <p v-if="refusal" class="small rubric" role="status">{{ refusal }}</p>
    <details v-if="expeditions.history.length" class="expedition-history">
      <summary class="small">{{ local('Closed expedition accounts', 'Completed operations') }}</summary>
      <div v-for="operation in expeditions.history" :key="operation.id" class="expedition-record">
        <p class="small"><strong>{{ operation.name }}</strong> · {{ operation.result }}</p>
        <p class="small">{{ operation.fate }}</p>
        <p class="small dim">{{ operation.paid }} {{ local('crowns spent', 'crowns paid') }} · {{ operation.crew.join(', ') }}</p>
        <p class="small">{{ operation.receipt }}</p>
      </div>
    </details>
    <div v-for="hearing in expeditions.cases" :key="hearing.id" class="expedition-record">
      <p class="small"><span class="dim">{{ hearing.year }} · </span>{{ hearing.receipt }}</p>
    </div>
  </section>
</template>

<style scoped>
.expedition-choice { display: grid; justify-items: start; gap: 8px; }
.expedition-choice label { display: grid; gap: 4px; min-width: 0; max-width: 100%; }
.expedition-choice select { width: 100%; max-width: 100%; min-height: 44px; }
.expeditions button { min-height: 44px; }
.expedition-record { margin-top: 12px; padding-top: 8px; border-top: 1px solid var(--rule); }
.expedition-record p { margin: 4px 0; }
.expedition-history { margin-top: 12px; }
</style>
