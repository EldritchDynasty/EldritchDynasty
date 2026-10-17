<script setup lang="ts">
import { computed } from 'vue';
import type { Check, EventTemplate, PoolSpec } from '@ed/schema';
import { ALL_AFFINITIES, PoolSpecS } from '@ed/schema';

/**
 * CHECKS, and the one thing about them that is easy to get wrong.
 *
 * A check's bands name one of two different things, and which one depends on
 * what the check is FOR — not on anything visible in the check itself:
 *
 *   named by `Choice.check`            bands name OUTCOME ids
 *   named by `decidedBy.party.check`   bands name CHOICE ids
 *
 * So this component works out the role from the event and offers the right
 * list. `checks/wiring` fails the build on the mistake; this is the half that
 * stops an author making it.
 */
const props = defineProps<{ event: EventTemplate }>();
const emit = defineEmits<{ change: [] }>();

const VARIANCE = ['none', 'narrow', 'wide'];
const POOL_KINDS = PoolSpecS.options.map((s) => s.shape.kind.value);

const choices = computed(() => (props.event.interaction.kind === 'narration' ? [] : props.event.interaction.choices));
const slotNames = computed(() => Object.keys(props.event.slots));

const branchCheck = computed(() => {
  const i = props.event.interaction;
  if (i.kind === 'narration') return undefined;
  const d = i.decidedBy;
  return typeof d === 'object' && 'party' in d ? d.party.check : undefined;
});

/** What this check's bands are allowed to name, and why. */
function bandTargets(check: Check): { options: string[]; role: string } {
  if (branchCheck.value === check.id) {
    return { options: choices.value.map((c) => c.id), role: 'decides the branch — bands name choices' };
  }
  const owner = choices.value.find((c) => c.check === check.id);
  if (owner) {
    return { options: owner.outcomes.map((o) => o.id), role: `resolves '${owner.label}' — bands name its outcomes` };
  }
  return { options: [], role: 'spent by nothing — this check never runs' };
}

function touch() { emit('change'); }

function setAffinity(check: Check, value: string) {
  const affinity = ALL_AFFINITIES.find((a) => a === value);
  if (affinity && check.pool.kind === 'family_knows') check.pool.affinity = affinity;
  touch();
}

function add() {
  let n = props.event.checks.length + 1;
  while (props.event.checks.some((c) => c.id === `check_${n}`)) n += 1;
  props.event.checks.push({
    id: `check_${n}`,
    pool: { kind: 'family_max', attr: 'strength' },
    difficulty: 50,
    variance: 'narrow',
    bands: [{ atLeast: 0, outcome: '' }],
  });
  touch();
}

function remove(i: number) {
  props.event.checks.splice(i, 1);
  touch();
}

/** A pool of `kind`, with the fields that kind needs and none of the others. */
function setPoolKind(check: Check, kind: string) {
  if (kind === 'family_knows') {
    check.pool = { kind: 'family_knows', affinity: 'life' };
    check.variance = 'none';
    check.difficulty = 1;
    touch();
    return;
  }
  const attr = 'attr' in check.pool ? check.pool.attr : 'strength';
  check.pool = kind === 'slot'
    ? { kind: 'slot', slot: slotNames.value[0] ?? '', attrs: [{ attr, weight: 1 }] }
    : kind === 'party_sum'
      ? { kind: 'party_sum', slots: slotNames.value.filter((s) => props.event.slots[s]?.castBy === 'player'), attr }
      : kind === 'family_any'
        ? { kind: 'family_any', attr, atLeast: 40 }
        : kind === 'record'
          ? { kind: 'record', against: { measure: 'count' } }
          : { kind: kind as 'family_sum', attr };
  touch();
}

const flatDifficulty = (c: Check) => typeof c.difficulty === 'number';

function toggleDifficulty(check: Check) {
  check.difficulty = flatDifficulty(check)
    ? { base: check.difficulty as number }
    : (check.difficulty as { base: number }).base;
  touch();
}

function setExpr(check: Check, key: 'base' | 'perRespectTier' | 'perCentury', value: number) {
  const d = check.difficulty as { base: number; perRespectTier?: number; perCentury?: number };
  d[key] = value;
  touch();
}

function addBand(check: Check) {
  const lowest = check.bands[check.bands.length - 1]?.atLeast ?? 0;
  check.bands.push({ atLeast: lowest - 20, outcome: bandTargets(check).options[0] ?? '' });
  touch();
}
function removeBand(check: Check, i: number) {
  check.bands.splice(i, 1);
  touch();
}

/** Bands are read highest-first and `checks/wiring` insists on it. Say so before the build does. */
function bandsDescend(check: Check): boolean {
  return check.bands.every((b, i) => i === 0 || b.atLeast < check.bands[i - 1]!.atLeast);
}

function poolOf(check: Check): PoolSpec { return check.pool; }
</script>

