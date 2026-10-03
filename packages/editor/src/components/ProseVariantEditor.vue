<script setup lang="ts">
import { computed } from 'vue';
import {
  contentInterpolationTokens,
  contentProseEntries,
  setContentProseText,
  type ContentProseEntry,
} from '@ed/schema';
import { isWritableContentPath } from '../lib/content';
import { fileOf, markDirty, stageProseVariant, store } from '../lib/store';

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
    existing.plainenglish = text;
    markDirty('proseVariants', entry.address);
    return;
  }

  // Do not manufacture an invalid empty catalogue row merely because the
  // author focused the field. The first real character stages the counterpart;
  // the normal SaveControl for the source item writes both columns together.
  if (!text.length || !sourceFile.value) return;
  stageProseVariant(sourceFile.value, entry.address, text);
}

function counts(tokens: readonly string[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const token of tokens) out.set(token, (out.get(token) ?? 0) + 1);
  return out;
}

function placeholderStatus(entry: ContentProseEntry): { ok: boolean; text: string } {
  const plain = plainText(entry.address);
  if (!plain) {
    return { ok: false, text: 'Plain English is missing.' };
  }

  const original = counts(entry.interpolations);
  const translated = counts(contentInterpolationTokens(plain));
  const tokens = [...new Set([...original.keys(), ...translated.keys()])].sort();
  const missing: string[] = [];
  const extra: string[] = [];

  for (const token of tokens) {
    const wanted = original.get(token) ?? 0;
    const got = translated.get(token) ?? 0;
    for (let i = got; i < wanted; i++) missing.push(token);
    for (let i = wanted; i < got; i++) extra.push(token);
  }

  if (!missing.length && !extra.length) {
    return {
      ok: true,
      text: entry.interpolations.length ? 'Placeholders match.' : 'No placeholders to preserve.',
    };
  }

  return {
    ok: false,
    text: [
      missing.length ? `missing ${missing.join(', ')}` : '',
      extra.length ? `extra ${extra.join(', ')}` : '',
    ].filter(Boolean).join(' · '),
  };
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
