<script setup lang="ts">
import { computed, useId } from 'vue';
import type { SessionView } from '@ed/core';
import type { ProseMode } from '@ed/schema';
import { currentMarriagePromises, hasResumeRecapAmbition, hasResumeRecapQuestion } from '../lib/game';

/** Reader-local facts after an accepted save pickup; never a second promise store. */
const props = withDefaults(defineProps<{
  view: SessionView;
  pending: number;
  /** The first current public docket item, not an inferred player intention. */
  nextDecision?: SessionView['docket'][number];
  proseMode?: ProseMode;
}>(), { proseMode: 'original' });
defineEmits<{ dismiss: [] }>();
const plain = computed(() => props.proseMode === 'plainenglish');
const pledges = computed(() => currentMarriagePromises(props.view));
const hasQuestion = computed(() => hasResumeRecapQuestion(props.view));
const hasAmbition = computed(() => hasResumeRecapAmbition(props.view));
/**
 * A recovered docket can carry an impossible future, fractional, or
 * pre-campaign date. Keep its count (the engine still owns the docket), but
 * do not describe that item as a decision already facing the reader.
 */
const currentDecision = computed(() => {
  const decision = props.nextDecision;
  if (props.pending <= 0 || !decision || !Number.isSafeInteger(decision.year)
    || decision.year > props.view.year) return undefined;
  const firstYear = props.view.campaign?.startYear;
  if (firstYear !== undefined && (!Number.isSafeInteger(firstYear) || decision.year < firstYear)) {
    return undefined;
  }
  return decision;
});
// Each optional recap is a named landmark, with the visible heading as its name.
const recapTitleId = useId();
</script>

<template>
  <aside class="panel small resume-recap" :aria-labelledby="recapTitleId">
    <div class="recap-heading">
      <h2 :id="recapTitleId" class="recap-title">{{ plain ? 'Back to your game' : 'The house, taken up again' }}</h2>
      <button class="quiet small" type="button" @click="$emit('dismiss')">
        {{ plain ? 'Hide recap' : 'Put aside' }}
      </button>
    </div>
    <details>
      <summary>{{ plain ? 'See where things stand' : 'Where the house stands' }}</summary>
      <p class="dim small">{{ view.houseName }} · {{ view.year }} · Generation {{ view.generation }}</p>
      <dl>
        <template v-if="hasQuestion">
          <dt>{{ plain ? 'Current family question' : 'This generation asks' }}</dt>
          <dd>{{ view.generationArc.question }}</dd>
        </template>
        <template v-if="hasAmbition">
          <dt>{{ plain ? 'Goal being tracked' : 'Ambition kept in view' }}</dt>
          <dd><strong>{{ view.ambition.name }}</strong> — {{ view.ambition.next }}</dd>
        </template>
        <template v-if="pending > 0">
          <dt>{{ plain ? 'Waiting for you' : 'Before the clock may turn' }}</dt>
          <dd>
            {{ pending === 1
              ? (plain ? 'One decision is waiting in your docket.' : 'One decision awaits on the docket.')
              : (plain ? pending + ' decisions are waiting in your docket.' : pending + ' decisions await on the docket.') }}
            <!-- The first actionable item is already in the public docket. Do not
                 reconstruct other queued items or a player's unwritten plan. -->
            <p v-if="pending > 0 && currentDecision?.kind === 'choice'" class="dim small recap-next-decision">
              {{ plain ? 'Next decision:' : 'First on the docket:' }} {{ currentDecision.year }} · {{ currentDecision.event.title }}
            </p>
            <p v-else-if="pending > 0 && currentDecision?.kind === 'match'" class="dim small recap-next-decision">
              {{ plain ? 'Next decision:' : 'First on the docket:' }} {{ currentDecision.year }} ·
              {{ plain ? 'Choose a spouse for' : 'A marriage for' }} {{ currentDecision.subject.name }}
            </p>
            <p v-else-if="pending > 0 && currentDecision?.kind === 'record'" class="dim small recap-next-decision">
              {{ plain ? 'Next decision:' : 'First on the docket:' }} {{ currentDecision.year }} ·
              {{ plain ? 'Choose what to record about' : 'What the book will say of' }} {{ currentDecision.subject }}
            </p>
          </dd>
        </template>
        <template v-if="pledges.length">
          <dt>{{ plain ? 'Outstanding marriage promises' : 'Marriage pledges still owed' }}</dt>
          <dd>
            <ul class="recap-pledges">
              <li v-for="promise in pledges" :key="`${promise.house}-${promise.year}-${promise.lot}`">
                {{ plain ? 'Promised in' : 'Pledged in' }} {{ promise.year }} to {{ promise.houseName }}
                for <em>{{ promise.lotName }}</em>
              </li>
            </ul>
          </dd>
        </template>
      </dl>
      <p class="dim small">{{ plain
        ? 'These are facts from this save, not a record of what you planned to do.'
        : "These are the house's present records, not a memory of your intended course." }}</p>
    </details>
  </aside>
</template>

<style scoped>
.resume-recap { max-width: 58rem; margin: 0 auto 14px; }
.recap-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.recap-title { font: inherit; font-weight: 700; margin: 0; }
.recap-pledges { margin: 0; padding-inline-start: 1.15rem; }
.recap-next-decision { margin: 5px 0 0; }
summary { cursor: pointer; min-height: 44px; align-content: center; }
dl { display: grid; grid-template-columns: minmax(9rem, 1fr) minmax(0, 3fr); gap: 8px 14px; }
dt { color: var(--rubric); }
dd { margin: 0; overflow-wrap: anywhere; }
@media (max-width: 600px) { dl { grid-template-columns: 1fr; gap: 3px; } dd { margin-bottom: 9px; } }
</style>
