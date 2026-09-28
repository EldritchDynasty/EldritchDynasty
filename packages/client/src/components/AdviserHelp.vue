<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { AdviserAdvice, HelpTier } from '@ed/core';

const props = defineProps<{
  ask: (tier: HelpTier) => AdviserAdvice[];
  resetKey?: string;
}>();

interface ShownTier {
  tier: HelpTier;
  lines: AdviserAdvice[];
}

const shown = ref<ShownTier[]>([]);
const unanswered = ref(false);

const nextTier = computed<HelpTier | null>(() => {
  if (unanswered.value) return null;
  const next = shown.value.length + 1;
  return next <= 3 ? next as HelpTier : null;
});

const buttonLabel = computed(() => {
  switch (nextTier.value) {
    case 1: return 'Ask an adviser';
    case 2: return 'Ask what the house knows';
    case 3: return 'Ask what can be done';
    default: return '';
  }
});

function askNext(): void {
  const tier = nextTier.value;
  if (!tier) return;
  const lines = props.ask(tier);
  if (lines.length === 0) {
    unanswered.value = true;
    return;
  }
  shown.value.push({ tier, lines });
}

watch(() => props.resetKey, () => {
  shown.value = [];
  unanswered.value = false;
});
</script>

<template>
  <section class="adviser-help" aria-label="Counsel from the household">
    <div v-if="shown.length" class="counsel" aria-live="polite">
      <template v-for="step in shown" :key="step.tier">
        <blockquote
          v-for="line in step.lines"
          :key="`${step.tier}-${line.adviser.id}-${line.lens}`"
        >
          <p>“{{ line.position }}”</p>
          <footer>
            <strong>{{ line.adviser.name }}</strong>
            <span> — {{ line.cares }}</span>
          </footer>
        </blockquote>
      </template>
    </div>

    <p v-if="unanswered" class="unanswered" role="status">
      Nobody at the table answers.
    </p>

    <button
      v-if="nextTier"
      type="button"
      class="ask"
      @click="askNext"
    >
      {{ buttonLabel }}
    </button>
  </section>
</template>

<style scoped>
.adviser-help {
  margin-top: 8px;
  padding-top: 6px;
  border-top: 1px solid var(--rule);
}

.counsel {
  display: grid;
  gap: 8px;
  margin-bottom: 6px;
}

blockquote {
  margin: 0;
  padding-left: 8px;
  border-left: 1px solid var(--ink-faint);
}

blockquote p,
blockquote footer {
  margin: 0;
}

blockquote footer {
  margin-top: 2px;
  color: var(--ink-soft);
  font-size: 0.82rem;
}

blockquote strong {
  color: var(--ink);
  font-weight: 600;
}

.ask {
  appearance: none;
  padding: 0;
  border: 0;
  border-bottom: 1px solid var(--ink-faint);
  background: transparent;
  color: var(--ink-soft);
  font: inherit;
  font-size: 0.82rem;
  cursor: pointer;
}

.ask:hover,
.ask:focus-visible {
  color: var(--ink);
  border-bottom-color: var(--ink-soft);
}

.ask:focus-visible {
  outline: 1px solid var(--ink-faint);
  outline-offset: 3px;
}

.unanswered {
  margin: 0;
  color: var(--ink-faint);
  font-size: 0.82rem;
}
</style>
