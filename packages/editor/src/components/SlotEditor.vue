<script setup lang="ts">
import { computed } from 'vue';
import type { EventTemplate, Filter, SlotSpec } from '@ed/schema';
import { SlotRoleS } from '@ed/schema';
import FilterBuilder from './FilterBuilder.vue';

/**
 * WHO STANDS IN THIS PART.
 *
 * `castBy` is the single most important field in the event model — it is the
 * whole of the mission mechanic, and the difference between an event that
 * happens to the family and one the player aims. It gets a control, not a
 * chip.
 */
const props = defineProps<{ slots: Record<string, SlotSpec>; event: EventTemplate }>();
const emit = defineEmits<{ change: [] }>();

const ROLES = SlotRoleS.options;
const MISSING = ['cancel_arc', 'recast', 'continue_absent', 'inherit:heir', 'inherit:eldest_child', 'inherit:closest_blood', 'inherit:house_successor'];

const names = computed(() => Object.keys(props.slots));

function touch() { emit('change'); }

function setCasting(spec: SlotSpec, field: 'role' | 'castBy', value: string) {
  if (field === 'role') spec.role = SlotRoleS.parse(value);
  else spec.castBy = value === 'player' ? 'player' : 'engine';
  if (spec.castBy !== 'engine' || spec.role !== 'family_member') delete spec.select;
  touch();
}

function setSelection(spec: SlotSpec, value: string) {
  if (value.trim()) spec.select = { bestBy: value.trim() };
  else delete spec.select;
  touch();
}

function add() {
  let n = 1;
  while (props.slots[`SLOT_${n}`]) n += 1;
  props.slots[`SLOT_${n}`] = { role: 'family_member', castBy: 'engine', optional: false, filters: [], bind: 'event' };
  touch();
}

function remove(name: string) {
  delete props.slots[name];
  touch();
}

/**
 * Renaming rewrites the key AND every `{TOKEN}` in the body, because a slot
 * whose name no longer matches its token is an undefined-slot error the author
 * did not make on purpose. Body rewriting is the whole reason renaming lives
 * here rather than being left to a text edit.
 */
function rename(from: string, to: string) {
  const clean = to.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
  if (!clean || clean === from || props.slots[clean]) return;
  const spec = props.slots[from]!;
  delete props.slots[from];
  props.slots[clean] = spec;
  const token = new RegExp('\\{' + from + '\\}', 'g');
  props.event.body = props.event.body.replace(token, '{' + clean + '}');
  if (props.event.absentBody) props.event.absentBody = props.event.absentBody.replace(token, '{' + clean + '}');
  touch();
}

function onMissingOf(spec: SlotSpec): string {
  const m = spec.onMissing;
  if (m === undefined) return '';
  return typeof m === 'string' ? m : `inherit:${m.inherit}`;
}

function setOnMissing(spec: SlotSpec, value: string) {
  if (!value) delete spec.onMissing;
  else if (value.startsWith('inherit:')) spec.onMissing = { inherit: value.slice(8) as never };
  else spec.onMissing = value as never;
  touch();
}

function addFilter(spec: SlotSpec) {
  spec.filters.push({ status: ['alive'] } as Filter);
  touch();
}
function setFilter(spec: SlotSpec, i: number, f: Filter) {
  spec.filters[i] = f;
  touch();
}
function removeFilter(spec: SlotSpec, i: number) {
  spec.filters.splice(i, 1);
  touch();
}

/** `continue_absent` without an `absentBody` renders a token for a man forty years dead. */
function needsAbsentBody(spec: SlotSpec): boolean {
  return spec.bind === 'arc' && spec.onMissing === 'continue_absent' && !props.event.absentBody;
}
</script>

<template>
  <div>
    <div v-for="name in names" :key="name" class="slot">
      <div class="slot-head">
        <input class="slot-name" type="text" :value="name" @change="rename(name, ($event.target as HTMLInputElement).value)" />
        <select :value="slots[name]!.role" @change="setCasting(slots[name]!, 'role', ($event.target as HTMLSelectElement).value)">
          <option v-for="r in ROLES" :key="r" :value="r">{{ r }}</option>
        </select>
        <select :value="slots[name]!.castBy" @change="setCasting(slots[name]!, 'castBy', ($event.target as HTMLSelectElement).value)">
          <option value="engine">cast by engine</option>
          <option value="player">cast by player</option>
        </select>
        <select :value="slots[name]!.bind" @change="slots[name]!.bind = ($event.target as HTMLSelectElement).value as never; touch()">
          <option value="event">this event only</option>
          <option value="arc">bound for the whole substory</option>
        </select>
        <label class="tick">
          <input type="checkbox" :checked="slots[name]!.optional"
                 @change="slots[name]!.optional = ($event.target as HTMLInputElement).checked; touch()" />optional
        </label>
        <select :value="onMissingOf(slots[name]!)" @change="setOnMissing(slots[name]!, ($event.target as HTMLSelectElement).value)">
          <option value="">on missing: (default)</option>
          <option v-for="m in MISSING" :key="m" :value="m">on missing: {{ m }}</option>
        </select>
        <button class="btn tiny" @click="remove(name)">remove</button>
      </div>

      <div v-if="needsAbsentBody(slots[name]!)" class="issue error">
        continue_absent needs an absentBody, or this renders a token for a man forty years in the ground
      </div>

      <div class="filters">
        <label v-if="slots[name]!.role === 'family_member' && slots[name]!.castBy === 'engine' && !slots[name]!.count">
          Best eligible member by (blank: random)
          <input aria-label="Best member attribute" :value="slots[name]!.select?.bestBy ?? ''"
                 @change="setSelection(slots[name]!, ($event.target as HTMLInputElement).value)" />
        </label>
        <div v-for="(f, i) in slots[name]!.filters" :key="i" class="filter-row">
          <FilterBuilder :model-value="f" :slot-names="names" @update:model-value="(v) => setFilter(slots[name]!, i, v)" />
          <button class="btn tiny" @click="removeFilter(slots[name]!, i)">×</button>
        </div>
        <button class="btn tiny" @click="addFilter(slots[name]!)">+ filter</button>
      </div>
    </div>
    <button class="btn" @click="add">+ add slot</button>
  </div>
</template>

<style scoped>
.slot { border-left: 2px solid var(--rule); padding: 6px 0 6px 10px; margin-bottom: 8px; }
.slot:hover { background: var(--vellum-deep); }
.slot-head { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.slot-head select, .slot-head input { width: auto; margin: 0; font-size: 12.5px; padding: 4px 6px; }
.slot-name { font-weight: 600; max-width: 140px; }
.filters { margin-top: 4px; padding-left: 6px; }
.filter-row { display: flex; align-items: flex-start; gap: 5px; }
.tick { display: inline-flex; align-items: center; gap: 3px; font-size: 12px; text-transform: none; letter-spacing: 0; color: var(--ink-soft); }
.tick input { margin: 0 2px 0 0; width: auto; }
.btn.tiny { padding: 2px 7px; font-size: 11px; }
</style>
