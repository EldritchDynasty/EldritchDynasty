<script setup lang="ts">
import { computed } from 'vue';
import { FREQUENCY_PROFILES, FREQUENCY_ORDER, type Frequency } from '@ed/schema';

const props = defineProps<{ modelValue: Frequency }>();
const emit = defineEmits<{ 'update:modelValue': [Frequency] }>();

const p = computed(() => FREQUENCY_PROFILES[props.modelValue]);

/**
 * The picker shows what the tier OBLIGES, not just what it weighs. Frequency
 * reaches into scheduling, presentation, folklore and the Record mechanic at
 * once, and an author choosing "mythic" needs to see that they have just
 * committed to a record block, two contradicting accounts, and a scene that
 * can fire exactly once in a Long Line.
 */
const rows = computed(() => [
  ['draw weight', `${p.value.weight}${p.value.droughtGainPerCentury ? ` · +${p.value.droughtGainPerCentury}/century of drought` : ''}`],
  ['per-run cap', p.value.perRunCap === null ? 'uncapped' : `${p.value.perRunCap} in a run`],
  ['cooldown', p.value.cooldownYears ? `${p.value.cooldownYears} years between any two` : 'none'],
  ['earliest', p.value.minGeneration ? `generation ${p.value.minGeneration}` : 'from the first year'],
  ['fires', p.value.maxFiresPerTemplate === Infinity ? 'repeatable' : `${p.value.maxFiresPerTemplate}× per run, ever`],
  ['record block', p.value.record],
  ['enters folklore', p.value.rumour],
  ['chronicle', p.value.chronicle + (p.value.named ? ' · named forever' : '')],
]);
</script>

<template>
  <fieldset class="frequency-group">
    <legend>Frequency</legend>
    <div class="freqpick">
      <button
        v-for="f in FREQUENCY_ORDER" :key="f"
        type="button"
        :aria-pressed="modelValue === f"
        :class="[f, { on: modelValue === f }]"
        @click="emit('update:modelValue', f)"
      >{{ f }}</button>
    </div>
  </fieldset>

  <div class="oblig">
    <table>
      <tbody>
      <tr v-for="[k, v] in rows" :key="k"><td>{{ k }}</td><td>{{ v }}</td></tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.frequency-group { border: 0; margin: 0; padding: 0; min-width: 0; }
.frequency-group legend {
  padding: 0; margin: 12px 0 5px;
  font-size: 11px; letter-spacing: .1em; text-transform: uppercase;
  color: var(--ink-faint); font-weight: 600;
}
</style>
