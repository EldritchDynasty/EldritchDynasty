<script setup lang="ts">
import { computed } from 'vue';
import type { CompareOp, Filter } from '@ed/schema';
import { ALL_AFFINITIES } from '@ed/schema';

/**
 * WHO A SLOT MAY CAST.
 *
 * The same table-driven shape `ConditionBuilder` uses on `Condition`, aimed at
 * `Filter` — which is also a keyed union with `all`/`any`/`not` combinators,
 * so the two files are deliberately the same shape rather than accidentally
 * similar. Six leaf shapes cover all ten kinds; a new filter kind that fits
 * one of them is a row in `LEAF_SHAPES`, not a new form.
 */
const props = defineProps<{ modelValue: Filter; slotNames?: string[] }>();
const emit = defineEmits<{ 'update:modelValue': [Filter] }>();

const COMPARE_OPS: CompareOp[] = ['lt', 'lte', 'eq', 'gte', 'gt', 'ne'];
const STATUSES = ['alive', 'dead', 'guardian'];
const MEMBERSHIPS = ['blood', 'married_in', 'cadet', 'retainer', 'none'];
const RELATIONS = ['not', 'child_of', 'sibling_of', 'spouse_of', 'blood_of'];

type Shape =
  | { kind: 'affinity' }
  | { kind: 'attr' }
  | { kind: 'has'; label: string }
  | { kind: 'boolean' }
  | { kind: 'compareNamed' }
  | { kind: 'stringSet'; options: string[] }
  | { kind: 'sex' }
  | { kind: 'relation' };

/** kind -> shape, read against `schema/src/conditions.ts`'s `Filter`. */
const LEAF_SHAPES: Record<string, Shape> = {
  knows: { kind: 'affinity' },
  attr: { kind: 'attr' },
  trait: { kind: 'has', label: 'trait' },
  tag: { kind: 'has', label: 'cast tag' },
  sex: { kind: 'sex' },
  age: { kind: 'compareNamed' },
  status: { kind: 'stringSet', options: STATUSES },
  membership: { kind: 'stringSet', options: MEMBERSHIPS },
  awakened: { kind: 'boolean' },
  canExpress: { kind: 'boolean' },
  relation: { kind: 'relation' },
};
const LEAF_KINDS = Object.keys(LEAF_SHAPES);

function defaultOf(kind: string): Filter {
  switch (LEAF_SHAPES[kind]!.kind) {
    case 'affinity': return { knows: { affinity: 'life' } };
    case 'attr': return { attr: '', op: 'gte', value: 0 } as never;
    case 'has': return { [kind]: '', has: true } as never;
    case 'boolean': return { [kind]: true } as never;
    case 'compareNamed': return { [kind]: { op: 'gte', value: 0 } } as never;
    case 'stringSet': return { [kind]: [] } as never;
    case 'sex': return { sex: 'male' } as never;
    case 'relation': return { relation: 'not', of: props.slotNames?.[0] ?? '' } as never;
    default: return { [kind]: {} } as never;
  }
}

function keyOf(f: Filter): string {
  if ('all' in f) return 'all';
  if ('any' in f) return 'any';
  if ('not' in f) return 'not';
  return Object.keys(f)[0]!;
}

const nodeKind = computed(() => keyOf(props.modelValue));

function setKind(kind: string) {
  if (kind === 'all' || kind === 'any') { emit('update:modelValue', { [kind]: [] } as never); return; }
  if (kind === 'not') { emit('update:modelValue', { not: defaultOf('awakened') } as never); return; }
  emit('update:modelValue', defaultOf(kind));
}

const groupItems = computed<Filter[]>(() => {
  const f = props.modelValue;
  if ('all' in f) return f.all;
  if ('any' in f) return f.any;
  return [];
});

function setGroup(items: Filter[]) {
  const kind = nodeKind.value;
  if (kind === 'all' || kind === 'any') emit('update:modelValue', { [kind]: items } as never);
}

function addChild() { setGroup([...groupItems.value, defaultOf('awakened')]); }
function removeChild(i: number) { setGroup(groupItems.value.filter((_, j) => j !== i)); }
function updateChild(i: number, v: Filter) { setGroup(groupItems.value.map((f, j) => (j === i ? v : f))); }

const notChild = computed<Filter>(() =>
  ('not' in props.modelValue ? props.modelValue.not : defaultOf('awakened')));
function updateNotChild(v: Filter) { emit('update:modelValue', { not: v } as never); }

function leafValue(): Record<string, unknown> {
  return props.modelValue as unknown as Record<string, unknown>;
}
function updateLeaf(patch: Record<string, unknown>) {
  emit('update:modelValue', { ...leafValue(), ...patch } as never);
}
function updateNested(key: string, patch: Record<string, unknown>) {
  const cur = (leafValue()[key] as Record<string, unknown>) ?? {};
  updateLeaf({ [key]: { ...cur, ...patch } });
}

function toggleInSet(key: string, option: string, on: boolean) {
  const cur = (leafValue()[key] as string[]) ?? [];
  updateLeaf({ [key]: on ? [...new Set([...cur, option])] : cur.filter((x) => x !== option) });
}
function inSet(key: string, option: string): boolean {
  return ((leafValue()[key] as string[]) ?? []).includes(option);
}
</script>

