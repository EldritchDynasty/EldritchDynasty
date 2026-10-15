<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import type { SessionView } from '@ed/core';
import type { ProseMode } from '@ed/schema';
import type { GameActions } from '../lib/game';

const props = defineProps<{
  /** No separate view type: the Muster's whole read model is `SessionView.muster`, absent when dormant. */
  view: SessionView;
  /** UI-only reading choice; the war read model and action payloads never change. */
  proseMode?: ProseMode;
  actions: GameActions;
  /** The last muster order refused, and why (issue #55's rule, kept for a second verb). */
  refusal: { op: string; reason: string } | null;
}>();

/**
 * THE MUSTER (concept §6, world §10; issue #89, Stages 2-3 — #95, #97).
 *
 * A panel, not a modal (#89's own words) — a docket item every year for
 * thirty-eight years would be a punishment, not a decision. Entering a war
 * and settling one are scripted moments an authored event reaches; this is
 * the standing order in between: reinforce it, buy up a position, or call
 * the men home. `commitment.positions` prices all four — `none` included,
 * a choice and not an absence — against the house exactly as it stands.
 */
const commitment = computed(() => props.view.muster);
const plain = computed(() => props.proseMode === 'plainenglish');
function local(original: string, direct: string): string {
  return plain.value ? direct : original;
}

function refusedIn(op: string): string | null {
  return props.refusal?.op === op ? props.refusal.reason : null;
}

const reinforceBy = ref(1);
/**
 * Vue's v-model.number returns an empty string when this field is cleared.
 * Prevent accidental fractions and unsafe counts from reaching the war-state
 * verb, while leaving the entered value visible for correction.
 */
const canReinforce = computed(() => Number.isSafeInteger(reinforceBy.value) && reinforceBy.value > 0);

/**
 * Keep one visible Muster from dispatching two war orders against the same
 * stale view. Vue has not patched a new position/men count during the click,
 * so an immediate second button activation is not a new deliberate order.
 * The next render unlocks the buttons even if an action refuses or throws.
 */
let submitting = false;
function sendOrder(order: Parameters<GameActions['muster']>[0]): void {
  if (submitting) return;
  submitting = true;
  try {
    props.actions.muster(order);
  } finally {
    void nextTick(() => { submitting = false; });
  }
}

function reinforce(): void {
  if (!canReinforce.value) return;
  sendOrder({ op: 'reinforce', men: reinforceBy.value });
}

const tideWord = computed(() => {
  const m = commitment.value;
  if (!m) return '';
  if (plain.value) return m.tide >= 60 ? 'favouring the house' : m.tide <= 40 ? 'against the house' : 'even for now';
  return m.tide >= 60 ? "in the house's favour" : m.tide <= 40 ? 'against the house' : 'holding, for now';
});
</script>

<template>
  <section v-if="commitment" class="muster panel">
    <h3 class="label">{{ local('The muster', 'Troops and war commitments') }}</h3>
    <p class="small">
      {{ commitment.men }} {{ plain ? (commitment.men === 1 ? 'troop' : 'troops') : (commitment.men === 1 ? 'man' : 'men') }} {{ local('in the field since', 'serving since') }} {{ commitment.began }},
      {{ local('of a house that could field', 'compared with the family\'s standard levy of') }} {{ commitment.maxMen }}.
    </p>
    <p class="small dim">{{ local('The tide runs', 'War progress is') }} {{ tideWord }}. {{ local('Credit earned so far:', 'War credit earned so far:') }} {{ commitment.credit.toFixed(1) }}.</p>

    <p v-if="commitment.positionName" class="small dim">{{ local('Standing under', 'Current war position:') }} {{ commitment.positionName }}.</p>
    <p v-else class="small rubric">{{ local('No banner bought. Word gets around; it is not in writing.', 'No formal war position has been purchased. Other houses may hear about the contribution, but it is not recorded.') }}</p>

    <p v-if="commitment.officers.length" class="small dim">
      {{ local('Led by', 'Commanding officers:') }} {{ commitment.officers.map((o) => o.name).join(', ') }}.
    </p>

    <div class="row">
      <input
        v-model.number="reinforceBy"
        type="number"
        min="1"
        step="1"
        :aria-label="local('Number of additional men', 'Number of additional troops to send')"
        :aria-invalid="!canReinforce"
        :aria-describedby="!canReinforce ? 'reinforce-error' : undefined"
      />
      <button :disabled="!canReinforce" @click="reinforce()">
        {{ local('Send more men', 'Send these troops') }}
      </button>
    </div>
    <p v-if="!canReinforce" id="reinforce-error" class="small rubric" role="alert">
      {{ local('Enter a positive whole number of men.', 'Enter a whole number of troops greater than zero.') }}
    </p>
    <p v-if="refusedIn('reinforce')" class="small rubric">{{ refusedIn('reinforce') }}</p>

    <!-- WHAT THE HOUSE IS TO BE REMEMBERED FOR (#89's thesis). One purchase,
         separate from the men — `none` is a real button, not a default. -->
    <div class="positions" role="group" :aria-label="local('Buy a position', 'Choose a war position to purchase')">
      <p class="small label">{{ local('Buy a position', 'Purchase a war position') }}</p>
      <div v-for="p in commitment.positions" :key="p.id" class="row position">
        <button :disabled="p.current || !p.canBuy" @click="sendOrder({ op: 'buy', position: p.id })">
          {{ p.current ? '✓ ' : '' }}{{ p.name }}<span v-if="p.price !== undefined"> — {{ p.price }} crowns</span>
        </button>
        <span v-if="!p.current && p.reason" class="small rubric">{{ p.reason }}</span>
      </div>
    </div>
    <p v-if="refusedIn('buy')" class="small rubric">{{ refusedIn('buy') }}</p>

    <!-- THE GOOD DECISION (#89), available every year. Keep the men, forfeit
         the credit, and the world notices. -->
    <div class="row">
      <button @click="sendOrder({ op: 'withdraw' })">
        {{ local('Call them home', 'Withdraw the troops') }}
      </button>
    </div>
    <p v-if="refusedIn('withdraw')" class="small rubric">{{ refusedIn('withdraw') }}</p>
  </section>
</template>

<style scoped>
.muster p { margin: 4px 0; }
.muster .row { margin-top: 8px; }
input[type='number'] { width: 8ch; }
.positions { margin-top: 10px; }
.position { align-items: center; gap: 8px; }
</style>
