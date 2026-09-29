<script setup lang="ts">
import { computed } from 'vue';
import Member from './Member.vue';
import type { SessionView } from '@ed/core';
import { children, drawnBeside, type MemberView } from '../lib/kin';

const props = defineProps<{
  member: MemberView;
  hall: MemberView[];
  names: SessionView['attributes'];
  traitNames: SessionView['traits'];
  selected: string | null;
  showRelevance?: boolean;
  mentions?: (person: string) => { id: string; year: number }[];
  relationshipAnchor?: { id: string; name: string };
}>();
defineEmits<{
  (e: 'select', id: string): void;
  (e: 'line'): void;
  (e: 'root', id: string): void;
  (e: 'book', page: string): void;
  (e: 'relationship', id: string): void;
}>();

const kids = computed(() => children(props.member, props.hall));

/**
 * The spouse who is drawn on this row rather than on one of their own
 * (issue #56) — a married-in partner whose parents are in no hall of ours, so
 * the tree had nowhere to hang her and put her at the top level, between two
 * of the house's own children, as an unrelated row.
 */
const beside = computed(() => drawnBeside(props.member, props.hall));
</script>

<template>
  <li>
    <!-- A couple is one row. §7's marriage market is houses trading blood, and
         the player's most consequential recurring decision is who marries
         whom — none of which was in the picture of the family. -->
    <div class="pair">
      <Member :member="member" :names="names" :trait-names="traitNames" :open="selected === member.id" :show-relevance="showRelevance" :mentions="mentions" :relationship-anchor="relationshipAnchor" @select="$emit('select', $event)" @line="$emit('line')" @book="$emit('book', $event)" @relationship="$emit('relationship', $event)" />
      <template v-if="beside">
        <span class="knot" aria-hidden="true">⚭</span>
        <span class="said-not-shown">married to</span>
        <Member :member="beside" :names="names" :trait-names="traitNames" :open="selected === beside.id" :show-relevance="showRelevance" :mentions="mentions" :relationship-anchor="relationshipAnchor" @select="$emit('select', $event)" @line="$emit('line')" @book="$emit('book', $event)" @relationship="$emit('relationship', $event)" />
      </template>
      <!-- A WAY IN, NOT A SMALLER INDENT (issue #106). The tree does not run
           off the side of a phone — the deepest chain measured across five
           runs to collection was five generations — but eighty-eight cards across
           six halls is five thousand pixels nobody enjoys scrolling, on a
           phone or a desk monitor either. Drawn only where there is a branch
           behind it: a button on a leaf would offer to root the tree at
           itself. -->
      <button v-if="kids.length" class="quiet small root" @click="$emit('root', member.id)">
        Only this branch ▸
      </button>
    </div>
    <ul v-if="kids.length">
      <!-- Recursive by filename. A generation is a nesting level, and there
           are about forty of them in a run. -->
      <Kin
        v-for="kid in kids"
        :key="kid.id"
        :member="kid"
        :hall="hall"
        :names="names"
        :trait-names="traitNames"
        :selected="selected"
        :show-relevance="showRelevance"
        :mentions="mentions"
        :relationship-anchor="relationshipAnchor"
        @select="$emit('select', $event)"
        @line="$emit('line')"
        @book="$emit('book', $event)"
        @relationship="$emit('relationship', $event)"
        @root="$emit('root', $event)"
      />
    </ul>
  </li>
</template>

<style scoped>
li { list-style: none; margin: 0 0 6px; }
/* Side by side where the screen allows, stacked where it does not — the mark
   between them carries the meaning either way. */
.pair { display: flex; align-items: flex-start; gap: 8px; flex-wrap: wrap; }
.knot { color: var(--ink-faint); font-size: var(--t-fine); padding-top: 7px; }
.root { align-self: center; }
ul { margin: 6px 0 0; padding-left: 18px; border-left: 1px solid var(--rule); }
</style>
