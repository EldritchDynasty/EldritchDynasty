<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import type { CastRequest, MatchCard, MatchPanel, PendingDecisionView, RecordOption, SlotFill } from '@ed/core';
import { futureOf, type GameActions } from '../lib/game';
import { isControl, isField, shortcutFor } from '../lib/keys';

const props = defineProps<{
  decision: PendingDecisionView;
  actions: GameActions;
  /**
   * A card the engine refused anyway (issue #83), drawn against the card it
   * belongs to. `match.ts` closes a card the moment its person or its subject
   * stops being able to marry, so this should stay null — it is here because
   * the bug was a return value nobody read, and the only durable fix for that
   * class is a client that draws the answer.
   */
  refusedCard?: { card: string; reason: string } | null;
}>();

/**
 * WHO THE PLAYER IS CASTING, per slot, for the decision on screen.
 *
 * Kept here rather than in the store because it is not simulation state: it is
 * a half-filled form, and it dies with the decision it belongs to. That is
 * what the `:key` on this component in `App.vue` is for — without it Vue
 * reuses the instance and this ref survives into the next decision.
 */
const cast = ref<SlotFill>({});

function fill(slot: string, event: Event): void {
  const person = (event.target as HTMLSelectElement).value;
  if (person) cast.value[slot] = person;
  else delete cast.value[slot];
}

/**
 * A COUNTED SLOT IS A CHECKLIST. The player is naming a party — between two
 * and five men, say — so the control has to be one that can hold more than one
 * answer, and `count.max` is enforced here as well as in `resolveChoice`: a
 * disabled sixth box says the party is full where a rejected send only says
 * the house refused.
 */
function party(slot: string): string[] {
  const v = cast.value[slot];
  return Array.isArray(v) ? v : v ? [v] : [];
}

function toggle(slot: string, id: string, max: number): void {
  const now = party(slot);
  if (now.includes(id)) cast.value[slot] = now.filter((x) => x !== id);
  else if (now.length < max) cast.value[slot] = [...now, id];
}

function full(req: CastRequest, id: string): boolean {
  const n = party(req.slot);
  return !!req.count && n.length >= req.count.max && !n.includes(id);
}

/**
 * WHAT A NUMBER ON A CARD MEANS, said where it can be read (issue #107).
 *
 * Kinship and the line read are two of the three numbers that decide a match,
 * and both carried their meaning in a `title` — so on a phone they were two
 * bare figures with no explanation available anywhere in the game. The string
 * is held here because the tooltip and the note under the cards have to be the
 * same sentence: two wordings of one explanation is how they come apart.
 */
const KINSHIP_SAYS = 'the inbreeding coefficient of the child this match would have, '
  + "as the family's own documents would calculate it";

/**
 * THE CANDIDATE CURRENTLY NAMED for a single-select slot, if any — so the
 * observed-line read (issue #28 item 2) can be shown beside the choice that
 * is actually on the table, not the whole candidate list at once.
 */
function selected(req: CastRequest): CastRequest['candidates'][number] | undefined {
  const id = cast.value[req.slot];
  return typeof id === 'string' ? req.candidates.find((c) => c.id === id) : undefined;
}

/** Every slot the event insists on has enough people standing in it. */
function ready(requests: CastRequest[]): boolean {
  return requests.every((r) => {
    const n = party(r.slot).length;
    if (r.count) return r.optional ? n === 0 || n >= r.count.min : n >= r.count.min;
    return r.optional || n > 0;
  });
}

/**
 * Whether a card's panel has anything on it at all (issue #68).
 *
 * A house nobody has watched, in a century the book has not written about,
 * genuinely has an empty panel — and an empty `<details>` the player can open
 * onto nothing is worse than no control, because it reads as a bug. So the
 * fold only exists where there is something behind it, which is the same rule
 * the empty side panels are collapsed by.
 */
function hasPanel(panel: MatchPanel): boolean {
  return panel.issue.length > 0 || panel.woken.length > 0
    || panel.said.length > 0 || panel.ourBook.length > 0;
}

/**
 * The short qualifier beside the future reading (issue #214).
 *
 * "Mixed" is not a warning and "uncertain" is not a failure. They are the
 * point of reading evidence rather than truth: sometimes two cases really are
 * close, and sometimes the honest thing the family knows is that it knows very
 * little.
 */
