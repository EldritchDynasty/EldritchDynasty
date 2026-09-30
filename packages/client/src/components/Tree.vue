<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import type { SessionView } from '@ed/core';
import Kin from './Kin.vue';
import { kinshipPath, roots, type MemberView } from '../lib/kin';

/**
 * `selected` is the APP's, not this component's. One card is open at a time —
 * this is a tree, not a spreadsheet — and the cast list opens cards too
 * (issue #44), so the two of them have to be looking at the same person.
 */
type MentionPage = { id: string; year: number };
type LineEntry = { person: string };

const props = defineProps<{
  view: SessionView;
  selected: string | null;
  /** Explicit navigation request from outside the tree (Chronicle/passage links). */
  reveal?: { id: string; token: number } | null;
  line?: readonly LineEntry[];
  mentions?: (person: string) => MentionPage[];
}>();
const emit = defineEmits<{
  (e: 'select', id: string): void;
  (e: 'line'): void;
  (e: 'book', page: string): void;
}>();

/**
 * A WAY IN (issue #106). Eighty-eight member cards across six halls is
 * roughly five thousand pixels of scroll with no search, no filter and no way
 * to jump to a person — true on a desk monitor as well as a phone, which is
 * the test the issue sets for whether this is the right fix. Three controls,
 * all of them optional and all of them composing: pick a hall, drill into a
 * branch, or search a name and land on it directly. None of them touch what
 * `roots`/`children` compute — they only decide which of that a given hall
 * draws this render.
 */

/** 'all' or a hall id. Narrows which halls are drawn at all. */
const hallFilter = ref<string>('all');

type HallView = SessionView['halls'][number];
type MemberFilter = 'all' | 'head' | 'succession' | 'married' | 'unmarried' | 'post' | 'cadet' | 'awakened';

const MEMBER_FILTERS: { id: MemberFilter; label: string }[] = [
  { id: 'all', label: 'Everyone' },
  { id: 'head', label: 'Head' },
  { id: 'succession', label: 'Heir / possible' },
  { id: 'married', label: 'Married' },
  { id: 'unmarried', label: 'Unmarried' },
  { id: 'post', label: 'In post' },
  { id: 'cadet', label: 'Cadet hall' },
  { id: 'awakened', label: 'Awakened' },
];

/**
 * Planning filters read only the photographed session view. In particular,
 * succession is the engine's known-facts answer: this client never filters on
 * an unwoken member's expresses field and therefore cannot turn a filter into
 * a genetic test (#268).
 */
const memberFilter = ref<MemberFilter>('all');
const showRelevance = ref(false);
const directLine = ref(false);

/**
 * RELATIONSHIP READING (#268). The first open card becomes the anchor; a
 * second open card asks the recorded family graph how the two are connected.
 * This is deliberately the book's parentage, through kinshipPath(), so a
 * forged lineage produces the forged relationship the household plans from.
 */
const relationshipFrom = ref<string | null>(null);
const relationshipTo = ref<string | null>(null);
const allMembers = computed(() => props.view.halls.flatMap((hall) => hall.members));
const relationAnchor = computed(() => {
  const id = relationshipFrom.value;
  if (!id) return undefined;
  const member = allMembers.value.find((candidate) => candidate.id === id);
  return member ? { id: member.id, name: member.name } : undefined;
});
const relationship = computed(() => {
  if (!relationshipFrom.value || !relationshipTo.value) return undefined;
  return kinshipPath(relationshipFrom.value, relationshipTo.value, allMembers.value);
});

function onRelationship(id: string): void {
  if (!relationshipFrom.value) {
    relationshipFrom.value = id;
    relationshipTo.value = null;
    return;
  }
  if (relationshipFrom.value === id) {
    relationshipFrom.value = null;
    relationshipTo.value = null;
    return;
  }
  relationshipTo.value = id;
}

function clearRelationship(): void {
  relationshipFrom.value = null;
  relationshipTo.value = null;
}

