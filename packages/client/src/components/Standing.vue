<script setup lang="ts">
import { computed } from 'vue';
import type { SessionView } from '@ed/core';
import type { StandingDelta } from '@ed/core';
import { needleAt } from '../lib/assize';
import { signed } from '../lib/jump';

const props = defineProps<{
  view: SessionView;
  jump: StandingDelta | null;
  /** Whether the host has the latest turn (issue #67). */
  saveStatus: 'idle' | 'saving' | 'saved' | 'error';
}>();

/**
 * WHAT THE PLAYER READS AS "SAVED" (issue #67).
 *
 * `writeSave` used to resolve into nothing the player could see — closing the
 * application was an act of faith. `null` for `idle`, deliberately: before the
 * first write there is nothing yet to report, and a header that says "saved"
 * before anything has happened is a lie a player has no way to catch.
 *
 * The words a title would have carried are IN the label instead — "hover is
 * not a channel" (issue #107) applies here exactly as it does to the marks on
 * the family tree: a thumb never hovers, so whatever a tooltip would have said
 * has to be readable without one.
 */
const saveLabel = computed(() => {
  switch (props.saveStatus) {
    case 'saving': return 'saving…';
    case 'saved': return 'saved';
    case 'error': return 'not saved — could not write to disk';
    default: return null;
  }
});

/**
 * HOW THE WORLD READS THE HOUSE, in words. `assize.pressure` runs from -1 (the
 * world can see you are failing, and is steadying you) to 1 (it can see you
 * are ahead, and is charging you for it). The Assize is explicit by design — a
 * hidden rubber band is a lie the player can feel and cannot name — so this is
 * drawn, and drawn in the same register the game says it in.
 */
const world = computed(() => {
  const a = props.view.assize;
  if (a.arm === 'resents') return 'The world has noticed you.';
  if (a.arm === 'steadies') return 'The world is being gentle with you.';
  return 'The world is not thinking about you.';
});

/**
 * The Ages the house is living through, named only where the chronicle has
 * named them (concept §20, rule one). An Age nobody has a word for yet shows
 * nothing here — the family finds out what these years were afterwards, like
 * everyone else, and the view withholds the name for exactly that reason.
 *
 * `ended === undefined` is what "living through" means, and it is not
 * decoration: `view.ages` carries the finished Ages too since issue #81, and
 * without this the header would list every Age the house has ever been
 * through as though it were still going on.
 */
const ages = computed(() =>
  props.view.ages.filter((a) => a.ended === undefined && a.name !== undefined));

/**
 * HOW MUCH, as distinct from which way (issue #51).
 *
 * `arm` is `pressure` thresholded to three words at ±0.35, so 0.4 and 0.95
 * print the same sentence and the difference between them only becomes visible
 * when the exaction lands. The sentence stays — it sets the register and it is
 * what a player reads first — and the rule underneath answers the other half.
 *
 * A scale on a page, not a HUD: a short ruled line, a tick where indifference
 * is, and a needle. No percentage anywhere; nobody in this world has one.
 */
const needle = computed(() => needleAt(props.view.assize.pressure));

/**
 * The reading in words, for anyone who cannot see the rule. It is the one
 * place the actual number is allowed out, because the alternative for a screen
 * reader is the sentence alone — which is the bug this issue is about.
 */
const reading = computed(() => {
  const p = props.view.assize.pressure;
  const lean = p > 0 ? 'against the house' : p < 0 ? 'in its favour' : 'neither way';
  return `The Assize leans ${lean}: ${p.toFixed(2)} of 1.`;
});

/**
 * WHAT THE HOUSE ONCE WAS, where that is more than what it is (issue #50).
 *
 * The rung falls the day the man holding it dies; `best` never does. The two
 * agreeing is the ordinary case and needs no second line — it is the fall that
 * wants remembering, and the year is what makes it a memory rather than a
 * boast.
 */
const reachedHigher = computed(() => {
  const a = props.view.ascension;
  if (a.best === a.rung) return null;
  return a.bestAt === undefined
    ? `${a.bestTitle}, once.`
    : `${a.bestTitle}, once, in ${a.bestAt}.`;
});

/**
 * DID THAT GO WELL? (issue #54)
 *
 * Every number up here is a level, and after turning a clock the only question
 * a player has is the derivative. 252 crowns might have been 190 and climbing
 * or 610 and collapsing, and the header read the same either way — this
 * codebase's failure mode exactly: nothing on the screen wrong, and the screen
 * no longer carrying information.
 *
 * Null where the jump did nothing. A header permanently decorated with "(0)"
 * is the noise the change is meant to remove, so the marks are absent rather
 * than zero, and a tier appears only on the jump that actually moved it.
 */
const moved = computed(() => props.jump);

