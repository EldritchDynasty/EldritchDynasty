<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import type { LandView, SessionView } from '@ed/core';
import type { ProseMode } from '@ed/schema';
import { useModal } from '../lib/modal';
import type { GameActions } from '../lib/game';

const props = defineProps<{
  /** The house's land (issue #94) — this component draws nothing an order screen does not already know. */
  land: LandView;
  halls: SessionView['halls'];
  houseName: string;
  /** Presentation only: land and order semantics remain unchanged. */
  proseMode?: ProseMode;
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
const plain = computed(() => props.proseMode === 'plainenglish');

type PlatState = 'held' | 'title_not_proved' | 'contested' | 'lost';

/** The text equivalent every state carries (issue #72) — never colour or a dash pattern alone. */
const STATE_WORD: Record<PlatState, string> = {
  held: 'held',
  title_not_proved: 'title not proved',
  contested: 'contested',
  lost: 'lost',
};

/** Plain wording changes no status, only how each status is explained. */
const PLAIN_STATE_WORD: Record<PlatState, string> = {
  held: 'held',
  title_not_proved: 'ownership not proved',
  contested: 'claimed by two sides',
  lost: 'lost',
};
function stateWord(state: PlatState): string {
  return (plain.value ? PLAIN_STATE_WORD : STATE_WORD)[state];
}

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
  caput?: boolean;
  holder?: string;
  holderName?: string;
}

const items = computed<PlatItem[]>(() => {
  const held: PlatItem[] = props.land.held.map((p) => {
    const state: PlatState = p.contestedBy ? 'contested' : !p.titleProved ? 'title_not_proved' : 'held';
    const detail = plain.value
      ? state === 'contested'
        ? `The house has held this since ${p.heldSince}, but ${p.contestedBy} also claims it.`
        : state === 'title_not_proved'
          ? `The house has held this since ${p.heldSince}, but it has no official record proving the title.`
          : `Held since ${p.heldSince}. ${p.provenance}`
      : state === 'contested'
        ? `Held since ${p.heldSince}, and claimed at the same time by ${p.contestedBy}.`
        : state === 'title_not_proved'
          ? `Held since ${p.heldSince}, but the house's copy has no notary's book behind it.`
          : `Held since ${p.heldSince}. ${p.provenance}`;
    return {
      key: p.parcel, parcel: p.parcel, name: p.name, place: p.place, state,
      acres: p.acres, provenance: p.provenance, contestedBy: p.contestedBy, detail,
      caput: p.caput, holder: p.holder, holderName: p.holderName,
    };
  });

  const lost: PlatItem[] = props.land.lost.map((l, i) => ({
    key: `lost:${i}:${l.defId ?? l.name}`,
    name: l.name,
    place: l.place,
    state: 'lost' as const,
    detail: plain.value ? `Lost in ${l.year}. ${l.by} gave it up.` : `Lost in ${l.year}, let go by ${l.by}.`,
  }));

  return [...held, ...lost];
});

// Only living cadet halls appear. The simulation's Table order owns validation.
const cadetHalls = computed(() => props.halls.filter((h) => !h.isSeat && h.members.length > 0));
const selectedHall = ref<Record<string, string>>({});
interface GiftError {
  parcel: string;
  /** A core-supplied refusal is data; only local fallback copy changes mode. */
  reason?: string;
  operation: 'give' | 'recall';
}
const giftError = ref<GiftError | null>(null);
function giftErrorText(error: GiftError | null): string {
  if (!error) return '';
  if (error.reason) return error.reason;
  if (error.operation === 'give') {
    return plain.value ? 'Could not give this land to the hall.' : 'The land could not be endowed.';
  }
  return plain.value ? 'Could not take this land back.' : 'The land could not be recalled.';
}

