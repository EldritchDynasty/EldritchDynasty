<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { Content, Issue } from '@ed/schema';
import { FREQUENCY_PROFILES, splitSentences, PROSE_SENTENCE_THRESHOLD, proseIssues } from '@ed/schema';
import { markDirty, store } from '../lib/store';
import FrequencyPicker from './FrequencyPicker.vue';
import SaveControl from './SaveControl.vue';
import ConditionBuilder from './ConditionBuilder.vue';
import OutcomeGraph from './OutcomeGraph.vue';
import BodyEditor from './BodyEditor.vue';
import ProseVariantEditor from './ProseVariantEditor.vue';
import ChroniclePreview from './ChroniclePreview.vue';
import NewItem from './NewItem.vue';
import SlotEditor from './SlotEditor.vue';
import CheckEditor from './CheckEditor.vue';
import DeciderPicker from './DeciderPicker.vue';
import Mark from './Mark.vue';
import { PURPOSE_LABEL, PURPOSE_MARK, TIER_MARK } from '../lib/marks';

const props = defineProps<{ content: Content; issues: Issue[] }>();

/**
 * No local copy (issue #20): editing `current.title` mutates the one shared
 * model directly, so it is still there after switching tabs and back.
 *
 * `store.bundle.events` and NOT `content.events`, which are two different
 * arrays now. `indexContent` compiles inline follow-ups into arcs
 * (`schema/src/desugar.ts`) and grafts an `arc` block onto the events they
 * name — by copying them, because the authored bundle must stay authored or
 * the editor would write a synthetic arc id back into somebody's YAML. Editing
 * `content.events` would therefore edit a throwaway copy for exactly those
 * events, and the edit would vanish on the next render with nothing to say so.
 *
 * `props.content` is still what validation and every cross-reference lookup
 * read: it is the compiled view, and this is the authored one.
 */
const events = computed(() => store.bundle.events);
const selectedId = ref(events.value[0]?.id ?? '');
const search = ref('');
const freqFilter = ref<string>('all');

const current = computed(() => events.value.find((e) => e.id === selectedId.value));

// Every field on the selected event feeds one deep watcher rather than an
// `@input` handler on each control — simpler, and it also catches edits made
// by the sub-editors below (conditions, outcomes, body) without each of them
// needing to know about the store.
watch(current, () => { if (current.value) markDirty('events', current.value.id); }, { deep: true });

const shown = computed(() =>
  events.value.filter((e) => {
    if (freqFilter.value !== 'all' && e.frequency !== freqFilter.value) return false;
    const q = search.value.toLowerCase();
    return !q || e.id.includes(q) || e.title.toLowerCase().includes(q) || e.tags.some((t) => t.includes(q));
  }));

const myIssues = computed(() =>
  props.issues.filter((i) => i.where.startsWith(`event:${selectedId.value}`)));

/** Live voice-contract read on the body being edited. */
const prose = computed(() => {
  const e = current.value;
  if (!e) return { sentences: 0, long: false, issues: [] as Issue[] };
  const sentences = splitSentences(e.body).length;
  return {
    sentences,
    long: sentences > PROSE_SENTENCE_THRESHOLD,
    issues: proseIssues('body', e.body),
  };
});

const slotNames = computed(() => Object.keys(current.value?.slots ?? {}));
const eventIds = computed(() => events.value.map((e) => e.id));

/**
 * The deep watcher above catches most edits, but a sub-editor that mutates a
 * nested array in place (splice on `outcomes`, delete on `slots`) can land
 * between flushes. Every sub-editor emits `change` as well, and both routes
 * end here — belt and braces on the one thing that must never be silently
 * lost, which is an edit.
 */
function touched() {
  if (current.value) markDirty('events', current.value.id);
}

/**
 * A new event that already passes validation. Three distinct purposes, a body
 * over the twenty-five-word floor, two branches with weights that sum — an
 * author's first sight of a new template should be a template, not a list of
 * everything wrong with it.
 */
function seedEvent(id: string) {
  return {
    id,
    title: 'An Untitled Scene',
    tier: 'family',
    frequency: 'uncommon',
    weight: 100,
    repeatable: true,
    cooldownYears: 0,
    tags: [],
    purposes: ['worldbuild_through_action', 'change_relationship', 'change_standing'],
    slots: { HEAD: { role: 'head', castBy: 'engine', optional: false, filters: [], bind: 'event' } },
    checks: [],
    reads: [],
    accounts: [],
    body: 'Something happens in the yard, in front of enough people that it will be talked about, '
      + 'and {HEAD} is the one who has to say what the house makes of it. Write the rest of this.',
    interaction: {
      kind: 'choice',
      decidedBy: 'player',
      choices: [
        { id: 'one_way', label: 'One way about it', requires: [], outcomes: [{ id: 'went_one_way', weight: 100, text: 'And so it went.', tags: [], effects: [] }] },
        { id: 'another', label: 'Another', requires: [], outcomes: [{ id: 'went_another', weight: 100, text: 'And so it went instead.', tags: [], effects: [] }] },
      ],
    },
  } as never;
}

