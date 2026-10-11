<script setup lang="ts">
import { computed } from 'vue';
import type { SessionView } from '@ed/core';
import type { RememberedPassage } from '../lib/game';

/**
 * WHAT THE YEARS DID (issue #49).
 *
 * The clock offers to move twenty-five years at a stroke and, until this
 * panel, moving them looked exactly like moving one: the tree got shorter,
 * the chronicle gained a line or two about whatever event happened to fire,
 * and four members of the family died without anything anywhere saying so.
 * `stepYear` had reported every one of those deaths since the day it was
 * written. Nobody was listening.
 *
 * It sits beside the chronicle rather than in it, and stays plain while the
 * chronicle is typeset, because they are not the same kind of thing. The
 * chronicle is written by somebody with an interest — it can omit a year,
 * improve one, or be quietly wrong about a woman's parentage for two hundred
 * years. This cannot. It is what happened, in the order it happened, and its
 * flatness is the whole difference between them.
 */
const props = defineProps<{
  passages: RememberedPassage[];
  halls: SessionView['halls'];
}>();
defineEmits<{ (e: 'select', id: string): void }>();

// A long jump can record a birth or deed and then a death before the player
// sees this log. Such a person has no current tree card. Show the history,
// but only offer navigation where the current halls can actually open it.
const onTree = computed(() => new Set(
  props.halls.flatMap((hall) => hall.members.map((member) => member.id)),
));
</script>

<template>
  <section v-if="passages.length" class="panel passage">
    <h3 class="label">What the years did</h3>

    <div v-for="year in passages" :key="year.year" class="year">
      <span class="dim small when">{{ year.year }}</span>
      <ul>
        <!-- Only current hall members have a tree card to open. A death
             cannot be opened, but neither can an earlier line about someone
             who died or left during a multi-year jump. Keep their words. -->
        <li v-for="(line, i) in year.lines" :key="i" :class="line.kind">
          <button v-if="line.kind !== 'death' && onTree.has(line.person)" class="row" @click="$emit('select', line.person)">
            {{ line.text }}
          </button>
          <template v-else>
            <span>{{ line.text }}</span>
            <!-- The cast named them before this year took them. The label and
                 sentence are the engine's own words, read back rather than
                 rewritten into an epitaph (issue #44). -->
            <p v-if="line.kind === 'death' && line.remembered" class="remembered small">
              <span class="rubric">{{ line.remembered.label }}</span> &mdash; {{ line.remembered.because }}
            </p>
          </template>
        </li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
.passage { margin-top: 10px; max-height: 24rem; overflow-y: auto; }
.year { display: flex; gap: 10px; align-items: baseline; padding: 3px 0; }
.when { flex: 0 0 4ch; letter-spacing: .06em; }
ul { margin: 0; padding: 0; list-style: none; min-width: 0; }
li { font-size: var(--t-fine); line-height: 1.5; color: var(--ink-soft); }
/* A death is the only line here the house cannot undo, and the only one that
   takes somebody off the tree. It gets the ink. */
li.death { color: var(--ink); }
/* A foregrounded death gets a second, quieter line rather than a warning
   treatment. The passage is still a flat account; this merely reads back the
   one fact that made the player notice this person last spring. */
.remembered { margin: 2px 0 4px; color: var(--ink-soft); text-wrap: pretty; }
li.awakening { color: var(--rubric); }
/* A finished book is the quietest thing in the log and the commonest — six to
   eight readers are mid-book at all times (issue #82). It is here because the
   years did it, not because anybody should read past a birth to find it. */
li.study { color: var(--ink-faint); }
/* Somebody leaving the house's service. Quiet like a study, because it mostly
   happens four at a time when the man who hired them dies (issue #87). */
li.service { color: var(--ink-faint); }
.row {
  background: none; border: 0; padding: 0; text-align: left;
  font: inherit; color: inherit; cursor: pointer;
}
.row:hover { color: var(--ink); background: none; text-decoration: underline; }
</style>
