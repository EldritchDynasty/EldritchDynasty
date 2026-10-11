<script setup lang="ts">
import { computed, inject, ref, shallowRef } from 'vue';
import type { Content } from '@ed/schema';
import { FREQUENCY_PROFILES } from '@ed/schema';
import {
  bootstrap, stepYear, renameChild, clearNamingQueue, frequencyReport,
  resolveChoice, resolveRecord, resolveMatch, declineMatch, autoResolveAll, makeRng,
  branchReport, halls, branchOf, END_YEAR, START_YEAR,
  type SimCtx, type PendingChoice, type PendingRecord, type PendingMatch, type MatchCard,
  type RecordOption, type ChronicleEntry,
} from '@ed/core';
import { MAIN_BRANCH, type Register } from '@ed/schema';
import Sigil from './Sigil.vue';
import Mark from './Mark.vue';
import Seal from './Seal.vue';
import { SOUND } from '../lib/audio-key';
import { valenceOf } from '../lib/valence';
import { submitsOnEnter } from '../lib/keys';
import type { MarkName } from '../lib/marks';

const props = defineProps<{ content: Content }>();

const seed = ref(1042);
const ctx = shallowRef<SimCtx | null>(null);
const nameDrafts = ref<Record<string, string>>({});
const filter = ref<'all' | 'named'>('all');

/**
 * Who decides. `ask` is the game; `chronicler` is the harness, and it is also
 * what a player pressing "to the term" is asking for. The two run the same code —
 * see core/events/decisions.ts — so this toggle changes who is holding the pen
 * and nothing else.
 */
const decider = ref<'ask' | 'chronicler'>('ask');
const castDrafts = ref<Record<string, string>>({});

/**
 * The world is one long-lived mutable object, so `triggerRef` alone is not
 * enough: an intermediate computed that returns `ctx.value.world` produces the
 * SAME reference every time, and Vue short-circuits there — every computed
 * downstream of it silently stops updating while its siblings keep working.
 *
 * An explicit version counter is the honest fix. Every computed that reads
 * simulation state touches `version` first, so nothing depends on reference
 * identity that will never change.
 */
const version = ref(0);

/**
 * The sound (`lib/sound.ts`), if `App.vue` is above us. Null in a test or in
 * anything else that renders this view without a provider, and every call site
 * below is written to shrug at that rather than guard for it.
 */
const sound = inject(SOUND, null);

/**
 * The drone follows the world, and the world only moves when `bump` says so —
 * so this is the one place it needs setting. `setDrone` compares against what
 * is already playing and leaves an unchanged drone alone, which matters: a
 * three-second swell retriggered every year is not a drone, it is a pulse.
 */
function bump() {
  version.value += 1;
  const c = ctx.value;
  if (!c || !sound) return;
  const registers = c.world.age.active
    .map((a) => props.content.age(a.age)?.register)
    .filter((r): r is Register => r !== undefined);
  sound.setDrone({ registers, frame: frameShown.value.length > 0 });
}

function start() {
  ctx.value = bootstrap(props.content, seed.value, START_YEAR);
  nameDrafts.value = {};
  seenFrame = 0;
  frameShown.value = [];
  bump();
}

/**
 * THE FRAME, WHICH IS QUIETER THAN THE TALE (concept §24).
 *
 * Last-night interludes have been accumulating on `world.frame.entries` since the
 * frame layer shipped, and nothing in this tool has ever shown one — which is
 * invariant 11's dead field, in a view rather than in the engine.
 *
 * They surface two ways, and the split is the same one the naming queue makes.
 *
 * A DELIBERATE step holds whatever fired on screen, in two colours, with the
 * drone off, until the player moves the clock again. The temperature change IS
 * the feature; there is nothing to click.
 *
 * A LONG JUMP does not. Measured: "to the term" produces about twenty interludes,
 * and holding them all turned the view into a column of frame panels with the
 * docket, the stats and the chronicle somewhere below the fold. A player who
 * presses "to the term" has asked not to be interrupted — so the interludes go to
 * the ledger below instead, which is where the frame layer is legible as a
 * layer rather than as a moment.
 */
