<script setup lang="ts">
import { computed } from 'vue';
import {
  contentProseEntries,
  proseOriginalHash,
  setContentProseText,
  type ContentProseEntry,
} from '@ed/schema';
import { isWritableContentPath } from '../lib/content';
import { fileOf, markDirty, removeProseVariant, stageProseVariant, store } from '../lib/store';
import { proseVariantStatus } from '../lib/prose-status';

const props = withDefaults(defineProps<{
  collectionKey: 'events' | 'arcs' | 'characterTemplates';
  id: string;
  modelValue: object;
  disabled?: boolean;
}>(), {
  disabled: false,
});

const sourceFile = computed(() => fileOf(props.collectionKey, props.id));
const writable = computed(() => {
  const file = sourceFile.value;
  return !props.disabled && file !== undefined && isWritableContentPath(file);
});

const entries = computed(() => {
  const file = sourceFile.value;
  if (!file) return [];
  return contentProseEntries(file, {
    [props.collectionKey]: [props.modelValue],
  });
});

function variant(address: string) {
  return store.bundle.proseVariants.find((candidate) => candidate.address === address);
}

function plainText(address: string): string {
  return variant(address)?.plainenglish ?? '';
}

function setOriginal(entry: ContentProseEntry, text: string): void {
  if (!writable.value) return;
  const changed = setContentProseText({
    [props.collectionKey]: [props.modelValue],
  }, entry.path, text);
  if (changed) markDirty(props.collectionKey, props.id);
}

function setPlain(entry: ContentProseEntry, text: string): void {
  if (!writable.value) return;
  const existing = variant(entry.address);
  if (existing) {
    if (!text.length) {
      if (sourceFile.value) removeProseVariant(sourceFile.value, entry.address);
      return;
    }
    existing.plainenglish = text;
    existing.of = proseOriginalHash(entry.text);
    markDirty('proseVariants', entry.address);
    return;
  }

  // Do not manufacture an invalid empty catalogue row merely because the
  // author focused the field. The first real character stages the counterpart;
  // the normal SaveControl for the source item writes both columns together.
  if (!text.length || !sourceFile.value) return;
  const staged = stageProseVariant(sourceFile.value, entry.address, text);
  if (staged) {
    staged.of = proseOriginalHash(entry.text);
    markDirty('proseVariants', entry.address);
  }
}

function placeholderStatus(entry: ContentProseEntry): { ok: boolean; text: string } {
  return proseVariantStatus(entry, variant(entry.address));
}

function fieldName(address: string): string {
  return address.split('#')[1] ?? address;
}
</script>

<template>
  <section class="prose-variants">
    <h3>Prose variants</h3>
    <p class="note" style="margin-top:0">
      <strong>Original</strong> keeps the authored voice contract.
      <strong>Plain English</strong> is deliberately direct and is not prose-style linted.
      Both use the same stable work-item address.
    </p>
    <p v-if="!writable && entries.length" class="note reference-only">
      Reference only in Mod Editor; shipped source files cannot be changed here.
    </p>

    <p v-if="!entries.length" class="note">No player-facing narrative fields on this item.</p>

    <article
      v-for="entry in entries"
      :key="entry.address"
      class="variant-row"
      :data-address="entry.address"
    >
      <code class="address">{{ fieldName(entry.address) }}</code>
      <div class="variant-columns">
        <label>
          Original
          <textarea
            class="original"
            :value="entry.text"
            :disabled="!writable"
            @input="setOriginal(entry, ($event.target as HTMLTextAreaElement).value)"
          />
        </label>
        <label>
          Plain English
          <textarea
            class="plainenglish"
            :value="plainText(entry.address)"
            :disabled="!writable"
            placeholder="Add the direct counterpart…"
            @input="setPlain(entry, ($event.target as HTMLTextAreaElement).value)"
          />
        </label>
      </div>
      <p
        class="placeholder-status"
        :class="{ good: placeholderStatus(entry).ok, bad: !placeholderStatus(entry).ok }"
      >
        {{ placeholderStatus(entry).text }}
      </p>
    </article>
  </section>
</template>

<style scoped>
.prose-variants { margin-top: 18px; }
.variant-row {
  padding: 10px 0;
  border-top: 1px solid var(--rule);
}
.address {
  display: block;
  margin-bottom: 6px;
  font-size: 11px;
  color: var(--ink-faint);
  overflow-wrap: anywhere;
}
.variant-columns {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
.variant-columns label {
  margin: 0;
  text-transform: none;
  letter-spacing: 0;
}
.variant-columns textarea {
  min-height: 86px;
  margin-top: 4px;
  resize: vertical;
}
.placeholder-status {
  margin: 5px 0 0;
  font-size: 11.5px;
}
.placeholder-status.good { color: var(--ink-faint); }
.placeholder-status.bad { color: var(--rubric); }
.reference-only { color: var(--rubric); }

@media (max-width: 760px) {
  .variant-columns { grid-template-columns: 1fr; }
}
</style>
