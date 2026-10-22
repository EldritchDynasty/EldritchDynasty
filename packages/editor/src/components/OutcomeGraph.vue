<script setup lang="ts">
import { computed } from 'vue';
import type { Choice, Content, EventTemplate, Outcome } from '@ed/schema';
import EffectEditor from './EffectEditor.vue';
import PrimordialEditor from './PrimordialEditor.vue';
import Mark from './Mark.vue';
import { valenceOf, type Valence } from '../lib/valence';

/**
 * THE CHOICE & OUTCOME TREE — editable (was issue #21's read-only SVG).
 *
 * The picture was the right idea and half the job: it showed the shape of the
 * branch and could not change it, so every real edit still meant finding the
 * event in a 400-line YAML file and counting indentation.
 *
 * Two things it draws that are not obvious from the YAML, and both are the
 * kind of mistake that produces content which validates and behaves wrongly:
 *
 *   A CHECKED branch resolves by BAND, so its outcomes' weights are unused.
 *   Showing a percentage there would be showing a number nothing reads.
 *
 *   Weights that do not sum to 100 are legal and almost always a slip, so the
 *   sum is shown against every unchecked group rather than only failing later.
 */
const props = defineProps<{ event: EventTemplate; eventIds: string[]; content?: Content }>();
const emit = defineEmits<{ change: [] }>();

const slotNames = computed(() => Object.keys(props.event.slots));

const branches = computed<{ choice?: Choice; label: string; outcomes: Outcome[]; check?: string }[]>(() => {
  const i = props.event.interaction;
  if (i.kind === 'narration') return [{ label: 'it fires', outcomes: i.outcomes }];
  return i.choices.map((c) => ({ choice: c, label: c.label, outcomes: c.outcomes, check: c.check }));
});

function touch() { emit('change'); }

/** The check that resolves a branch, if any — its outcomes' weights are then unused. */
function checkOf(branch: { check?: string }) {
  return branch.check ? props.event.checks.find((c) => c.id === branch.check) : undefined;
}

function weightSum(outcomes: Outcome[]): number {
  return outcomes.reduce((s, o) => s + o.weight, 0);
}

function pct(o: Outcome, outcomes: Outcome[]): string {
  const sum = weightSum(outcomes);
  return sum > 0 ? `${Math.round((100 * o.weight) / sum)}%` : '—';
}

// ── Branches ────────────────────────────────────────────────────────────
function addChoice() {
  const i = props.event.interaction;
  if (i.kind === 'narration') return;
  let n = i.choices.length + 1;
  while (i.choices.some((c) => c.id === `choice_${n}`)) n += 1;
  i.choices.push({
    id: `choice_${n}`,
    label: 'A new way about it',
    requires: [],
    outcomes: [blankOutcome(`outcome_${n}`)],
  });
  touch();
}

function removeChoice(i: number) {
  const inter = props.event.interaction;
  if (inter.kind === 'narration') return;
  inter.choices.splice(i, 1);
  touch();
}

function setCheck(choice: Choice, id: string) {
  if (id) choice.check = id;
  else delete choice.check;
  touch();
}

// ── Outcomes ────────────────────────────────────────────────────────────
function blankOutcome(id: string): Outcome {
  return { id, weight: 100, text: '', tags: [], effects: [] };
}

function addOutcome(outcomes: Outcome[]) {
  let n = outcomes.length + 1;
  while (outcomes.some((o) => o.id === `outcome_${n}`)) n += 1;
  outcomes.push(blankOutcome(`outcome_${n}`));
  touch();
}

function removeOutcome(outcomes: Outcome[], i: number) {
  outcomes.splice(i, 1);
  touch();
}

function setTags(o: Outcome, raw: string) {
  o.tags = raw.split(',').map((t) => t.trim()).filter(Boolean);
  touch();
}

// ── The inline follow-up ────────────────────────────────────────────────
/** Every event this outcome could hand off to — the follow-up picker's list. */
const followUps = computed(() => props.eventIds.filter((id) => id !== props.event.id));

function toggleNext(o: Outcome) {
  if (o.next) delete o.next;
  else o.next = { event: '', after: 'next_generation', keep: [] };
  touch();
}

function setKeep(o: Outcome, raw: string) {
  if (!o.next) return;
  o.next.keep = raw.split(',').map((t) => t.trim()).filter(Boolean);
  touch();
}

const SCHEDULES = ['immediate', 'next_generation', 'a window…'];

function scheduleKind(o: Outcome): string {
  const a = o.next?.after;
  return typeof a === 'string' ? a : 'a window…';
}

/**
 * Which way an outcome goes for the house — derived from its own effects, so
 * it cannot disagree with what the outcome does and it moves the moment an
 * effect below it is edited (`lib/valence.ts`).
 */
function tone(o: Outcome): Valence {
  return valenceOf(o.effects);
}

function setSchedule(o: Outcome, kind: string) {
  if (!o.next) return;
  o.next.after = kind === 'a window…' ? { minYears: 20, maxYears: 60 } : (kind as 'immediate');
  touch();
}
</script>