let seenFrame = 0;
const frameShown = ref<{ year: number; text: string }[]>([]);

/**
 * Every interlude the run has produced, newest first. This is the frame as a
 * RECORD — the thing the last night has been writing while the family wrote its own —
 * and until now nothing in the tool showed it at all.
 */
const frameLedger = computed(() => {
  void version.value;
  return [...(ctx.value?.world.frame.entries ?? [])].reverse();
});

/**
 * Run forward. The naming queue is drained by the player, not by the clock —
 * so the run stops advancing while children are waiting to be named. Naming is
 * one of the few things the player does to an individual rather than to the
 * bloodline, and it should be able to interrupt a Long Line.
 */
/**
 * Deliberate steps stop for the naming queue; long jumps do not.
 *
 * A fast-forward that halts every third birth never reaches the term — pressing it
 * twelve times got a run to 1058. When the player asks for four centuries they
 * are asking the chronicler to keep the register, which is the design's own
 * fallback: the names stand, they simply are not yours.
 */
const PAUSE_FOR_NAMING_UP_TO = 25;

function advance(n: number) {
  const c = ctx.value;
  if (!c) return;
  const pauses = n <= PAUSE_FOR_NAMING_UP_TO;
  const ask = decider.value === 'ask';

  // Moving the clock closes whatever the frame was holding. One page turn per
  // press, not per year: a hundred of them is not a hundred pages, it is a fan.
  frameShown.value = [];
  seenFrame = c.world.frame.entries.length;
  sound?.cue('page');

  for (let i = 0; i < n; i++) {
    stepYear(c, !ask);
    // The docket stops the clock. Long jumps hand the pen to the chronicler
    // instead — asking four hundred questions is not a fast-forward.
    if (c.world.pendingDecisions.length) {
      if (pauses) break;
      autoResolveAll(c, makeRng(c.world.seed + c.world.year));
    }
    if (pauses && c.world.pendingNames.length >= 3) break;
  }
  if (!pauses) clearNamingQueue(c);

  // Only a deliberate step is interrupted; see the note on `frameShown`. Two
  // at once is already a lot of screen, and three would be a wall.
  frameShown.value = pauses
    ? c.world.frame.entries.slice(seenFrame).slice(-2).map((f) => ({ year: f.year, text: f.text }))
    : [];
  seenFrame = c.world.frame.entries.length;

  bump();
  // The bell means the clock has stopped and it is waiting on you. Nothing is
  // filtered here because nothing needs to be: only `decidedBy: player` ever
  // reaches `pendingDecisions` (invariant 9) — `chance`, `state` and `party`
  // resolve themselves and never park.
  if (c.world.pendingDecisions.length) sound?.cue('bell');
}

// ── The docket ───────────────────────────────────────────────────────────
const decision = computed(() => {
  void version.value;
  return ctx.value?.world.pendingDecisions[0] ?? null;
});

function answer(choiceId: string) {
  const c = ctx.value;
  const d = decision.value;
  if (!c || !d || d.kind !== 'choice') return;
  const res = resolveChoice(c, d.id, choiceId, makeRng(c.world.seed + c.world.year), { ...castDrafts.value });
  castDrafts.value = {};
  // Which way it went, read off the effects the outcome actually applied —
  // not off anything an author had to remember to declare (`lib/valence.ts`).
  if (res.ok && res.resolved) sound?.cue(valenceOf(res.resolved.outcome.effects));
  bump();
}

function write(option: RecordOption) {
  const c = ctx.value;
  const d = decision.value;
  if (!c || !d || d.kind !== 'record') return;
  resolveRecord(c, d.id, option);
  // Written, whichever of the three it was. An omission is sealed too — that
  // is what makes the dated blank a decision rather than an absence.
  sound?.cue('seal');
  bump();
}

