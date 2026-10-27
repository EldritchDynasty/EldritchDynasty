<script setup lang="ts">
import HouseholdSecurity from './HouseholdSecurity.vue';
import CovertExpeditions from './CovertExpeditions.vue';
import OutsideServices from './OutsideServices.vue';
import TableTaskLinks from './TableTaskLinks.vue';
import RecordedLife from './RecordedLife.vue';
import { computed, nextTick, ref, watch } from 'vue';
import type { LandView, TableView } from '@ed/core';
import type { ProseMode } from '@ed/schema';
import type { GameActions, GameStore } from '../lib/game';
import { modalFocusable as focusableWithin } from '../lib/modal';
import { tableTargetAttrs, type OpenedTablePanels, type TableReveal, type TableTarget, type TableTask } from '../lib/table-nav';

const props = defineProps<{
  // No `view`: this panel drew its tutoring subjects off `SessionView`'s list
  // of every attribute in the game, and now takes `table.teachable` instead.
  // A prop nothing reads is the same bug as a schema field nothing reads.
  table: TableView;
  /** The house's land — held ground and the open market (issue #94). */
  land: LandView;
  actions: GameActions;
  /** The last order refused, and which panel asked (issue #55). */
  refusal: { kind: string; reason: string } | null;
  /** What the last order cost, where it cost anything (issue #59). */
  receipt: string | null;
  /** Reader-local text only; game actions and supplied prose stay unchanged. */
  proseMode?: ProseMode;
  reveal?: TableReveal | null;
  tasks?: readonly TableTask[];
  showEverything?: boolean;
  returnLabel?: string;
  milestones?: GameStore['milestones'];
}>();

function studyYears(book: TableView['shelf'][number]): number {
  return book.readers.find((reader) => reader.person === reading.value[book.book])?.years ?? book.years;
}

/**
 * THE PLAT LIVES INSIDE THE TABLE (issue #96, Phase C, per the ruling on
 * #91/#102): never a fifth pane. `App.vue` renders it — the same split
 * `Book.vue` already uses for the chronicle's own volume — so the click that
 * opens it has to start here, where the land panel already is.
 */
const emit = defineEmits<{
  book: [page: string];
  'open-plat': [];
  navigate: [target: TableTarget];
  revealed: [token: number];
  return: [];
}>();

/**
 * THE REASON GOES WITH THE CONTROL (issue #55).
 *
 * One shared `refused` line lived in the purse, and refusals come from nine
 * panels — so an order refused from The Papers printed its reason about
 * 1,500px above the button that had just been pressed. The player saw nothing
 * happen, which in this codebase is the single least detectable failure there
 * is.
 */
function refusedIn(kind: string): string | null {
  return props.refusal?.kind === kind ? props.refusal.reason : null;
}

/**
 * THE TABLE — the half of the game that is not answering a prompt.
 *
 * Everything else the player does answers the docket. These are standing
 * orders: the player says what the house is to do with its people and its
 * money, the year phases carry it out, and the order stands until it is
 * finished or withdrawn. §13's headline tension lives here — tutor the child
 * you have, or buy the book his grandchildren might read; you can afford one —
 * and it only exists if both are on the same screen with one treasury above
 * them.
 */
/** The number input's .number modifier also yields '' for an emptied field.
 * A ceiling is whole crowns, including zero, and must survive exact numeric
 * round-tripping rather than being silently rounded by the simulation. */
