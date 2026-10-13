<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import type { LandView, TableView } from '@ed/core';
import type { ProseMode } from '@ed/schema';
import type { GameActions } from '../lib/game';

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
const emit = defineEmits<{ 'open-plat': [] }>();

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
 * house's own offer on each — crowns, or an heirloom traded for it. The
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

function advance(person: string): void {
  const marks = advancing.value[person];
  if (!validAdvance(marks)) return;
  props.actions.order({ kind: 'bond', person, op: 'bind', marks });
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
const shut = ref<Record<string, boolean>>({});
function idle(panel: string, hasWork: boolean): boolean {
  return !hasWork && !shut.value[panel];
}

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
  <section class="table stack" aria-label="The house's standing orders">
    <div class="panel">
      <h3 class="label">The purse</h3>
      <p class="small">
        {{ table.treasury }} {{ local('crowns. A term of tutoring is', 'crowns available. A tutoring term costs') }} {{ table.tutorFee }}.
      </p>

      <!-- WARDSHIP (issue #1206). The engine has taken the land income away
           for as long as this stands and offered the customary buy-back since
           #91, and no client drew either: the purse shrank for sixteen years
           with nothing on the screen to say why, or what could be done. -->
      <section v-if="table.wardship" class="wardship" aria-label="Wardship">
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
          @click="actions.order({ kind: 'buyBackWardship' })"
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
        <template v-else>{{ local('The house has not said what it will spend, so it will not bid.', 'No maximum bid has been set. The house will not bid at the auction.') }}</template>
      </p>
      <p v-if="table.auction" class="small dim">
        {{ local('A sale in', 'Next auction:') }} {{ table.auction.year }} — {{ table.auction.lots }}
        {{ table.auction.lots === 1 ? 'lot' : 'lots' }}, the cheapest reserved at
        {{ table.auction.lowestReserve }}.
      </p>
      <p v-else class="small dim">{{ local('Nothing has been announced.', 'No auction has been announced yet.') }}</p>

      <div v-for="lot in table.auction?.items ?? []" :key="lot.id" class="line lot">
        <div class="small">
          <strong>{{ lot.name }}</strong>
          <span class="dim"> · {{ lot.seller }} · sold in {{ lot.saleYear }} · reserved at {{ lot.reserve }}</span>
        </div>
        <p v-if="lot.kind === 'chronicle_page'" class="small rubric blurb">
          {{ local('Whoever buys this page reads it. If a rival buys it, what it proves is proven.', 'The buyer can read this Chronicle page. A rival who buys it can use its evidence to prove a claim.') }}
        </p>
        <p v-if="lot.bid" class="small dim">
          {{ local('The house has bid', 'Current bid:') }}
          {{ lot.bid.currency === 'coin' ? `${lot.bid.amount} crowns` : lot.bid.name }} {{ local('for it.', 'for this lot.') }}
        </p>
        <div class="row">
          <input
            type="number" min="1" step="1" v-model.number="lotCoin[lot.id]"
            :aria-label="`Bid in crowns for ${lot.name}`"
          />
          <button :disabled="!validLotCoin(lotCoin[lot.id])" @click="bidCoin(lot.id)">Bid crowns</button>
          <template v-if="table.auction?.heirlooms.length">
            <select v-model="lotHeirloom[lot.id]" :aria-label="`Heirloom to trade for ${lot.name}`">
              <option value="">an heirloom…</option>
              <option v-for="h in table.auction.heirlooms" :key="h.id" :value="h.id">{{ h.name }}</option>
            </select>
            <button :disabled="!lotHeirloom[lot.id]" @click="bidHeirloom(lot.id)">Trade it</button>
          </template>
          <button
            v-if="lot.bid" class="quiet small"
            @click="submitAuctionOrder({ kind: 'lotBid', lot: lot.id, bid: null })"
          >
            Withdraw
          </button>
        </div>
      </div>
      <p v-if="refusedIn('lotBid')" class="small rubric">{{ refusedIn('lotBid') }}</p>

      <div class="row">
        <input
          type="number" min="0" step="1" v-model.number="ceiling"
          aria-label="Maximum auction bid in crowns"
          :aria-invalid="!validCeiling(ceiling)"
          :aria-describedby="!validCeiling(ceiling) ? 'bid-ceiling-error' : undefined"
        />
        <button :disabled="!validCeiling(ceiling)" @click="setBidCeiling">Set the ceiling</button>
      </div>
      <p v-if="!validCeiling(ceiling)" id="bid-ceiling-error" class="small rubric" role="alert">
        Enter zero or a whole number of crowns within the safe counting range.
      </p>
      <p v-if="refusedIn('bid')" class="small rubric">{{ refusedIn('bid') }}</p>
      <!-- THE RECEIPT (issue #59). §13 means these to hurt — the money is gone
           the day it is spent and the auction is in eleven years — and a spend
           the player cannot feel landing does not hurt, it only makes the
           number smaller for reasons they reconstruct later, wrongly. -->
      <p v-else-if="receipt" class="small spent">{{ receipt }}</p>
    </div>

    <div v-if="table.delegation.length" class="panel">
      <h3 class="label">{{ local('Standing preferences', 'Saved decisions') }}</h3>
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

    <div class="panel">
      <h3 class="label">The Great Work</h3>
      <p class="small dim">{{ local('The house can call a rite when its people can field it. Each call opens the authored choice and its cost.', 'You can begin a rite when enough eligible family members are available. You will see the choices and costs before proceeding.') }}</p>
      <div class="row">
        <button :disabled="!table.vesselRite.ready" @click="assemble('vesselRite')">Call the Vessel</button>
        <span v-if="!table.vesselRite.ready" class="small rubric">{{ table.vesselRite.reason }}</span>
      </div>
      <div class="row">
        <button :disabled="!table.greatRite.ready" @click="assemble('greatRite')">Call the Great Rite</button>
        <span v-if="!table.greatRite.ready" class="small rubric">{{ table.greatRite.reason }}</span>
      </div>
      <p class="small dim">{{ local("A two-rite elder can be unmade for an adult blood descendant. The elder is spent; the final working still needs the living family's eight affinities and the descendant's own strength.", "An elder who has completed two rites can be sacrificed for an adult blood descendant. This uses up the elder. The final rite still requires all eight affinities among living family members and enough strength in the descendant.") }}</p>
      <button :disabled="!table.unmaking.ready" @click="assemble('unmaking')">Call the family to the Unmaking</button>
      <p v-if="!table.unmaking.ready" class="small rubric">{{ table.unmaking.reason }}</p>

      <!-- The confirmation itself is presentation-only; the button below is the old order verb. -->
      <section v-if="pendingRite && riteAssembly" class="rite-assembly" aria-label="Rite assembly">
        <h4 class="label">{{ riteAssembly.title }} — {{ local('before the house commits', 'review before confirming') }}</h4>
        <p v-for="actor in riteAssembly.actors" :key="actor.slot" class="small">
          <strong>{{ actor.slot }}</strong> — {{ actor.name }}
        </p>
        <div v-for="risk in riteAssembly.atRisk" :key="risk.slot" class="small">
          <strong>{{ risk.slot }}</strong> — {{ local('choose on the docket from', 'choose from these candidates when prompted:') }}
          {{ risk.candidates.map((candidate) => candidate.name).join(', ') }}.
        </div>
        <p v-for="line in riteAssembly.preparations" :key="line" class="small dim">{{ line }}</p>
        <p v-for="line in riteAssembly.irreversible" :key="line" class="small rubric">{{ line }}</p>
        <p class="small dim">{{ local('This page names only facts already visible to the house. It does not reveal the outcome or its odds.', 'This summary only shows information you already know. It does not reveal what will happen or how likely each outcome is.') }}</p>
        <div class="row">
          <button class="primary" @click="confirmRite">{{ local('Put this rite before the house', 'Confirm and begin the rite') }}</button>
          <button class="quiet" @click="cancelRite">Not yet</button>
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
          Search the old papers — {{ table.ledgerSearch.fee }} crowns
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
    <div class="panel" :class="{ idle: idle('land', land.market.length > 0) }">
      <h3 class="label row">
        <button class="fold" :aria-expanded="!idle('land', land.market.length > 0)" @click="shut['land'] = !shut['land']">The land</button>
        <button class="quiet small plat-link" @click="emit('open-plat')">See the plat</button>
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
            Buy it
          </button>
          <span v-if="!lot.canBuy" class="small rubric">the house cannot raise {{ lot.price }}</span>
        </div>
      </div>
      <p v-if="refusedIn('buy')" class="small rubric">{{ refusedIn('buy') }}</p>

      <div class="wrap">
        <span class="small dim">Rents:</span>
        <button
          v-for="policy in (['customary', 'hard', 'rack'] as const)"
          :key="policy"
          class="small"
          :class="{ held: land.rentsPolicy === policy }"
          :aria-pressed="land.rentsPolicy === policy"
          @click="actions.order({ kind: 'rents', policy })"
        >
          {{ policy === 'rack' ? 'Rack' : policy === 'hard' ? 'Hard' : 'Customary' }}
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
            Sell it — {{ p.sellPrice }} crowns
          </button>
          <template v-if="p.improving !== undefined">
            <span class="small dim">draining until {{ p.improving }}</span>
          </template>
          <button v-else class="small" :disabled="!p.canImprove"
            @click="actions.order({ kind: 'improve', parcel: p.parcel })">
            Improve it — {{ p.improveCost }} crowns
          </button>
        </div>
      </div>
      <p v-if="refusedIn('sell')" class="small rubric">{{ refusedIn('sell') }}</p>
      <p v-if="refusedIn('improve')" class="small rubric">{{ refusedIn('improve') }}</p>
    </div>

    <!-- THE LIBRARY. Books are the ladder: Adept wants three, Hierophant
         eight. Nobody reads one unless somebody is put on it. -->
    <div class="panel" :class="{ idle: idle('shelf', table.shelf.length > 0) }">
      <h3 class="label">
        <button class="fold" :aria-expanded="!idle('shelf', table.shelf.length > 0)" @click="shut['shelf'] = !shut['shelf']">The shelf</button>
      </h3>
      <p v-if="!table.shelf.length" class="small dim">{{ local('The house holds no book anybody can read.', 'The house has no readable books.') }}</p>
      <div v-for="book in table.shelf" :key="book.book" class="line">
        <div class="small"><strong>{{ book.name }}</strong> <span class="dim">· {{ studyYears(book) }} {{ studyYears(book) === 1 ? 'year' : 'years' }} · {{ book.conditionLabel }} ({{ book.condition }}%)</span></div>
        <p v-if="book.restoringUntil !== undefined" class="small dim">{{ local('With the binder until', 'Being repaired until') }} {{ book.restoringUntil }}</p>
        <div v-else-if="book.restore" class="row">
          <button class="small" :disabled="!book.restore.canPay" :aria-label="'Restore ' + book.name" @click="actions.order({ kind: 'restore', book: book.book })">
            Restore — {{ book.restore.fee }} crowns, {{ book.restore.years }} {{ book.restore.years === 1 ? 'year' : 'years' }}
          </button>
          <span v-if="book.restore.reason" class="small rubric">{{ book.restore.reason }}</span>
        </div>
        <p v-if="book.blurb" class="small dim blurb">{{ book.blurb }}</p>
        <!-- A SELECT, like Places (issue #55). This was one button per reader
             per book — sixteen on turn one across two books, and it grew with
             the household — while the identical interaction was solved with a
             dropdown two hundred pixels below. -->
        <div class="row">
          <select v-model="reading[book.book]" :disabled="!book.readers.length" :aria-label="'Choose a reader for ' + book.name">
            <option value="">
              {{ book.restoringUntil !== undefined ? '— with the binder —' : book.readers.length ? '— put whom on it —' : '— nobody can take it up —' }}
            </option>
            <option v-for="r in book.readers" :key="r.person" :value="r.person">{{ r.name }}</option>
          </select>
          <button
            class="small"
            :disabled="!reading[book.book] || !book.readers.length"
            @click="actions.order({ kind: 'study', person: reading[book.book] ?? '', book: book.book })"
          >
            Set them reading
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
              {{ book.queued ? 'Broker sent' : 'Seek this book' }}
            </button>
          </div>
          <p v-if="book.blurb" class="small dim blurb">{{ book.blurb }}</p>
        </div>
        <p v-if="refusedIn('seekBook')" class="small rubric">{{ refusedIn('seekBook') }}</p>
      </div>
    </div>

    <!-- §13's price table. The money is gone the day it is spent, and the
         auction is in eleven years. -->
    <div class="panel">
      <h3 class="label">A term of tutoring</h3>
      <div class="row">
        <select v-model="pupil" aria-label="Child to tutor">
          <option value="">— which child —</option>
          <option v-for="p in table.pupils" :key="p.person" :value="p.person">{{ p.name }}, {{ p.age }}</option>
        </select>
        <select v-model="subject" aria-label="Subject to tutor">
          <option value="">— in what —</option>
          <option v-for="t in table.teachable" :key="t.attr" :value="t.attr">{{ t.name }}</option>
        </select>
        <button
          :disabled="!pupil || !subject || !table.canTutor"
          @click="actions.order({ kind: 'tutor', person: pupil, attr: subject })"
        >
          Pay the {{ table.tutorFee }}
        </button>
      </div>
      <p v-if="!table.canTutor" class="small rubric">{{ local('The house cannot raise the', 'The house cannot afford the tutoring fee of') }} {{ table.tutorFee }}.</p>
      <p v-if="refusedIn('tutor')" class="small rubric">{{ refusedIn('tutor') }}</p>
      <div v-if="table.tutoring.length" class="small dim">
        {{ local('in a term:', 'Currently being tutored:') }} {{ table.tutoring.map((t) => t.name + ' until ' + t.completes).join(', ') }}
      </div>
    </div>

    <!-- Respect is bought with descendants. A commission is bought with money. -->
    <div class="panel" :class="{ idle: idle('posts', table.posts.some((p) => p.eligible.length > 0)) }">
      <h3 class="label">
        <button class="fold" :aria-expanded="!idle('posts', table.posts.some((p) => p.eligible.length > 0))" @click="shut['posts'] = !shut['posts']">Places</button>
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
          <span class="dim"> · standing {{ post.respectYield }}</span>
        </div>
        <div v-if="post.blurb" class="small dim blurb">{{ post.blurb }}</div>
        <div v-if="post.holders.length" class="small dim">
          {{ local('held by', 'Current holders:') }} {{ post.holders.map((h) => h.name).join(', ') }}
        </div>
        <div class="row">
          <select v-model="placing[post.career]" :aria-label="'Choose someone for ' + post.name">
            <option value="">— place whom —</option>
            <option v-for="e in post.eligible" :key="e.person" :value="e.person">{{ e.name }}, {{ e.age }}</option>
          </select>
          <button
            :disabled="!post.canPay || !placing[post.career]"
            @click="actions.order({ kind: 'career', person: placing[post.career] ?? '', career: post.career })"
          >
            Buy it
          </button>
          <!-- Priced against the purse, in words. A greyed button says the
               house cannot, and never which of the two reasons it is. -->
          <span v-if="!post.canPay" class="small rubric">the house cannot raise {{ post.fee }}</span>
        </div>
      </div>
      <p v-if="refusedIn('career')" class="small rubric">{{ refusedIn('career') }}</p>
    </div>

    <!-- ISSUE #41. The Match is one decision a generation; the house makes
         five hundred other marriages in a run, and this is the only thing the
         player can say about them. Neither answer is the safe one. -->
    <div class="panel">
      <h3 class="label">Who the house marries</h3>
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
    <div class="panel" :class="{ idle: idle('programme', table.programmeCandidates.length > 0 || !!table.scion || !!table.scionHeir || !!table.scionVacant || !!table.scionHeirVacant) }">
      <h3 class="label">
        <button
          class="fold"
          :aria-expanded="!idle('programme', table.programmeCandidates.length > 0 || !!table.scion || !!table.scionHeir || !!table.scionVacant || !!table.scionHeirVacant)"
          @click="shut['programme'] = !shut['programme']"
        >The programme</button>
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
          <strong>Scion</strong>
          <span class="dim"> · {{ table.scion ? table.scion.name : 'nobody named' }}</span>
        </div>
        <div class="row">
          <select v-model="scionChoice" aria-label="Choose the Scion">
            <option value="">— name whom —</option>
            <option v-for="p in table.programmeCandidates" :key="p.person" :value="p.person">
              {{ p.name }}, {{ p.age }}
            </option>
          </select>
          <button class="small" :disabled="!scionChoice" @click="actions.order({ kind: 'scion', person: scionChoice })">
            Name the Scion
          </button>
          <button v-if="table.scion || table.scionVacant" class="small" @click="actions.order({ kind: 'scion', person: null })">
            Leave the place empty
          </button>
        </div>
        <p v-if="refusedIn('scion')" class="small rubric">{{ refusedIn('scion') }}</p>
      </div>

      <div class="line">
        <div class="small">
          <strong>Heir to the programme</strong>
          <span class="dim"> · {{ table.scionHeir ? table.scionHeir.name : 'nobody named' }}</span>
        </div>
        <div class="row">
          <select v-model="scionHeirChoice" aria-label="Choose the heir to the programme">
            <option value="">— name whom —</option>
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
            Name the heir
          </button>
          <button v-if="table.scionHeir || table.scionHeirVacant" class="small" @click="actions.order({ kind: 'scionHeir', person: null })">
            Leave the place empty
          </button>
        </div>
        <p v-if="refusedIn('scionHeir')" class="small rubric">{{ refusedIn('scionHeir') }}</p>
      </div>
    </div>

    <!-- §7: every daughter married outward is power leaving the blood forever,
         and there was no way to decline to spend her. -->
    <div class="panel" :class="{ idle: idle('market', table.market.length > 0) }">
      <h3 class="label">
        <button class="fold" :aria-expanded="!idle('market', table.market.length > 0)" @click="shut['market'] = !shut['market']">The market</button>
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

    <!-- §7: "A dowry is not money. Great houses negotiate in lineage
         documentation... Forging them is an industry." A house with a thin
         record learns it by being refused a card, and this is where it can do
         something about that before the refusal rather than after. -->
    <div class="panel" :class="{ idle: idle('papers', table.papers.length > 0) }">
      <h3 class="label">
        <button class="fold" :aria-expanded="!idle('papers', table.papers.length > 0)" @click="shut['papers'] = !shut['papers']">The papers</button>
      </h3>
      <p v-if="!table.papers.length" class="small dim">{{ local('Nobody of the house has a match to make.', 'No family member needs marriage papers right now.') }}</p>
      <p class="small dim blurb">
        {{ local('Three generations of maternal record, notarised. What a great house asks for before it will open the conversation, and what a young house has not got.', 'Great houses require notarised records for three generations through the mother before considering a marriage. A younger house may not have those records.') }}
      </p>
      <div v-for="row in table.papers" :key="row.person" class="line">
        <div class="small">
          <strong>{{ row.name }}</strong>
          <span class="dim"> · {{ local('the record shows', 'recorded generations:') }} {{ row.shows }} {{ local('of 3', 'out of 3') }}</span>
          <span v-if="row.forged" class="dim"> · {{ row.forged }} bought</span>
          <span v-if="row.exposed" class="rubric"> · {{ row.exposed }} questioned</span>
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
          the house cannot raise
          {{ table.pedigreePrices.filter((g) => !g.canPay).map((g) => g.price).join(' or ') }}
        </div>
      </div>
      <p v-if="refusedIn('pedigree')" class="small rubric">{{ refusedIn('pedigree') }}</p>
    </div>

    <!-- WORLD §12. "Nobody in this world is a slave and there is no serfdom in
         Aubren. People are held by debt, custom, contract and having nowhere
         else to go, which is sufficient." Both halves of that are decisions. -->
    <div class="panel" :class="{ idle: idle('servants', table.servants.length > 0) }">
      <h3 class="label">
        <button class="fold" :aria-expanded="!idle('servants', table.servants.length > 0)" @click="shut['servants'] = !shut['servants']">The house's people</button>
      </h3>
      <p v-if="!table.servants.length" class="small dim">{{ local("Nobody is in the house's service.", 'The house has no servants.') }}</p>
      <div v-for="s in table.servants" :key="s.person" class="line">
        <div class="small">
          <strong>{{ s.name }}</strong>
          <span class="dim"> · {{ s.role }} · {{ s.wage }} marks</span>
          <span v-if="s.bonded" class="rubric"> · owes {{ s.debt }}</span>
          <span class="dim"> · they think of you {{ s.loyalty }}</span>
        </div>
        <div class="row">
          <input
            v-if="!s.bonded"
            type="number" min="1" step="1" :max="table.maxBond"
            v-model.number="advancing[s.person]"
            :placeholder="'marks, up to ' + table.maxBond"
            :aria-label="'Marks to advance to ' + s.name"
            :aria-invalid="advancing[s.person] !== undefined && !validAdvance(advancing[s.person])"
            :aria-describedby="advancing[s.person] !== undefined && !validAdvance(advancing[s.person]) ? 'bond-marks-error-' + s.person : undefined"
          />
          <button
            v-if="!s.bonded"
            class="small"
            :disabled="!validAdvance(advancing[s.person])"
            @click="advance(s.person)"
          >
            Advance it against the years
          </button>
          <p
            v-if="!s.bonded && advancing[s.person] !== undefined && !validAdvance(advancing[s.person])"
            :id="'bond-marks-error-' + s.person"
            class="small rubric"
            role="alert"
          >
            Enter a whole number of marks from 1 to {{ table.maxBond }}.
          </p>
          <button
            v-if="s.bonded"
            class="small"
            @click="actions.order({ kind: 'bond', person: s.person, op: 'free' })"
          >
            Tear it up
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
