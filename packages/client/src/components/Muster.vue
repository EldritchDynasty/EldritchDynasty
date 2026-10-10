<script setup lang="ts">
import { computed, ref } from 'vue';
import type { SessionView } from '@ed/core';
import type { GameActions } from '../lib/game';

const props = defineProps<{
  /** No separate view type: the Muster's whole read model is `SessionView.muster`, absent when dormant. */
  view: SessionView;
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

function reinforce(): void {
  if (!canReinforce.value) return;
  props.actions.muster({ op: 'reinforce', men: reinforceBy.value });
}

const tideWord = computed(() => {
  const m = commitment.value;
  if (!m) return '';
  return m.tide >= 60 ? "in the house's favour" : m.tide <= 40 ? 'against the house' : 'holding, for now';
});
</script>

<template>
  <section v-if="commitment" class="muster panel">
    <h3 class="label">The muster</h3>
    <p class="small">
      {{ commitment.men }} {{ commitment.men === 1 ? 'man' : 'men' }} in the field since {{ commitment.began }},
      of a house that could field {{ commitment.maxMen }}.
    </p>
    <p class="small dim">The tide runs {{ tideWord }}. Credit earned so far: {{ commitment.credit.toFixed(1) }}.</p>

    <p v-if="commitment.positionName" class="small dim">Standing under {{ commitment.positionName }}.</p>
    <p v-else class="small rubric">No banner bought. Word gets around; it is not in writing.</p>

    <p v-if="commitment.officers.length" class="small dim">
      Led by {{ commitment.officers.map((o) => o.name).join(', ') }}.
    </p>

    <div class="row">
      <input
        v-model.number="reinforceBy"
        type="number"
        min="1"
        step="1"
        aria-label="Number of additional men"
        :aria-invalid="!canReinforce"
        :aria-describedby="!canReinforce ? 'reinforce-error' : undefined"
      />
      <button :disabled="!canReinforce" @click="reinforce()">
        Send more men
      </button>
    </div>
    <p v-if="!canReinforce" id="reinforce-error" class="small rubric" role="alert">
      Enter a positive whole number of men.
    </p>
    <p v-if="refusedIn('reinforce')" class="small rubric">{{ refusedIn('reinforce') }}</p>

    <!-- WHAT THE HOUSE IS TO BE REMEMBERED FOR (#89's thesis). One purchase,
         separate from the men — `none` is a real button, not a default. -->
    <div class="positions">
      <p class="small label">Buy a position</p>
      <div v-for="p in commitment.positions" :key="p.id" class="row position">
        <button :disabled="p.current || !p.canBuy" @click="actions.muster({ op: 'buy', position: p.id })">
          {{ p.current ? '✓ ' : '' }}{{ p.name }}<span v-if="p.price !== undefined"> — {{ p.price }} crowns</span>
        </button>
        <span v-if="!p.current && p.reason" class="small rubric">{{ p.reason }}</span>
      </div>
    </div>
    <p v-if="refusedIn('buy')" class="small rubric">{{ refusedIn('buy') }}</p>

    <!-- THE GOOD DECISION (#89), available every year. Keep the men, forfeit
         the credit, and the world notices. -->
    <div class="row">
      <button @click="actions.muster({ op: 'withdraw' })">
        Call them home
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