function selectNew(id: string) {
  selectedId.value = id;
}

/**
 * Narration has one branch and nothing to decide; a choice has several. Turning
 * one into the other is a real authoring move — a scene grows a decision, or
 * loses one — and doing it by hand means rewriting the interaction block.
 */
function setInteractionKind(kind: string) {
  const e = current.value;
  if (!e || e.interaction.kind === kind) return;
  if (kind === 'narration') {
    const first = e.interaction.kind === 'narration' ? e.interaction.outcomes : e.interaction.choices[0]!.outcomes;
    e.interaction = { kind: 'narration', outcomes: first };
  } else if (e.interaction.kind === 'narration') {
    e.interaction = {
      kind: kind as 'choice',
      decidedBy: 'player',
      choices: [
        { id: 'choice_1', label: 'One way about it', requires: [], outcomes: e.interaction.outcomes },
        { id: 'choice_2', label: 'Another', requires: [], outcomes: [{ id: 'outcome_2', weight: 100, text: '', tags: [], effects: [] }] },
      ],
    };
  } else {
    e.interaction = { ...e.interaction, kind: kind as 'dispatch' };
  }
  touched();
}
const undefinedTokens = computed(() => {
  const e = current.value;
  if (!e) return [];
  const used = [...e.body.matchAll(/\{([A-Z_][A-Z0-9_]*)\}/g)].map((m) => m[1]!);
  return [...new Set(used)].filter((t) => !slotNames.value.includes(t));
});

/** Built here rather than in the template: `{...}` collides with Vue's delimiters. */
const undefinedTokenList = computed(() =>
  undefinedTokens.value.map((t) => '{' + t + '}').join(', '));

const perAge = computed(() => {
  const map = new Map<string, number>();
  for (const a of props.content.ages) map.set(a.id, 0);
  for (const e of events.value) {
    for (const a of e.ages?.only ?? []) map.set(a, (map.get(a) ?? 0) + 1);
  }
  return [...map].sort((a, b) => a[1] - b[1]);
});

const byFrequency = computed(() => {
  const out: Record<string, number> = { common: 0, uncommon: 0, rare: 0, mythic: 0 };
  for (const e of events.value) out[e.frequency] = (out[e.frequency] ?? 0) + 1;
  return out;
});
</script>

