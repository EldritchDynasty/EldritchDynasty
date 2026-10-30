<script setup lang="ts">
import { computed, ref, useId } from 'vue';
import type { ProseMode } from '@ed/schema';
import { splitFirstStanding, standingGlossaryDefinition } from '../lib/glossary';

const props = defineProps<{ text: string; proseMode?: ProseMode }>();
const segments = computed(() => splitFirstStanding(props.text, props.proseMode));
const containsTerm = computed(() => segments.value.some((segment) => segment.term === 'standing'));
const open = ref(false);
const expanded = computed(() => containsTerm.value && open.value);
const controlId = useId();
const opener = ref<HTMLButtonElement | null>(null);
const definition = computed(() => standingGlossaryDefinition(props.proseMode));

function toggle(): void {
  open.value = !open.value;
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || !expanded.value) return;
  event.preventDefault();
  event.stopPropagation();
  open.value = false;
  opener.value?.focus();
}
</script>

<template>
  <span class="glossary-text" @keydown="onKeydown">
    <template v-for="(segment, index) in segments" :key="index">
      <button
        v-if="segment.term === 'standing'"
        ref="opener"
        type="button"
        class="glossary-term"
        :aria-expanded="expanded"
        :aria-controls="expanded ? controlId : undefined"
        @click="toggle"
      >{{ segment.text }}</button><template v-else>{{ segment.text }}</template>
    </template>
    <span v-if="expanded" :id="controlId" class="glossary-definition" role="note" tabindex="-1">{{ definition }}</span>
  </span>
</template>

<style scoped>
.glossary-term {
  border: 0; padding: 0; background: transparent; color: inherit;
  font: inherit; cursor: pointer; text-decoration: underline dotted;
  text-underline-offset: .16em;
}
.glossary-term:focus-visible { outline: 2px solid var(--rubric); outline-offset: 2px; }
.glossary-definition {
  display: inline; margin-left: .35em; color: var(--ink-soft);
  font-size: .92em;
}
.glossary-definition::before { content: '— '; }
</style>
