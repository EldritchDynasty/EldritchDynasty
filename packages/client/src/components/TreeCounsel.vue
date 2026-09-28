<script setup lang="ts">
import { computed } from 'vue';
import type { HelpTier, SessionView } from '@ed/core';
import type { GameActions } from '../lib/game';
import AdviserHelp from './AdviserHelp.vue';

const props = defineProps<{
  view: SessionView;
  selected: string | null;
  actions: Pick<GameActions, 'advice'>;
}>();

/** Prefer the person already under the reader's hand, then the sitting Head. */
const treeSubject = computed(() => props.selected
  ?? props.view.halls.flatMap((hall) => hall.members).find((member) => member.head)?.id
  ?? props.view.house);

/** The seat has no branch grievance; quiet cadet halls need no grievance help. */
const aggrieved = computed(() => props.view.halls.filter((hall) => !hall.isSeat && hall.grievance > 0));

function askTree(tier: HelpTier) {
  return props.actions.advice('tree', treeSubject.value, tier);
}

function askBranch(branch: string) {
  return (tier: HelpTier) => props.actions.advice('branches', branch, tier);
}
</script>

<template>
  <!-- Counsel is a sibling of the tree because it reads the photographed
       surface but owns none of the tree's search, filter or selection state. -->
  <aside class="tree-counsel" aria-label="Counsel about the family">
    <AdviserHelp :ask="askTree" :reset-key="`tree:${treeSubject}`" />

    <details v-if="aggrieved.length" class="branch-help">
      <summary class="small">Ask about a hall's grievance</summary>
      <section v-for="hall in aggrieved" :key="hall.id" class="hall-help">
        <p class="small">
          <strong>{{ hall.name }}</strong>
          <span class="dim"> · grievance {{ Math.round(hall.grievance) }}</span>
        </p>
        <AdviserHelp :ask="askBranch(hall.id)" :reset-key="`branches:${hall.id}`" />
      </section>
    </details>
  </aside>
</template>

<style scoped>
.tree-counsel { margin-bottom: 12px; }
.branch-help { margin-top: 4px; color: var(--ink-soft); }
.branch-help > summary { min-height: 40px; padding: 10px 0; cursor: pointer; }
.hall-help { margin-top: 8px; padding-left: 8px; border-left: 1px solid var(--rule); }
.hall-help p { margin: 0; }
</style>
