<script setup lang="ts">
import { computed, ref } from 'vue';
import type { LandView } from '@ed/core';
import { useModal } from '../lib/modal';
import type { GameActions } from '../lib/game';

const props = defineProps<{
  /** The house's land (issue #94) — this component draws nothing an order screen does not already know. */
  land: LandView;
  houseName: string;
  actions: GameActions;
  close: () => void;
}>();

/**
 * THE PLAT (issue #96, Phase C).
 *
 * A ledger of acreage is arithmetic; a drawing you filled in over eight
 * hundred years is a trophy — and it is a RECORD, wrong in the same ways the
 * chronicle is wrong (issue #91's third design commitment). It draws only
 * what the house holds, has held, or has lost, and it never adjudicates: a
 * `contested` parcel is drawn as held and as claimed by somebody else, both
 * at once, because there is no narrator here who knows the truth.
 *
 * NO ADJACENCY, NO CONTIGUITY, NO PAINTING THE PROVINCE (issue #91's ruling,
 * amended on #102/#96): every cell is the same size regardless of acreage, in
 * reading order, because the moment two parcels are worth more for touching
 * this stops being a document and starts being a map of operations. Acreage
 * is a number IN each cell, never a shape.
 *
 * Reachable only from the Table pane (`App.vue`'s `pane` stays the same
 * four-way union it always was) — never a fifth tab, per the ruling: a plat
 * with its own tab is promoted to scoreboard by the navigation, whatever the
 * component itself intends.
 */
const card = ref<HTMLElement | null>(null);
useModal(card, () => props.close());

type PlatState = 'held' | 'title_not_proved' | 'contested' | 'lost';

/** The text equivalent every state carries (issue #72) — never colour or a dash pattern alone. */
const STATE_WORD: Record<PlatState, string> = {
  held: 'held',
  title_not_proved: 'title not proved',
  contested: 'contested',
  lost: 'lost',
};

interface PlatItem {
  key: string;
  parcel?: string;
  name: string;
  place: string;
  state: PlatState;
  acres?: number;
  provenance?: string;
  detail: string;
  contestedBy?: string;
}

const items = computed<PlatItem[]>(() => {
  const held: PlatItem[] = props.land.held.map((p) => {
    const state: PlatState = p.contestedBy ? 'contested' : !p.titleProved ? 'title_not_proved' : 'held';
    const detail = state === 'contested'
      ? `Held since ${p.heldSince}, and claimed at the same time by ${p.contestedBy}.`
      : state === 'title_not_proved'
        ? `Held since ${p.heldSince}, but the house's copy has no notary's book behind it.`
        : `Held since ${p.heldSince}. ${p.provenance}`;
    return {
      key: p.parcel, parcel: p.parcel, name: p.name, place: p.place, state,
      acres: p.acres, provenance: p.provenance, contestedBy: p.contestedBy, detail,
    };
  });

  const lost: PlatItem[] = props.land.lost.map((l, i) => ({
    key: `lost:${i}:${l.defId ?? l.name}`,
    name: l.name,
    place: l.place,
    state: 'lost' as const,
    detail: `Lost in ${l.year}, let go by ${l.by}.`,
  }));

  return [...held, ...lost];
});

// ── The drawing ──────────────────────────────────────────────────────────

const COLS = 4;
const CELL_W = 148;
const CELL_H = 92;
const GAP = 12;
const PAD = 18;

const cells = computed(() => items.value.map((item, i) => ({
  ...item,
  x: PAD + (i % COLS) * (CELL_W + GAP),
  y: PAD + Math.floor(i / COLS) * (CELL_H + GAP),
})));

const svgWidth = computed(() => {
  const cols = Math.min(Math.max(items.value.length, 1), COLS);
  return PAD * 2 + cols * CELL_W + (cols - 1) * GAP;
});
const svgHeight = computed(() => {
  const rows = Math.max(Math.ceil(items.value.length / COLS), 1);
  return PAD * 2 + rows * CELL_H + (rows - 1) * GAP;
});

/** Dash pattern per state — visual only, and never the sole carrier: every cell also has a `<title>` and a row in the table below (issue #72). */
function dash(state: PlatState): string | undefined {
  if (state === 'title_not_proved') return '3 3';
  if (state === 'lost') return '6 4';
  return undefined;
}

// ── Naming (issue #96's own verb, pointed at ground) ────────────────────

const naming = ref<string | null>(null);
const draftName = ref('');
const renameError = ref<string | null>(null);

function startNaming(item: PlatItem): void {
  if (!item.parcel) return;
  naming.value = item.parcel;
  draftName.value = item.name;
  renameError.value = null;
}

function confirmNaming(item: PlatItem): void {
  // Enter and blur can both fire before Vue removes the input. Only the
  // still-open edit may submit, or one name can create two Chronicle pages.
  if (!item.parcel || naming.value !== item.parcel) return;
  const trimmed = draftName.value.trim();
  if (trimmed && trimmed !== item.name && !props.actions.nameParcel(item.parcel, trimmed)) {
    // The parcel may have left the house since the editor opened. Do not
    // discard a name the player tried to give it when the engine refuses.
    renameError.value = 'That parcel could not be renamed. It may no longer be held by the house.';
    return;
  }
  renameError.value = null;
  naming.value = null;
}
</script>

