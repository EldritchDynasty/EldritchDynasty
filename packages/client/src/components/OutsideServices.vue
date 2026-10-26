<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { TableView } from '@ed/core';
import type { ProseMode } from '@ed/schema';
import type { GameActions } from '../lib/game';

const props = defineProps<{
  services: TableView['outsideServices']; actions: GameActions; proseMode?: ProseMode;
  refusal: { kind: string; reason: string } | null;
}>();
const local = (original: string, plain: string) => props.proseMode === 'plainenglish' ? plain : original;
const selected = ref('');
const groups = computed(() => [
  { name: local('A reader for the house', 'Hire a practitioner'), offers: props.services.hires },
  { name: local('Work for another house', 'Accept a commission'), offers: props.services.commissions },
  { name: local('A promised return', 'Fulfil a return obligation'), offers: props.services.returns },
]);
const offers = computed(() => [...props.services.hires, ...props.services.commissions, ...props.services.returns]);
const key = (offer: typeof offers.value[number]) => JSON.stringify(offer.order);
const choice = computed(() => offers.value.find(offer => key(offer) === selected.value));
watch(offers, rows => { if (!rows.some(row => key(row) === selected.value)) selected.value = ''; });
const refusal = computed(() => props.refusal && ['mysticSearch', 'mysticHire', 'mysticCommission', 'mysticReturn'].includes(props.refusal.kind) ? props.refusal.reason : null);
function commit() {
  if (choice.value?.ok) props.actions.order(JSON.parse(JSON.stringify(choice.value.order)));
}
const stage = (value: string) => value === 'preparing' ? local('on the outward road', 'travelling and preparing')
  : value === 'working' ? local('keeping the agreed work', 'serving') : local('on the return road', 'returning');
</script>

<template>
  <section class="panel outside-services" data-testid="outside-services">
    <h3 class="label">{{ local('Readers on the road', 'Outside Mystic services') }}</h3>
    <p class="small dim">{{ services.terms }}</p>
    <div class="service-search">
      <button class="small" :disabled="!services.search.ok" @click="actions.order({ kind: 'mysticSearch' })">
        {{ local('Send the broker', 'Search for a practitioner') }} · {{ services.search.price }} crowns
      </button>
      <span class="small dim">{{ services.search.reason ?? local(`Answer due in ${services.search.due}`, `Search completes in ${services.search.due}`) }}</span>
      <p v-if="services.search.scarce" class="small rubric">{{ local('War or plague has lengthened the search.', 'War or plague delays the search.') }}</p>
    </div>
    <div v-for="contract in services.contracts" :key="contract.id" class="service-entry small">
      <p><strong>{{ contract.person }}</strong> · {{ stage(contract.stage) }}</p>
      <p class="dim">{{ local('Work begins', 'Ready in') }} {{ contract.ready }} · {{ local('last working year', 'work ends in') }} {{ contract.ends }} · {{ local('return due', 'return expected in') }} {{ contract.returnsAt }}</p>
      <p class="dim">{{ contract.paid.toFixed(1) }} {{ local('crowns spent', 'crowns paid') }} · {{ contract.earned }} {{ local('crowns received', 'crowns earned') }}</p>
    </div>
    <template v-if="offers.length">
      <label class="small service-choice">{{ local('The proposed service', 'Choose an outside service') }}
        <select v-model="selected">
          <option value="">{{ local('Read the terms before committing', 'Choose an offer to review') }}</option>
          <optgroup v-for="group in groups.filter(group => group.offers.length)" :key="group.name" :label="group.name">
            <option v-for="offer in group.offers" :key="key(offer)" :value="key(offer)">
              {{ offer.person }} · {{ offer.working }} · {{ 'place' in offer ? offer.place : offer.patron }}
            </option>
          </optgroup>
        </select>
      </label>
      <div v-if="choice" class="service-entry small">
        <p><strong>{{ choice.person }}</strong> · {{ choice.working }}</p>
        <p v-if="'description' in choice" class="dim">{{ choice.description }}</p>
        <p>{{ choice.price }} {{ local('crowns now', 'crowns paid at commitment') }} ({{ choice.providerFee }} {{ local('to the reader', 'professional fee') }} + {{ choice.workingFee }} {{ local('to make ready', 'preparation') }}) · {{ choice.upkeep }} {{ local('crowns a working year', 'crowns per working year') }}</p>
        <p class="dim">{{ local('Work begins', 'Ready in') }} {{ choice.ready }} · {{ local('last working year', 'work ends in') }} {{ choice.ends }} · {{ local('return due', 'return expected in') }} {{ choice.returnsAt }}</p>
        <p v-if="'income' in choice" class="dim">{{ choice.income }} {{ local('crowns across the term', 'crowns earned over the full term') }} · {{ choice.favour }} {{ local('favour on completion, within the ordinary limit', 'relationship gain on completion, capped normally') }}</p>
        <p v-if="'fieldTerms' in choice && choice.fieldTerms" class="rubric">{{ choice.fieldTerms }}</p>
        <p v-if="choice.reason" class="rubric">{{ choice.reason }}</p>
        <button class="small" :disabled="!choice.ok" @click="commit">{{ local('Commit this service', 'Confirm this service') }}</button>
      </div>
    </template>
    <p v-else-if="!services.contracts.length" class="small dim">{{ local('No known reader can yet be offered work here.', 'There are no known qualified readers with suitable work to offer.') }}</p>
    <p v-if="refusal" class="small rubric" role="status">{{ refusal }}</p>
    <div v-for="promise in services.promises" :key="promise.id" class="service-entry small">
      <p :class="promise.overdue ? 'rubric' : 'dim'">{{ promise.patron }} · {{ local('a trained reader was promised by', 'a trained reader must return by') }} {{ promise.due }}{{ promise.overdue ? local(' · the missed term is remembered', ' · the missed deadline remains recorded') : '' }}</p>
    </div>
    <details v-if="services.history.length" class="small service-entry">
      <summary>{{ local('Closed road accounts', 'Completed outside service accounts') }}</summary>
      <div v-for="past in services.history" :key="past.id" class="service-entry">
        <p>{{ past.receipt }}</p><p class="dim">{{ past.earned }} {{ local('crowns received', 'crowns earned') }}</p>
      </div>
    </details>
  </section>
</template>

<style scoped>
.service-search, .service-entry, .service-choice { margin-top: 12px; }
.service-entry { border-top: 1px solid var(--rule); padding-top: 8px; }
.service-entry p { margin: 4px 0; }
.service-choice { display: grid; gap: 4px; }
select { width: 100%; min-width: 0; }
.service-search { display: flex; align-items: baseline; flex-wrap: wrap; gap: 8px; }
.service-entry, .service-search { overflow-wrap: anywhere; }
</style>