const ceiling = ref<number | string>(props.table.bidCeiling);
function validCeiling(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
/**
 * Auction orders all read the same displayed lot/ceiling state. Do not send
 * competing offers or a withdrawal before Vue has refreshed that state.
 * This lock is scoped to auction orders, not unrelated work on the Table.
 */
let auctionSubmitting = false;
function submitAuctionOrder(order: Parameters<GameActions['order']>[0]): void {
  if (auctionSubmitting) return;
  auctionSubmitting = true;
  try {
    props.actions.order(order);
  } finally {
    void nextTick(() => { auctionSubmitting = false; });
  }
}

function setBidCeiling(): void {
  if (!validCeiling(ceiling.value)) return;
  submitAuctionOrder({ kind: 'bid', ceiling: ceiling.value });
}

/**
 * A BID ON ONE LOT (issue #1183). The ceiling above is what the house will
 * spend on a sale it has not looked at; these are the lots, named, and the
 * house's own offer on each — crowns, an heirloom, or a marriage pledge. The
 * engine refuses what the house cannot honour and voids, at the sale, what it
 * no longer can.
 */
const lotCoin = ref<Record<string, number | string>>({});
const lotHeirloom = ref<Record<string, string>>({});
function validLotCoin(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}
function bidCoin(lot: string): void {
  const amount = lotCoin.value[lot];
  if (!validLotCoin(amount)) return;
  submitAuctionOrder({ kind: 'lotBid', lot, bid: { currency: 'coin', amount } });
}
function bidHeirloom(lot: string): void {
  const heirloom = lotHeirloom.value[lot];
  if (!heirloom) return;
  submitAuctionOrder({ kind: 'lotBid', lot, bid: { currency: 'heirloom', heirloom } });
}

/**
 * Buying back wardship changes its availability immediately, but the stale
 * button remains clickable until Vue repaints the Table. A second order would
 * be refused and overwrite the first purchase's successful receipt.
 */
let buyingBackWardship = false;
function buyBackWardship(): void {
  if (buyingBackWardship || !props.table.wardship
    || props.table.wardship.boughtBack || props.table.wardship.buyBackCost === undefined) return;
  buyingBackWardship = true;
  try {
    props.actions.order({ kind: 'buyBackWardship' });
  } finally {
    // A refused order must remain retryable on the next rendered turn.
    void nextTick(() => { buyingBackWardship = false; });
  }
}

const pupil = ref('');
const subject = ref('');

/** The two names the player is about to put into the ascension programme. */
const scionChoice = ref('');
const scionHeirChoice = ref('');

/** Who the player is about to put in each post, keyed by the post. */
const placing = ref<Record<string, string>>({});

/** What the player is about to advance against each servant's years. */
const advancing = ref<Record<string, number>>({});

/** Vue's .number model can return an empty string despite its typed ref.
 * Never submit nonintegral debt, but keep input visible for correction. */
function validAdvance(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 1
    && value <= props.table.maxBond;
}

/**
 * Binding or freeing a servant changes their status synchronously, but Vue
 * leaves the old Bond button clickable until the next render. Keep one order
 * per servant in that render so a stale second click cannot replace a
 * successful receipt with an "already bonded" or "nothing to free" refusal.
 * Independent servants are never blocked by each other.
 */
const bondSubmitting = new Set<string>();
function sendBondOrder(order: Extract<Parameters<GameActions['order']>[0], { kind: 'bond' }>): void {
  if (bondSubmitting.has(order.person)) return;
  bondSubmitting.add(order.person);
  try {
    props.actions.order(order);
  } finally {
    void nextTick(() => { bondSubmitting.delete(order.person); });
  }
}

function advance(person: string): void {
  const marks = advancing.value[person];
  if (!validAdvance(marks)) return;
  sendBondOrder({ kind: 'bond', person, op: 'bind', marks });
}

/** Who the player is about to put on each book. The shelf used to be a button
 * per reader per book — sixteen on turn one across two books, growing with the
 * household — while Places solved the identical shape with a `select` 200px
 * further down. Two idioms for one interaction, on one screen. */
const reading = ref<Record<string, string>>({});
watch(() => props.table.shelf, (books) => {
  for (const book of books) {
    const selected = reading.value[book.book] ?? '';
    reading.value[book.book] = book.readers.some((reader) => reader.person === selected) ? selected : '';
  }
}, { immediate: true });

/**
 * ISSUE #218 — THE ASSEMBLY BEFORE THE ACT.
 *
 * Calling a rite used to be a one-click jump straight to the docket. Hold the
 * engine's photographed assembly here first; cancelling mutates nothing, and
 * confirming still invokes the exact same table order/resolver as before.
 */
type RiteOrder = 'vesselRite' | 'greatRite' | 'unmaking';
const pendingRite = ref<RiteOrder | null>(null);
function assemble(kind: RiteOrder): void {
  pendingRite.value = kind;
}
function cancelRite(): void {
  pendingRite.value = null;
}
function confirmRite(): void {
  const kind = pendingRite.value;
  if (!kind) return;
  pendingRite.value = null;
  props.actions.order({ kind });
}
const riteAssembly = computed(() => pendingRite.value ? props.table[pendingRite.value].assembly : undefined);

/**
 * THE LONG WAIT (§11, issue #1794). Declaring a man mundane cannot be undone,
 * so it is asked twice: choose him, then confirm. Cancelling mutates nothing;
 * confirming sends the one `declareMundane` order.
 */
const pendingMundane = ref<{ person: string; name: string } | null>(null);
/** Open only when the declaration would move the seal; folded, never hidden, otherwise. */
const mundaneMatters = computed(() => props.table.longWait.some((p) => p.inLine));
function confirmMundane(): void {
  const chosen = pendingMundane.value;
  if (!chosen) return;
  pendingMundane.value = null;
  props.actions.order({ kind: 'declareMundane', person: chosen.person });
}

/**
 * THE FORCING RITES (§11, #1817). The house may try a rite on any boy of the
 * line in its window; the list is the same whether or not the blood is in
 * him, because the house does not know. A boy goes through one rite, so this
 * too is asked twice: choose him, then confirm. Cancelling mutates nothing.
 */
const forcingRites = computed(() => props.table.forcing ?? []);
const forcingMatters = computed(() => forcingRites.value.some((r) => r.ready));
const pendingForcing = ref<{ rite: string; title: string; person: string; name: string } | null>(null);
function confirmForcing(): void {
  const chosen = pendingForcing.value;
  if (!chosen) return;
  pendingForcing.value = null;
  props.actions.order({ kind: 'forcingRite', rite: chosen.rite, person: chosen.person });
}

/**
 * WHAT THE HOUSE COULD DO THIS YEAR, and what it is only being shown.
 *
 * The table was a 2,300px scroll because every panel drew whether or not it
 * had anything to say, including the ones whose only content was "Nobody of
 * the house is of an age to be spent this year." §13's tension — tutor the
 * child you have or buy the book his grandchildren might read, you can afford
 * one — only exists if both are on one screen under one treasury.
 *
 * A panel with nothing to offer keeps its heading and one line saying so, and
 * folds. Nothing is hidden: the player can still open it, and knows it is
 * there and empty, which is a different fact from it not existing.
 */
/**
 * MYSTIC DUTIES (#1873). One reader and one place per order; both selects are
 * drawn from what the engine says it would accept, and cleared when a choice
 * stops being on offer rather than left pointing at somebody who left.
 */
const dutyWho = ref<Record<string, string>>({});
const dutyWhere = ref<Record<string, string>>({});
const showUnlearned = ref(false);
const visibleDuties = computed(() => props.table.mystic.offers.filter(offer => showUnlearned.value || offer.known));
watch(() => props.table.mystic.offers, (offers) => {
  for (const offer of offers) {
    const who = dutyWho.value[offer.working] ?? '';
    dutyWho.value[offer.working] = offer.practitioners.some((r) => r.person === who) ? who : '';
    const where = Number(dutyWhere.value[offer.working] ?? '');
    dutyWhere.value[offer.working] = Number.isInteger(where) && dutyWhere.value[offer.working] !== '' && where < offer.targets.length
      ? String(where) : '';
  }
}, { immediate: true });
function assignDuty(offer: TableView['mystic']['offers'][number]): void {
  const target = offer.targets[Number(dutyWhere.value[offer.working])];
  const person = dutyWho.value[offer.working];
  if (!target || !person) return;
  props.actions.order({ kind: 'mysticAssign', person, working: offer.working, target: target.target, bindings: target.bindings });
}
function dutyStatus(duty: TableView['mystic']['duties'][number]): string {
  switch (duty.status) {
    case 'preparing': return local(`making ready until ${duty.ready}`, `preparing until ${duty.ready}`);
    case 'serving': return local('kept', 'active');
    case 'suspended': return local(`lapsed — ${duty.reason ?? ''}`, `stopped: ${duty.reason ?? ''}`);
  }
}
function dutyRecord(duty: { service: TableView['mystic']['duties'][number]['service'] }): string {
  const s = duty.service;
  const parts = [local(`${s.servedYears} years kept`, `${s.servedYears} years active`)];
  if (s.livesKept) parts.push(local(`${s.livesKept} ${s.livesKept === 1 ? 'life' : 'lives'} kept`, `${s.livesKept} ${s.livesKept === 1 ? 'person' : 'people'} saved`));
  if (s.yieldKept) parts.push(local(`${s.yieldKept.toFixed(1)} of yield held`, `${s.yieldKept.toFixed(1)} yield saved`));
  if (s.menKept) parts.push(local(`${s.menKept} levy men kept`, `${s.menKept} levy men saved`));
  if (s.crownsKept) parts.push(local(`${s.crownsKept.toFixed(1)} crowns kept`, `${s.crownsKept.toFixed(1)} crowns saved`));
  if (s.bookWearKept) parts.push(local(`${s.bookWearKept.toFixed(1)} page wear kept`, `${s.bookWearKept.toFixed(1)} book condition saved`));
  if (s.healthRestored) parts.push(local(`${s.healthRestored.toFixed(1)} health restored`, `${s.healthRestored.toFixed(1)} health recovered`));
  if (s.studyYearsKept) parts.push(local(`${s.studyYearsKept} reading years kept`, `${s.studyYearsKept} study years saved`));
  if (s.opportunities) parts.push(local(`${s.opportunities} useful sightings`, `${s.opportunities} useful sightings`));
  if (s.protections) parts.push(local(`${s.protections} protections used`, `${s.protections} protective interventions`));
  if (s.covertUses) parts.push(local(`${s.covertUses} useful expedition workings`, `${s.covertUses} useful operation effects`));
  parts.push(local(`${Math.round(s.spent)} crowns spent`, `${Math.round(s.spent)} crowns paid`));
  return parts.join(' · ');
}

// App owns these reader choices, so leaving the pane does not discard them.
const opened = defineModel<OpenedTablePanels>('opened', { default: () => ({}) });
function togglePanel(panel: TableTarget): void {
  opened.value = { ...opened.value, [panel]: !opened.value[panel] };
}
function idle(panel: TableTarget, hasWork: boolean): boolean {
  return !hasWork && !opened.value[panel];
}
const root = ref<HTMLElement | null>(null);
watch(() => props.reveal, async (request) => {
  if (!request) return;
  opened.value = { ...opened.value, [request.target]: true };
  await nextTick();
  if (props.reveal?.token !== request.token) return;
  const panel = root.value?.querySelector<HTMLElement>(`[data-table-target="${request.target}"]`);
  if (!panel) return;
  panel.scrollIntoView?.({ block: 'start', behavior: 'auto' });
  const heading = panel.querySelector<HTMLElement>('h3');
  const destination = heading?.querySelector<HTMLElement>('button:not(:disabled)')
    ?? focusableWithin(panel)[0] ?? heading;
  if (destination) {
    if (destination === heading) destination.tabIndex = -1;
    destination.focus({ preventScroll: true });
  }
  emit('revealed', request.token);
}, { immediate: true, flush: 'post' });

/** Can the house pay for a term, a place, a paper? Drawn, not only enforced. */
const broke = computed(() => props.table.treasury <= 0);

/** The standing order on marriage, in the house's own words. */
const plain = computed(() => props.proseMode === 'plainenglish');
/** Reader-only wording: never rewrite authored text, engine reasons or action ids. */
function local(original: string, simple: string): string {
  return plain.value ? simple : original;
}
const MARRIAGE_ORDERS = [
  { policy: 'in' as const, label: 'Keep it in the family', simple: 'Marry within the family' },
  { policy: 'out' as const, label: 'Marry outward', simple: 'Marry outside the family' },
  { policy: 'as_it_falls' as const, label: 'As it falls', simple: 'No preference' },
];

</script>

<template>
<section ref="root" class="table stack" :aria-label="plain ? 'Family orders and resources' : `The house's standing orders`">
    <nav v-if="tasks?.length" class="table-tasks" :aria-label="local('Find an order', 'Find family orders')">
      <div class="row">
        <h3 class="label">{{ local('What the house needs', 'What do you want to do?') }}</h3>
        <button v-if="returnLabel" type="button" class="quiet small return-goal" @click="emit('return')">{{ returnLabel }}</button>
      </div>
      <details v-for="task in tasks" :key="task.id">
        <summary class="small">{{ task.title }}</summary>
        <TableTaskLinks :task="task" :prose-mode="proseMode" @navigate="emit('navigate', $event)" />
      </details>
    </nav>
    <div v-bind="tableTargetAttrs('purse')" class="panel">
      <h3 class="label">{{ local('The purse', 'Money and auctions') }}</h3>
      <p class="small">
        <template v-if="plain">
          Money balance: {{ table.treasury }} crowns<span v-if="table.treasury < 0"> (the house owes {{ -table.treasury }} crowns)</span>. A tutoring term costs {{ table.tutorFee }}.
        </template>
        <template v-else>
          {{ table.treasury }} crowns. A term of tutoring is {{ table.tutorFee }}.
        </template>
      </p>

      <!-- WARDSHIP (issue #1206). The engine has taken the land income away
           for as long as this stands and offered the customary buy-back since
           #91, and no client drew either: the purse shrank for sixteen years
           with nothing on the screen to say why, or what could be done. -->
      <section v-if="table.wardship" class="wardship" :aria-label="local('Wardship', 'Guardianship and land income')">
        <p class="small" :class="table.wardship.boughtBack ? 'dim' : 'rubric'">
          <template v-if="table.wardship.boughtBack">
            {{ table.wardship.wardName }} {{ local("is still under age, but the wardship was bought back and the land is the house's again.", "is still a minor. The house paid to end wardship and has its land income again.") }}
          </template>
          <template v-else>
            {{ table.wardship.wardName }} {{ local('is under age, and since', 'is a minor. Since') }} {{ table.wardship.since }} {{ local('the Warden has taken the harvest.', 'the Warden has received the harvest income.') }}
          </template>
        </p>
        <button
          v-if="!table.wardship.boughtBack && table.wardship.buyBackCost !== undefined"
          @click="buyBackWardship"
        >
          {{ local('Buy the wardship back', 'Pay to end wardship') }} — {{ table.wardship.buyBackCost }} crowns
        </button>
        <p v-if="refusedIn('buyBackWardship')" class="small rubric">{{ refusedIn('buyBackWardship') }}</p>
      </section>

      <!-- THE AUCTION READS AS A DECISION (issue #55). `bidCeiling` defaults to
           zero and the panel said "the house will bid up to 0", which is a
           house that will never bid on anything, forever, with nothing
           anywhere flagging it as a decision nobody made. It looked exactly
           like a working auction — this codebase's failure mode, wearing a UI.
           And it never said WHEN, which is the whole of §13's sentence: the
           money is gone the day it is spent and the auction is years out. -->
      <p class="small" :class="table.bidCeiling > 0 ? 'dim' : 'rubric'">
        <template v-if="table.bidCeiling > 0">
          {{ local('The house will go to', 'The house will bid up to') }} {{ table.bidCeiling }} {{ local('at the next sale.', 'crowns at the next auction.') }}
        </template>
        <template v-else-if="table.auction?.items.some((lot) => lot.bid)">
          {{ local('The house has set no ceiling; its named bids below still stand.', 'No automatic maximum has been set. Your bids for individual lots still apply.') }}
        </template>
        <template v-else>{{ local('The house has not said what it will spend, so it will not bid.', 'No maximum bid has been set. The house will not bid at the auction.') }}</template>
      </p>
      <p v-if="table.auction" class="small dim">
        {{ local('A sale in', 'Next auction:') }} {{ table.auction.year }} — {{ table.auction.lots }}
        {{ table.auction.lots === 1 ? 'lot' : 'lots' }}, {{ local('the cheapest reserved at', 'lowest starting price') }}
        {{ table.auction.lowestReserve }}.
      </p>
      <p v-else class="small dim">{{ local('Nothing has been announced.', 'No auction has been announced yet.') }}</p>

      <div v-for="lot in table.auction?.items ?? []" :key="lot.id" class="line lot">
        <div class="small">
          <strong>{{ lot.name }}</strong>
          <span class="dim"> · {{ lot.seller }} · {{ local('sold in', 'sale year') }} {{ lot.saleYear }} · {{ local('reserved at', 'starting price') }} {{ lot.reserve }}</span>
        </div>
        <p v-if="lot.kind === 'chronicle_page'" class="small rubric blurb">
          {{ local('Whoever buys this page reads it. If a rival buys it, what it proves is proven.', 'The buyer can read this Chronicle page. A rival who buys it can use its evidence to prove a claim.') }}
        </p>
        <p v-if="lot.bid" class="small dim">
          {{ local('The house has bid', 'Current bid:') }}
          {{ lot.bid.currency === 'coin' ? `${lot.bid.amount} crowns` : lot.bid.currency === 'heirloom' ? lot.bid.name : local('the hand of a future granddaughter', 'a future granddaughter in marriage') }} {{ local('for it.', 'for this lot.') }}
        </p>
        <div class="row">
          <input
            type="number" min="1" step="1" v-model.number="lotCoin[lot.id]"
            :aria-label="plain ? `Offer crowns for ${lot.name}` : `Bid in crowns for ${lot.name}`"
          />
          <button :disabled="!validLotCoin(lotCoin[lot.id])" @click="bidCoin(lot.id)">{{ local('Bid crowns', 'Place money bid') }}</button>
          <template v-if="table.auction?.heirlooms.length">
            <select v-model="lotHeirloom[lot.id]" :aria-label="plain ? `Choose an heirloom to offer for ${lot.name}` : `Heirloom to trade for ${lot.name}`">
              <option value="">{{ local('an heirloom…', 'Choose an heirloom…') }}</option>
              <option v-for="h in table.auction.heirlooms" :key="h.id" :value="h.id">{{ h.name }}</option>
            </select>
            <button :disabled="!lotHeirloom[lot.id]" @click="bidHeirloom(lot.id)">{{ local('Trade it', 'Offer heirloom') }}</button>
          </template>
          <button
            v-if="lot.bid" class="quiet small"
            @click="submitAuctionOrder({ kind: 'lotBid', lot: lot.id, bid: null })"
          >
            {{ local('Withdraw', 'Withdraw bid') }}
          </button>
        </div>
        <div v-if="lot.marriagePromise" class="pledge">
          <p :id="`pledge-terms-${lot.id}`" class="small dim blurb">
            <template v-if="lot.marriagePromise.available">
              {{ lot.marriagePromise.signer }} {{ local('may pledge a future granddaughter to', 'can promise a future granddaughter to') }} {{ lot.seller }}.
              {{ local('If the bid wins, a granddaughter born after the sale must marry into that house within', 'If you win, a granddaughter born after this auction must marry into that family within') }}
              {{ lot.marriagePromise.term }} {{ local('years of the sale.', 'years of the auction.') }}
              {{ local('Keeping her back or letting the pledge expire costs a tier of Respect and an inherited grudge.', 'Withholding her or missing the deadline loses one reputation level and creates a grudge against your family and its descendants.') }}
            </template>
            <template v-else>{{ lot.marriagePromise.reason }}</template>
          </p>
          <button
            class="small"
            :disabled="!lot.marriagePromise.available"
            :aria-label="plain ? `Offer a future granddaughter in marriage for ${lot.name} from ${lot.seller}` : `Pledge a granddaughter for ${lot.name} from ${lot.seller}`"
            :aria-describedby="`pledge-terms-${lot.id}`"
            @click="submitAuctionOrder({ kind: 'lotBid', lot: lot.id, bid: { currency: 'marriage_promise' } })"
          >{{ local('Pledge a granddaughter', 'Offer a future granddaughter in marriage') }}</button>
        </div>
      </div>
      <p v-if="refusedIn('lotBid')" class="small rubric">{{ refusedIn('lotBid') }}</p>

      <div class="row">
        <input
          type="number" min="0" step="1" v-model.number="ceiling"
          :aria-label="local('Maximum auction bid in crowns', 'Maximum amount to bid at auction (crowns)')"
          :aria-invalid="!validCeiling(ceiling)"
          :aria-describedby="!validCeiling(ceiling) ? 'bid-ceiling-error' : undefined"
        />
        <button :disabled="!validCeiling(ceiling)" @click="setBidCeiling">{{ local('Set the ceiling', 'Set maximum bid') }}</button>
      </div>
      <p v-if="!validCeiling(ceiling)" id="bid-ceiling-error" class="small rubric" role="alert">
        {{ local('Enter zero or a whole number of crowns within the safe counting range.', 'Enter zero or a positive whole number of crowns within the allowed range.') }}
      </p>
      <p v-if="refusedIn('bid')" class="small rubric">{{ refusedIn('bid') }}</p>
      <!-- THE RECEIPT (issue #59). §13 means these to hurt — the money is gone
           the day it is spent and the auction is in eleven years — and a spend
           the player cannot feel landing does not hurt, it only makes the
           number smaller for reasons they reconstruct later, wrongly. -->
      <p v-else-if="receipt" class="small spent">{{ receipt }}</p>
    </div>

    <div v-bind="tableTargetAttrs('preferences')" v-if="table.delegation.length || opened.preferences || showEverything" class="panel">
      <h3 class="label">{{ local('Standing preferences', 'Saved decisions') }}</h3>
      <p v-if="!table.delegation.length" class="small dim">{{ local('No standing answers have been kept.', 'No decisions have been saved yet.') }}</p>
      <p class="small dim">{{ local('Routine repeats may use these answers. Anything important still comes back to the table.', 'The house can reuse these answers for routine decisions. Important decisions will still be shown to you.') }}</p>
      <div v-for="policy in table.delegation" :key="policy.kind + ':' + policy.event" class="row policy">
        <span class="small"><strong>{{ policy.title }}</strong> · {{ policy.answer.replace(/_/g, ' ') }}</span>
        <button
          class="quiet small"
          @click="policy.kind === 'choice'
            ? actions.delegateChoice(policy.event, null)
            : actions.delegateRecord(policy.event, null)"
        >
          {{ local('Ask me again', 'Let me decide next time') }}
        </button>
      </div>
    </div>

    <div v-bind="tableTargetAttrs('greatWork')" class="panel">
      <h3 class="label">{{ local('The Great Work', 'Major rites') }}</h3>
      <p class="small dim">{{ local('The house can call a rite when its people can field it. Each call opens the authored choice and its cost.', 'You can begin a rite when enough eligible family members are available. You will see the choices and costs before proceeding.') }}</p>
      <div class="row">
        <button :disabled="!table.vesselRite.ready" @click="assemble('vesselRite')">{{ local('Call the Vessel', 'Begin the Vessel rite') }}</button>
        <span v-if="!table.vesselRite.ready" class="small rubric">{{ table.vesselRite.reason }}</span>
      </div>
      <div class="row">
        <button :disabled="!table.greatRite.ready" @click="assemble('greatRite')">{{ local('Call the Great Rite', 'Begin the Great Rite') }}</button>
        <span v-if="!table.greatRite.ready" class="small rubric">{{ table.greatRite.reason }}</span>
      </div>
      <p class="small dim">{{ local("A two-rite elder can be unmade for an adult blood descendant. The elder is spent; the final working still needs the living family's eight affinities and the descendant's own strength.", "An elder who has completed two rites can be sacrificed for an adult blood descendant. This uses up the elder. The final rite still requires all eight affinities among living family members and enough strength in the descendant.") }}</p>
      <button :disabled="!table.unmaking.ready" @click="assemble('unmaking')">{{ local('Call the family to the Unmaking', 'Begin the Unmaking rite') }}</button>
      <p v-if="!table.unmaking.ready" class="small rubric">{{ table.unmaking.reason }}</p>

      <!-- The confirmation itself is presentation-only; the button below is the old order verb. -->
      <section v-if="pendingRite && riteAssembly" class="rite-assembly" :aria-label="local('Rite assembly', 'Review the rite')">
        <h4 class="label">{{ riteAssembly.title }} — {{ local('before the house commits', 'review before confirming') }}</h4>
        <p v-for="actor in riteAssembly.actors" :key="actor.slot" class="small">
          <strong>{{ actor.slot }}</strong> — {{ actor.name }}
        </p>
        <div v-for="risk in riteAssembly.atRisk" :key="risk.slot" class="small">
          <strong>{{ risk.slot }}</strong> — {{ local('choose on the docket from', 'choose from these candidates when prompted:') }}
          {{ risk.candidates.map((candidate) => candidate.name).join(', ') }}.
          <!-- Who would be spent, as the house remembers them (#1867 §6). -->
          <ul class="remembered">
            <li v-for="candidate in risk.candidates" :key="candidate.person" class="dim">
              {{ candidate.remembered }}
              <details v-if="milestones" class="candidate-life">
                <summary>{{ local(`Read the life the book gives ${candidate.name}`, `Read ${candidate.name}'s recorded history`) }}</summary>
                <RecordedLife :person="candidate.person" :read="milestones" :prose-mode="proseMode" @book="$emit('book', $event)" />
              </details>
            </li>
          </ul>
        </div>
        <p v-for="line in riteAssembly.preparations" :key="line" class="small dim">{{ line }}</p>
        <p v-for="line in riteAssembly.irreversible" :key="line" class="small rubric">{{ line }}</p>
        <p class="small dim">{{ local('This page names only facts already visible to the house. It does not reveal the outcome or its odds.', 'This summary only shows information you already know. It does not reveal what will happen or how likely each outcome is.') }}</p>
        <div class="row">
          <button class="primary" @click="confirmRite">{{ local('Put this rite before the house', 'Confirm and begin the rite') }}</button>
          <button class="quiet" @click="cancelRite">{{ local('Not yet', 'Cancel') }}</button>
        </div>
      </section>
      <p v-if="refusedIn('vesselRite')" class="small rubric">{{ refusedIn('vesselRite') }}</p>
      <p v-if="refusedIn('greatRite')" class="small rubric">{{ refusedIn('greatRite') }}</p>
      <p v-if="refusedIn('unmaking')" class="small rubric">{{ refusedIn('unmaking') }}</p>
      <div class="ledger-search">
        <p class="small dim">
          {{ local('Once the Unmaking has raised a Demigod, the house may pay its record-keepers to search the old contracts for a clause the chronicle has not yet recovered.', 'After the Unmaking creates a Demigod, you can pay record-keepers to search old contracts for a missing Chronicle clause.') }}
        </p>
        <button
          :disabled="!table.ledgerSearch.ready"
          @click="actions.order({ kind: 'seekClause' })"
        >
          {{ local('Search the old papers', 'Search old records') }} — {{ table.ledgerSearch.fee }} crowns
        </button>
        <p v-if="!table.ledgerSearch.ready" class="small rubric">{{ table.ledgerSearch.reason }}</p>
        <p v-if="refusedIn('seekClause')" class="small rubric">{{ refusedIn('seekClause') }}</p>
      </div>
    </div>

    <!-- THE LAND (issue #91, Phase B — #94). §13's third leg, generational by
         construction: a farm sold in 1204 is income four generations do not
         have. On the same screen as the shelf and the tutor's fee, under the
         same treasury above — a land panel with its own budget would have
         failed the whole point of building this. -->
    <div v-bind="tableTargetAttrs('land')" class="panel" :class="{ idle: idle('land', land.market.length > 0) }">
      <h3 class="label row">
        <button class="fold" :aria-expanded="!idle('land', land.market.length > 0)" @click="togglePanel('land')">{{ local('The land', 'Land holdings') }}</button>
        <button class="quiet small plat-link" @click="emit('open-plat')">{{ local('See the plat', 'View land map') }}</button>
      </h3>
      <p v-if="!land.market.length" class="small dim">{{ local('Nothing is on the market this year.', 'No land is available to buy this year.') }}</p>
      <div v-for="lot in land.market" :key="lot.parcel" class="line">
        <div class="small">
          <strong>{{ lot.name }}</strong>
          <span class="dim"> · {{ lot.place }} · {{ lot.price }} crowns · gone by {{ lot.closesYear }}</span>
        </div>
        <div class="small dim blurb">
          {{ lot.reason === 'neighbour_short' ? local('A neighbour is short before Michaelmas.', 'A neighbour needs money before Michaelmas.') : local('Offered at the Bramme fair.', 'For sale at the Bramme fair.') }}
        </div>
        <div class="row">
          <button :disabled="!lot.canBuy" @click="actions.order({ kind: 'buy', parcel: lot.parcel })">
            {{ local('Buy it', 'Buy this land') }}
          </button>
          <span v-if="!lot.canBuy" class="small rubric">{{ local('the house cannot raise', 'The family cannot afford') }} {{ lot.price }}</span>
        </div>
      </div>
      <p v-if="refusedIn('buy')" class="small rubric">{{ refusedIn('buy') }}</p>

      <div class="wrap">
        <span class="small dim">{{ local('Rents:', 'Rent policy:') }}</span>
        <button
          v-for="policy in (['customary', 'hard', 'rack'] as const)"
          :key="policy"
          class="small"
          :class="{ held: land.rentsPolicy === policy }"
          :aria-pressed="land.rentsPolicy === policy"
          @click="actions.order({ kind: 'rents', policy })"
        >
          {{ policy === 'rack' ? local('Rack', 'Highest rent') : policy === 'hard' ? local('Hard', 'Higher rent') : local('Customary', 'Usual rent') }}
        </button>
      </div>
      <p v-if="land.rentsPolicy !== 'customary'" class="small rubric">
        {{ land.rentsPolicy === 'rack' ? local('Most now, and longest remembered.', 'Highest rent now, with lasting resentment.') : local('More now, and remembered later.', 'Higher rent now, but tenants will remember it.') }}
      </p>
      <p v-if="refusedIn('rents')" class="small rubric">{{ refusedIn('rents') }}</p>

      <div v-for="p in land.held" :key="p.parcel" class="line">
        <div class="small">
          <strong>{{ p.name }}</strong>
          <span class="dim"> · {{ p.place }} · yield {{ ((p.baseYield + p.yieldBonus) * p.yieldFactor).toFixed(1) }}</span>
        </div>
        <div class="row">
          <button v-if="p.sellable" :disabled="p.improving !== undefined" class="small"
            @click="actions.order({ kind: 'sell', parcel: p.parcel })">
            {{ local('Sell it', 'Sell this land') }} — {{ p.sellPrice }} crowns
          </button>
          <template v-if="p.improving !== undefined">
            <span class="small dim">{{ local('draining until', 'Drainage work until') }} {{ p.improving }}</span>
          </template>
          <button v-else class="small" :disabled="!p.canImprove"
            @click="actions.order({ kind: 'improve', parcel: p.parcel })">
            {{ local('Improve it', 'Improve this land') }} — {{ p.improveCost }} crowns
          </button>
        </div>
      </div>
      <p v-if="refusedIn('sell')" class="small rubric">{{ refusedIn('sell') }}</p>
      <p v-if="refusedIn('improve')" class="small rubric">{{ refusedIn('improve') }}</p>
    </div>

    <HouseholdSecurity :show-empty="showEverything || opened.security" :security="table.security" :prose-mode="proseMode"
      :refusal="refusedIn('covertDefend') || refusedIn('releaseIntruder')" @order="actions.order" />
    <CovertExpeditions :show-empty="showEverything || opened.expeditions" :expeditions="table.expeditions" :prose-mode="proseMode"
      :refusal="refusedIn('covertPrepare') || refusedIn('covertWithdraw')" @order="actions.order" />

    <!-- THE LIBRARY. Books are the ladder: Adept wants three, Hierophant
         eight. Nobody reads one unless somebody is put on it. -->
    <div v-bind="tableTargetAttrs('shelf')" class="panel" :class="{ idle: idle('shelf', table.shelf.length > 0) }">
      <h3 class="label">
        <button class="fold" :aria-expanded="!idle('shelf', table.shelf.length > 0)" @click="togglePanel('shelf')">{{ local('The shelf', 'Family library') }}</button>
      </h3>
      <p v-if="!table.shelf.length" class="small dim">{{ local('The house holds no book anybody can read.', 'The house has no readable books.') }}</p>
      <div v-for="book in table.shelf" :key="book.book" class="line">
        <div class="small"><strong>{{ book.name }}</strong> <span class="dim">· {{ studyYears(book) }} {{ studyYears(book) === 1 ? 'year' : 'years' }} · {{ book.conditionLabel }} ({{ book.condition }}%)</span></div>
        <p v-if="book.restoringUntil !== undefined" class="small dim">{{ local('With the binder until', 'Being repaired until') }} {{ book.restoringUntil }}</p>
        <div v-else-if="book.restore" class="row">
          <button class="small" :disabled="!book.restore.canPay" :aria-label="local('Restore', 'Repair') + ' ' + book.name" @click="actions.order({ kind: 'restore', book: book.book })">
            {{ local('Restore', 'Repair book') }} — {{ book.restore.fee }} crowns, {{ book.restore.years }} {{ book.restore.years === 1 ? 'year' : 'years' }}
          </button>
          <span v-if="book.restore.reason" class="small rubric">{{ book.restore.reason }}</span>
        </div>
        <p v-if="book.blurb" class="small dim blurb">{{ book.blurb }}</p>
        <!-- A SELECT, like Places (issue #55). This was one button per reader
             per book — sixteen on turn one across two books, and it grew with
             the household — while the identical interaction was solved with a
             dropdown two hundred pixels below. -->
        <div class="row">
          <select v-model="reading[book.book]" :disabled="!book.readers.length" :aria-label="local('Choose a reader for', 'Choose who reads') + ' ' + book.name">
            <option value="">
              {{ book.restoringUntil !== undefined ? local('— with the binder —', '— being repaired —') : book.readers.length ? local('— put whom on it —', '— choose reader —') : local('— nobody can take it up —', '— no eligible reader —') }}
            </option>
            <option v-for="r in book.readers" :key="r.person" :value="r.person">{{ r.name }}</option>
          </select>
          <button
            class="small"
            :disabled="!reading[book.book] || !book.readers.length"
            @click="actions.order({ kind: 'study', person: reading[book.book] ?? '', book: book.book })"
          >
            {{ local('Set them reading', 'Start reading') }}
          </button>
        </div>
      </div>
      <p v-if="refusedIn('study')" class="small rubric">{{ refusedIn('study') }}</p>
      <p v-if="refusedIn('restore')" class="small rubric">{{ refusedIn('restore') }}</p>
      <div v-if="table.studying.length" class="small dim reading">
        {{ local('reading now:', 'Currently reading:') }} {{ table.studying.map((s) => s.name + ' until ' + s.completes).join(', ') }}
      </div>
      <div v-if="table.missingPrimers.length" class="reading">
        <p class="small dim">{{ local('Ask a Sarrow broker to bring a missing working to a sale. The search costs 25 crowns now; the book has its own reserve later.', 'Pay a Sarrow broker 25 crowns now to look for a missing spellbook. If one comes to auction, you must also pay its reserve price later.') }}</p>
        <div v-for="book in table.missingPrimers" :key="book.book" class="line">
          <div class="row">
            <span class="small"><strong>{{ book.affinity }}</strong> · {{ book.name }} · {{ book.reserve }} crown reserve in {{ book.saleYear }}</span>
            <button class="small" :disabled="book.queued" @click="actions.order({ kind: 'seekBook', book: book.book })">
              {{ book.queued ? local('Broker sent', 'Broker already requested') : local('Seek this book', 'Ask broker for this book') }}
            </button>
          </div>
          <p v-if="book.blurb" class="small dim blurb">{{ book.blurb }}</p>
        </div>
        <p v-if="refusedIn('seekBook')" class="small rubric">{{ refusedIn('seekBook') }}</p>
      </div>
    </div>

    <!-- MYSTIC DUTIES (#1873). A finished book is a reader who can be set to
         keep something: one hall's sick, one parcel's banks. It is paid for
         every year and asked about never. -->
    <div v-bind="tableTargetAttrs('duties')" class="panel" :class="{ idle: idle('duties', table.mystic.duties.length > 0 || visibleDuties.length > 0) }">
      <h3 class="label">
        <button class="fold" :aria-expanded="!idle('duties', table.mystic.duties.length > 0 || visibleDuties.length > 0)" @click="togglePanel('duties')">{{ local('Standing duties', 'Mystic duties') }}</button>
      </h3>
      <p v-if="!table.mystic.duties.length" class="small dim">{{ local('Nobody keeps a working for the house.', 'No one has a Mystic duty.') }}</p>
      <div v-for="duty in table.mystic.duties" :key="duty.id" class="line">
        <div class="small"><strong>{{ duty.name }}</strong> · {{ duty.workingName }} · {{ duty.place }} <span class="dim">· {{ dutyStatus(duty) }}</span></div>
        <p class="small dim">{{ duty.upkeep }} {{ local('crowns a year', 'crowns per year') }} · {{ dutyRecord(duty) }}</p>
        <p v-if="duty.fieldTerms" class="small dim">{{ duty.fieldTerms }}</p>
        <p v-if="duty.attended?.length" class="small dim">{{ local('Sitting with:', 'Caring for:') }} {{ duty.attended.map((w) => w.name).join(', ') }}</p>
        <p v-if="duty.paused" class="small dim">{{ local('Set down for it:', 'Reading paused:') }} {{ duty.paused.name }}, {{ duty.paused.remainingYears }} {{ duty.paused.remainingYears === 1 ? 'year' : 'years' }} {{ local('left', 'remaining') }}</p>
        <button class="small" :aria-label="local('Release', 'End duty') + ' ' + duty.name" @click="actions.order({ kind: 'mysticRelease', assignment: duty.id })">{{ local('Release', 'End duty') }}</button>
      </div>
      <p v-if="refusedIn('mysticRelease')" class="small rubric">{{ refusedIn('mysticRelease') }}</p>
      <label class="small dim"><input v-model="showUnlearned" type="checkbox"> {{ local('Include workings nobody has read for', 'Show workings without a trained reader') }}</label>
      <div v-for="offer in visibleDuties" :key="offer.working" class="line">
        <div class="small"><strong>{{ offer.name }}</strong> <span class="dim">· {{ offer.affinity }} · {{ offer.preparation }} {{ local('crowns to make ready', 'crowns to prepare') }}<template v-if="offer.preparationYears">, {{ offer.preparationYears }} {{ offer.preparationYears === 1 ? 'year' : 'years' }}</template> · {{ offer.upkeep }} {{ local('a year', 'per year') }}</span></div>
        <p class="small dim blurb">{{ offer.description }}</p>
        <p class="small dim">{{ local('Books read:', 'Required completed books:') }} {{ offer.books.join(', ') }}</p>
        <p v-if="offer.collaborator" class="small dim">{{ local('Works only beside a different paid reader keeping', 'Requires a different available, paid reader doing') }} {{ offer.collaborator }} {{ local('at the same place.', 'at the same location.') }}</p>
        <p v-if="offer.fieldTerms" class="small dim">{{ offer.fieldTerms }}</p>
        <div class="row">
          <select v-model="dutyWho[offer.working]" :disabled="!offer.practitioners.length" :aria-label="local('Choose who keeps', 'Choose who does') + ' ' + offer.name">
            <option value="">{{ offer.practitioners.length ? local('— whom —', '— choose reader —') : offer.known ? local('— the reader is occupied or absent —', '— trained readers are unavailable —') : local('— nobody has read for it —', '— no trained reader —') }}</option>
            <option v-for="r in offer.practitioners" :key="r.person" :value="r.person">{{ r.name }}{{ r.studying ? local(' (sets a book down)', ' (pauses reading)') : '' }}</option>
          </select>
          <select v-model="dutyWhere[offer.working]" :disabled="!offer.targets.length" :aria-label="local('Choose where for', 'Choose the place for') + ' ' + offer.name">
            <option value="">{{ offer.targets.length ? local('— where —', '— choose place —') : local('— nowhere it can reach —', '— no suitable place —') }}</option>
            <option v-for="(t, i) in offer.targets" :key="t.name" :value="String(i)">{{ t.name }}</option>
          </select>
          <button class="small" :disabled="!dutyWho[offer.working] || !dutyWhere[offer.working]" @click="assignDuty(offer)">{{ local('Set them to it', 'Assign') }}</button>
        </div>
      </div>
      <p v-if="refusedIn('mysticAssign')" class="small rubric">{{ refusedIn('mysticAssign') }}</p>
      <details v-if="table.mystic.history.length" class="small">
        <summary>{{ local('Closed service accounts', 'Past service accounts') }}</summary>
        <div v-for="past in table.mystic.history" :key="past.id" class="line"><p>{{ past.account }}</p><p class="dim">{{ dutyRecord(past) }}</p></div>
      </details>
    </div>

    <OutsideServices v-bind="tableTargetAttrs('outsideServices')" :services="table.outsideServices" :actions="actions" :refusal="refusal" :prose-mode="proseMode" />

    <div v-bind="tableTargetAttrs('captives')" class="panel captives" :class="{ idle: idle('captives', (table.captives?.length ?? 0) > 0) }">
      <h3 class="label">
        <button class="fold" :aria-expanded="!idle('captives', (table.captives?.length ?? 0) > 0)" @click="togglePanel('captives')">{{ local('Held away', 'Captive family') }}</button>
      </h3>
      <p v-if="!table.captives?.length" class="small dim">{{ local('Nobody on the house’s account is held for ransom.', 'No family member or contracted reader is held for ransom.') }}</p>
      <div v-for="held in table.captives ?? []" :key="held.person" class="line">
        <div class="small"><strong>{{ held.name }}</strong> · {{ local('held by', 'captive of') }} {{ held.captor }} {{ local('since', 'since the year') }} {{ held.since }}</div>
        <button class="small" :disabled="!held.ok" :aria-label="local('Ransom', 'Pay to free') + ' ' + held.name + ' — ' + held.price + ' crowns'" :aria-describedby="held.reason ? 'ransom-' + held.person : undefined" @click="actions.order({ kind: 'ransom', person: held.person })">{{ local('Bring them home', 'Pay for their release') }} — {{ held.price }} crowns</button>
        <p v-if="held.reason" :id="'ransom-' + held.person" class="small dim">{{ held.reason }}</p>
      </div>
      <p v-if="refusedIn('ransom')" class="small rubric">{{ refusedIn('ransom') }}</p>
    </div>

    <!-- §13's price table. The money is gone the day it is spent, and the
         auction is in eleven years. -->
    <div v-bind="tableTargetAttrs('tutoring')" class="panel">
      <h3 class="label">{{ local('A term of tutoring', 'Tutoring') }}</h3>
      <div class="row">
        <select v-model="pupil" :aria-label="local('Child to tutor', 'Choose a child for tutoring')">
          <option value="">{{ local('— which child —', '— choose child —') }}</option>
          <option v-for="p in table.pupils" :key="p.person" :value="p.person">{{ p.name }}, {{ p.age }}</option>
        </select>
        <select v-model="subject" :aria-label="local('Subject to tutor', 'Choose tutoring subject')">
          <option value="">{{ local('— in what —', '— choose subject —') }}</option>
          <option v-for="t in table.teachable" :key="t.attr" :value="t.attr">{{ t.name }}</option>
        </select>
        <button
          :disabled="!pupil || !subject || !table.canTutor"
          @click="actions.order({ kind: 'tutor', person: pupil, attr: subject })"
        >
          {{ local('Pay the', 'Pay tutoring fee') }} {{ table.tutorFee }}
        </button>
      </div>
      <p v-if="!table.canTutor" class="small rubric">{{ local('The house cannot raise the', 'The house cannot afford the tutoring fee of') }} {{ table.tutorFee }}.</p>
      <p v-if="refusedIn('tutor')" class="small rubric">{{ refusedIn('tutor') }}</p>
      <div v-if="table.tutoring.length" class="small dim">
        {{ local('in a term:', 'Currently being tutored:') }} {{ table.tutoring.map((t) => t.name + ' until ' + t.completes).join(', ') }}
      </div>
    </div>

    <!-- Respect is bought with descendants. A commission is bought with money. -->
    <div v-bind="tableTargetAttrs('posts')" class="panel" :class="{ idle: idle('posts', table.posts.some((p) => p.eligible.length > 0)) }">
      <h3 class="label">
        <button class="fold" :aria-expanded="!idle('posts', table.posts.some((p) => p.eligible.length > 0))" @click="togglePanel('posts')">{{ local('Places', 'Career positions') }}</button>
      </h3>
      <p
        v-if="!table.posts.some((p) => p.eligible.length)"
        class="small dim"
      >{{ local('Nobody of the house is of an age to be placed.', 'No family member is currently eligible for a post.') }}</p>
      <div v-for="post in table.posts" :key="post.career" class="line">
        <div class="small">
          <strong>{{ post.name }}</strong>
          <span class="dim"> · {{ post.fee }} crowns</span>
          <span v-if="post.usualFee" class="rubric"> · {{ local('usually', 'normal price:') }} {{ post.usualFee }}; {{ local('these years make this place cheaper', 'the current discount lowers the cost') }}</span>
          <span class="dim"> · {{ local('standing', 'reputation gained') }} {{ post.respectYield }}</span>
        </div>
        <div v-if="post.blurb" class="small dim blurb">{{ post.blurb }}</div>
        <div v-if="post.holders.length" class="small dim">
          {{ local('held by', 'Current holders:') }} {{ post.holders.map((h) => h.name).join(', ') }}
        </div>
        <div class="row">
          <select v-model="placing[post.career]" :aria-label="(plain ? 'Choose a family member for ' : 'Choose someone for ') + post.name">
            <option value="">{{ local('— place whom —', '— choose a family member —') }}</option>
            <option v-for="e in post.eligible" :key="e.person" :value="e.person">{{ e.name }}, {{ e.age }}</option>
          </select>
          <button
            :disabled="!post.canPay || !placing[post.career]"
            @click="actions.order({ kind: 'career', person: placing[post.career] ?? '', career: post.career })"
          >
            {{ local('Buy it', 'Buy this position') }}
          </button>
          <!-- Priced against the purse, in words. A greyed button says the
               house cannot, and never which of the two reasons it is. -->
          <span v-if="!post.canPay" class="small rubric">{{ local('the house cannot raise', 'Not enough money to pay') }} {{ post.fee }}</span>
        </div>
      </div>
      <p v-if="refusedIn('career')" class="small rubric">{{ refusedIn('career') }}</p>
    </div>

    <!-- ISSUE #41. The Match is one decision a generation; the house makes
         five hundred other marriages in a run, and this is the only thing the
         player can say about them. Neither answer is the safe one. -->
    <div v-bind="tableTargetAttrs('marriages')" class="panel">
      <h3 class="label">{{ local('Who the house marries', 'Marriage preferences') }}</h3>
      <p class="small dim blurb">
        {{ local('When nobody asks you. The blood runs out of a family that marries outward and thins in one that will not.', 'This policy controls routine marriages that you do not choose yourself. Marrying outside the family loses the bloodline; marrying only within the family can weaken it.') }}
      </p>
      <div class="wrap">
        <button
          v-for="option in MARRIAGE_ORDERS"
          :key="option.policy"
          class="small"
          :class="{ held: table.marriagePolicy === option.policy }"
          :aria-pressed="table.marriagePolicy === option.policy"
          @click="actions.order({ kind: 'marriages', policy: option.policy })"
        >
          {{ local(option.label, option.simple) }}
        </button>
      </div>
      <p v-if="refusedIn('marriages')" class="small rubric">{{ refusedIn('marriages') }}</p>
    </div>

    <!-- #201 / #61. The engine has always made this a deliberate household
         programme across generations. Draw the existing orders here rather
         than leaving the ascendant path available only to simulation policy. -->
    <div v-bind="tableTargetAttrs('programme')" class="panel" :class="{ idle: idle('programme', table.programmeCandidates.length > 0 || !!table.scion || !!table.scionHeir || !!table.scionVacant || !!table.scionHeirVacant) }">
      <h3 class="label">
        <button
          class="fold"
          :aria-expanded="!idle('programme', table.programmeCandidates.length > 0 || !!table.scion || !!table.scionHeir || !!table.scionVacant || !!table.scionHeirVacant)"
          @click="togglePanel('programme')"
        >{{ local('The programme', 'Family advancement plan') }}</button>
      </h3>
      <p class="small dim blurb">
        {{ local('Name the one the house will put first in its books, tutoring and marriages, and the one it will build beside him. These places do not pass by themselves.', 'Choose the main candidate for family books, tutoring and marriages, and a second candidate to support him. The positions do not transfer automatically when someone leaves.') }}
      </p>

      <p v-if="table.scionVacant" class="small rubric">
        {{ table.scionVacant.wasName }} {{ local('left the first place in', 'left the first position in') }} {{ table.scionVacant.since }}. {{ local('Nobody stands there now.', 'The position is now vacant.') }}
      </p>
      <p v-if="table.scionHeirVacant" class="small rubric">
        {{ table.scionHeirVacant.wasName }} {{ local('left the second place in', 'left the second position in') }} {{ table.scionHeirVacant.since }}. {{ local('Nobody stands there now.', 'The position is now vacant.') }}
      </p>

      <div class="line">
        <div class="small">
          <strong>{{ local('Scion', 'Main candidate') }}</strong>
          <span class="dim"> · {{ table.scion ? table.scion.name : local('nobody named', 'No one selected') }}</span>
        </div>
        <div class="row">
          <select v-model="scionChoice" :aria-label="local('Choose the Scion', 'Choose main candidate')">
            <option value="">{{ local('— name whom —', '— choose a candidate —') }}</option>
            <option v-for="p in table.programmeCandidates" :key="p.person" :value="p.person">
              {{ p.name }}, {{ p.age }}
            </option>
          </select>
          <button class="small" :disabled="!scionChoice" @click="actions.order({ kind: 'scion', person: scionChoice })">
            {{ local('Name the Scion', 'Set main candidate') }}
          </button>
          <button v-if="table.scion || table.scionVacant" class="small" @click="actions.order({ kind: 'scion', person: null })">
            {{ local('Leave the place empty', 'Clear this position') }}
          </button>
        </div>
        <p v-if="refusedIn('scion')" class="small rubric">{{ refusedIn('scion') }}</p>
      </div>

      <div class="line">
        <div class="small">
          <strong>{{ local('Heir to the programme', 'Supporting candidate') }}</strong>
          <span class="dim"> · {{ table.scionHeir ? table.scionHeir.name : local('nobody named', 'No one selected') }}</span>
        </div>
        <div class="row">
          <select v-model="scionHeirChoice" :aria-label="local('Choose the heir to the programme', 'Choose supporting candidate')">
            <option value="">{{ local('— name whom —', '— choose a candidate —') }}</option>
            <option
              v-for="p in table.programmeCandidates"
              :key="p.person"
              :value="p.person"
              :disabled="p.person === table.scion?.person"
            >
              {{ p.name }}, {{ p.age }}
            </option>
          </select>
          <button class="small" :disabled="!scionHeirChoice || scionHeirChoice === table.scion?.person" @click="actions.order({ kind: 'scionHeir', person: scionHeirChoice })">
            {{ local('Name the heir', 'Set supporting candidate') }}
          </button>
          <button v-if="table.scionHeir || table.scionHeirVacant" class="small" @click="actions.order({ kind: 'scionHeir', person: null })">
            {{ local('Leave the place empty', 'Clear this position') }}
          </button>
        </div>
        <p v-if="refusedIn('scionHeir')" class="small rubric">{{ refusedIn('scionHeir') }}</p>
      </div>
    </div>

    <!-- §7: every daughter married outward is power leaving the blood forever,
         and there was no way to decline to spend her. -->
    <div v-bind="tableTargetAttrs('market')" class="panel" :class="{ idle: idle('market', table.market.length > 0) }">
      <h3 class="label">
        <button class="fold" :aria-expanded="!idle('market', table.market.length > 0)" @click="togglePanel('market')">{{ local('The market', 'Marriage market') }}</button>
      </h3>
      <p v-if="!table.market.length" class="small dim">
        {{ local('Nobody of the house is of an age to be spent this year.', 'No family member is eligible for the marriage market this year.') }}
      </p>
      <div class="wrap">
        <button
          v-for="p in table.market"
          :key="p.person"
          class="small"
          :class="{ held: p.held }"
          :aria-pressed="p.held"
          @click="actions.order({ kind: 'withhold', person: p.person, hold: !p.held })"
        >
          {{ p.name }}, {{ p.age }} — {{ p.held ? local('kept back', 'withheld from marriage') : local('on the market', 'available for marriage') }}
        </button>
      </div>
      <p v-if="refusedIn('withhold')" class="small rubric">{{ refusedIn('withhold') }}</p>
    </div>

    <!-- §11, THE LONG WAIT (#1794): "At some point the Head must declare them
         mundane and put them to use — freeing the succession, risking
         disaster." The panel never says whether the blood is in him; the house
         does not know, and that is the decision. -->
    <div v-bind="tableTargetAttrs('longWait')" class="panel" :class="{ idle: idle('longWait', mundaneMatters) }">
      <h3 class="label">
        <button class="fold" :aria-expanded="!idle('longWait', mundaneMatters)" @click="togglePanel('longWait')">{{ local('The long wait', 'Men who have not awakened') }}</button>
      </h3>
      <p v-if="!table.longWait.length" class="small dim">
        {{ local('Nobody of the line is old enough to be given up on.', 'No adult man of the family is waiting to awaken.') }}
      </p>
      <p v-else class="small dim blurb">
        {{ local(
          'Grown men of the line who have never woken. Stop waiting for one and he never will: the seal passes over him to a brother, a cousin, or a Regent, and he is free to be placed, married or sent.',
          'These adult men of the family have never awakened. If you declare one mundane, he can never awaken. He is skipped in the succession, so the seal goes to a brother, a cousin or a Regent instead. He can still be given a post, married or sent away.',
        ) }}
      </p>
      <div v-if="pendingMundane" class="line" role="group" :aria-label="local('Confirm the declaration', 'Confirm declaring this man mundane')">
        <p class="small">
          <strong>{{ pendingMundane.name }}</strong>
          {{ local('— the house stops waiting. This cannot be taken back.', '— declare him mundane. This cannot be undone.') }}
        </p>
        <div class="row">
          <button class="primary small" @click="confirmMundane">{{ local('Stop waiting for him', 'Confirm: declare him mundane') }}</button>
          <button class="small" @click="pendingMundane = null">{{ local('Keep waiting', 'Cancel') }}</button>
        </div>
      </div>
      <div v-else class="wrap">
        <button
          v-for="p in table.longWait"
          :key="p.person"
          class="small"
          :aria-label="local(
            `Stop waiting for ${p.name}, ${p.age} years old${p.inLine ? ', who stands before the seal' : ''}`,
            `Declare ${p.name}, ${p.age} years old,${p.inLine ? ' a possible heir,' : ''} mundane`,
          )"
          @click="pendingMundane = { person: p.person, name: p.name }"
        >
          {{ p.name }}, {{ p.age }}<span v-if="p.inLine" class="rubric"> · {{ local('stands before the seal', 'possible heir') }}</span>
        </button>
      </div>
      <p v-if="refusedIn('declareMundane')" class="small rubric">{{ refusedIn('declareMundane') }}</p>
    </div>

    <!-- §11, FORCING (#1817): "The family has rites to force an awakening —
         dangerous, sometimes lethal." Any boy of the line in the window may be
         put through one, once. The panel never says whether the blood is in
         him: the house finds out the way it always has, by trying. -->
    <div v-bind="tableTargetAttrs('forcing')" v-if="forcingRites.length || opened.forcing || showEverything" class="panel" :class="{ idle: idle('forcing', forcingMatters) }">
      <h3 class="label">
        <button class="fold" :aria-expanded="!idle('forcing', forcingMatters)" @click="togglePanel('forcing')">{{ local('The forcing rites', 'Rites to force an awakening') }}</button>
      </h3>
      <p class="small dim blurb">
        {{ local(
          'The old books give ways to force a waking out of a boy who has not woken. Each is dangerous, and some of them kill. A boy is put through one, once, and the book does not say who it will answer in.',
          'These rites try to force an unawakened boy of the family to awaken. They are dangerous and can kill him. Each boy can go through only one, once. There is no way to know beforehand whether it can work on him.',
        ) }}
      </p>
      <p v-if="!forcingRites.length" class="small dim">{{ local('No forcing rites are offered at present.', 'No rites to force an awakening are currently offered.') }}</p>
      <div v-if="pendingForcing" class="line" role="group" :aria-label="local('Confirm the rite', 'Confirm starting this rite')">
        <p class="small">
          <strong>{{ pendingForcing.title }}</strong> — <strong>{{ pendingForcing.name }}</strong>
          {{ local('— the rite goes before the house. He will not be offered another.', '— the rite will start. He cannot go through another one.') }}
        </p>
        <div class="row">
          <button class="primary small" @click="confirmForcing">{{ local('Put him through it', 'Confirm: start the rite') }}</button>
          <button class="small" @click="pendingForcing = null">{{ local('Not him', 'Cancel') }}</button>
        </div>
      </div>
      <template v-else>
      <div v-for="rite in forcingRites" :key="rite.rite" class="line">
        <p class="small">
          <strong>{{ rite.title }}</strong>
          <span v-if="rite.to !== undefined" class="dim"> · {{ local('for a boy of', 'ages') }} {{ rite.from ?? 0 }}–{{ rite.to }}</span>
        </p>
        <p v-if="!rite.ready" class="small dim">{{ rite.reason }}</p>
        <div v-else class="wrap">
          <button
            v-for="b in rite.boys"
            :key="b.person"
            class="small"
            :aria-label="local(`Put ${b.name}, ${b.age} years old, through ${rite.title}`, `Start ${rite.title} for ${b.name}, age ${b.age}`)"
            @click="pendingForcing = { rite: rite.rite, title: rite.title, person: b.person, name: b.name }"
          >
            {{ b.name }}, {{ b.age }}
          </button>
        </div>
      </div>
      </template>
      <p v-if="refusedIn('forcingRite')" class="small rubric">{{ refusedIn('forcingRite') }}</p>
    </div>

    <!-- §7: "A dowry is not money. Great houses negotiate in lineage
         documentation... Forging them is an industry." A house with a thin
         record learns it by being refused a card, and this is where it can do
         something about that before the refusal rather than after. -->
    <div v-bind="tableTargetAttrs('papers')" class="panel" :class="{ idle: idle('papers', table.papers.length > 0) }">
      <h3 class="label">
        <button class="fold" :aria-expanded="!idle('papers', table.papers.length > 0)" @click="togglePanel('papers')">{{ local('The papers', 'Marriage papers') }}</button>
      </h3>
      <p v-if="!table.papers.length" class="small dim">{{ local('Nobody of the house has a match to make.', 'No family member needs marriage papers right now.') }}</p>
      <p class="small dim blurb">
        {{ local('Three generations of maternal record, notarised. What a great house asks for before it will open the conversation, and what a young house has not got.', 'Great houses require notarised records for three generations through the mother before considering a marriage. A younger house may not have those records.') }}
      </p>
      <div v-for="row in table.papers" :key="row.person" class="line">
        <div class="small">
          <strong>{{ row.name }}</strong>
          <span class="dim"> · {{ local('the record shows', 'recorded generations:') }} {{ row.shows }} {{ local('of 3', 'out of 3') }}</span>
          <span v-if="row.forged" class="dim"> · {{ row.forged }} {{ local('bought', 'purchased generations') }}</span>
          <span v-if="row.exposed" class="rubric"> · {{ row.exposed }} {{ local('questioned', 'disputed generations') }}</span>
        </div>
        <div class="row">
          <button
            v-for="g in table.pedigreePrices"
            :key="g.grade"
            class="small"
            :disabled="!g.canPay || row.shows >= g.covers"
            @click="actions.order({ kind: 'pedigree', person: row.person, grade: g.grade })"
          >
            {{ g.grade === 'caster' ? 'Caster' : 'Bramme' }} — {{ g.price }} crowns, {{ g.covers }} generations
          </button>
        </div>
        <div v-if="table.pedigreePrices.some((g) => !g.canPay)" class="small rubric">
          {{ local('the house cannot raise', 'The family cannot afford') }}
          {{ table.pedigreePrices.filter((g) => !g.canPay).map((g) => g.price).join(' or ') }}
        </div>
      </div>
      <p v-if="refusedIn('pedigree')" class="small rubric">{{ refusedIn('pedigree') }}</p>
    </div>

    <!-- WORLD §12. "Nobody in this world is a slave and there is no serfdom in
         Aubren. People are held by debt, custom, contract and having nowhere
         else to go, which is sufficient." Both halves of that are decisions. -->
    <div v-bind="tableTargetAttrs('servants')" class="panel" :class="{ idle: idle('servants', table.servants.length > 0) }">
      <h3 class="label">
        <button class="fold" :aria-expanded="!idle('servants', table.servants.length > 0)" @click="togglePanel('servants')">{{ local("The house's people", 'Servants and debt contracts') }}</button>
      </h3>
      <p v-if="!table.servants.length" class="small dim">{{ local("Nobody is in the house's service.", 'The house has no servants.') }}</p>
      <div v-for="s in table.servants" :key="s.person" class="line">
        <div class="small">
          <strong>{{ s.name }}</strong>
          <span class="dim"> · {{ s.role }} · {{ s.wage }} marks</span>
          <span v-if="s.bonded" class="rubric"> · {{ local('owes', 'debt:') }} {{ s.debt }}</span>
          <span class="dim"> · {{ local('they think of you', 'loyalty:') }} {{ s.loyalty }}</span>
        </div>
        <div class="row">
          <input
            v-if="!s.bonded"
            type="number" min="1" step="1" :max="table.maxBond"
            v-model.number="advancing[s.person]"
            :placeholder="plain ? 'Enter 1 to ' + table.maxBond + ' marks' : 'marks, up to ' + table.maxBond"
            :aria-label="(plain ? 'Debt advance in marks for ' : 'Marks to advance to ') + s.name"
            :aria-invalid="advancing[s.person] !== undefined && !validAdvance(advancing[s.person])"
            :aria-describedby="advancing[s.person] !== undefined && !validAdvance(advancing[s.person]) ? 'bond-marks-error-' + s.person : undefined"
          />
          <button
            v-if="!s.bonded"
            class="small"
            :disabled="!validAdvance(advancing[s.person])"
            @click="advance(s.person)"
          >
            {{ local('Advance it against the years', 'Give a debt advance') }}
          </button>
          <p
            v-if="!s.bonded && advancing[s.person] !== undefined && !validAdvance(advancing[s.person])"
            :id="'bond-marks-error-' + s.person"
            class="small rubric"
            role="alert"
          >
            {{ local('Enter a whole number of marks from 1 to', 'Enter a whole-number advance between 1 and') }} {{ table.maxBond }}{{ plain ? ' marks.' : '.' }}
          </p>
          <button
            v-if="s.bonded"
            class="small"
            @click="sendBondOrder({ kind: 'bond', person: s.person, op: 'free' })"
          >
            {{ local('Tear it up', 'Cancel debt bond') }}
          </button>
        </div>
      </div>
      <p v-if="refusedIn('bond')" class="small rubric">{{ refusedIn('bond') }}</p>
      <p v-if="table.servants.some((s) => s.bonded)" class="small dim blurb">
        {{ local('A bond costs nothing in wages and cannot be ended by a bad year. Nobody whose debt is standing is ever glad of it, and everybody still held remembers who was let off.', 'A debt bond requires no wages and continues through bad years. People held by debt resent it, and those still held notice when someone else is released.') }}
      </p>
    </div>
  </section>
</template>

<style scoped>
.candidate-life summary { min-height: 44px; padding: 8px 0; cursor: pointer; }
.table-tasks { border-bottom: 1px solid var(--rule); padding-bottom: 12px; min-width: 0; }
.table-tasks h3 { margin: 0; }
.table-tasks details { border-top: 1px solid var(--rule); }
.table-tasks summary { min-height: 44px; align-content: center; cursor: pointer; overflow-wrap: anywhere; }
.return-goal { min-height: 44px; }
/* Ink, not rubric. A spend the house chose is not an error. */
.spent { color: var(--ink); }
.line { padding: 6px 0; border-top: 1px solid var(--rule); }
.line:first-of-type { border-top: 0; }
.line .blurb { margin: 2px 0 4px; }
.reading { margin-top: 6px; }

/* A PANEL WITH NOTHING TO OFFER (issue #55). Folded, not hidden: the heading
   and the one line saying it is empty both stay, because "this panel exists
   and has nothing in it" is a different fact from "this panel is not here".
   The table was a 2,300px scroll with §13's two halves 900px apart. */
.panel.idle > :not(.label):not(.small) { display: none; }
.panel.idle .line, .panel.idle .row, .panel.idle .wrap { display: none; }
.panel.idle .label { opacity: .7; }
.fold {
  background: none; border: 0; padding: 0; font: inherit;
  letter-spacing: inherit; text-transform: inherit; color: inherit; cursor: pointer;
}
.fold:hover { color: var(--ink); background: none; }
.plat-link { margin-left: auto; }
button.held { border-color: var(--rubric); color: var(--rubric); }
input[type='number'] { width: 8ch; }
</style>