function letHimDecide() {
  const c = ctx.value;
  if (!c) return;
  autoResolveAll(c, makeRng(c.world.seed + c.world.year));
  bump();
}

const asChoice = computed(() => (decision.value?.kind === 'choice' ? decision.value as PendingChoice : null));
const asRecord = computed(() => (decision.value?.kind === 'record' ? decision.value as PendingRecord : null));
const asMatch = computed(() => (decision.value?.kind === 'match' ? decision.value as PendingMatch : null));

/** Take a card. The suitor a card promises is the suitor who arrives. */
function takeMatch(cardId: string) {
  const c = ctx.value;
  const d = asMatch.value;
  if (!c || !d) return;
  resolveMatch(c, d.id, cardId);
  sound?.cue('seal');
  bump();
}

function declineHand() {
  const c = ctx.value;
  const d = asMatch.value;
  if (!c || !d) return;
  declineMatch(c, d.id);
  bump();
}

/**
 * What the documents claim about how close these two are. The player is
 * reading a number he is meant to be suspicious of — a bought grandmother
 * makes a first cousin read as a stranger — so it is worded, not printed.
 */
function kinshipOf(card: MatchCard): string {
  if (card.kinship >= 0.2) return 'the same blood, near enough to be a scandal';
  if (card.kinship >= 0.1) return 'close kin on paper';
  if (card.kinship >= 0.045) return 'first cousins, by the documents';
  if (card.kinship > 0) return 'kin, distantly, if the papers are honest';
  return 'no relation the papers admit to';
}

/**
 * What the house has watched of this line's women — the mother and the sisters
 * for someone already alive, the house's own daughters for a stranger.
 *
 * Worded rather than printed, like kinship, and for a harder reason: there is
 * no number here for anyone in 1042 to have. The count of lives is said out
 * loud when it is one, because a line read off a single woman is a rumour and
 * ought to sound like one before a daughter is spent on it.
 */
function lineOf(card: MatchCard): string {
  if (card.line === 'unknown') return 'nothing known of the line';
  const hedge = card.lineSeen === 1 ? ', on one life' : '';
  if (card.line === 'fertile') return `a full line${hedge}`;
  if (card.line === 'thin') return `a thin line${hedge}`;
  return `an ordinary line${hedge}`;
}

const RECORD_BLURB: Record<RecordOption, string> = {
  record: 'Write it as it happened.',
  omit: 'Leave the line blank. Everyone will notice the blank.',
  embellish: 'Write it better. Somebody, one day, may be able to prove otherwise.',
};

// ── The halls ────────────────────────────────────────────────────────────
const branchHalls = computed(() => {
  void version.value;
  const c = ctx.value;
  if (!c) return [];
  const populated = halls(c.world, c.world.year);
  const rows = [{
    id: MAIN_BRANCH,
    name: 'The main house',
    members: (populated.get(MAIN_BRANCH) ?? []).length,
    grievance: 0,
    founded: 1042,
    main: true,
  }];
  for (const b of branchReport(c)) {
    if (b.extinct !== undefined) continue;
    rows.push({ id: b.id, name: b.name, members: b.members, grievance: b.grievance, founded: b.founded, main: false });
  }
  return rows;
});

const liveGrudges = computed(() => {
  void version.value;
  const w = ctx.value?.world;
  if (!w) return 0;
  return [...w.relationships.values()].reduce((a, r) => a + r.grudges.length, 0);
});

const branchesGone = computed(() => {
  void version.value;
  return ctx.value ? branchReport(ctx.value).filter((b) => b.extinct !== undefined).length : 0;
});

function commitName(personId: string) {
  const c = ctx.value;
  if (!c) return;
  const draft = (nameDrafts.value[personId] ?? '').trim();
  if (draft) renameChild(c, personId, draft);
  else c.world.pendingNames = c.world.pendingNames.filter((p) => p.person !== personId);
  delete nameDrafts.value[personId];
  bump();
}

