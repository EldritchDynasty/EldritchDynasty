<script setup lang="ts">
import { computed, ref } from 'vue';
import type { ProseMode } from '@ed/schema';
import type { GameActions } from '../lib/game';
import { useModal } from '../lib/modal';

const props = withDefaults(defineProps<{
  line: ReturnType<GameActions['line']>;
  close: () => void;
  proseMode?: ProseMode;
}>(), { proseMode: 'original' });

/** This history is a fresh reading, not a saved Chronicle page. */
const copy = computed(() => props.proseMode === 'plainenglish' ? {
  dialog: 'History of the heads of the house',
  title: 'Family leaders',
  close: 'Close',
  count: (n: number) => `${n} ${n === 1 ? 'leader' : 'leaders'} since the house began.`,
  guardian: (born: number | undefined, year: number | undefined) =>
    `${born === undefined ? '' : `Born in ${born}. `}Became the family's guardian spirit${year === undefined ? '.' : ` in ${year}.`}`,
  claimedDeath: (year: number, cause: string) =>
    `The book says this leader died in ${year} from ${cause}.`,
  death: (born: number | undefined, died: number) =>
    born === undefined ? `Died in ${died}.` : `Born in ${born}; died in ${died}.`,
  born: (year: number | undefined) => `Born in ${year}.`,
  empty: 'No one has led the house since it began.',
} : {
  dialog: 'who has held the seal',
  title: 'The seal',
  close: 'Close it',
  count: (n: number) => `${n} ${n === 1 ? 'head' : 'heads'} since the signing.`,
  guardian: (born: number | undefined, year: number | undefined) =>
    `${born === undefined ? '' : `born ${born} · `}did not die — he has watched the house${year === undefined ? '' : ` since ${year}`}`,
  claimedDeath: (year: number, cause: string) =>
    `the book has him dying in ${year}, of ${cause}`,
  death: (born: number | undefined, died: number) =>
    born === undefined ? `died ${died}` : `born ${born}, died ${died}`,
  born: (year: number) => `born ${year}`,
  empty: 'Nobody has taken the seal since the signing.',
});

/**
 * THE SPINE (issue #56).
 *
 * The halls are the living household, and rightly: the dead leave, because
 * they are in the chronicle, which is where a family keeps its dead. The one
 * exception is §22's Vessel, who stays greyed with a mark that is not the mark
 * for death, and she stays exactly where she is.
 *
 * But that is the reason a player at 1400 had fourteen generations of
 * ancestors with no visual trace anywhere — the one screen that could show a
 * five centuries of a bloodline showed nine people, in a game whose whole
 * subject is generational.
 *
 * So: one line, one name a generation, the seal and nothing else. Deliberately
 * not a genealogy — the halls are the family, this is the spine holding them
 * up.
 */
const card = ref<HTMLElement | null>(null);
useModal(card, () => props.close());

/** How long he had it. The sitting head's reign is still running. */
function held(h: ReturnType<GameActions['line']>[number]): string {
  if (props.proseMode === 'plainenglish') {
    if (h.to === undefined) return `Leader since ${h.from} (still serving).`;
    const years = h.to - h.from;
    return `Led from ${h.from} to ${h.to} (${years} ${years === 1 ? 'year' : 'years'}).`;
  }
  if (h.to === undefined) return `${h.from} — and holds it still`;
  const years = h.to - h.from;
  return `${h.from}–${h.to} · ${years} ${years === 1 ? 'year' : 'years'}`;
}
</script>

<template>
  <div class="scrim" @click="close()">
    <article ref="card" class="spine" role="dialog" aria-modal="true" :aria-label="copy.dialog" @click.stop>
      <header>
        <div class="row top">
          <h3 class="label">{{ copy.title }}</h3>
          <button class="quiet small" @click="close()">{{ copy.close }}</button>
        </div>
        <p class="dim small">
          {{ copy.count(line.length) }}
        </p>
      </header>

      <ol class="held">
        <li v-for="(h, i) in line" :key="h.person + h.from">
          <span class="dim small n" aria-hidden="true">{{ i + 1 }}</span>
          <div>
            <div class="name">{{ h.name }}</div>
            <div class="dim small">{{ held(h) }}</div>
            <!-- WHAT THE RECORD CLAIMS, which is the version the house wrote
                 and may not be the version that happened. The game never
                 adjudicates between the two in its own voice. -->
            <!-- INVARIANT 3: the Narrator does not die. `kill` redirects him
                 to `guardian` and sets `died` on the way past, so the one man
                 in this list who did not die was being shown dying. -->
            <div v-if="h.guardian" class="dim small">
              {{ copy.guardian(h.born, h.died) }}
            </div>
            <div v-else-if="h.claimedDeath" class="small said">
              {{ copy.claimedDeath(h.claimedDeath.year, h.claimedDeath.cause) }}
            </div>
            <div v-else-if="h.died !== undefined" class="dim small">
              {{ copy.death(h.born, h.died) }}
            </div>
            <div v-else-if="h.born !== undefined" class="dim small">{{ copy.born(h.born) }}</div>
          </div>
        </li>
      </ol>
      <p v-if="!line.length" class="dim small empty">
        {{ copy.empty }}
      </p>
    </article>
  </div>
</template>

<style scoped>
.scrim {
  position: fixed; inset: 0; z-index: 20;
  background: color-mix(in srgb, var(--vellum-deep) 88%, transparent);
  display: grid; place-items: center; padding: 30px;
  /* The row is the window, not the content: see `Book.vue` (#356). */
  grid-template-rows: minmax(0, 100%);
  /* NO OVERLAY HONOURED THE SAFE AREA (issue #106). See `Book.vue` for why
     these fall back to nothing on a device with no notch to clear. */
  padding-top: max(30px, env(safe-area-inset-top));
  padding-bottom: max(30px, env(safe-area-inset-bottom));
  padding-left: max(30px, env(safe-area-inset-left));
  padding-right: max(30px, env(safe-area-inset-right));
}
.spine {
  background: var(--vellum); border: 1px solid var(--rule);
  width: min(48ch, 100%); max-height: 100%;
  display: flex; flex-direction: column;
}
header { padding: 16px 22px 12px; border-bottom: 1px solid var(--rule); }
.top { justify-content: space-between; align-items: baseline; }
.held { list-style: none; margin: 0; padding: 16px 22px 24px; overflow-y: auto; }
.held li { display: flex; gap: 12px; padding: 7px 0; border-top: 1px solid var(--rule); }
.held li:first-child { border-top: 0; }
.n { flex: 0 0 2ch; text-align: right; font-variant-numeric: tabular-nums; padding-top: 2px; }
.name { font-size: var(--t-card); }
.said { color: var(--ink-soft); font-style: italic; }
.empty { padding: 16px 22px 24px; }
</style>