<template>
  <div class="cond">
    <div class="cond-row">
      <select class="cond-kind" :value="nodeKind" @change="setKind(($event.target as HTMLSelectElement).value)">
        <optgroup label="combinators">
          <option value="all">all</option>
          <option value="any">any</option>
          <option value="not">not</option>
        </optgroup>
        <optgroup label="leaves">
          <option v-for="k in LEAF_KINDS" :key="k" :value="k">{{ k }}</option>
        </optgroup>
      </select>

      <template v-if="LEAF_SHAPES[nodeKind]">
        <select v-if="nodeKind === 'knows'" aria-label="Known affinity"
                :value="(leafValue().knows as { affinity: string }).affinity"
                @change="updateNested('knows', { affinity: ($event.target as HTMLSelectElement).value })">
          <option v-for="a in ALL_AFFINITIES" :key="a" :value="a">{{ a }}</option>
        </select>
        <template v-if="nodeKind === 'attr'">
          <input type="text" placeholder="attribute" :value="leafValue().attr"
                 @input="updateLeaf({ attr: ($event.target as HTMLInputElement).value })" />
          <select :value="leafValue().op" @change="updateLeaf({ op: ($event.target as HTMLSelectElement).value })">
            <option v-for="op in COMPARE_OPS" :key="op" :value="op">{{ op }}</option>
          </select>
          <input type="number" :value="leafValue().value"
                 @input="updateLeaf({ value: Number(($event.target as HTMLInputElement).value) })" />
        </template>

        <template v-else-if="LEAF_SHAPES[nodeKind]!.kind === 'has'">
          <input type="text" :placeholder="(LEAF_SHAPES[nodeKind] as { label: string }).label" :value="leafValue()[nodeKind]"
                 @input="updateLeaf({ [nodeKind]: ($event.target as HTMLInputElement).value })" />
          <select :value="String(leafValue().has)" @change="updateLeaf({ has: ($event.target as HTMLSelectElement).value === 'true' })">
            <option value="true">has it</option>
            <option value="false">does not</option>
          </select>
        </template>

        <template v-else-if="LEAF_SHAPES[nodeKind]!.kind === 'boolean'">
          <select :value="String(leafValue()[nodeKind])" @change="updateLeaf({ [nodeKind]: ($event.target as HTMLSelectElement).value === 'true' })">
            <option value="true">true</option>
            <option value="false">false</option>
          </select>
        </template>

        <template v-else-if="LEAF_SHAPES[nodeKind]!.kind === 'compareNamed'">
          <select :value="(leafValue()[nodeKind] as { op: string })?.op"
                  @change="updateNested(nodeKind, { op: ($event.target as HTMLSelectElement).value })">
            <option v-for="op in COMPARE_OPS" :key="op" :value="op">{{ op }}</option>
          </select>
          <input type="number" :value="(leafValue()[nodeKind] as { value: number })?.value"
                 @input="updateNested(nodeKind, { value: Number(($event.target as HTMLInputElement).value) })" />
        </template>

        <template v-else-if="nodeKind === 'sex'">
          <select :value="leafValue().sex" @change="updateLeaf({ sex: ($event.target as HTMLSelectElement).value })">
            <option value="male">male</option>
            <option value="female">female</option>
          </select>
        </template>

        <template v-else-if="LEAF_SHAPES[nodeKind]!.kind === 'stringSet'">
          <label v-for="o in (LEAF_SHAPES[nodeKind] as { options: string[] }).options" :key="o" class="tick">
            <input type="checkbox" :checked="inSet(nodeKind, o)"
                   @change="toggleInSet(nodeKind, o, ($event.target as HTMLInputElement).checked)" />{{ o }}
          </label>
        </template>

        <template v-else-if="nodeKind === 'relation'">
          <select :value="leafValue().relation" @change="updateLeaf({ relation: ($event.target as HTMLSelectElement).value })">
            <option v-for="r in RELATIONS" :key="r" :value="r">{{ r }}</option>
          </select>
          <span class="of">of</span>
          <select :value="leafValue().of" @change="updateLeaf({ of: ($event.target as HTMLSelectElement).value })">
            <option v-for="s in slotNames ?? []" :key="s" :value="s">{{ s }}</option>
            <option v-if="!(slotNames ?? []).includes(String(leafValue().of))" :value="leafValue().of">
              {{ leafValue().of || '—' }}
            </option>
          </select>
        </template>
      </template>
    </div>

    <div v-if="nodeKind === 'all' || nodeKind === 'any'" class="cond-group">
      <div v-for="(child, i) in groupItems" :key="i" class="cond-child">
        <FilterBuilder :model-value="child" :slot-names="slotNames" @update:model-value="(v) => updateChild(i, v)" />
        <button class="btn tiny" @click="removeChild(i)">×</button>
      </div>
      <button class="btn tiny" @click="addChild">+ add</button>
    </div>

    <div v-else-if="nodeKind === 'not'" class="cond-group">
      <FilterBuilder :model-value="notChild" :slot-names="slotNames" @update:model-value="updateNotChild" />
    </div>
  </div>
</template>

<style scoped>
.cond { margin: 3px 0; }
.cond-row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.cond-row select, .cond-row input[type=text], .cond-row input[type=number] {
  width: auto; margin: 0; font-size: 12.5px; padding: 4px 6px;
}
.cond-kind { min-width: 112px; font-weight: 600; }
.cond-group { margin: 4px 0 4px 14px; padding-left: 9px; border-left: 2px solid var(--rule); }
.cond-child { display: flex; align-items: flex-start; gap: 5px; margin-bottom: 4px; }
.tick { display: inline-flex; align-items: center; gap: 3px; font-size: 12px; text-transform: none; letter-spacing: 0; color: var(--ink-soft); }
.tick input { margin: 0 2px 0 0; width: auto; }
.of { font-size: 12px; color: var(--ink-faint); }
.btn.tiny { padding: 2px 7px; font-size: 11px; }
</style>