const favours = computed(() => {
  const a = props.view.assize;
  const out: string[] = [];
  if (a.favour) out.push('a favour is owed');
  if (a.mercy) out.push('a mercy is running');
  if (a.exaction) out.push('an exaction is being collected');
  return out;
});

/**
 * THE MUSTER, in one line (issue #89, Stage 2 — #95). Absent — not merely
 * blank — with no commitment standing, which is nearly always (#90 measures
 * a median gap of ~250 years between Wars): the header carries nothing
 * about a war the house is not in, the same way it carries nothing about
 * an Assize favour that is not running.
 */
const muster = computed(() => {
  const m = props.view.muster;
  if (!m) return null;
  const tideWord = m.tide >= 60 ? 'in the house\'s favour' : m.tide <= 40 ? 'against the house' : 'holding, for now';
  const men = `${m.men} ${m.men === 1 ? 'man' : 'men'} in the field`;
  return `${men}, and the tide runs ${tideWord}.`;
});
</script>

<template>
  <header class="standing">
    <div class="year">
      <strong>{{ view.year }}</strong>
      <span class="dim small">generation {{ view.generation }}</span>
      <span
        v-if="saveLabel"
        class="dim small save"
        :class="{ warn: saveStatus === 'error' }"
      >{{ saveLabel }}</span>
    </div>

    <div class="house">
      <div class="name">
        {{ view.houseName }}
        <!-- THE RUN'S NAME (issue #59). Determinism is per-world and carefully
             kept, so the seed is what identifies this Long Line — and it
             left the screen at `Begin` and never came back, which meant a
             player could not say which run they had played, replay it, or
             report a bug against it. -->
        <span class="dim seed">seed #{{ view.seed }}</span>
      </div>
      <div class="dim small">
        {{ view.treasury }} crowns<span
          v-if="moved && moved.treasury !== 0"
          class="delta"
        > ({{ signed(moved.treasury) }})</span> ·
        <span :class="{ delta: moved?.respect }">{{ view.respect }}</span><span
          v-if="moved?.respect"
          class="delta"
        > (was {{ moved.respect.from }})</span> ·
        discontent {{ view.discontent }}<span
          v-if="moved && moved.discontent !== 0"
          class="delta"
        > ({{ signed(moved.discontent) }})</span> ·
        <span :class="{ delta: moved && moved.clauses > 0 }">
          {{ view.clausesRecovered }}/{{ view.clausesTotal }} clauses recovered</span><span
            v-if="moved && moved.clauses > 0"
            class="delta"
          > ({{ signed(moved.clauses) }})</span>
      </div>
    </div>

    <!-- THE LADDER, AND WHAT IS IN THE WAY OF THE NEXT RUNG (concept §22,
         issue #212). The exact predicate still exists on the read model for
         tooling and deep inspection, but this header speaks in the world's
         language: one dominant obstacle, then one kind of action the house can
         take. No progress bar and no wall of thresholds. -->
    <div class="rung">
      <div class="name">{{ view.ascension.title }}</div>

      <template v-if="view.ascension.diagnosis">
        <div class="rubric small next-rung">
          Next rung · {{ view.ascension.diagnosis.targetTitle }}
          <span v-if="view.ascension.diagnosis.name" class="dim">
            · {{ view.ascension.diagnosis.name }}
          </span>
        </div>
        <div
          v-for="blocker in view.ascension.diagnosis.blockers"
          :key="blocker.kind + blocker.text"
          class="ladder-blocker small"
        >
          <div>{{ blocker.text }}</div>
          <div class="soft">{{ blocker.hint }}</div>
        </div>
      </template>

      <div v-else-if="view.ascension.foremost" class="dim small">
        {{ view.ascension.foremost.name }} — nothing stands in the way.
      </div>
      <div v-else class="dim small">nobody of the house is on the ladder</div>

      <!-- THE READING (issue #50). Kept tertiary rather than promoted into a
           progress treatment: this is the existing exact inspection, while
           the diagnosis above is the primary answer to "what next?". -->
      <div v-if="view.ascension.foremost" class="dim small ladder-measure">
        power {{ Math.round(view.ascension.foremost.power) }} of 100 ·
        {{ view.ascension.foremost.spells }}
        {{ view.ascension.foremost.spells === 1 ? 'book' : 'books' }}
      </div>
      <!-- THE HIGH-WATER MARK. Invariant 14 keeps exactly one number across a
           Long Line — "a family that made a Hierophant once made one" —
           and no pixel printed it, so a house that put one on the ladder in
           1400 and buried him in 1431 read ever after like a house that never
           managed it. Shown only when it is not the current rung: when they
           agree the line above has already said it. -->
      <div v-if="reachedHigher" class="soft small">{{ reachedHigher }}</div>
    </div>
    <div v-if="ages.length" class="age">
      <div v-for="age in ages" :key="age.age" class="name">
        {{ age.name }}<span class="dim small"> · since {{ age.began }}</span>
      </div>
    </div>

    <div class="world">
      <!-- An arm that flipped between two renders used to just be a different
           sentence, as though it had always said that.

           The mark is neutral because the sentence is not: "it did not,
           before" reads correctly after "the world has noticed you" and
           becomes a riddle after "the world is not thinking about you". Three
           arms, one mark, and the sentence above it carries the meaning. -->
      <div class="soft small">
        {{ world }}<span v-if="moved?.arm" class="delta"> That is new.</span>
      </div>
      <!-- WHAT THE NAME COSTS (issue #62). The player gave this Head a Head's
           name, and the bar the world grades the house on rose for it. Said
           in words beside the needle it moves: invariant 13 does not allow a
           reading the player can feel and cannot name. -->
      <div v-if="view.assize.measuredAgainst" class="small namesake">
        Measured against the {{ view.assize.measuredAgainst.name }} who came before.
      </div>
      <!-- The magnitude the sentence throws away. Left is the world steadying
           a house it can see is failing; right is the world charging one it can
           see is ahead — the same order as the number (invariant 13). -->
      <div class="dim small gauge-reading">{{ reading }}</div>
      <div class="gauge" aria-hidden="true">
        <span class="tick" />
        <span class="needle" :style="{ left: needle + '%' }" />
      </div>
      <div v-if="favours.length" class="rubric small">{{ favours.join(' · ') }}</div>
      <div v-if="muster" class="rubric small">{{ muster }}</div>
      <div v-if="view.guardian" class="dim small">
        {{ view.guardian.name }} watches, and has since {{ view.guardian.since }}.
      </div>
    </div>
  </header>
</template>

<style scoped>
.standing {
  display: flex; align-items: flex-start; gap: 28px; flex-wrap: wrap;
  padding: 14px 26px; border-bottom: 1px solid var(--rule);
  background: var(--vellum-deep);
}
.year strong { font-size: var(--t-year); font-weight: 500; display: block; line-height: 1.1; }
.year { min-width: 90px; }
.house .name, .rung .name { font-size: var(--t-body); }
.rung .name { color: var(--rubric); }
.next-rung { margin-top: 2px; }
.ladder-blocker { max-width: 48ch; margin-top: 2px; }
.ladder-blocker .soft { margin-top: 2px; }
.ladder-measure { margin-top: 2px; }
.age .name { font-size: var(--t-body); color: var(--rubric); }
.world { margin-left: auto; text-align: right; max-width: 34ch; }
/* What the last turn of the clock did. Ink against the dimmed levels it sits
   in, because the change is the news and the level is the context. */
.delta { color: var(--ink); }
/* Small enough to ignore across a Long Line, and there when it is wanted. */
.seed { font-size: var(--t-label); letter-spacing: .04em; }
/* Its own line under "generation N" rather than run into it — a fact about
   the host, not about the house. */
.save { display: block; margin-top: 2px; }
.save.warn { color: var(--rubric); }

/* A RULED LINE, NOT A PROGRESS BAR. It is drawn the way a scale is drawn in
   the margin of a page: a hairline, a tick at the middle for the world not
   thinking about you, and one pen stroke for where the house actually sits. */
.gauge-reading { margin-top: 3px; }
.gauge {
  position: relative; margin: 3px 0 0 auto; width: 108px; height: 9px;
  border-bottom: 1px solid var(--rule);
}
.gauge .tick, .gauge .needle { position: absolute; bottom: 0; width: 1px; }
.gauge .tick { left: 50%; height: 4px; background: var(--ink-faint); }
/* The needle is the only thing here with weight, and it is ink rather than
   rubric: the Assize leaning is weather, not an alarm. The flags below it are
   the alarm, and they are already red. */
.namesake { color: var(--rubric); font-style: italic; margin-top: 2px; }
.gauge .needle { height: 9px; background: var(--ink); transform: translateX(-0.5px); }

/* NARROW (issue #57). The header is a flex row that wraps to six stacked
   blocks on a phone and ate 270px of an 844px screen before the board began.
   The year and the house stay; the rest tightens up and the world's block
   stops being right-aligned, because on one column there is nothing to align
   it against. Nothing here applies above the breakpoint. */
@media (max-width: 1100px) {
  .standing { gap: 6px 18px; padding: 10px 16px; }
  .year strong { font-size: var(--t-head); }
  .year { min-width: 0; display: flex; align-items: baseline; gap: 8px; }
  .house .name, .rung .name, .age .name { font-size: var(--t-card); }
  .world { margin-left: 0; text-align: left; max-width: none; }
  .gauge { margin-left: 0; }
}
</style>