function keepAll() {
  if (!ctx.value) return;
  clearNamingQueue(ctx.value);
  bump();
}

const w = computed(() => { void version.value; return ctx.value?.world ?? null; });

const pending = computed(() => {
  void version.value;
  const c = ctx.value;
  if (!c) return [];
  return c.world.pendingNames.map((n) => {
    const p = c.world.people.get(n.person);
    const mother = p?.trueParents.mother ? c.world.people.get(p.trueParents.mother) : undefined;
    const father = p?.trueParents.father ? c.world.people.get(p.trueParents.father) : undefined;
    return { ...n, person: n.person, sigilSeed: p?.sigilSeed ?? 0, mother: mother?.name, father: father?.name };
  });
});

const entries = computed(() => {
  void version.value;
  const all = w.value?.chronicle ?? [];
  const shown = filter.value === 'named' ? all.filter((e) => e.named) : all;
  return shown.slice(-140);
});

/**
 * WHAT GOES IN THE MARGIN, AND WHAT DOES NOT.
 *
 * Most entries get nothing, and that is the design (concept §24: marginalia).
 * A mark on every line is not marginalia, it is a column — and the whole value
 * of the pilcrow is that the eye finds it because its neighbours are bare.
 *
 * Order matters here. An entry that is BOTH struck and embellished is struck:
 * the house wrote something better and then the thing it was about ended
 * anyway, and the ending is the louder fact.
 */
function gutterOf(e: ChronicleEntry): MarkName | null {
  if (e.greyed) return 'obelus';                    // known to have existed, and gone
  if (e.record === 'omit') return 'obelus';         // the dated blank. Somebody struck this
  if (e.record === 'embellish') return 'asterisk';  // this line claims more than happened
  if (e.weight === 'page') return 'manicule';
  if (e.weight === 'paragraph') return 'pilcrow';
  return null;                                       // 'line', and 'illuminated' gets wax
}

/**
 * A seal is stamped on the illuminated entries — the mythic tier, a handful in
 * a Long Line. Seeded off the entry rather than off the render, so the
 * same line keeps the same wax: `Seal.vue` warns about exactly this, and a
 * seal that reshuffles on every keystroke reads as a bug even to somebody who
 * could not name what changed.
 */