function matchesMemberFilter(member: MemberView, hall: HallView): boolean {
  switch (memberFilter.value) {
    case 'all': return true;
    case 'head': return member.head;
    case 'succession': return member.succession !== undefined;
    case 'married': return member.spouse !== undefined;
    case 'unmarried': return member.spouse === undefined;
    case 'post': return member.post !== undefined;
    case 'cadet': return !hall.isSeat;
    case 'awakened': return member.awakened;
  }
}

function membersOf(hall: HallView): MemberView[] {
  return hall.members.filter((member) => matchesMemberFilter(member, hall));
}

/**
 * A MEMBER ID TO ROOT AT, within whichever hall holds them. Set from the
 * "Only this branch" control `Kin.vue` offers wherever a member has
 * descendants, and cleared by the breadcrumb this draws in its place. Scoped
 * to one hall at a time — the hall a focused branch belongs to is set here
 * alongside it, so drilling into a branch does not leave five other halls
 * still fully unrolled underneath it.
 */
const focus = ref<string | null>(null);

function onRoot(hallId: string, id: string): void {
  hallFilter.value = hallId;
  focus.value = id;
}

function clearFocus(): void {
  focus.value = null;
}

/** Picking a hall always drops any branch focus — it belonged to the old view. */
function pickHall(id: string): void {
  hallFilter.value = id;
  directLine.value = false;
  clearFocus();
}

function pickMemberFilter(id: MemberFilter): void {
  memberFilter.value = id;
  directLine.value = false;
  clearFocus();
}

function toggleDirectLine(): void {
  directLine.value = !directLine.value;
  if (directLine.value) {
    hallFilter.value = 'all';
    memberFilter.value = 'all';
  }
  clearFocus();
}

/** Which non-empty halls this planning view draws, given both selectors. */
const shownHalls = computed(() => {
  let halls = hallFilter.value === 'all'
    ? props.view.halls
    : props.view.halls.filter((h) => h.id === hallFilter.value);
  if (directLine.value) {
    const ids = new Set((props.line ?? []).map((entry) => entry.person));
    halls = halls.filter((hall) => hall.members.some((member) => ids.has(member.id)));
  }
  if (memberFilter.value === 'all') return halls;
  return halls.filter((hall) => membersOf(hall).length > 0);
});

/** The root(s) a given hall draws: the whole filtered hall, or one focused branch. */
function rootsOf(hall: HallView): MemberView[] {
  const members = membersOf(hall);
  if (focus.value) {
    const found = members.find((m) => m.id === focus.value);
    if (found) return [found];
  }
  if (directLine.value) {
    const ids = new Set((props.line ?? []).map((entry) => entry.person));
    const candidates = members.filter((member) => ids.has(member.id));
    const candidateIds = new Set(candidates.map((member) => member.id));
    return candidates.filter((member) => {
      const parentIds = [member.record.parents.mother, member.record.parents.father];
      return !parentIds.some((id) => id !== undefined && candidateIds.has(id));
    });
  }
  return roots(members);
}

/**
 * FIND SOMEBODY BY NAME, rather than by scrolling past everyone who is not
 * them. Two characters minimum so half the house does not light up on the
 * first keystroke; capped at eight because this is a way to a person, not a
 * second directory.
 */
const query = ref('');

const matches = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (q.length < 2) return [];
  const out: { id: string; name: string; hallId: string; hallName: string }[] = [];
  for (const hall of props.view.halls) {
    for (const m of hall.members) {
      if (!m.name.toLowerCase().includes(q)) continue;
      out.push({ id: m.id, name: m.name, hallId: hall.id, hallName: hall.name });
      if (out.length >= 8) return out;
    }
  }
  return out;
});

/**
 * LANDING ON THE RESULT. Opens their card the same way clicking them in the
 * tree would, clears any branch focus so the person they were found under is
 * visible around them, and scrolls the card into view — the tree is still a
 * long page even with one hall showing, and a card opened off-screen is a
 * card the player has to go looking for anyway.
 */
async function makeVisible(m: { id: string; hallId: string }): Promise<void> {
  hallFilter.value = m.hallId;
  memberFilter.value = 'all';
  directLine.value = false;
  focus.value = null;
  query.value = '';
  await nextTick();
  document.getElementById('member-' + m.id)?.scrollIntoView({ block: 'center' });
}