<template>
  <div>
    <div v-for="(b, bi) in branches" :key="bi" class="branch">
      <div class="branch-head">
        <template v-if="b.choice">
          <input class="bid" type="text" :value="b.choice.id" @change="b.choice!.id = ($event.target as HTMLInputElement).value; touch()" />
          <input class="blabel" type="text" :value="b.choice.label" @input="b.choice!.label = ($event.target as HTMLInputElement).value; touch()" />
          <select :value="b.choice.check ?? ''" @change="setCheck(b.choice!, ($event.target as HTMLSelectElement).value)">
            <option value="">no check — weights decide</option>
            <option v-for="c in event.checks" :key="c.id" :value="c.id">resolved by {{ c.id }}</option>
          </select>
          <button class="btn tiny" @click="removeChoice(bi)">remove branch</button>
        </template>
        <template v-else>
          <span class="bid">it fires</span>
        </template>
      </div>

      <div v-if="checkOf(b)" class="bandnote">
        resolved by band — {{ checkOf(b)!.bands.map((x) => `≥${x.atLeast} → ${x.outcome}`).join('  ·  ') }}
      </div>
      <div v-else-if="weightSum(b.outcomes) !== 100" class="issue warning">
        weights sum to {{ weightSum(b.outcomes) }}, not 100
      </div>

      <div v-for="(o, oi) in b.outcomes" :key="oi" class="outcome">
        <div class="o-head">
          <!-- `plain` draws nothing: most outcomes are plain, and a mark on
               every one of them says nothing at all. -->
          <span v-if="tone(o) !== 'plain'" class="marks" :class="`tone-${tone(o)}`">
            <Mark
              :name="tone(o) === 'boon' ? 'boon' : 'blow'" :size="15"
              :title="tone(o) === 'boon' ? 'the house gains' : 'the house loses'"
            />
          </span>
          <input class="oid" type="text" :value="o.id" @change="o.id = ($event.target as HTMLInputElement).value; touch()" />
          <template v-if="!checkOf(b)">
            <span class="fk">weight</span>
            <input class="ow" type="number" :value="o.weight" @input="o.weight = Number(($event.target as HTMLInputElement).value); touch()" />
            <span class="fk">{{ pct(o, b.outcomes) }}</span>
          </template>
          <span v-else class="fk">weight unused — this branch resolves by band</span>
          <input class="otags" type="text" placeholder="tags" :value="o.tags.join(', ')" @input="setTags(o, ($event.target as HTMLInputElement).value)" />
          <button class="btn tiny" @click="removeOutcome(b.outcomes, oi)">×</button>
        </div>

        <textarea class="otext" rows="3" placeholder="what happens, in the voice"
                  :value="o.text" @input="o.text = ($event.target as HTMLTextAreaElement).value; touch()" />

        <label class="sub">Effects</label>
        <EffectEditor :model-value="o.effects" :slot-names="slotNames"
                      @update:model-value="(v) => { o.effects = v; touch(); }" />

        <PrimordialEditor :event="event" :outcome="o" :content="content" @change="touch" />
        <div class="nextline">
          <button class="btn tiny" @click="toggleNext(o)">
            {{ o.next ? 'remove follow-up' : '+ follow-up scene' }}
          </button>
          <template v-if="o.next">
            <span class="fk">then</span>
            <select :value="o.next.event" @change="o.next!.event = ($event.target as HTMLSelectElement).value; touch()">
              <option value="">— pick an event —</option>
              <option v-for="id in followUps" :key="id" :value="id">{{ id }}</option>
            </select>
            <select :value="scheduleKind(o)" @change="setSchedule(o, ($event.target as HTMLSelectElement).value)">
              <option v-for="s in SCHEDULES" :key="s" :value="s">{{ s }}</option>
            </select>
            <template v-if="typeof o.next.after !== 'string'">
              <input class="ow" type="number" :value="o.next.after.minYears"
                     @input="(o.next!.after as { minYears: number }).minYears = Number(($event.target as HTMLInputElement).value); touch()" />
              <span class="fk">to</span>
              <input class="ow" type="number" :value="o.next.after.maxYears"
                     @input="(o.next!.after as { maxYears: number }).maxYears = Number(($event.target as HTMLInputElement).value); touch()" />
              <span class="fk">years</span>
            </template>
            <span class="fk">keeping</span>
            <input class="otags" type="text" placeholder="slots to carry over" :value="o.next.keep.join(', ')"
                   @input="setKeep(o, ($event.target as HTMLInputElement).value)" />
          </template>
        </div>
      </div>

      <button class="btn tiny" @click="addOutcome(b.outcomes)">+ outcome</button>
    </div>

    <button v-if="event.interaction.kind !== 'narration'" class="btn" @click="addChoice">+ add branch</button>
  </div>
</template>

<style scoped>
.branch { border-left: 3px solid var(--rule); padding: 7px 0 7px 11px; margin-bottom: 12px; }
.branch-head { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.branch-head input, .branch-head select { width: auto; margin: 0; font-size: 12.5px; padding: 4px 6px; }
.bid { font-weight: 600; max-width: 150px; }
.blabel { min-width: 260px; }
.bandnote { font-size: 11.5px; color: var(--uncommon); margin: 4px 0; }
.outcome { border-left: 2px solid var(--rule); padding: 5px 0 5px 10px; margin: 7px 0; }
.o-head { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.o-head input, .o-head select { width: auto; margin: 0; font-size: 12.5px; padding: 4px 6px; }
.oid { font-weight: 600; max-width: 150px; }
.ow { max-width: 68px; }
.otags { min-width: 130px; }
.otext { width: 100%; margin: 5px 0; font-size: 13px; }
.nextline { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; margin-top: 5px; }
.nextline select, .nextline input { width: auto; margin: 0; font-size: 12.5px; padding: 4px 6px; }
.sub { display: block; font-size: 10.5px; letter-spacing: .1em; text-transform: uppercase; color: var(--ink-faint); margin: 6px 0 2px; }
.fk { font-size: 11px; letter-spacing: .06em; color: var(--ink-faint); }
.btn.tiny { padding: 2px 7px; font-size: 11px; }
</style>
