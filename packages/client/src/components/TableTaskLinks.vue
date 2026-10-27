<script setup lang="ts">
import type { ProseMode } from '@ed/schema';
import { tableTargetLabel, type TableTarget, type TableTask } from '../lib/table-nav';

const props = defineProps<{ task: TableTask; proseMode?: ProseMode }>();
const emit = defineEmits<{ navigate: [target: TableTarget, origin: HTMLElement] }>();
function navigate(target: TableTarget, event: MouseEvent): void {
  if (!props.task.revealed) return;
  if (event.currentTarget instanceof HTMLElement) emit('navigate', target, event.currentTarget);
}
</script>

<template>
  <div class="task-links" role="group" :aria-label="task.title">
    <template v-if="task.revealed">
      <div class="wrap">
        <button v-for="target in task.targets" :key="target" type="button" class="quiet small"
          :data-table-go="target" @click="navigate(target, $event)">
          Open {{ tableTargetLabel(target, proseMode) }}
        </button>
      </div>
      <p v-if="task.offer" class="small dim offer"><span>{{ task.offer.label }} — </span>{{ task.offer.reason }}</p>
    </template>
    <p v-else class="small dim unavailable">{{ proseMode === 'plainenglish'
      ? 'Family orders will open as the family’s business grows.'
      : 'The Table will open as the house’s business grows.' }}</p>
  </div>
</template>

<style scoped>
.task-links { min-width: 0; }
.task-links button { min-height: 44px; padding: 8px; text-align: left; text-decoration: underline; text-underline-offset: 3px; }
.offer, .unavailable { margin: 4px 0 8px; overflow-wrap: anywhere; }
</style>