function sealSeed(e: ChronicleEntry): number {
  let h = e.year >>> 0;
  for (const ch of e.id ?? e.eventId ?? 'wax') h = (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0;
  return h;
}

const freq = computed(() => (void version.value, ctx.value ? frequencyReport(ctx.value) : null));
const activeAges = computed(() =>
  (w.value?.age.active ?? []).map((a) => {
    const def = props.content.age(a.age);
    return {
      id: a.age,
      // Ages are named late: the player feels two decades of effects first.
      label: a.named ? (def?.name ?? a.age) : 'something is happening',
      years: (w.value?.year ?? 0) - a.began,
      named: a.named,
    };
  }));

const household = computed(() => {
  void version.value;
  const c = ctx.value;
  if (!c) return [];
  return c.world.people.household(c.world.playerHouse, c.world.year)
    .map((p) => ({ p, hall: branchOf(c.world, p, c.world.year) }))
    .sort((a, b) => a.p.born - b.p.born);
});
</script>

<template>
  <header>
    <h2>Simulate</h2>
    <p>
      Five hundred years, one bloodline. Frequency is not a weight synonym here — watch how
      differently the chronicle renders a common event and a mythic one.
    </p>
  </header>

  <div class="bar">
    <label style="margin:0">Seed</label>
    <input type="number" v-model.number="seed" style="width:90px" />
    <button class="btn primary" @click="start">{{ ctx ? 'Restart' : `Begin, ${START_YEAR}` }}</button>
    <template v-if="ctx">
      <button class="btn" @click="advance(1)">+1 year</button>
      <button class="btn" @click="advance(25)">+25</button>
      <button class="btn" @click="advance(100)">+100</button>
      <button class="btn" @click="advance(Math.max(0, END_YEAR - (w?.year ?? START_YEAR)))">to {{ END_YEAR }}</button>
      <button class="btn" @click="decider = decider === 'ask' ? 'chronicler' : 'ask'">
        {{ decider === 'ask' ? 'You decide' : 'The chronicler decides' }}
      </button>
      <span style="color:var(--ink-faint);font-size:13px">year {{ w?.year }} · generation {{ w?.generation }}</span>
    </template>
  </div>

  <p v-if="!ctx" class="note">Nothing is running. Press begin.</p>

  <template v-else>
    <!-- ── The frame (concept §24): two colours, no drone, a slow reveal ─ -->
    <div v-for="(f, i) in frameShown" :key="`fr${i}`" class="frame">
      <span class="ask"><Mark name="moth" :size="15" />{{ f.year }} · from outside the record</span>
      <p class="scene">{{ f.text }}</p>
    </div>

    <!-- ── The docket ───────────────────────────────────────────────── -->
    <div v-if="asChoice" class="docket">
      <span class="ask"><Mark name="manicule" :size="15" />{{ asChoice.year }} · {{ asChoice.event.title }}</span>
      <p class="scene">{{ asChoice.body }}</p>

      <div v-for="req in asChoice.cast" :key="req.slot" class="cast">
        <label>{{ req.slot }}</label>
        <select v-model="castDrafts[req.slot]">
          <option value="">nobody</option>
          <option v-for="c in req.candidates" :key="c.id" :value="c.id">{{ c.name }}, {{ c.age }}</option>
        </select>
      </div>

      <button
        v-for="c in asChoice.choices" :key="c.id"
        class="choice" :disabled="!c.available" @click="answer(c.id)"
      >
        {{ c.label }}
        <span v-if="!c.available" class="why">closed to you — {{ c.blockedBy }}</span>
      </button>
      <button class="btn" style="margin-top:6px" @click="letHimDecide">Let the chronicler decide</button>
    </div>

    <!-- ── The Match: three cards, one marriage (concept §5) ────────── -->
    <div v-else-if="asMatch" class="docket">
      <span class="ask"><Mark name="ring" :size="15" />{{ asMatch.year }} · the match</span>
      <p class="scene">
        A marriage for <strong>{{ asMatch.subject.name }}</strong>, {{ asMatch.subject.age }}.
        {{ asMatch.subject.sex === 'female'
          ? 'These men would take the name and live under this roof.'
          : 'These women would come here, and their sons would be of this house.' }}
        What any of them carries is not on the table and cannot be — you are reading houses,
        papers, prices, and what their mothers and sisters bore.
      </p>

      <div class="cards">
        <button
          v-for="card in asMatch.cards" :key="card.id"
          class="card" :disabled="!card.available" @click="takeMatch(card.id)"
        >
          <span class="who">{{ card.name }}</span>
          <span class="line">{{ card.age }} · {{ card.houseName }}</span>
          <span class="blurb">{{ card.blurb }}</span>
          <span class="terms">
            {{ card.dowry ? card.dowry + ' crowns' : 'no dowry' }} · {{ kinshipOf(card) }}
          </span>
          <span class="lineage">{{ lineOf(card) }}</span>
          <span v-if="!card.available" class="why">closed to you — {{ card.blockedBy }}</span>
        </button>
      </div>

      <button class="btn" style="margin-top:10px" @click="declineHand">
        Take none of them. The house can wait three years.
      </button>
      <button class="btn" style="margin-top:6px" @click="letHimDecide">Let the chronicler decide</button>
    </div>

    <div v-else-if="asRecord" class="docket">
      <span class="ask"><Mark name="seal" :size="15" />{{ asRecord.year }} · the record</span>
      <p class="scene">
        What the book says about <em>{{ asRecord.subject }}</em>. There is one line about it, and this is it.
      </p>
      <button v-for="o in asRecord.options" :key="o.option" class="choice" @click="write(o.option)">
        {{ o.option }} — {{ RECORD_BLURB[o.option] }}
        <span class="why">{{ o.chronicle ?? 'a dated blank line' }}</span>
      </button>
    </div>
    <!-- ── Naming ───────────────────────────────────────────────────── -->
    <div v-if="pending.length" class="panel" style="border-color:var(--rubric);margin-bottom:16px">
      <h3 style="color:var(--rubric);display:flex;align-items:center;gap:8px">
        <Mark name="cradle" :size="17" />
        {{ pending.length }} child{{ pending.length > 1 ? 'ren' : '' }} born to the house
      </h3>
      <p class="note" style="margin-top:0">
        The chronicler has written a name already. You may leave it, and many houses do.
      </p>
      <div v-for="b in pending" :key="b.person"
           style="display:flex;gap:10px;align-items:center;margin-bottom:8px">
        <Sigil :seed="b.sigilSeed" :size="30" :sex="b.sex as 'male' | 'female'" />
        <div style="flex:1;min-width:0">
          <input
            type="text"
            :placeholder="b.suggested"
            v-model="nameDrafts[b.person]"
            @keydown.enter="submitsOnEnter($event) && commitName(b.person)"
          />
          <div style="font-size:11px;color:var(--ink-faint);margin-top:3px">
            born {{ b.born }} · {{ b.sex === 'female' ? 'a daughter' : 'a son' }}
            <template v-if="b.mother"> of {{ b.mother }}<template v-if="b.father"> and {{ b.father }}</template></template>
          </div>
        </div>
        <button class="btn primary" @click="commitName(b.person)">Name</button>
      </div>
      <button class="btn" @click="keepAll">Keep the chronicler's names</button>
    </div>

    <div class="stats" style="margin-bottom:16px">
      <div class="stat"><div class="k">Household</div><div class="v">{{ household.length }}</div></div>
      <div class="stat"><div class="k">Ever lived</div><div class="v">{{ w?.people.size }}</div></div>
      <div class="stat"><div class="k">Respect</div><div class="v" style="font-size:15px">{{ w?.respect }}</div></div>
      <div class="stat"><div class="k">Treasury</div><div class="v">{{ Math.round(w?.treasury ?? 0) }}<small> cr</small></div></div>
      <div class="stat">
        <div class="k">Clauses</div>
        <div class="v">{{ w?.clausesRecovered.size }}<small>/{{ props.content.clauses.length }}</small></div>
      </div>
      <div class="stat"><div class="k">Grudges</div><div class="v">{{ liveGrudges }}</div></div>
      <div class="stat"><div class="k">Rumours</div><div class="v">{{ w?.rumours.size }}</div></div>
      <div class="stat"><div class="k">Discrepancies</div><div class="v">{{ w?.discrepancies.size }}</div></div>
      <div class="stat"><div class="k">Discontent</div><div class="v">{{ Math.round(w?.discontent ?? 0) }}</div></div>
    </div>

    <div class="cols wide">
      <div>
        <div class="panel" style="margin-bottom:12px">
          <h3>Frequency ledger</h3>
          <table class="attrs">
            <tbody>
            <tr v-for="(v, k) in freq" :key="k">
              <td class="k">
                <span class="badge" :class="k">{{ k }}</span>
              </td>
              <td class="v">
                {{ v.fired }} fired
                <span style="color:var(--ink-faint);font-size:11px">
                  / {{ v.pool }} authored
                  <template v-if="FREQUENCY_PROFILES[k].perRunCap">· cap {{ FREQUENCY_PROFILES[k].perRunCap }}</template>
                  <template v-if="v.barred"> · <span style="color:var(--rubric)">cooling</span></template>
                </span>
              </td>
            </tr>
            </tbody>
          </table>
        </div>

        <div class="panel" style="margin-bottom:12px">
          <h3>The Age</h3>
          <p v-if="!activeAges.length" class="note" style="margin:0">
            Nothing in particular. A world between things is allowed.
          </p>
          <div v-for="a in activeAges" :key="a.id" style="margin-bottom:8px">
            <div :style="{ fontSize: '14px', color: a.named ? 'var(--ink)' : 'var(--ink-soft)' }">
              {{ a.label }}
            </div>
            <div style="font-size:11px;color:var(--ink-faint)">
              {{ a.years }} years in{{ a.named ? '' : ' · unnamed' }}
            </div>
          </div>
        </div>

        <div v-if="frameLedger.length" class="panel frame-ledger" style="margin-bottom:12px">
          <h3><Mark name="moth" :size="15" />From outside the record</h3>
          <p class="note" style="margin-top:0">
            {{ frameLedger.length }} interlude{{ frameLedger.length > 1 ? 's' : '' }}.
            {{ END_YEAR }} has been reading along.
          </p>
          <div class="list" style="max-height:260px">
            <div v-for="(f, i) in frameLedger" :key="`fl${i}`" class="fl">
              <span class="yr">{{ f.year }}</span>
              <span class="tx">{{ f.text }}</span>
            </div>
          </div>
        </div>

        <div class="panel" style="margin-bottom:12px">
          <h3>The halls</h3>
          <p v-if="branchHalls.length < 2" class="note" style="margin:0 0 8px">
            One roof, so far. Younger sons found their own the year a brother takes the seal.
          </p>
          <div class="halls">
            <div
              v-for="h in branchHalls" :key="h.id"
              class="hall" :class="{ sore: h.grievance >= 55 }"
            >
              <span class="n">{{ h.name }}</span>
              <span class="g">{{ h.members }} living</span>
              <span v-if="!h.main" class="g">· grievance {{ h.grievance }}</span>
            </div>
          </div>
          <p v-if="branchesGone" class="note" style="margin-bottom:0">
            {{ branchesGone }} branch{{ branchesGone > 1 ? 'es have' : ' has' }} ended.
          </p>
        </div>

        <div class="panel">
          <h3>The household</h3>
          <div class="list" style="max-height:340px">
            <div v-for="{ p, hall } in household" :key="String(p.id)" class="row" style="cursor:default">
              <Sigil :seed="p.sigilSeed" :size="22" :sex="p.sex" :status="p.status" :madness="p.madness" />
              <span class="t">{{ p.name }}</span>
              <span class="sub" v-if="hall !== MAIN_BRANCH">cadet</span>
              <span class="sub">{{ (w?.year ?? 0) - p.born }}</span>
            </div>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="bar" style="margin-bottom:10px">
          <h3 style="margin:0;flex:1">The chronicle</h3>
          <button class="btn" @click="filter = filter === 'all' ? 'named' : 'all'">
            {{ filter === 'all' ? 'Named entries only' : 'Everything' }}
          </button>
        </div>

        <div class="chronicle">
          <div v-for="(e, i) in entries" :key="i" class="entry" :class="[e.weight, { greyed: e.greyed }]">
            <span class="yr">{{ e.year }}</span>
            <span class="gutter">
              <Seal v-if="e.weight === 'illuminated'" :seed="sealSeed(e)" :size="24" />
              <Mark
                v-else-if="gutterOf(e)" :name="gutterOf(e)!" :size="14"
                :class="gutterOf(e)!" titled
              />
            </span>
            <div class="body">
              <span v-if="e.title" class="ttl">{{ e.title }}</span>
              <!-- The prose is its own block so the illuminated tier's drop cap
                   has something to drop into. On `.body`, `::first-letter`
                   resolves to the first block-level descendant — which is the
                   TITLE whenever there is one, so the cap was landing on 11px
                   uppercase and doing nothing anybody could name. -->
              <span v-if="e.text" class="prose">{{ e.text }}</span>
              <!-- An omitted entry prints as a dated blank. The blank is designed. -->
              <span v-else class="blank" />
              <span v-if="e.record === 'embellish'" class="stamp">as written</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </template>
</template>