async function jumpTo(m: { id: string; hallId: string }): Promise<void> {
  emit('select', m.id);
  await makeVisible(m);
}

function hallFor(id: string): HallView | undefined {
  return props.view.halls.find((candidate) => candidate.members.some((member) => member.id === id));
}

async function jumpToId(id: string): Promise<void> {
  const hall = hallFor(id);
  if (!hall) return;
  emit('select', id);
  await makeVisible({ id, hallId: hall.id });
}

async function revealId(id: string): Promise<void> {
  const hall = hallFor(id);
  if (!hall) return;
  await makeVisible({ id, hallId: hall.id });
}

/**
 * A Chronicle/passage link means "show me this person", not merely "select
 * this id". Reset every private narrowing state that could otherwise keep the
 * selected card unrendered. Immediate handles navigation that changes pane and
 * mounts the tree in the same tick; token handles following the same link twice.
 */
watch(() => props.reveal?.token, () => {
  if (props.reveal) void revealId(props.reveal.id);
}, { immediate: true });
</script>

<template>
  <section class="tree" aria-label="The living family tree">
    <label class="row find">
      <span class="said-not-shown">Find somebody by name</span>
      <input v-model="query" type="search" placeholder="find somebody by name" />
    </label>
    <ul v-if="matches.length" class="matches">
      <li v-for="m in matches" :key="m.id">
        <button class="small" @click="jumpTo(m)">
          {{ m.name }} <span class="dim">· {{ m.hallName }}</span>
        </button>
      </li>
    </ul>
    <p v-else-if="query.trim().length >= 2" class="dim small">Nobody of the house answers to that.</p>

    <!-- A PLANNING INDEX, NOT ANOTHER STAT SHEET (#268). These filters only
         name facts already present in SessionView. "Heir / possible" is the
         engine's known-succession answer; it never reads unwoken Power here. -->
    <div class="planning" aria-label="Plan with the family tree">
      <span class="dim small planning-label">Read the house by</span>
      <div class="wrap filters" role="group" aria-label="Family tree filters">
        <button
          v-for="filter in MEMBER_FILTERS"
          :key="filter.id"
          type="button"
          class="quiet small"
          :class="{ on: memberFilter === filter.id }"
          :aria-pressed="memberFilter === filter.id"
          :data-filter="filter.id"
          @click="pickMemberFilter(filter.id)"
        >{{ filter.label }}</button>
      </div>
      <button
        type="button"
        class="quiet small"
        :class="{ on: directLine }"
        :aria-pressed="directLine"
        data-direct-line
        @click="toggleDirectLine"
      >Direct line</button>
      <button
        type="button"
        class="quiet small relevance-toggle"
        :class="{ on: showRelevance }"
        :aria-pressed="showRelevance"
        data-relevance-toggle
        @click="showRelevance = !showRelevance"
      >Relevant to the plan</button>
    </div>

    <!-- HOW ARE THESE TWO RELATED? The path is a reading of the same recorded
         graph the tree draws. Names are controls because every person on the
         path is a way back into that person's card. -->
    <div v-if="relationAnchor" class="relationship small" aria-live="polite">
      <template v-if="relationshipTo">
        <span class="dim">Recorded relationship:</span>
        <button class="quiet small" :data-relation-person="relationAnchor.id" @click="jumpToId(relationAnchor.id)">{{ relationAnchor.name }}</button>
        <template v-if="relationship">
          <template v-for="step in relationship" :key="step.person.id + ':' + step.relation">
            <span class="dim relation-step">→ {{ step.relation }}</span>
            <button class="quiet small" :data-relation-person="step.person.id" @click="jumpToId(step.person.id)">{{ step.person.name }}</button>
          </template>
        </template>
        <span v-else class="dim">— the book records no path between them.</span>
      </template>
      <span v-else class="dim">
        Tracing from {{ relationAnchor.name }}. Open another person and ask for their relationship.
      </span>
      <button class="quiet small clear-relation" @click="clearRelationship()">clear</button>
    </div>

    <!-- THE HALL PICKER. A HALL IS NOT A HOUSE (invariant 15): cadet branches
         are households inside the player's house, and crowding is per hall —
         so "show me one of them" is a real question and not an arbitrary
         slice. -->
    <div v-if="view.halls.length > 1" class="wrap halls">
      <button
        class="small"
        :class="{ on: hallFilter === 'all' }"
        :aria-pressed="hallFilter === 'all'"
        @click="pickHall('all')"
      >All halls</button>
      <button
        v-for="hall in view.halls"
        :key="hall.id"
        class="small"
        :class="{ on: hallFilter === hall.id }"
        :aria-pressed="hallFilter === hall.id"
        @click="pickHall(hall.id)"
      >{{ hall.name }} <span class="dim">· {{ hall.members.length }}</span></button>
    </div>

    <!-- A HALL IS NOT A HOUSE (invariant 15). Cadet branches are households
         inside the player's house, and crowding and grievance are per hall —
         so they are drawn as separate halls of the same family rather than as
         one long roster. -->
    <section v-for="hall in shownHalls" :key="hall.id" class="hall" :aria-labelledby="'hall-' + hall.id">
      <h3 :id="'hall-' + hall.id" class="label">
        {{ hall.name }}
        <span v-if="hall.isSeat" class="rubric">· the seat</span>
        <span class="dim"> · {{ membersOf(hall).length }} shown</span>
        <span v-if="hall.grievance > 0" class="dim"> · grievance {{ Math.round(hall.grievance) }}</span>
      </h3>

      <!-- THE BREADCRUMB OUT OF A FOCUSED BRANCH. Only where this hall is the
           one the focus belongs to — the picker may be showing several. -->
      <p v-if="focus && membersOf(hall).some((m) => m.id === focus)" class="dim small branch">
        Showing one branch. <button class="quiet small" @click="clearFocus()">Show the whole hall</button>
      </p>

      <ul v-if="membersOf(hall).length">
        <Kin
          v-for="member in rootsOf(hall)"
          :key="member.id"
          :member="member"
          :hall="membersOf(hall)"
          :names="view.attributes"
          :trait-names="view.traits"
          :selected="selected"
          :show-relevance="showRelevance"
          :mentions="mentions"
          :relationship-anchor="relationAnchor"
          @select="$emit('select', $event)"
          @line="$emit('line')"
          @book="$emit('book', $event)"
          @relationship="onRelationship"
          @root="onRoot(hall.id, $event)"
        />
      </ul>
      <p v-else class="dim small">Nobody in this hall matches that reading.</p>
    </section>
    <p v-if="!shownHalls.length" class="dim small no-match">Nobody in the living house matches that reading.</p>
  </section>
</template>

<style scoped>
.hall { margin-bottom: 22px; }
.hall > ul { margin: 0; padding: 0; }
.find { margin-bottom: 10px; }
.find input { flex: 1; min-width: 0; }
.matches { list-style: none; margin: 0 0 10px; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.matches button { width: 100%; text-align: left; }
.planning {
  display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap;
  margin: 0 0 14px; padding: 8px 0;
  border-top: 1px solid var(--rule); border-bottom: 1px solid var(--rule);
}
.planning-label { flex: 0 0 auto; }
.filters { flex: 1 1 420px; }
.planning button.on { color: var(--ink); background: var(--vellum-deep); border-color: var(--rule); }
.relevance-toggle { margin-left: auto; }
.relationship {
  display: flex; align-items: baseline; gap: 5px; flex-wrap: wrap;
  margin: -6px 0 14px; padding: 6px 0 8px;
  border-bottom: 1px solid var(--rule);
}
.relationship button { padding: 0 2px; }
.relationship .relation-step { margin-left: 2px; }
.relationship .clear-relation { margin-left: auto; }
.halls { margin-bottom: 14px; }
.halls button.on { color: var(--ink); background: var(--vellum-deep); border-color: var(--rule); }
.branch { margin: -4px 0 10px; }
.no-match { margin: 0 0 18px; }
</style>
