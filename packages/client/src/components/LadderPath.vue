<script setup lang="ts">
import { computed } from 'vue';
import type { SessionView } from '@ed/core';
import type { ProseMode } from '@ed/schema';

const props = withDefaults(defineProps<{
  ascension: SessionView['ascension'];
  proseMode?: ProseMode;
}>(), { proseMode: 'original' });

const emit = defineEmits<{
  look: [person: string];
  match: [decision: string, card: string];
}>();

const plain = computed(() => props.proseMode === 'plainenglish');
type Step = SessionView['ascension']['rungs'][number];
type State = 'not-yet' | 'held' | 'passed' | 'once' | 'next' | 'beyond';
type PathStep = Step & { state: State; current: boolean; target: boolean };

/** The engine supplies both order and titles. A client never copies §22's union. */
const steps = computed<PathStep[]>(() => {
  const a = props.ascension;
  const currentIndex = a.rungs.findIndex((r) => r.id === a.rung);
  const namedTarget = a.diagnosis
    ? a.rungs.findIndex((r) => r.id === a.diagnosis!.target)
    : -1;
  // A missing diagnosis can mean the next rung is clear; an obsolete
  // diagnosis target in a test/save should still leave its words readable.
  const targetIndex = namedTarget >= 0 ? namedTarget
    : currentIndex >= 0 && currentIndex + 1 < a.rungs.length ? currentIndex + 1 : -1;
  return a.rungs.map((r, index) => {
    const current = index === currentIndex;
    const target = index === targetIndex && !current;
    const state: State = current ? (r.id === 'none' ? 'not-yet' : 'held')
      : index < currentIndex ? 'passed'
        : r.reachedAt !== undefined ? 'once'
          : target ? 'next' : 'beyond';
    return { ...r, state, current, target };
  });
});

function stateText(step: PathStep): string {
  switch (step.state) {
    case 'not-yet':
      return plain.value ? 'Not yet on the ladder' : 'the house has not climbed';
    case 'held':
      return plain.value ? 'Held now' : 'held now';
    case 'passed':
      return plain.value ? 'Below the current level' : 'below the present rung';
    case 'once':
      return step.reachedAt === undefined
        ? (plain.value ? 'Reached before; no one holds it now' : 'once reached; none holds it now')
        : (plain.value
          ? `Reached in ${step.reachedAt}; no one holds it now`
          : `reached in ${step.reachedAt}; none holds it now`);
    case 'next':
      return plain.value ? 'Next level' : 'next rung';
    case 'beyond':
      return plain.value ? 'Not reached' : 'beyond';
  }
}
</script>

<template>
  <ol class="ladder-path" :aria-label="plain ? 'Ascension levels in order' : 'The Ascension ladder, in order'">
    <li
      v-for="step in steps"
      :key="step.id"
      class="ladder-step"
      :data-rung="step.id"
      :data-state="step.state"
      :aria-current="step.current ? 'step' : undefined"
    >
      <div class="ladder-step-head small">
        <strong>{{ step.title }}</strong>
        <span class="soft">{{ stateText(step) }}</span>
      </div>
      <template v-if="step.target && ascension.diagnosis">
        <section
          class="preparation-guide"
          :aria-label="plain ? 'Preparing for the next level' : 'Preparing for the next rung'"
        >
          <div class="rubric small next-rung">
            {{ plain ? 'Next level' : 'Next rung' }} · {{ ascension.diagnosis.targetTitle }}
            <span v-if="ascension.diagnosis.name" class="dim">
              · {{ ascension.diagnosis.name }}
            </span>
          </div>
          <p v-if="ascension.diagnosis.blockers.length" class="preparation-note small soft">
            {{ plain
              ? 'This is the first obstacle shown for the next level. Meeting it may reveal another requirement.'
              : 'The first bar to this rung is named here; another may stand behind it.'
            }}
          </p>
          <div
            v-for="blocker in ascension.diagnosis.blockers"
            :key="blocker.kind + blocker.text"
            class="ladder-blocker small"
          >
            <p class="blocker-fact">{{ blocker.text }}</p>
            <p class="soft blocker-action">
              <span class="rubric">{{ plain ? 'What to try' : 'A way forward' }} · </span>{{ blocker.hint }}
            </p>
          </div>
          <details v-if="ascension.diagnosis.route" class="power-route small">
            <summary class="rubric">{{ ascension.diagnosis.route.title }}</summary>
            <p>{{ ascension.diagnosis.route.rule }}</p>
            <ul v-if="ascension.diagnosis.route.daughters.length">
              <li v-for="woman in ascension.diagnosis.route.daughters" :key="woman.person">
                <button class="quiet" @click="emit('look', woman.person)">{{ woman.name }}</button>
                <p v-for="line in woman.evidence" :key="line" class="soft">{{ line }}</p>
              </li>
            </ul>
            <ul v-if="ascension.diagnosis.route.cards.length">
              <li v-for="card in ascension.diagnosis.route.cards" :key="card.card">
                <button class="quiet" @click="emit('match', card.decision, card.card)">{{ card.name }} · {{ card.label }}</button>
                <p v-for="line in card.evidence" :key="line" class="soft">{{ line }}</p>
              </li>
            </ul>
            <p v-if="ascension.diagnosis.route.none" class="soft">{{ ascension.diagnosis.route.none }}</p>
            <ul v-if="ascension.diagnosis.route.alternatives.length">
              <li v-for="card in ascension.diagnosis.route.alternatives" :key="card.card">
                <button class="quiet" @click="emit('match', card.decision, card.card)">{{ card.name }} · {{ card.label }}</button>
                <p v-for="line in card.evidence" :key="line" class="soft">{{ line }}</p>
              </li>
            </ul>
            <p class="dim">{{ ascension.diagnosis.route.caution }}</p>
          </details>
        </section>
      </template>
      <div v-else-if="step.target" class="rubric small next-rung">
        {{ plain ? 'Next level' : 'Next rung' }} · {{ step.title }}
      </div>
    </li>
  </ol>
</template>

<style scoped>
.ladder-path {
  list-style: decimal;
  display: flex;
  align-items: flex-start;
  flex-wrap: wrap;
  gap: 5px 16px;
  margin: 8px 0;
  padding-left: 22px;
  max-width: 72ch;
}
.ladder-step { min-width: 9ch; padding-right: 4px; }
.ladder-step[data-state="once"] { border-bottom: 1px dashed var(--rule); }
.ladder-step-head { display: flex; flex-direction: column; gap: 2px; }
.ladder-step-head strong { font-weight: 500; }
.ladder-step-head .soft { font-size: var(--t-label); }
.next-rung { margin-top: 6px; }
.preparation-guide { max-width: 48ch; }
.preparation-note { margin: 4px 0 8px; }
.ladder-blocker p { margin: 3px 0; }
.blocker-action .rubric { white-space: nowrap; }
.ladder-blocker { max-width: 48ch; margin-top: 3px; }
.ladder-blocker .soft { margin-top: 2px; }
.power-route { margin-top: 12px; max-width: 48ch; }
.power-route p { margin: 4px 0; }
.power-route ul { margin: 8px 0; padding-left: 16px; }
.power-route li { margin: 4px 0; }
.power-route button { min-height: 40px; text-align: left; overflow-wrap: anywhere; }
.power-route > summary { min-height: 40px; padding: 8px 0; cursor: pointer; }
@media (max-width: 680px) {
  .ladder-path { display: block; max-width: 100%; }
  .ladder-step { margin: 4px 0; overflow-wrap: anywhere; }
  .ladder-step-head { display: flex; flex-direction: row; flex-wrap: wrap; gap: 6px; }
}
</style>
