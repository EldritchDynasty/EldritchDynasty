<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { ArcDef, ArcNode, Content, Issue, Successor } from '@ed/schema';
import { markDirty, store } from '../lib/store';
import ArcGraph from './ArcGraph.vue';
import ConditionBuilder from './ConditionBuilder.vue';
import SaveControl from './SaveControl.vue';
import NewItem from './NewItem.vue';
import ProseVariantEditor from './ProseVariantEditor.vue';

/**
 * SUBSTORIES, EDITABLE.
 *
 * An arc used to be a two-file binding maintained entirely by hand: a node
 * table in `arcs/*.yaml` and an `arc: { of, node }` block on every event that
 * is one of its nodes, with nothing checking the second direction. That is why
 * this view exists — and why picking a node's event from a dropdown writes
 * BOTH sides.
 *
 * Arcs compiled from an `Outcome.next` chain (`schema/src/desugar.ts`) show up
 * here too, marked, and are read-only. They have no YAML to write back to:
 * they live in the index and the outcome that declares them is the thing to
 * edit.
 */
const props = defineProps<{ content: Content; issues: Issue[] }>();

/**
 * The COMPILED list, so arcs built from an inline `next` chain are visible
 * here too. Authored arcs are the same objects `store.bundle.arcs` holds —
 * `desugarInline` appends to the array and never copies an authored arc — so
 * editing one reaches the store. Compiled arcs are read-only and say so.
 */
const arcs = computed(() => props.content.arcs);

/**
 * Events are looked up in the AUTHORED bundle when they are about to be
 * written to. `content.event()` can return a desugar copy (see the note in
 * `EventEditor.vue`), and stamping `arc: { of, node }` onto a copy would be a
 * binding that exists for one render.
 */
function authoredEvent(id: string) {
  return store.bundle.events.find((e) => e.id === id);
}
const selectedId = ref(arcs.value.find((a) => !a.inline)?.id ?? arcs.value[0]?.id ?? '');
const selectedNode = ref('');

const arc = computed<ArcDef | undefined>(() => arcs.value.find((a) => a.id === selectedId.value));
const node = computed<ArcNode | undefined>(() => arc.value?.nodes.find((n) => n.id === selectedNode.value));
const readOnly = computed(() => arc.value?.inline ?? false);

watch(arc, () => { selectedNode.value = arc.value?.entry ?? ''; }, { immediate: true });
watch(arc, () => { if (arc.value && !arc.value.inline) markDirty('arcs', arc.value.id); }, { deep: true });

const myIssues = computed(() =>
  props.issues.filter((i) => i.where.startsWith(`arc:${selectedId.value}`)));

const eventIds = computed(() => store.bundle.events.map((e) => e.id));
const nodeIds = computed(() => arc.value?.nodes.map((n) => n.id) ?? []);

/** The branches and endings the SELECTED node's event can actually produce. */
const parentShape = computed(() => {
  const e = node.value ? authoredEvent(node.value.event) : undefined;
  if (!e) return { choices: [] as string[], outcomes: [] as string[], tags: [] as string[] };
  const groups = e.interaction.kind === 'narration' ? [e.interaction.outcomes] : e.interaction.choices.map((c) => c.outcomes);
  const outcomes = groups.flat();
  return {
    choices: e.interaction.kind === 'narration' ? [] : e.interaction.choices.map((c) => c.id),
    outcomes: outcomes.map((o) => o.id),
    tags: [...new Set(outcomes.flatMap((o) => o.tags))],
  };
});

/** A new substory: one beat, pointing at an event that exists, ending after it. */
function seedArc(id: string) {
  return {
    id,
    title: 'An Untitled Substory',
    entry: 'first',
    nodes: [{
      id: 'first',
      event: eventIds.value[0] ?? '',
      selection: 'first_match',
      successors: [{ to: 'end', weight: 100 }],
      schedule: 'next_generation',
    }],
    bindings: [],
    maxConcurrentInstances: 1,
    inline: false,
  } as never;
}

function selectNew(id: string) {
  selectedId.value = id;
}

function touch() {
  if (arc.value && !arc.value.inline) markDirty('arcs', arc.value.id);
}

// ── Nodes ───────────────────────────────────────────────────────────────
function addNode() {
  if (!arc.value || readOnly.value) return;
  let n = arc.value.nodes.length + 1;
  while (arc.value.nodes.some((x) => x.id === `node_${n}`)) n += 1;
  arc.value.nodes.push({
    id: `node_${n}`,
    event: eventIds.value[0] ?? '',
    selection: 'first_match',
    successors: [{ to: 'end', weight: 100 }],
    schedule: 'next_generation',
  });
  selectedNode.value = `node_${n}`;
  touch();
}

function removeNode(id: string) {
  if (!arc.value || readOnly.value) return;
  arc.value.nodes = arc.value.nodes.filter((n) => n.id !== id);
  // A successor pointing at a node that is gone dies silently at that node,
  // so retarget rather than leave it dangling.
  for (const n of arc.value.nodes) {
    for (const s of n.successors) if (s.to === id) s.to = 'end';
  }
  if (arc.value.entry === id) arc.value.entry = arc.value.nodes[0]?.id ?? '';
  selectedNode.value = arc.value.entry;
  touch();
}

