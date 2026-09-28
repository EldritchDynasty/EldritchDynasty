<script setup lang="ts">
import { computed } from 'vue';
import type { SessionView } from '@ed/core';
import { MARKS, type Mark, madnessMark } from '../lib/marks';

type MemberView = SessionView['halls'][number]['members'][number];

const props = defineProps<{
  member: MemberView;
  /** What the content calls things. See `SessionView.attributes` / `.traits`. */
  names: SessionView['attributes'];
  traitNames: SessionView['traits'];
  open: boolean;
  showRelevance?: boolean;
}>();
defineEmits<{ (e: 'select', id: string): void; (e: 'line'): void }>();

/**
 * WHAT THE BOOK SAYS ABOUT THEM, and only that (issue #19).
 *
 * `record.claimed` is the list of attributes the chronicle has actually
 * spoken about; `record.attrs` fills in the real value for everything else so
 * a UI never has to fall back, and drawing that unfiltered would put a
 * woman's Fecundity on her card. Nobody in this world has a number for
 * Fecundity. They have a grandmother who bore seven and a cousin who bore
 * none, and the marriage market's line read is the whole of what anyone can
 * honestly say — so a card that printed the number would delete §7.
 *
 * A person the book has never described therefore shows no attributes at all,
 * which is not a gap. It is the house not having written anything down.
 */
const said = computed(() => props.member.record.claimed.map((attr) => ({
  attr,
  name: props.names.find((a) => a.attr === attr)?.name ?? attr,
  claimed: Math.round(props.member.record.attrs[attr] ?? 0),
  real: Math.round(props.member.attrs[attr] ?? 0),
})));

/** The three the record is loudest about — a card is not a stat sheet. */
const loudest = computed(() => [...said.value].sort((a, b) => b.claimed - a.claimed).slice(0, 3));

/** The traits the book credits them with, under the names the content gives. */
const claimedTraits = computed(() => props.member.record.claimedTraits.map(
  (t) => props.traitNames.find((x) => x.trait === t)?.name ?? t));

/** The record's line on their parentage differs from the truth. A forged dowry does this. */
/**
 * §22's mark that is not the mark for death. The dead are not on this tree at
 * all — they are in the chronicle, which is where a house keeps its dead — so
 * the only person here who is not living is the one the rite took, and she
 * stays where she was: greyed, named, and still somebody's daughter.
 */
const consumed = computed(() => props.member.status === 'vessel_consumed');

/**
 * THE MARKS ON THE ROW, drawn from the one table (issue #107).
 *
 * They were six spans, each with its glyph in the template and its meaning in
 * a `title` — which is to say, on a phone, six glyphs and no meanings. The
 * glyph and the sentence come from `lib/marks.ts` together now, so the legend
 * in the help panel cannot say something different from the card, and the
 * sentence goes on `aria-label` as well as on the tooltip.
 */
const marks = computed<Mark[]>(() => {
  const m = props.member;
  const out: Mark[] = [];
  // The seal first. Nothing takes it out of the main house (invariant 12).
  if (m.head) out.push(MARKS.seal);
  if (m.awakened) out.push(m.expresses ? MARKS.expresses : MARKS.carries);
  if (m.madness > 0) out.push(madnessMark(m.madness));
  if (m.drift) out.push(MARKS.drift);
  // Not a cross and not an obelus. There is no mark for this, so it is a name
  // with a line drawn round it and nothing written after.
  if (consumed.value) out.push(MARKS.given);
  return out;
});

const foundling = computed(() => {
  const r = props.member.record.parents;
  const t = props.member.parents;
  return r.mother !== t.mother || r.father !== t.father;
});

const relevance = computed(() => props.showRelevance ? (props.member.relevance ?? []) : []);
const succession = computed(() => {
  if (props.member.succession === 'heir') return 'next to hold the seal';
  if (props.member.succession === 'possible') return 'may hold the seal';
  return undefined;
});
</script>

