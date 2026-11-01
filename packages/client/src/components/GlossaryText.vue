<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from 'vue';
import type { ProseMode } from '@ed/schema';
import { loadBundle } from '../lib/content';
import { glossaryDefinition, splitFirstGlossary } from '../lib/glossary';

const props = defineProps<{ text: string; proseMode?: ProseMode }>();
// Each passage marks one term, even when the validated glossary grows.
const segments = computed(() => splitFirstGlossary(props.text, props.proseMode));
const termId = computed(() => segments.value.find((segment) => segment.term)?.term);

// The first disclosure and at most two related hops. Each hop has its own
// opener so Escape can close the innermost definition and restore focus.
const MAX_DEPTH = 3;
const chain = ref<string[]>([]);
const openers = ref<Array<HTMLButtonElement | null>>([]);
const expanded = computed(() => chain.value.length > 0);
const controlId = useId();
const root = ref<HTMLElement | null>(null);

watch([() => props.text, () => props.proseMode], async () => {
  // Removing an expanded related note removes its focused button as well.
  // Only move focus when it was inside the disappearing disclosure: changing
  // reading preferences elsewhere must never steal focus back to this passage.
  const primary = root.value?.querySelector<HTMLButtonElement>('button.glossary-term');
  const restoreFocus = chain.value.length > 0
    && typeof document !== 'undefined'
    && !!root.value?.contains(document.activeElement)
    && document.activeElement !== primary;
  chain.value = [];
  openers.value = [];
  if (!restoreFocus) return;

  await nextTick();
  // A changed passage may lose its only glossary alias. Keep keyboard focus
  // with the surviving text; it is programmatic, never an extra Tab stop.
  const host = root.value;
  if (!host?.isConnected) return;
  (host.querySelector<HTMLButtonElement>('button.glossary-term') ?? host).focus();
});

function buttonFrom(event: MouseEvent): HTMLButtonElement | null {
  return event.currentTarget instanceof HTMLButtonElement ? event.currentTarget : null;
}

function toggle(event: MouseEvent): void {
  if (!termId.value) return;
  if (expanded.value) {
    chain.value = [];
    openers.value = [];
  } else {
    openers.value = [buttonFrom(event)];
    chain.value = [termId.value];
  }
}

function noteId(depth: number): string {
  return `${controlId}-${depth}`;
}

/** Expose only validated related ids, not an ancestor or a fourth level. */
function relatedAt(id: string, depth: number): Array<{ id: string; name: string }> {
  if (depth >= MAX_DEPTH - 1) return [];
  const terms = loadBundle().glossary;
  const ancestors = new Set(chain.value.slice(0, depth + 1));
  const from = terms.find((term) => term.id === id);
  return (from?.related ?? [])
    .filter((related) => !ancestors.has(related))
    .flatMap((related) => {
      const term = terms.find((entry) => entry.id === related);
      return term ? [{ id: related, name: term.names[props.proseMode ?? 'original'] }] : [];
    });
}

function openRelated(id: string, depth: number, event: MouseEvent): void {
  const parent = chain.value.slice(0, depth + 1);
  if (parent.includes(id) || parent.length >= MAX_DEPTH) return;
  // Activating an already-open relation collapses that child, while another
  // relation replaces only the deeper branch of this disclosure.
  if (chain.value[depth + 1] === id) {
    chain.value = parent;
    openers.value = openers.value.slice(0, depth + 1);
    return;
  }
  openers.value = [...openers.value.slice(0, depth + 1), buttonFrom(event)];
  chain.value = [...parent, id];
}

async function onKeydown(event: KeyboardEvent): Promise<void> {
  if (event.key !== 'Escape' || !expanded.value) return;
  event.preventDefault();
  event.stopPropagation();
  const opener = openers.value[openers.value.length - 1];
  chain.value = chain.value.slice(0, -1);
  openers.value = openers.value.slice(0, -1);
  await nextTick();
  opener?.focus();
}
</script>

<template>
  <span ref="root" class="glossary-text" tabindex="-1" @keydown="onKeydown">
    <template v-for="(segment, index) in segments" :key="index">
      <template v-if="segment.term">
        <button
          type="button"
          class="glossary-term"
          :aria-expanded="expanded"
          :aria-controls="expanded ? noteId(0) : undefined"
          @click="toggle($event)"
        >{{ segment.text }}</button>
        <!-- Keep the whole bounded disclosure chain beside the marked word.
             Appending it after the segments put the note at the far end of
             long Chronicle passages, detached from what opened it (#2366). -->
        <span
          v-for="(id, depth) in chain"
          :id="noteId(depth)"
          :key="id"
          class="glossary-definition"
          role="note"
          tabindex="-1"
        >
          {{ glossaryDefinition(id, proseMode) }}
          <span v-if="relatedAt(id, depth).length" class="glossary-related">
            <button
              v-for="related in relatedAt(id, depth)"
              :key="related.id"
              type="button"
              class="glossary-term"
              :aria-expanded="chain[depth + 1] === related.id"
              :aria-controls="chain[depth + 1] === related.id ? noteId(depth + 1) : undefined"
              @click="openRelated(related.id, depth, $event)"
            >{{ related.name }}</button>
          </span>
        </span>
      </template>
      <template v-else>{{ segment.text }}</template>
    </template>
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
}
.glossary-definition::before { content: '— '; }
.glossary-related { margin-left: .4em; }
.glossary-related::before { content: 'Related: '; }
.glossary-related button + button { margin-left: .35em; }
</style>