/**
 * Both halves of the binding, written together. Setting a node's event without
 * stamping `arc: { of, node }` onto that event is exactly the failure
 * `arcs/wiring`'s reverse check was added to catch: the event leaves the
 * ambient pool and the arc never calls it.
 */
function setNodeEvent(n: ArcNode, eventId: string) {
  if (!arc.value || readOnly.value) return;
  const previous = authoredEvent(n.event);
  if (previous?.arc?.of === arc.value.id && previous.arc.node === n.id) {
    delete previous.arc;
    markDirty('events', previous.id);
  }
  n.event = eventId;
  const next = authoredEvent(eventId);
  if (next) {
    next.arc = { of: arc.value.id, node: n.id };
    markDirty('events', next.id);
  }
  touch();
}

const scheduleKind = (n: ArcNode) => (typeof n.schedule === 'string' ? n.schedule : 'a window…');

function setSchedule(n: ArcNode, kind: string) {
  n.schedule = kind === 'a window…' ? { minYears: 20, maxYears: 60 } : (kind as 'immediate');
  touch();
}

// ── Successors ──────────────────────────────────────────────────────────
function addSuccessor(n: ArcNode) {
  if (readOnly.value) return;
  n.successors.push({ to: 'end', weight: 100 });
  touch();
}

function removeSuccessor(n: ArcNode, i: number) {
  if (readOnly.value) return;
  n.successors.splice(i, 1);
  touch();
}

function setGuard(s: Successor, key: 'fromChoice' | 'fromOutcome' | 'fromTag', value: string) {
  if (value) s[key] = value;
  else delete s[key];
  touch();
}

function moveSuccessor(n: ArcNode, i: number, by: number) {
  const to = i + by;
  if (to < 0 || to >= n.successors.length) return;
  [n.successors[i], n.successors[to]] = [n.successors[to]!, n.successors[i]!];
  touch();
}
</script>

