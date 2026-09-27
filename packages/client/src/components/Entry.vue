<script setup lang="ts">
import { computed } from 'vue';
import type { ChronicleEntry } from '@ed/core';

/**
 * ONE LINE OF THE BOOK, wherever the book is being read (issue #48).
 *
 * Three places draw chronicle entries — the panel on the board, the reading
 * pane, and the creditor's account on the last night — and they were drawing
 * them separately. That is fine right up until one of them is edited: the
 * accessible text for a blank went into the panel and not the epilogue, so a
 * screen reader met a described gap in one place and `&nbsp;` in the other,
 * for the same artefact, in the same run.
 *
 * FREQUENCY IS FELT HERE AND NOWHERE ELSE. A tier is a rationing decision
 * everywhere in the engine; in the book it is typography, and typography is
 * the only form in which the player ever meets it. So `weight` is a class and
 * the stylesheet is the whole of the meaning.
 *
 * An omission is a DATED BLANK LINE, not a missing line. The blank is the
 * artefact — it is the most interesting thing on the page — and it is the one
 * part of this component that must never be tidied into nothing.
 */
const props = defineProps<{
  entry: ChronicleEntry;
  /** The epilogue reads the book aloud in a plainer hand than the panel keeps. */
  read?: boolean;
}>();

/**
 * WHAT THE LINE ACTUALLY CLAIMS (issue #19).
 *
 * A recorded entry can assert things about people — an attribute, a trait, a
 * death, a deed — and those assertions are what the creditor checks on the
 * last night. They have been on the read model since #19 and nothing drew
 * them, which `view.test.ts` caught the moment a claims-bearing entry
 * happened to land in its sampled window.
 *
 * Said in the family's own register, not as a data readout: the house does
 * not think of these as fields. A `deed` already carries its own sentence, so
 * it is quoted rather than reworded, for the reason `passage.ts` quotes
 * `causeOfDeath`.
 */
const claims = computed(() => (props.entry.claims ?? []).map((c) => {
  if (c.kind === 'deed') return c.text;
  if (c.kind === 'death') return `that they died in ${c.year}, ${c.cause}`;
  if (c.kind === 'trait') return c.has ? `that they were ${c.trait}` : `that they were not ${c.trait}`;
  return `that their ${c.attr.replace(/_/g, ' ')} stood at ${c.value}`;
}));

const delegatedPolicies = computed(() => (props.entry.delegated ?? '')
  .split('|')
  .filter(Boolean)
  .map((policy) => {
    const [kind, value] = policy.split(':', 2);
    if (kind === 'record' && value === 'record') return 'standing preference: write it as it happened';
    if (kind === 'choice' && value) return `standing preference: ${value.replace(/_/g, ' ')}`;
    return 'answered by standing preference';
  }));
</script>

<template>
  <article
    class="entry"
    :class="[entry.weight, {
      greyed: entry.greyed,
      omitted: entry.text === null,
      embellished: entry.record === 'embellish',
      read,
    }]"
  >
    <span class="year dim small">{{ entry.year }}</span>
    <h4 v-if="entry.title && entry.text !== null">{{ entry.title }}</h4>
    <p v-if="entry.text !== null">{{ entry.text }}</p>
    <!-- To a screen reader this was `&nbsp;` with a `title` on it, which is to
         say nothing whatsoever, exactly where the artefact is. The sentence is
         said; the page still shows the gap. ONE sentence for both channels —
         the title and the announcement said slightly different things, which
         is how two wordings of one fact start drifting apart. -->
    <p v-else class="blank" title="Somebody decided this year would not be written down.">
      <span class="said-not-shown">Somebody decided this year would not be written down.</span>
      <span aria-hidden="true">&nbsp;</span>
    </p>
    <!-- AND VISIBLY (issue #107). A ruled blank with its explanation in a
         tooltip reads, on a phone, as a rendering bug — which is the worst
         possible thing for the most interesting artefact the game produces.
         The blank is not tidied away; it is initialled, the way the house
         initials a line it improved. -->
    <span v-if="entry.text === null && !read" class="dim small mark">left blank, on purpose</span>
    <span v-if="entry.record === 'embellish' && !read" class="dim small mark">as the house tells it</span>
        <template v-if="!read">
      <span
        v-for="(policy, i) in delegatedPolicies"
        :key="`delegated-${i}`"
        class="dim small mark"
      >{{ policy }}</span>
    </template>
    <!-- The assertions the creditor checks on the last night. Drawn under the
         line that makes them, because a claim detached from its sentence is a
         fact from nowhere. -->
    <ul v-if="claims.length" class="claims dim small">
      <li v-for="(c, i) in claims" :key="i">{{ c }}</li>
    </ul>
  </article>
</template>

<style scoped>
.entry { margin: 0 0 14px; }
.entry p { margin: 2px 0 0; line-height: 1.6; }
.entry h4 { margin: 2px 0 0; font-weight: 500; font-size: var(--t-card); }
.entry .year { display: block; letter-spacing: .08em; }
.entry.line p { font-size: var(--t-fine); color: var(--ink-soft); }
.entry.paragraph p { font-size: var(--t-card); }
.entry.page p { font-size: var(--t-body); }
.entry.illuminated { border-left: 2px solid var(--rubric); padding-left: 12px; }
.entry.illuminated h4 { color: var(--rubric); font-size: var(--t-lead); }
.entry.illuminated p { font-size: var(--t-lead); }
.entry.greyed { opacity: .55; }
/* The artefact. A ruled empty line where a year should have been. */
.entry.omitted .blank { border-bottom: 1px solid var(--rule); }
.entry .mark { font-style: italic; }
/* What the line says is true. Set in from the entry, because it is the
   entry's evidence rather than more of its prose. */
.entry .claims { margin: 4px 0 0; padding-left: 16px; }
.entry .claims li { line-height: 1.5; }

/* Read aloud on the last night: one hand, evenly, blanks taking as long as a
   page. The creditor does not read the family's typography back to it. */
.entry.read { margin-bottom: 12px; }
.entry.read p { font-size: var(--t-card); }
.entry.read.illuminated { border-left: 0; padding-left: 0; }
.entry.read.illuminated p, .entry.read.page p, .entry.read.line p { font-size: var(--t-card); }
.entry.read.embellished p { font-style: italic; }
</style>
