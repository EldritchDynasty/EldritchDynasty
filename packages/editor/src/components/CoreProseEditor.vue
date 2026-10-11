<script lang="ts">
import { reactive } from 'vue';

// Keep unvalidated author drafts through App.vue's tab unmount/remount cycle.
// They never enter the shared runtime content bundle before token review.
const drafts = reactive(new Map<string, string>());
</script>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { contentInterpolationTokens, proseOriginalHash } from '@ed/schema';
import coreEntries from 'virtual:ed-core-prose';
import { isWritableContentPath } from '../lib/content';
import { proseVariantStatus } from '../lib/prose-status';
import {
  applyCoreProseEdits, externalChange, markCoreProseDraftDirty,
  pendingCoreProseText, saveCoreProseCatalogue, store,
} from '../lib/store';
import DiffView from './DiffView.vue';

type Entry = (typeof coreEntries)[number];
const FILE = 'messages.yaml';
const search = ref('');
const reviewing = ref(false);
const saving = ref(false);
const error = ref('');
const externalConflict = ref(false);

const writable = computed(() => isWritableContentPath(FILE));
const filtered = computed(() => {
  const term = search.value.trim().toLowerCase();
  return term
    ? coreEntries.filter((e) => (e.address + ' ' + e.file + ' ' + e.text).toLowerCase().includes(term))
    : coreEntries;
});

const entriesByAddress = new Map(coreEntries.map((e) => [e.address, e]));
function existing(entry: Entry) {
  return store.bundle.proseVariants.find((v) => v.address === entry.address);
}
function textFor(entry: Entry): string {
  return drafts.get(entry.address) ?? existing(entry)?.plainenglish ?? '';
}
function statusFor(entry: Entry) {
  const draft = drafts.get(entry.address);
  if (draft === '') return { ok: true, text: 'Will remove the Plain English counterpart.' };
  const variant = draft === undefined
    ? existing(entry)
    : { plainenglish: draft, of: proseOriginalHash(entry.text) };
  return proseVariantStatus(
    { text: entry.text, interpolations: entry.interpolations }, variant,
  );
}
const badDrafts = computed(() =>
  [...drafts].filter(([address, plainenglish]) => {
    if (!plainenglish.length) return false;
    const entry = entriesByAddress.get(address);
    if (!entry) return true;
    return !proseVariantStatus(
      { text: entry.text, interpolations: contentInterpolationTokens(entry.text) },
      { plainenglish, of: proseOriginalHash(entry.text) },
    ).ok;
  }),
);
const pending = computed(() => reviewing.value ? pendingCoreProseText() : undefined);
const dirty = computed(() => store.dirty.has(FILE) || drafts.size > 0);

function edit(entry: Entry, event: Event) {
  if (!writable.value) return;
  const target = event.target;
  if (!(target instanceof HTMLTextAreaElement)) return;
  drafts.set(entry.address, target.value);
  markCoreProseDraftDirty();
  reviewing.value = false; // a preview must not silently omit subsequent edits
  error.value = '';
  externalConflict.value = false;
}

async function review() {
  if (!writable.value || !dirty.value || badDrafts.value.length) return;
  error.value = '';
  externalConflict.value = false;
  try {
    const changed = await externalChange(FILE);
    if (changed.changed) {
      externalConflict.value = true;
      error.value = 'messages.yaml changed on disk. Reload the editor before saving.';
      return;
    }
    const edits = [...drafts].map(([address, plainenglish]) => {
      const entry = entriesByAddress.get(address);
      return { address, plainenglish, original: entry?.text ?? '' };
    });
    const result = applyCoreProseEdits(edits);
    if (!result.ok) {
      error.value = result.error ?? 'Could not stage core prose edits';
      return;
    }
    drafts.clear();
    reviewing.value = true;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  }
}

async function save() {
  if (!writable.value || !reviewing.value || saving.value) return;
  saving.value = true;
  try {
    const changed = await externalChange(FILE);
    if (changed.changed) {
      externalConflict.value = true;
      error.value = 'messages.yaml changed on disk. Reload the editor before saving.';
      return;
    }
    const result = await saveCoreProseCatalogue();
    if (result.ok) {
      reviewing.value = false;
      error.value = '';
    } else {
      error.value = result.error ?? 'Could not write messages.yaml';
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <section class="core-prose">
    <header>
      <h2>Core prose · Plain English</h2>
      <p class="note">
        Stable messages are extracted from the actual core source at build time.
        Original is read-only; only the counterparts in messages.yaml are saved.
      </p>
    </header>

    <p v-if="!writable" class="issue warning" role="status">
      Reference only in Mod Editor. Shipped messages.yaml cannot be edited.
    </p>

    <label class="search-label">
      Search message key, source, or Original
      <input v-model="search" type="search" placeholder="Search core messages…" />
    </label>
    <p class="note" role="status">
      {{ filtered.length }} of {{ coreEntries.length }} stable core messages
      <span v-if="dirty"> · Unsaved drafts or catalogue changes</span>
    </p>

    <p v-if="badDrafts.length" class="issue error" role="alert">
      {{ badDrafts.length }} Plain English draft{{ badDrafts.length === 1 ? '' : 's' }}
      have invalid or missing placeholders. Correct them before reviewing the file.
    </p>

    <article v-for="entry in filtered" :key="entry.address" class="variant-row">
      <code>{{ entry.address }}</code>
      <p class="note">Source: {{ entry.file }}</p>
      <div class="variant-columns">
        <label>
          Original · read only
          <textarea :value="entry.text" readonly class="original" />
        </label>
        <label>
          Plain English
          <textarea
            :value="textFor(entry)"
            :disabled="!writable"
            class="plainenglish"
            placeholder="Add a direct counterpart…"
            @input="edit(entry, $event)"
          />
        </label>
      </div>
      <p class="note" :class="{ bad: !statusFor(entry).ok }" role="status">
        {{ statusFor(entry).text }}
      </p>
    </article>

    <div class="bar save-bar">
      <span class="note">{{ dirty ? 'Unsaved changes · messages.yaml' : 'Nothing unsaved' }}</span>
      <button class="btn" :disabled="!writable || !dirty || !!badDrafts.length || saving" @click="review">
        Review &amp; save
      </button>
    </div>
    <p v-if="error" class="issue error" role="alert">{{ error }}</p>

    <section v-if="reviewing" class="panel">
      <h3>Review messages.yaml changes</h3>
      <DiffView v-if="pending" :before="pending.before" :after="pending.after" />
      <div class="bar">
        <button class="btn primary" :disabled="saving || externalConflict || !!badDrafts.length" @click="save">
          {{ saving ? 'Writing…' : 'Write to disk' }}
        </button>
        <button class="btn" @click="reviewing = false">Cancel</button>
      </div>
    </section>
  </section>
</template>

<style scoped>
.core-prose { max-width: 1080px; }
.search-label { display: block; margin: 18px 0; }
.search-label input { display: block; width: 100%; margin-top: 6px; }
.variant-row { padding: 15px 0; border-top: 1px solid var(--rule); }
.variant-row code { overflow-wrap: anywhere; }
.variant-row .note { margin: 5px 0; }
.variant-columns { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.variant-columns label { display: block; }
.variant-columns textarea { min-height: 90px; margin-top: 5px; resize: vertical; width: 100%; }
.bad { color: var(--rubric); }
.save-bar { margin-top: 20px; }
@media (max-width: 760px) {
  .variant-columns { grid-template-columns: 1fr; }
}
</style>