<template>
  <header>
    <h2>Substories</h2>
    <p>
      A parent node triggers children and exactly one happens — the engine returns a single node id,
      so that is structural rather than a convention. Every guard a successor carries must hold; a
      <code>when</code> is evaluated with the running story in scope, so it can ask what this run of
      it remembers.
    </p>
  </header>

  <div class="cols wide">
    <div>
      <div class="panel" style="margin-bottom:12px">
        <h3>{{ arcs.length }} substories</h3>
        <NewItem collection-key="arcs" :seed="seedArc" @created="selectNew" />
        <div class="list">
          <button
            v-for="a in arcs" :key="a.id" class="row"
            :class="{ on: a.id === selectedId }" @click="selectedId = a.id"
          >
            <span class="badge" :class="a.inline ? 'common' : 'rare'">{{ a.inline ? 'inline' : 'arc' }}</span>
            <span class="t">{{ a.title }}<br /><span class="sub">{{ a.nodes.length }} beats · {{ a.id }}</span></span>
          </button>
        </div>
      </div>

      <div class="panel">
        <h3>Validation</h3>
        <p v-if="!myIssues.length" class="note" style="margin-top:0">No issues.</p>
        <div v-for="(i, n) in myIssues" :key="n" class="issue" :class="i.level">
          <code>{{ i.rule }}</code> {{ i.message }}
        </div>
      </div>
    </div>

    <div v-if="arc" class="panel" style="min-width:0">
      <h3>{{ arc.id }}</h3>

      <div v-if="readOnly" class="note" style="margin-top:0">
        <strong>Compiled from an inline follow-up.</strong> This substory has no YAML of its own —
        it is built from an outcome's <code>next</code> before the engine sees it. Edit it on the
        outcome that declares it, in the Events tab.
      </div>

      <label>Title</label>
      <input type="text" v-model="arc.title" :disabled="readOnly" />

      <div class="bar" style="margin-top:8px">
        <span class="fk">entry</span>
        <select :value="arc.entry" :disabled="readOnly" @change="arc.entry = ($event.target as HTMLSelectElement).value; touch()">
          <option v-for="id in nodeIds" :key="id" :value="id">{{ id }}</option>
        </select>
        <span class="fk">at most</span>
        <input type="number" style="max-width:64px" :value="arc.maxConcurrentInstances" :disabled="readOnly"
               @input="arc.maxConcurrentInstances = Number(($event.target as HTMLInputElement).value); touch()" />
        <span class="fk">at once</span>
        <span class="fk">bindings</span>
        <input type="text" style="max-width:200px" placeholder="slots held for the whole story"
               :value="arc.bindings.join(', ')" :disabled="readOnly"
               @input="arc.bindings = ($event.target as HTMLInputElement).value.split(',').map((x) => x.trim()).filter(Boolean); touch()" />
      </div>

      <label>The shape of it</label>
      <ArcGraph :arc="arc" :selected="selectedNode" @select="(id) => (selectedNode = id)" />

      <template v-if="node">
        <label>{{ node.id }}</label>
        <div class="bar">
          <input type="text" style="max-width:150px" :value="node.id" :disabled="readOnly"
                 @change="node.id = ($event.target as HTMLInputElement).value; touch()" />
          <select :value="node.event" :disabled="readOnly" @change="setNodeEvent(node, ($event.target as HTMLSelectElement).value)">
            <option v-for="id in eventIds" :key="id" :value="id">{{ id }}</option>
          </select>
          <select :value="node.selection" :disabled="readOnly"
                  @change="node.selection = ($event.target as HTMLSelectElement).value as never; touch()">
            <option value="first_match">first matching successor</option>
            <option value="weighted">weighted among the matches</option>
          </select>
          <select :value="scheduleKind(node)" :disabled="readOnly" @change="setSchedule(node, ($event.target as HTMLSelectElement).value)">
            <option value="immediate">immediate</option>
            <option value="next_generation">next generation</option>
            <option value="a window…">a window…</option>
          </select>
          <template v-if="typeof node.schedule !== 'string'">
            <input type="number" style="max-width:64px" :value="node.schedule.minYears" :disabled="readOnly"
                   @input="(node.schedule as { minYears: number }).minYears = Number(($event.target as HTMLInputElement).value); touch()" />
            <span class="fk">to</span>
            <input type="number" style="max-width:64px" :value="node.schedule.maxYears" :disabled="readOnly"
                   @input="(node.schedule as { maxYears: number }).maxYears = Number(($event.target as HTMLInputElement).value); touch()" />
            <span class="fk">years</span>
          </template>
          <button v-if="!readOnly" class="btn tiny" @click="removeNode(node.id)">remove beat</button>
        </div>

        <label>What happens next</label>
        <div v-for="(s, i) in node.successors" :key="i" class="succ">
          <div class="bar">
            <span class="fk">go to</span>
            <select :value="s.to" :disabled="readOnly" @change="s.to = ($event.target as HTMLSelectElement).value; touch()">
              <option value="end">end the story</option>
              <option v-for="id in nodeIds" :key="id" :value="id">{{ id }}</option>
            </select>
            <select :value="s.fromChoice ?? ''" :disabled="readOnly" @change="setGuard(s, 'fromChoice', ($event.target as HTMLSelectElement).value)">
              <option value="">any branch</option>
              <option v-for="c in parentShape.choices" :key="c" :value="c">took {{ c }}</option>
            </select>
            <select :value="s.fromOutcome ?? ''" :disabled="readOnly" @change="setGuard(s, 'fromOutcome', ($event.target as HTMLSelectElement).value)">
              <option value="">any ending</option>
              <option v-for="o in parentShape.outcomes" :key="o" :value="o">ended {{ o }}</option>
            </select>
            <select :value="s.fromTag ?? ''" :disabled="readOnly" @change="setGuard(s, 'fromTag', ($event.target as HTMLSelectElement).value)">
              <option value="">any tag</option>
              <option v-for="t in parentShape.tags" :key="t" :value="t">tagged {{ t }}</option>
            </select>
            <template v-if="node.selection === 'weighted'">
              <span class="fk">weight</span>
              <input type="number" style="max-width:64px" :value="s.weight" :disabled="readOnly"
                     @input="s.weight = Number(($event.target as HTMLInputElement).value); touch()" />
            </template>
            <button v-if="!readOnly" class="btn tiny" @click="moveSuccessor(node, i, -1)">↑</button>
            <button v-if="!readOnly" class="btn tiny" @click="moveSuccessor(node, i, 1)">↓</button>
            <button v-if="!readOnly" class="btn tiny" @click="removeSuccessor(node, i)">×</button>
          </div>
          <ConditionBuilder :model-value="s.when" @update:model-value="(v) => { if (v) s.when = v; else delete s.when; touch(); }" />
        </div>
        <button v-if="!readOnly" class="btn tiny" @click="addSuccessor(node)">+ successor</button>
      </template>

      <div style="margin-top:14px">
        <button v-if="!readOnly" class="btn" @click="addNode">+ add beat</button>
      </div>

      <ProseVariantEditor
        collection-key="arcs"
        :id="arc.id"
        :model-value="arc"
        :disabled="readOnly"
      />

      <SaveControl v-if="!readOnly" collection-key="arcs" :id="arc.id" />
    </div>
  </div>
</template>

<style scoped>
.succ { border-left: 2px solid var(--rule); padding: 5px 0 5px 10px; margin-bottom: 7px; }
.succ:hover { background: var(--vellum-deep); }
.bar select, .bar input { width: auto; margin: 0; font-size: 12.5px; padding: 4px 6px; }
.fk { font-size: 11px; letter-spacing: .06em; color: var(--ink-faint); }
.btn.tiny { padding: 2px 7px; font-size: 11px; }
</style>