<template>
  <header>
    <h2>Events</h2>
    <p>
      Every template declares exactly three purposes and one frequency. Frequency is a
      rationing tier, not a weight synonym: it decides caps, cooldowns, whether a Record
      choice is required, whether the world remembers, and how the chronicle renders it.
    </p>
  </header>

  <div class="bar">
    <input type="text" v-model="search" placeholder="search id, title, tag" style="max-width:240px" />
    <button
      v-for="f in ['all', 'common', 'uncommon', 'rare', 'mythic']" :key="f" class="btn"
      :style="freqFilter === f ? 'border-color:var(--rubric);color:var(--rubric)' : ''"
      :aria-pressed="freqFilter === f"
      @click="freqFilter = f"
    >{{ f }}<span v-if="f !== 'all'" class="count">{{ byFrequency[f] ?? 0 }}</span></button>
  </div>

  <div class="cols wide">
    <div>
      <div class="panel" style="margin-bottom:12px">
        <h3>{{ shown.length }} events</h3>
        <NewItem collection-key="events" :seed="seedEvent" @created="selectNew" />
        <div class="list">
          <button
            v-for="e in shown" :key="e.id" class="row"
            :class="{ on: e.id === selectedId }" @click="selectedId = e.id"
          >
            <span class="badge" :class="e.frequency">{{ e.frequency }}</span>
            <span class="t">{{ e.title }}<br /><span class="sub">{{ e.tier }} · {{ e.id }}</span></span>
            <!-- What it is aimed at, a rule, and one mark per declared purpose.
                 Nothing here is chosen: the three-purpose rule guarantees
                 exactly three, and `marks.ts` maps each to its own mark. Two
                 templates with the same row of marks do the same three jobs,
                 which is the duplicate sweep (concept §25) made visible. -->
            <span class="marks">
              <Mark :name="TIER_MARK[e.tier]" :size="14" :title="`tier: ${e.tier}`" />
              <i class="sep" />
              <Mark
                v-for="p in e.purposes" :key="p"
                :name="PURPOSE_MARK[p]" :size="14" :title="PURPOSE_LABEL[p]"
              />
            </span>
          </button>
        </div>
      </div>

      <div class="panel">
        <h3>Per-Age coverage</h3>
        <p class="note" style="margin-top:0">
          An Age with no content of its own is a modifier wearing a name.
        </p>
        <table class="attrs">
          <tbody>
          <tr v-for="[age, n] in perAge" :key="age">
            <td class="k">{{ age.replace(/_/g, ' ') }}</td>
            <td class="v" :style="n < 4 ? 'color:var(--rubric)' : ''">{{ n }} exclusive</td>
          </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div v-if="current" class="panel">
      <h3>{{ current.id }}</h3>

      <label>Title</label>
      <input type="text" v-model="current.title" />

      <FrequencyPicker v-model="current.frequency" />

      <div class="note" style="margin-top:10px">
        <template v-if="FREQUENCY_PROFILES[current.frequency].record === 'required' && !current.record">
          <strong style="color:var(--rubric)">This tier requires a Record block</strong> and this
          template has none. Record / Omit / Embellish is the mechanical form of the thesis.
        </template>
        <template v-else-if="FREQUENCY_PROFILES[current.frequency].record === 'forbidden' && current.record">
          <strong style="color:var(--rubric)">Common events must not carry a Record block.</strong>
          The choice loses meaning if it is routine.
        </template>
        <template v-else>
          Record block: {{ current.record ? 'present' : 'none' }} ·
          rumour: {{ current.rumour ? current.rumour.id : 'none' }} ·
          accounts: {{ current.accounts.length }}
        </template>
      </div>

      <label>Purposes (exactly three)</label>
      <div>
        <!-- The chips carry the same mark the list rows do, which makes this
             the legend for them: an author who has seen a cup here knows what
             the cup on a row three hundred templates down is claiming. -->
        <span v-for="p in current.purposes" :key="p" class="chip">
          <Mark :name="PURPOSE_MARK[p]" :size="14" />{{ p }}
        </span>
      </div>

      <label>
        Body
        <span style="text-transform:none;letter-spacing:0;color:var(--ink-faint);font-weight:400">
          — {{ prose.sentences }} sentences{{ prose.long ? ', held to the voice contract' : '' }}
        </span>
      </label>
      <BodyEditor v-model="current.body" :slot-names="slotNames" />

      <div v-if="undefinedTokens.length" class="issue error">
        undefined slot{{ undefinedTokens.length > 1 ? 's' : '' }}: {{ undefinedTokenList }}
      </div>

      <div v-if="prose.long" style="margin-top:10px">
        <h3>Voice contract</h3>
        <p v-if="!prose.issues.length" class="note" style="margin-top:0">
          Clean. Past five sentences a body is prose, not a note — this one holds.
        </p>
        <div v-for="(i, n) in prose.issues" :key="n" class="issue warning">{{ i.message }}</div>
      </div>

      <label>Slots</label>
      <SlotEditor :slots="current.slots" :event="current" @change="touched" />

      <label>Interaction</label>
      <div class="bar">
        <button
          v-for="k in ['narration', 'choice', 'dispatch']" :key="k" class="btn"
          :style="current.interaction.kind === k ? 'border-color:var(--rubric);color:var(--rubric)' : ''"
          @click="setInteractionKind(k)"
        >{{ k }}</button>
      </div>
      <div class="note" style="margin-top:6px">
        <template v-if="current.interaction.kind === 'narration'">
          Fires, tells, resolves. No player input, which is not the same as no consequence.
        </template>
        <template v-else-if="current.interaction.kind === 'choice'">
          {{ current.interaction.choices.length }} branches.
        </template>
        <template v-else>
          A mission: the player casts the slots himself.
        </template>
      </div>

      <template v-if="current.interaction.kind !== 'narration'">
        <label>Who decides</label>
        <DeciderPicker :event="current" @change="touched" />
      </template>

      <label>Branches &amp; outcomes</label>
      <OutcomeGraph :event="current" :event-ids="eventIds" @change="touched" />

      <label>Checks</label>
      <CheckEditor :event="current" @change="touched" />

      <label>Conditions</label>
      <ConditionBuilder v-model="current.conditions" />

      <template v-if="current.record">
        <label>Chronicle preview</label>
        <ChroniclePreview :record="current.record" />
      </template>

      <label>Age scope</label>
      <div>
        <span v-for="a in current.ages?.only ?? []" :key="a" class="chip">only in {{ a }}</span>
        <span v-for="a in current.ages?.never ?? []" :key="a" class="chip">never in {{ a }}</span>
        <span v-if="!current.ages" style="color:var(--ink-faint);font-size:12px">any Age</span>
      </div>

      <div style="margin-top:16px">
        <h3>Validation</h3>
        <p v-if="!myIssues.length" class="note" style="margin-top:0">No issues.</p>
        <div v-for="(i, n) in myIssues" :key="n" class="issue" :class="i.level">
          <code>{{ i.rule }}</code> {{ i.message }}
        </div>
      </div>

      <ProseVariantEditor
        collection-key="events"
        :id="current.id"
        :model-value="current"
      />

      <SaveControl collection-key="events" :id="current.id" />
    </div>
  </div>
</template>