// The old Endow/Recall button stays clickable until Vue repaints. Suppress
// repeated orders for that parcel, not for independent parcels in the same Plat.
const giftSubmitting = new Set<string>();
function dispatchGift(order: Extract<Parameters<GameActions['order']>[0], { kind: 'endow' }>): ReturnType<GameActions['order']> | null {
  if (giftSubmitting.has(order.parcel)) return null;
  giftSubmitting.add(order.parcel);
  try {
    return props.actions.order(order);
  } finally {
    // Even refused/thrown orders can retry after the next rendered state.
    void nextTick(() => { giftSubmitting.delete(order.parcel); });
  }
}

function giveLand(item: PlatItem): void {
  const parcel = item.parcel;
  if (!parcel || item.caput || item.holder) return;
  const branch = selectedHall.value[parcel];
  if (!branch || !cadetHalls.value.some((hall) => hall.id === branch)) return;
  const result = dispatchGift({ kind: 'endow', parcel, branch });
  if (!result) return;
  giftError.value = result.ok ? null : { parcel, reason: result.reason, operation: 'give' };
}

function recallLand(item: PlatItem): void {
  const parcel = item.parcel;
  if (!parcel || !item.holder) return;
  const result = dispatchGift({ kind: 'endow', parcel, branch: null });
  if (!result) return;
  giftError.value = result.ok ? null : { parcel, reason: result.reason, operation: 'recall' };
}

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
type RenameError = 'empty' | 'rejected';
const renameError = ref<RenameError | null>(null);
const renameErrorText = computed(() => {
  switch (renameError.value) {
    case 'empty':
      return plain.value ? 'Enter a name, or use the previous name.' : 'Enter a parcel name, or restore its previous name.';
    case 'rejected':
      return plain.value ? 'Could not change this name. The house may no longer hold this land.' : 'That parcel could not be renamed. It may no longer be held by the house.';
    default:
      return '';
  }
});

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
  if (!trimmed) {
    // Empty drafts are not a cancellation: keep the input and explain why
    // nothing changed, whether submission came from Enter or blur.
    renameError.value = 'empty';
    return;
  }
  if (trimmed !== item.name && !props.actions.nameParcel(item.parcel, trimmed)) {
    // The parcel may have left the house since the editor opened. Do not
    // discard a name the player tried to give it when the engine refuses.
    renameError.value = 'rejected';
    return;
  }
  renameError.value = null;
  naming.value = null;
}

/**
 * IME candidate confirmation also sends Enter. On keyup, composition may
 * already have ended, which would submit a partial parcel name. Only an
 * intentional non-composing keydown commits the edit.
 */
function submitOnEnter(item: PlatItem, event: KeyboardEvent): void {
  if (event.isComposing || event.keyCode === 229) return;
  confirmNaming(item);
}
</script>