function futureAside(card: MatchCard): string | undefined {
  const reading = futureOf(card);
  if (reading.confidence === 'mixed' && reading.competing) {
    return `mixed with ${reading.competing}`;
  }
  if (reading.confidence === 'uncertain') return 'thin evidence';
  return undefined;
}

const RECORD_OPTIONS: { option: RecordOption; label: string }[] = [
  { option: 'record', label: 'Write it as it happened' },
  { option: 'omit', label: 'Leave it out' },
  { option: 'embellish', label: 'Improve it' },
];

/**
 * The Record options THIS block actually offers, in the order they are drawn.
 *
 * The template filters `RECORD_OPTIONS` with a `v-if`, so a block that does not
 * offer "Leave it out" draws Improve it second — and indexing the unfiltered
 * table by the number in the margin would key "2" to an option that is not on
 * the screen. One list, read by the eye and by the keyboard.
 */
const recordOptions = computed(() => (props.decision.kind === 'record'
  ? RECORD_OPTIONS.filter((o) => props.decision.kind === 'record'
    && props.decision.options.some((x) => x.option === o.option))
  : []));

/**
 * 1-9 TAKES THE NUMBERED THING (issue #58).
 *
 * Handled here rather than in `App.vue` because taking a choice needs `cast` —
 * the half-filled form above, which belongs to this decision and dies with it.
 * Lifting it into the store to reach it from a global listener would make a
 * form into simulation state.
 *
 * Counted off what is DRAWN, greyed entries included, because the number in
 * the margin is the number the player is reading. A choice they cannot take is
 * still the second one on the page.
 */
function take(index: number): void {
  const d = props.decision;
  if (d.kind === 'choice') {
    if (!d.choicesAreOpen) return;
    const c = d.choices[index];
    if (!c || !c.available || !ready(d.cast)) return;
    props.actions.choose(d.id, c.id, cast.value, c.label);
    return;
  }
  if (d.kind === 'match') {
    const card = d.cards[index];
    if (!card || !card.available) return;
    props.actions.match(d.id, card.id, card.name);
    return;
  }
  const option = recordOptions.value[index];
  if (option) props.actions.record(d.id, option.option, option.label);
}

function onKey(e: KeyboardEvent): void {
  const el = document.activeElement;
  const press = shortcutFor({
    key: e.key,
    shift: e.shiftKey,
    modified: e.ctrlKey || e.metaKey || e.altKey,
    inField: isField(el),
    onControl: isControl(el),
  });
  if (press?.kind !== 'take') return;
  e.preventDefault();
  take(press.index);
}

const heading = ref<HTMLElement | null>(null);
onMounted(async () => {
  window.addEventListener('keydown', onKey);
  await nextTick();
  heading.value?.focus();
});
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));

</script>