<template>
  <div class="scrim" @click="close()">
    <article ref="card" class="plat" role="dialog" aria-modal="true" aria-label="the plat of the house's ground" @click.stop>
      <header class="row top">
        <h3 class="label">The plat</h3>
        <button class="quiet small" @click="close()">Close it</button>
      </header>
      <p class="dim small">
        {{ houseName }} — {{ land.held.length }} held, {{ land.lost.length }} lost.
        A record, drawn to scale of nothing but itself.
      </p>

      <!-- THE DRAWING. Decorative by construction — every fact in it is said
           again, in words, in the table below — so it carries `role="img"`
           with one summary rather than making a screen reader visit forty
           `<title>`s to learn what a sighted reader sees at a glance. -->
      <svg
        v-if="cells.length"
        :viewBox="`0 0 ${svgWidth} ${svgHeight}`"
        :width="svgWidth" :height="svgHeight"
        role="img"
        :aria-label="`${cells.length} parcels drawn: ${land.held.length} held, ${land.lost.length} lost. The table below names each one.`"
        class="drawing"
      >
        <g v-for="cell in cells" :key="cell.key" :transform="`translate(${cell.x}, ${cell.y})`">
          <rect
            :width="CELL_W" :height="CELL_H" rx="2"
            :class="['plot', cell.state]"
            :stroke-dasharray="dash(cell.state)"
          />
          <!-- CONTESTED: drawn as held AND claimed, both at once, unadjudicated. -->
          <rect
            v-if="cell.state === 'contested'"
            x="8" y="8" :width="CELL_W - 16" :height="CELL_H - 16"
            class="plot contested-overlay"
            stroke-dasharray="2 3"
          />
          <line
            v-if="cell.state === 'lost'"
            x1="6" y1="6" :x2="CELL_W - 6" :y2="CELL_H - 6" class="strike"
          />
          <text x="10" y="20" class="cell-name">{{ cell.name }}</text>
          <text v-if="cell.acres !== undefined" x="10" y="38" class="cell-acres">{{ cell.acres }} acres</text>
          <text x="10" :y="CELL_H - 10" class="cell-state">{{ STATE_WORD[cell.state] }}</text>
          <text v-if="cell.contestedBy" x="10" y="56" class="cell-claim">claimed by {{ cell.contestedBy }}</text>
        </g>
      </svg>
      <p v-else class="small dim">The house holds no ground at all.</p>

      <!-- THE TABLE EQUIVALENT (issue #72 and #96's own acceptance): the
           drawing is decorative; this is where every fact in it is actually
           said, and it is where the house names what it has cleared. -->
      <table class="terrier">
        <caption class="said-not-shown">Every parcel the house holds or has lost, in the same order as the drawing.</caption>
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">State</th>
            <th scope="col">Place</th>
            <th scope="col">Particulars</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in items" :key="item.key" :class="item.state">
            <td>
              <template v-if="naming === item.parcel">
                <input
                  v-model="draftName"
                  size="18"
                  :aria-label="'Rename ' + item.name"
                  :aria-describedby="renameError ? 'parcel-rename-error-' + item.parcel : undefined"
                  @keyup.enter="confirmNaming(item)"
                  @blur="confirmNaming(item)"
                />
                <p
                  v-if="renameError"
                  :id="'parcel-rename-error-' + item.parcel"
                  class="rubric small"
                  role="alert"
                >{{ renameError }}</p>
              </template>
              <template v-else>
                {{ item.name }}
                <button v-if="item.parcel" class="quiet rename" @click="startNaming(item)">rename</button>
              </template>
            </td>
            <td>{{ STATE_WORD[item.state] }}</td>
            <td>{{ item.place }}</td>
            <td>{{ item.detail }}</td>
          </tr>
        </tbody>
      </table>
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
  padding-top: max(30px, env(safe-area-inset-top));
  padding-bottom: max(30px, env(safe-area-inset-bottom));
  padding-left: max(30px, env(safe-area-inset-left));
  padding-right: max(30px, env(safe-area-inset-right));
}
.plat {
  background: var(--vellum); border: 1px solid var(--rule);
  width: min(84ch, 100%); max-height: 100%; overflow-y: auto;
  padding: 16px 22px 22px;
}
.top { justify-content: space-between; align-items: baseline; margin-bottom: 4px; }

.drawing { display: block; margin: 14px 0; max-width: 100%; height: auto; }
.plot { fill: var(--panel); stroke: var(--ink-soft); stroke-width: 1.5; }
.plot.title_not_proved { stroke: var(--ink-faint); }
.plot.lost { fill: color-mix(in srgb, var(--vellum-deep) 60%, transparent); opacity: .55; }
.contested-overlay { fill: none; stroke: var(--rubric); stroke-width: 1.5; }
.strike { stroke: var(--ink-faint); stroke-width: 1.5; }
.cell-name { font-size: var(--t-fine); fill: var(--ink); font-weight: 600; }
.cell-acres, .cell-state { font-size: var(--t-label); fill: var(--ink-soft); }
.cell-claim { font-size: var(--t-label); fill: var(--rubric); }

.terrier { width: 100%; border-collapse: collapse; font-size: var(--t-fine); }
.terrier th, .terrier td { text-align: left; padding: 6px 8px; border-top: 1px solid var(--rule); vertical-align: top; }
.terrier tr.lost { opacity: .6; }
.terrier tr.lost td:first-child { text-decoration: line-through; }
.terrier tr.contested td:first-child { color: var(--rubric); }
.rename {
  background: none; border: 0; padding: 0 0 0 6px; font: inherit;
  font-size: var(--t-label); color: var(--ink-faint); cursor: pointer; text-decoration: underline;
}
.rename:hover { color: var(--ink); }
</style>