<template>
  <div class="scrim" @click="close()">
    <article ref="card" class="plat" role="dialog" aria-modal="true" :aria-label="plain ? 'Land held or lost by the house' : 'the plat of the house\'s ground'" @click.stop>
      <header class="row top">
        <h3 class="label">{{ plain ? 'Land records' : 'The plat' }}</h3>
        <button class="quiet small" @click="close()">{{ plain ? 'Close' : 'Close it' }}</button>
      </header>
      <p class="dim small">
        {{ houseName }} — {{ land.held.length }} {{ plain ? (land.held.length === 1 ? 'parcel held' : 'parcels held') : 'held' }}, {{ land.lost.length }} {{ plain ? (land.lost.length === 1 ? 'parcel lost' : 'parcels lost') : 'lost' }}.
        {{ plain ? 'Each box represents one parcel, not its actual size.' : 'A record, drawn to scale of nothing but itself.' }}
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
        :aria-label="plain ? `${cells.length} parcels: ${land.held.length} held, ${land.lost.length} lost. Details are in the table below.` : `${cells.length} parcels drawn: ${land.held.length} held, ${land.lost.length} lost. The table below names each one.`"
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
          <text x="10" :y="CELL_H - 10" class="cell-state">{{ stateWord(cell.state) }}</text>
          <text v-if="cell.contestedBy" x="10" y="56" class="cell-claim">{{ plain ? 'Also claimed by' : 'claimed by' }} {{ cell.contestedBy }}</text>
        </g>
      </svg>
      <p v-else class="small dim">{{ plain ? 'The house has no land recorded here.' : 'The house holds no ground at all.' }}</p>

      <!-- THE TABLE EQUIVALENT (issue #72 and #96's own acceptance): the
           drawing is decorative; this is where every fact in it is actually
           said, and it is where the house names what it has cleared. -->
      <table class="terrier">
        <caption class="said-not-shown">{{ plain ? 'Details of all land the house holds or has lost.' : 'Every parcel the house holds or has lost, in the same order as the drawing.' }}</caption>
        <thead>
          <tr>
            <th scope="col">{{ plain ? 'Parcel name' : 'Name' }}</th>
            <th scope="col">{{ plain ? 'Status' : 'State' }}</th>
            <th scope="col">{{ plain ? 'Location' : 'Place' }}</th>
            <th scope="col">{{ plain ? 'Details' : 'Particulars' }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in items" :key="item.key" :class="item.state">
            <td>
              <template v-if="naming === item.parcel">
                <input
                  v-model="draftName"
                  size="18"
                   :aria-label="(plain ? 'Change name of ' : 'Rename ') + item.name"
                  :aria-invalid="Boolean(renameError)"
                  :aria-describedby="renameError ? 'parcel-rename-error-' + item.parcel : undefined"
                  @input="renameError = null"
                  @keydown.enter="submitOnEnter(item, $event)"
                  @blur="confirmNaming(item)"
                />
                <p
                  v-if="renameError"
                  :id="'parcel-rename-error-' + item.parcel"
                  class="rubric small"
                  role="alert"
                >{{ renameErrorText }}</p>
              </template>
              <template v-else>
                {{ item.name }}
                <button v-if="item.parcel" class="quiet rename" :aria-label="(plain ? 'Change name of ' : 'Rename ') + item.name" @click="startNaming(item)">{{ plain ? 'change name' : 'rename' }}</button>
              </template>
            </td>
            <td>{{ stateWord(item.state) }}</td>
            <td>{{ item.place }}</td>
            <td>
              {{ item.detail }}
              <template v-if="item.parcel && item.holder">
                <p class="small dim">{{ plain ? 'Currently held by' : 'Held by' }} {{ item.holderName ?? item.holder }}.</p>
                <button class="small recall-land" type="button" @click="recallLand(item)">{{ plain ? 'Take land back' : 'Recall this land' }}</button>
              </template>
              <div v-else-if="item.parcel && !item.caput && cadetHalls.length" class="gift-controls">
                <label class="small" :for="`endow-${item.parcel}`">{{ plain ? 'Give to a younger family hall' : 'Give to a cadet hall' }}</label>
                <select
                  :id="`endow-${item.parcel}`"
                  v-model="selectedHall[item.parcel ?? '']"
                  :aria-label="(plain ? 'Family household to receive ' : 'Hall to receive ') + item.name"
                  @change="giftError = null"
                >
                  <option value="">{{ plain ? 'Choose a family hall' : 'Choose a hall' }}</option>
                  <option v-for="hall in cadetHalls" :key="hall.id" :value="hall.id">{{ hall.name }}</option>
                </select>
                <button class="small endow" type="button" :disabled="!selectedHall[item.parcel ?? '']" @click="giveLand(item)">{{ plain ? 'Give land' : 'Endow' }}</button>
              </div>
              <p v-if="giftError?.parcel === item.parcel" class="small rubric" role="alert">{{ giftErrorText(giftError) }}</p>
            </td>
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
.gift-controls { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 6px; }
.gift-controls select { max-width: 22ch; }
</style>