<template>
  <!-- LIVE (issue #58). Answering a decision replaces this panel with the next
       one, and to anyone not watching the middle of the screen that happened in
       silence. `polite` because it is a reading, not an alarm — it waits for a
       gap rather than cutting across whatever is being read. -->
  <section class="docket panel" aria-live="polite" aria-atomic="false" aria-labelledby="docket-heading">
    <!-- LIVING COUNSEL (#215). These are people already in the household, not a
         neutral strategy layer. Their reason for caring is drawn beside the
         advice so disagreement reads as character rather than as conflicting
         tooltips. The engine has already enforced the knowledge boundary. -->
    <aside v-if="decision.advice?.length" class="advice stack" aria-label="Counsel from the household">
      <blockquote v-for="a in decision.advice" :key="a.adviser.id" class="small">
        <p>“{{ a.position }}”</p>
        <footer>
          <strong>{{ a.adviser.name }}</strong>
          <span class="dim"> — {{ a.cares }}</span>
        </footer>
      </blockquote>
    </aside>
    <!-- ── A CHOICE, OR A PARTY ────────────────────────────────────────────
         `decidedBy` says which. `player` means take a branch; `party` means
         name who goes and let what they are between them decide the rest, and
         a client that drew the choice list regardless would be offering an
         answer the engine will not accept. -->
    <template v-if="decision.kind === 'choice'">
      <h3 id="docket-heading" ref="heading" class="label" tabindex="-1">{{ decision.year }} · {{ decision.event.title }}</h3>
      <p class="body">{{ decision.body }}</p>
      <p v-if="decision.callback" class="small callback">{{ decision.callback }}</p>

      <div v-if="decision.arcStep" class="dim small arc">
        part of {{ decision.arcStep.instance.arc }}<span v-if="decision.arcStep.absent"> — and one of them is gone</span>
      </div>

      <div v-for="req in decision.cast" :key="req.slot" class="cast row">
        <label class="dim small">
          {{ req.slot }}
          <span v-if="req.count"> ({{ req.count.min }}–{{ req.count.max }})</span>
          <span v-else-if="req.optional"> (may stand empty)</span>
        </label>

        <fieldset v-if="req.count" class="party">
          <legend class="dim small">{{ party(req.slot).length }} named</legend>
          <label v-for="c in req.candidates" :key="c.id" class="small">
            <input
              type="checkbox"
              :checked="party(req.slot).includes(c.id)"
              :disabled="full(req, c.id)"
              @change="toggle(req.slot, c.id, req.count.max)"
            >
            {{ c.name }}, {{ c.age }}
          </label>
        </fieldset>

        <select v-else @change="fill(req.slot, $event)" :aria-label="'Choose ' + req.slot">
          <option value="">— nobody —</option>
          <option v-for="c in req.candidates" :key="c.id" :value="c.id">
            {{ c.name }}, {{ c.age }}
          </option>
        </select>

        <span v-if="!req.candidates.length" class="dim small">nobody of the house can stand here</span>

        <!-- WHAT IS OBSERVED OF THEIR LINE (issue #28 item 2) — her mother
             and sisters, named, with what the record credits to them. The
             same epistemics as the matchmaker's panel (issue #68) and never
             a fecundity number: see `core/src/people/panel.ts`. Only present
             when the slot is authored `showLine: true`, and only shown once
             a candidate is actually named. -->
        <template v-if="!req.count && selected(req)?.issue">
          <ul v-if="selected(req)!.issue!.length" class="small dim">
            <li v-for="row in selected(req)!.issue" :key="row.name">
              {{ row.name }}, {{ row.relation }} — {{ row.borne }}
              {{ row.borne === 1 ? 'child' : 'children' }}, {{ row.grown }} grown.
            </li>
          </ul>
          <p v-else class="small dim">no line anybody here has watched</p>
        </template>
      </div>

      <div v-if="decision.choicesAreOpen" class="choices stack">
        <button
          v-for="(c, i) in decision.choices"
          :key="c.id"
          :disabled="!c.available || !ready(decision.cast)"
          @click="actions.choose(decision.id, c.id, cast, c.label)"
        >
          <!-- The number is drawn because a shortcut nobody can see is a
               shortcut nobody uses. -->
          <span class="dim key" aria-hidden="true">{{ i + 1 }}</span>
          <span>{{ c.label }}</span>
          <!-- An unavailable choice is itself information (concept §16), so it
               is shown greyed with the reason rather than filtered away. -->
          <small v-if="!c.available" class="dim"> — {{ c.blockedBy }}</small>
        </button>
      </div>

      <div v-else class="choices">
        <p class="dim small">
          The branch is not yours to take. Name who goes, and what they are between them decides it.
        </p>
        <button class="primary" :disabled="!ready(decision.cast)" @click="actions.send(decision.id, cast, 'Send them')">
          Send them
        </button>
      </div>
    </template>

    <!-- ── THE MATCH (concept §5) — three cards and one marriage ─────────── -->
    <template v-else-if="decision.kind === 'match'">
      <h3 id="docket-heading" ref="heading" class="label" tabindex="-1">{{ decision.year }} · a marriage for {{ decision.subject.name }}</h3>
      <p class="body">
        {{ decision.subject.name }} is {{ decision.subject.age }}. These are the cards the year dealt.
      </p>

      <div class="cards">
        <article v-for="(card, i) in decision.cards" :key="card.id" class="card" :class="{ shut: !card.available }">
          <div class="row">
            <span class="dim key" aria-hidden="true">{{ i + 1 }}</span>
            <strong>{{ card.name }}</strong>
            <span class="dim small">{{ card.age }} · {{ card.houseName }}</span>
          </div>
          <p class="small soft">{{ card.blurb }}</p>
          <p v-if="card.callback" class="small callback">{{ card.callback }}</p>

          <!-- THE FUTURE ON THE FACE OF THE CARD (issue #214). This is not a
               forecast and it does not know the genome. `futureOf` receives
               only the same photographed MatchCard that is already being
               drawn here, and its reasons point back to evidence the player
               can open immediately below. -->
          <div class="future" :aria-label="'Why choose ' + card.name" :data-future="futureOf(card).kind">
            <p class="small future-head">
              <strong>{{ futureOf(card).label }}</strong>
              <span v-if="futureAside(card)" class="dim"> · {{ futureAside(card) }}</span>
            </p>
            <p v-for="reason in futureOf(card).reasons" :key="reason" class="small soft future-reason">
              {{ reason }}
            </p>
          </div>

          <p class="small words">{{ card.words }}</p>
          <div class="dim small">
            <span :title="KINSHIP_SAYS">kinship {{ card.kinship.toFixed(4) }}</span>
            ·
            <!-- The count is drawn rather than hovered. "The line reads fair"
                 says nothing on its own: a word standing on four completed
                 lives and the same word standing on forty are not the same
                 claim, and that was the half kept in a tooltip. -->
            <span>the line reads {{ card.line }}, on {{ card.lineSeen }} completed lives</span>
            · {{ card.dowry }} crowns
          </div>

          <!-- ── THE MATCHMAKER'S PANEL (issue #68) ────────────────────────
               What is observed, never what is true. Folded shut by default:
               the card is still the decision, and a hand of three open
               dossiers is a reading task rather than a choice. Everything
               inside is a public fact or somebody's claim — see
               `core/src/people/panel.ts` for why none of it is a stat. -->
          <details v-if="hasPanel(card.panel)" class="panel">
            <summary class="small">What is known of her</summary>

            <template v-if="card.panel.issue.length">
              <p class="small dim heading">The line, in names</p>
              <ul class="small">
                <li v-for="row in card.panel.issue" :key="row.name">
                  {{ row.name }}, {{ row.relation }} — {{ row.borne }}
                  {{ row.borne === 1 ? 'child' : 'children' }}, {{ row.grown }} grown.
                </li>
              </ul>
            </template>

            <template v-if="card.panel.woken.length">
              <p class="small dim heading">Wakings the world attended</p>
              <ul class="small">
                <li v-for="row in card.panel.woken" :key="row.name + row.year">
                  {{ row.name }}, {{ row.relation }}, woke in {{ row.year }}<span
                    v-if="row.expressed"
                  >, and the house has seen what it cost him</span>.
                </li>
              </ul>
            </template>

            <!-- Teller and bias, never accuracy. The game does not adjudicate
                 between two accounts in its own voice, so the player weighs
                 the mouth the way they would weigh a person. -->
            <template v-if="card.panel.said.length">
              <p class="small dim heading">What is said of the house</p>
              <blockquote v-for="row in card.panel.said" :key="row.tale" class="small said">
                <p>{{ row.text }}</p>
                <footer class="dim">{{ row.teller }} · {{ row.bias }}</footer>
              </blockquote>
            </template>

            <template v-if="card.panel.ourBook.length">
              <p class="small dim heading">What our own book has said of them</p>
              <ul class="small">
                <li v-for="(row, j) in card.panel.ourBook" :key="row.year + '/' + j">
                  <span class="dim">{{ row.year }}</span> — {{ row.text }}
                  <em v-if="row.embellished" class="lie">as we improved it</em>
                </li>
              </ul>
            </template>
          </details>

          <button :disabled="!card.available" @click="actions.match(decision.id, card.id, card.name)">
            Take this one
          </button>
          <div v-if="!card.available" class="dim small">{{ card.blockedBy }}</div>
          <!-- A refusal the engine produced anyway, against the card that
               produced it rather than anywhere else on the board. -->
          <div v-else-if="refusedCard?.card === card.id" class="small refused" role="alert">
            {{ refusedCard.reason }}
          </div>
        </article>
      </div>

      <!-- THE THREE NUMBERS, TOGETHER (issue #106). Below the width where
           `.cards` becomes a deck the numbers scroll out of one at a time —
           kinship, the line, the dowry — this says all three for all three
           cards without scrolling. `aria-hidden` because every figure here is
           already read off its own card above; a screen reader gets it once,
           not twice. Wide, this never draws: the three cards side by side
           already put the numbers next to each other. -->
      <table class="strip small" aria-hidden="true">
        <thead>
          <tr class="dim"><th>who</th><th>kinship</th><th>the line</th><th>dowry</th></tr>
        </thead>
        <tbody>
          <tr v-for="card in decision.cards" :key="card.id">
            <td>{{ card.name }}</td>
            <td>{{ card.kinship.toFixed(4) }}</td>
            <td>{{ card.line }}</td>
            <td>{{ card.dowry }}</td>
          </tr>
        </tbody>
      </table>

      <!-- Once, under the hand, rather than three times inside it: the
           sentence is the same for every card and the cards are already the
           densest thing on the board. -->
      <p class="dim small note">Kinship is {{ KINSHIP_SAYS }}.</p>

      <!-- Declining is a real move: the house waits for a better year, and on
           a deck the player can swipe past all three cards without ever
           reaching this — so under the phone tier it is pinned rather than
           left to scroll off with them (issue #106). -->
      <div class="decline">
        <button class="quiet" @click="actions.declineHand(decision.id)">Take none of them</button>
      </div>
    </template>

    <!-- ── THE RECORD BLOCK — what gets written down ─────────────────────── -->
    <!-- NAMED, not `v-else`. This was a bare catch-all, which is invariant 5's
         permissive default wearing a stylesheet: a fourth PendingDecision kind
         would have rendered as a Record block — the wrong panel, drawn
         confidently, with `decision.subject` undefined and three buttons that
         call `record` on a decision that is not one. A template has no
         `assertNever`, so the exhaustiveness is spelled out here and
         `Docket.test.ts` reads the kinds off the schema to check it. -->
    <template v-else-if="decision.kind === 'record'">
      <h3 id="docket-heading" ref="heading" class="label" tabindex="-1">{{ decision.year }} · what the book will say</h3>
      <p class="body">
        There is one line about <em>{{ decision.subject }}</em>, and this is it.
      </p>
      <p v-if="decision.callback" class="small callback">{{ decision.callback }}</p>

      <div class="choices stack">
        <template v-for="(o, i) in recordOptions" :key="o.option">
          <button @click="actions.record(decision.id, o.option, o.label)">
            <span class="dim key" aria-hidden="true">{{ i + 1 }}</span>
            <span>{{ o.label }}</span>
            <small class="dim entry">
              {{ decision.options.find((x) => x.option === o.option)?.chronicle ?? 'nothing at all' }}
            </small>
          </button>
        </template>
      </div>
    </template>

    <!-- AND A LAST BRANCH THAT SAYS SO. Unreachable while the three kinds
         above are the whole union; the point is that if it ever IS reached,
         the player sees that something is wrong instead of seeing the wrong
         panel drawn as though it were right. This codebase fails by doing
         nothing, and a blank card is the same failure as a wrong one. -->
    <template v-else>
      <h3 id="docket-heading" ref="heading" class="label" tabindex="-1">{{ (decision as { year: number }).year }} · unhandled</h3>
      <p class="body">
        This docket is of a kind the panel does not know how to draw. Nothing is
        lost — the clock is waiting, not broken — but it cannot be answered here.
      </p>
    </template>

    <!-- THE ESCAPE HATCH. Daveed is not neutral, and handing him the pen is a
         way of playing rather than a way of skipping. -->
    <footer>
      <button class="quiet small" @click="actions.letHimDecide()">Let him decide</button>
    </footer>
  </section>
</template>

<style scoped>
.docket { max-width: 72ch; }
.body { font-size: var(--t-body); line-height: 1.62; margin: 0 0 14px; }
.arc { margin-bottom: 10px; }
.cast { margin-bottom: 8px; }
.party { border: 1px solid var(--rule); display: flex; flex-wrap: wrap; gap: 2px 12px; padding: 4px 8px; }
.party label { display: flex; align-items: center; gap: 4px; min-width: 0; }
.cast label { min-width: 9ch; }
.choices { margin-top: 12px; }
.choices button { text-align: left; display: block; width: 100%; }
.choices .entry { display: block; margin-top: 3px; font-style: italic; }
/* The number in the margin. Quiet enough to read past, there when you look
   for it — a shortcut nobody can see is a shortcut nobody uses. */
.key {
  display: inline-block; min-width: 1.4ch; margin-right: 7px;
  font-size: var(--t-label); font-variant-numeric: tabular-nums;
}
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 10px; margin-bottom: 12px; }
.strip { display: none; }
/* Under the hand, above the way out of it. */
.note { margin: 0 0 10px; }
.card { border: 1px solid var(--rule); border-radius: 3px; padding: 10px 12px; background: var(--vellum); }
.card.shut { opacity: .6; }
.card p { margin: 6px 0; }
/* The answer to "why this person?" comes before the arithmetic, but remains
   type on vellum rather than a badge or score. The evidence itself stays in
   the folded panel below. */
.future { margin: 8px 0 10px; }
.future .future-head {
  margin: 0 0 3px; text-transform: uppercase; letter-spacing: .06em;
  font-size: var(--t-label);
}
.future .future-reason { margin: 2px 0; }
.card .words { font-style: italic; }
.card button { margin-top: 8px; width: 100%; }
/* The one thing on a card the player needs to see over the card itself. */
.card .refused { margin-top: 6px; color: var(--rubric); }
/* The panel is evidence under the card, not a second card. It reads quieter
   than the words above it and never competes with the button below it. */
.panel { margin-top: 8px; border-top: 1px solid var(--rule); padding-top: 6px; }
.panel summary { cursor: pointer; color: var(--ink-soft, inherit); }
.panel .heading { margin: 8px 0 2px; text-transform: uppercase; letter-spacing: .06em; }
.panel ul { margin: 0; padding-left: 16px; }
.panel li { margin: 2px 0; }
.panel .said { margin: 4px 0 8px; padding-left: 8px; border-left: 2px solid var(--rule); }
.panel .said p { margin: 0; font-style: italic; }
.panel .said footer { margin-top: 2px; }
/* A page this family improved. Marked, because acting on your own forgery is
   the whole reason it is on the panel. */
.panel .lie { color: var(--rubric); font-style: italic; }
footer { margin-top: 14px; border-top: 1px solid var(--rule); padding-top: 8px; }

/* THE MATCH COLLAPSES (issue #106). `.cards` at `minmax(210px, 1fr)` is one
   column below about 640px, which turns the game's most consequential
   recurring decision into three screens of scrolling with the numbers being
   weighed never on screen together. This does not touch the grid above the
   tier — wide, it stays the three cards it is. After the rule it overrides,
   not before it: same specificity on `.cards`, later wins. */
@media (max-width: 640px) {
  .cards {
    display: flex; flex-wrap: nowrap; overflow-x: auto; scroll-snap-type: x mandatory;
    -webkit-overflow-scrolling: touch; padding-bottom: 6px;
  }
  .card { flex: 0 0 82%; scroll-snap-align: start; }
  /* `table-layout: fixed` (issue #106). Left `auto`, a name like "Doran of
     Calder" set the column's minimum wider than `width: 100%` and the table
     grew past it rather than wrapping — `width` is advisory under `auto`
     layout, never a ceiling. `fixed` makes it one: content wraps instead. */
  .strip { display: table; width: 100%; table-layout: fixed; border-collapse: collapse; margin: 0 0 12px; }
  .strip th, .strip td { text-align: left; padding: 3px 10px 3px 0; font-weight: 400; }
  /* Every body row rules off from whatever is above it — the header, or the
     row before it. `thead`/`tbody` (added for valid markup — a bare `<tr>`
     under `<table>` is foster-parented by the HTML parser and confused Vue's
     patch on update) scope `:first-child` per section now, so this targets
     `tbody tr` directly rather than relying on position in the table. */
  .strip tbody tr td { border-top: 1px solid var(--rule); }
  /* Pinned to the foot of the viewport as the player scrolls the panel, not
     just the deck — declining survives a swipe past all three cards. */
  .decline {
    position: sticky; bottom: 0; background: var(--panel);
    padding-top: 8px; padding-bottom: max(8px, env(safe-area-inset-bottom));
  }
}
</style>