<template>
  <div>
    <div v-for="(check, i) in event.checks" :key="i" class="check">
      <div class="row-head">
        <input type="text" :value="check.id" @change="check.id = ($event.target as HTMLInputElement).value; touch()" />
        <span class="role">{{ bandTargets(check).role }}</span>
        <button class="btn tiny" @click="remove(i)">remove</button>
      </div>

      <div class="line">
        <span class="fk">pool</span>
        <select :value="check.pool.kind" @change="setPoolKind(check, ($event.target as HTMLSelectElement).value)">
          <option v-for="k in POOL_KINDS" :key="k" :value="k">{{ k }}</option>
        </select>

        <template v-if="poolOf(check).kind === 'slot'">
          <select :value="(poolOf(check) as { slot: string }).slot"
                  @change="(poolOf(check) as { slot: string }).slot = ($event.target as HTMLSelectElement).value; touch()">
            <option v-for="s in slotNames" :key="s" :value="s">{{ s }}</option>
          </select>
        </template>
        <template v-else-if="poolOf(check).kind === 'party_sum'">
          <label v-for="s in slotNames" :key="s" class="tick">
            <input
              type="checkbox"
              :checked="(poolOf(check) as { slots: string[] }).slots.includes(s)"
              @change="(poolOf(check) as { slots: string[] }).slots = ($event.target as HTMLInputElement).checked
                ? [...(poolOf(check) as { slots: string[] }).slots, s]
                : (poolOf(check) as { slots: string[] }).slots.filter((x) => x !== s); touch()"
            />{{ s }}
          </label>
        </template>

        <template v-if="check.pool.kind === 'family_knows'">
          <select aria-label="Family known affinity" :value="check.pool.affinity"
                  @change="setAffinity(check, ($event.target as HTMLSelectElement).value)">
            <option v-for="a in ALL_AFFINITIES" :key="a" :value="a">{{ a }}</option>
          </select>
        </template>
        <template v-if="'attr' in poolOf(check)">
          <input type="text" placeholder="attribute" :value="(poolOf(check) as { attr: string }).attr"
                 @input="(poolOf(check) as { attr: string }).attr = ($event.target as HTMLInputElement).value; touch()" />
        </template>
        <template v-if="poolOf(check).kind === 'family_any'">
          <span class="fk">at least</span>
          <input type="number" :value="(poolOf(check) as { atLeast: number }).atLeast"
                 @input="(poolOf(check) as { atLeast: number }).atLeast = Number(($event.target as HTMLInputElement).value); touch()" />
        </template>
      </div>

      <div class="line">
        <span class="fk">difficulty</span>
        <template v-if="flatDifficulty(check)">
          <input type="number" :value="check.difficulty as number"
                 @input="check.difficulty = Number(($event.target as HTMLInputElement).value); touch()" />
        </template>
        <template v-else>
          <span class="fk">base</span>
          <input type="number" :value="(check.difficulty as { base: number }).base"
                 @input="setExpr(check, 'base', Number(($event.target as HTMLInputElement).value))" />
          <span class="fk">per tier</span>
          <input type="number" :value="(check.difficulty as { perRespectTier?: number }).perRespectTier ?? 0"
                 @input="setExpr(check, 'perRespectTier', Number(($event.target as HTMLInputElement).value))" />
          <span class="fk">per century</span>
          <input type="number" :value="(check.difficulty as { perCentury?: number }).perCentury ?? 0"
                 @input="setExpr(check, 'perCentury', Number(($event.target as HTMLInputElement).value))" />
        </template>
        <button class="btn tiny" @click="toggleDifficulty(check)">
          {{ flatDifficulty(check) ? 'make it move with the world' : 'make it flat' }}
        </button>

        <span class="fk">variance</span>
        <select :value="check.variance" @change="check.variance = ($event.target as HTMLSelectElement).value as never; touch()">
          <option v-for="v in VARIANCE" :key="v" :value="v">{{ v }}</option>
        </select>
      </div>

      <div class="line bands">
        <span class="fk">bands</span>
        <div>
          <div v-for="(b, bi) in check.bands" :key="bi" class="band">
            <span class="fk">≥</span>
            <input type="number" :value="b.atLeast" @input="b.atLeast = Number(($event.target as HTMLInputElement).value); touch()" />
            <span class="fk">→</span>
            <select :value="b.outcome" @change="b.outcome = ($event.target as HTMLSelectElement).value; touch()">
              <option v-for="o in bandTargets(check).options" :key="o" :value="o">{{ o }}</option>
              <option v-if="!bandTargets(check).options.includes(b.outcome)" :value="b.outcome">{{ b.outcome || '—' }}</option>
            </select>
            <button class="btn tiny" @click="removeBand(check, bi)">×</button>
          </div>
          <button class="btn tiny" @click="addBand(check)">+ band</button>
          <div v-if="!bandsDescend(check)" class="issue error">
            bands are read highest-first and must descend strictly
          </div>
        </div>
      </div>
    </div>
    <button class="btn" @click="add">+ add check</button>
  </div>
</template>

<style scoped>
.check { border-left: 2px solid var(--rule); padding: 6px 0 6px 10px; margin-bottom: 9px; }
.check:hover { background: var(--vellum-deep); }
.row-head { display: flex; gap: 7px; align-items: center; margin-bottom: 4px; }
.row-head input { width: auto; margin: 0; font-weight: 600; font-size: 12.5px; padding: 4px 6px; }
.role { font-size: 11.5px; color: var(--ink-faint); font-style: italic; }
.line { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; margin: 3px 0; }
.line input, .line select { width: auto; margin: 0; font-size: 12.5px; padding: 4px 6px; }
.line input[type=number] { max-width: 78px; }
.bands { align-items: flex-start; }
.band { display: flex; gap: 5px; align-items: center; margin-bottom: 3px; }
.fk { font-size: 11px; letter-spacing: .06em; color: var(--ink-faint); }
.tick { display: inline-flex; align-items: center; gap: 3px; font-size: 12px; text-transform: none; letter-spacing: 0; color: var(--ink-soft); }
.tick input { margin: 0 2px 0 0; width: auto; }
.btn.tiny { padding: 2px 7px; font-size: 11px; }
</style>
