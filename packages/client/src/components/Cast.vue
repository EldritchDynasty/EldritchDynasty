<script setup lang="ts">
import type { SessionView } from '@ed/core';
import type { ProseMode } from '@ed/schema';
import { ageLabel } from '../lib/age';

defineProps<{ cast: SessionView['cast']; selected: string | null; proseMode?: ProseMode }>();
defineEmits<{ (e: 'select', id: string): void }>();

/**
 * WHO THIS GENERATION IS ABOUT (issue #44).
 *
 * The tree draws seventy people and a player asked to care about seventy
 * cares about none of them. This is the same household, read down to the five
 * or six the year is actually about, each with the one fact that is true of
 * them and of nobody else — which is the condition for attachment that the
 * game was missing. `cast.ts` decides who; this draws them and hands the click
 * to the tree, so the list is a way INTO the family rather than a second copy
 * of it.
 *
 * The wording is the engine's — the sentence AND the little label beside the
 * name. A client that wrote its own sentence per role would be inventing facts
 * about people, which is the one thing the record layer exists to stop; and a
 * per-role dictionary here is a hand-written copy of a closed union, which
 * quietly printed `sole_expresser` at the moment issue #86 doubled the roles.
 */
</script>

<template>
  <section v-if="cast.length" class="panel cast" aria-labelledby="cast-heading">
    <h3 id="cast-heading" class="label">{{ proseMode === 'plainenglish' ? 'People important to this generation' : 'Who this generation is about' }}</h3>
    <ul>
      <li v-for="member in cast" :key="member.person" :class="{ on: selected === member.person }">
        <button class="row" :aria-pressed="selected === member.person" @click="$emit('select', member.person)">
          <span class="who">
            <span class="name">{{ member.name }}</span>
            <span class="dim small"><span aria-hidden="true">{{ member.sex === 'female' ? '♀' : '♂' }}</span><span class="said-not-shown">{{ member.sex === 'female' ? 'woman' : 'man' }}, </span> <span aria-hidden="true">{{ member.age }}</span><span class="said-not-shown">{{ ageLabel(member.age) }}</span> · {{ member.hall }}</span>
          </span>
          <span class="role rubric small">{{ member.label }}</span>
        </button>
        <p class="because small">{{ member.because }}</p>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.cast { margin-bottom: 18px; }
ul { margin: 0; padding: 0; list-style: none; }
li { padding: 7px 0; border-top: 1px solid var(--rule); }
li:first-child { border-top: 0; }
li.on { background: var(--vellum-deep); }
.row {
  display: flex; align-items: baseline; justify-content: space-between; gap: 10px;
  width: 100%; background: none; border: 0; padding: 0; text-align: left; cursor: pointer;
}
.who { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
.name { color: var(--ink); }
.role { white-space: nowrap; }
.because { margin: 2px 0 0; color: var(--ink-soft); }
</style>