<template>
  <div
    :id="'member-' + member.id"
    class="member"
    :class="{ open, head: member.head, drift: member.drift, consumed, relevant: relevance.length > 0 }"
  >
    <button
      class="face"
      :aria-expanded="open"
      :aria-controls="'detail-' + member.id"
      @click="$emit('select', member.id)"
    >
      <span class="name">
        {{ member.name }}<span v-if="member.epithet" class="dim"> {{ member.epithet }}</span>
      </span>
      <!-- SAID AS WELL AS DRAWN (issues #107, #275). A hover tooltip is
           not a reading channel: the same sentence is the accessible name,
           and the whole table is printed in the visible Marks legend that a
           thumb can open. -->
      <span class="marks">
        <span class="dim"><span aria-hidden="true">{{ member.sex === 'female' ? '♀' : '♂' }}</span><span class="said-not-shown">{{ member.sex === 'female' ? 'woman' : 'man' }}, </span> {{ member.age }}</span>
        <span
          v-for="mark in marks"
          :key="mark.kind"
          :class="mark.kind"
          :aria-label="mark.says"
          role="img"
        >{{ mark.glyph }}</span>
      </span>
    </button>

    <div v-if="succession" class="succession small rubric">{{ succession }}</div>
    <div v-if="relevance.length" class="relevance small">
      <span class="rubric">For the plan:</span>
      <span v-for="(item, i) in relevance" :key="item.reason">
        <span v-if="i" class="dim"> · </span>{{ item.reason }}
      </span>
    </div>

    <!-- WHERE SHE CAME FROM, on the row (issue #56). §7's market is houses
         trading blood, so the house a spouse married in from is the one fact
         about her the tree has to carry — and it lived inside a card. -->
    <div v-if="member.spouse?.marriedIn && member.spouse.house" class="dim small from">
      of {{ member.spouse.house }}
    </div>

    <div v-if="loudest.length" class="claimed dim small">
      <span v-for="a in loudest" :key="a.attr">{{ a.name }} {{ a.claimed }}</span>
    </div>

    <div v-if="open" :id="'detail-' + member.id" class="detail">
      <div v-if="claimedTraits.length" class="small">
        <span class="dim">said to be</span> {{ claimedTraits.join(', ') }}
      </div>
      <div v-if="member.spouse" class="small dim">
        married to {{ member.spouse.name }}<span v-if="member.spouse.marriedIn && member.spouse.house">,
        of {{ member.spouse.house }}</span>
      </div>
      <div v-if="member.contract" class="small dim">holds a contract as {{ member.contract }}</div>
      <!-- Only from the seat, and only when the card is open (issue #56). The
           halls are the living household; the line behind them is a different
           question, asked from the person currently answering it. -->
      <button v-if="member.head" class="quiet small" @click.stop="$emit('line')">
        Who has held the seal
      </button>
      <div v-if="member.record.claimedDeath" class="small dim">
        the book has them dying in {{ member.record.claimedDeath.year }},
        of {{ member.record.claimedDeath.cause }}
      </div>
      <div v-if="foundling" class="small rubric">the book gives them a different mother or father than they have</div>

      <!-- CLAIMED, then REAL. In that order, always: the recorded person is
           the one the house has, and the other one is what you are checking
           them against. -->
      <table v-if="said.length" class="attrs small">
        <tr class="dim"><th>attribute</th><th>the book</th><th>the person</th></tr>
        <tr v-for="a in said" :key="a.attr" :class="{ apart: a.claimed !== a.real }">
          <td>{{ a.name }}</td><td>{{ a.claimed }}</td><td>{{ a.real }}</td>
        </tr>
      </table>
      <p v-else class="small dim">The book has never said a word about what they were like.</p>
    </div>
  </div>
</template>

<style scoped>
.member {
  border: 1px solid var(--rule); border-radius: 3px;
  background: var(--panel); padding: 6px 9px; min-width: 190px;
}
.member.head { border-color: var(--rubric); }
.member.relevant { box-shadow: inset 3px 0 0 var(--rubric); }
.member.consumed { border-style: dashed; opacity: 0.55; }
.given { color: var(--rubric); }
.member.open { background: var(--vellum-deep); }
.face {
  display: flex; align-items: baseline; gap: 10px; width: 100%;
  background: none; border: 0; padding: 0; text-align: left;
}
.name { flex: 1; font-size: var(--t-card); }
.marks { display: flex; gap: 5px; font-size: var(--t-fine); }
/* Keyed by `MarkKind`, so the class and the meaning cannot come apart. */
.seal { color: var(--rubric); }
.madness { color: var(--rubric); }
/* The carried mark is the same mark, unfilled and quieter. It is the same
   event in the family's life and not the same thing in the person. */
.carries { color: var(--ink-soft); }
.drift { color: var(--ink-faint); }
.claimed { display: flex; gap: 9px; margin-top: 3px; font-size: var(--t-label); }
.succession { margin-top: 2px; }
.relevance { margin-top: 4px; line-height: 1.35; }
.from { margin-top: 2px; }
.detail { margin-top: 8px; border-top: 1px solid var(--rule); padding-top: 7px; display: grid; gap: 4px; }
.attrs { border-collapse: collapse; width: 100%; }
.attrs th { text-align: left; font-weight: 400; }
.attrs td { padding-right: 10px; }
.attrs .apart td { color: var(--rubric); }
</style>
