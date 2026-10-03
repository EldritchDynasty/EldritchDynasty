<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue';
import type { Content } from '@ed/schema';
import { FREQUENCY_PROFILES } from '@ed/schema';
import { START_YEAR, bootstrap, previewTemplate, makeRng, eldritch, genomeOf } from '@ed/core';
import { markDirty } from '../lib/store';
import FrequencyPicker from './FrequencyPicker.vue';
import Sigil from './Sigil.vue';
import SaveControl from './SaveControl.vue';
import ConditionBuilder from './ConditionBuilder.vue';
import ProseVariantEditor from './ProseVariantEditor.vue';

const props = defineProps<{ content: Content }>();

// No local copy (issue #20) — see EventEditor.vue's own note. `content.characterTemplates`
// is `store.bundle.characterTemplates` itself.
const templates = computed(() => props.content.characterTemplates);
const selectedId = ref(templates.value[0]?.id ?? '');
const current = computed(() => templates.value.find((t) => t.id === selectedId.value));

watch(current, () => { if (current.value) markDirty('characterTemplates', current.value.id); }, { deep: true });

const roleFilter = ref<string>('all');
const roles = computed(() => ['all', ...new Set(templates.value.map((t) => t.role))]);
const shown = computed(() =>
  templates.value.filter((t) => roleFilter.value === 'all' || t.role === roleFilter.value));

const preview = shallowRef<ReturnType<typeof previewTemplate> | null>(null);
const previewSeed = ref(7);

/**
 * The only honest way to review a character template is to roll a lot of them
 * and look at the distribution — because the field that matters most, whether
 * this person carries anything, is invisible to the player and invisible on
 * the form. A recipe that reads like deep blood and produces nulls is a bug
 * you can only see in the sample.
 */
function roll(n = 24) {
  const t = current.value;
  if (!t) return;
  const ctx = bootstrap(props.content, previewSeed.value, START_YEAR);
  const rng = makeRng(previewSeed.value);
  preview.value = previewTemplate(t, ctx, n, (p) => {
    const g = genomeOf(p, ctx.genetics);
    return eldritch(g, p.sex, ctx.genetics.table);
  }, rng);
  previewSeed.value += 1;
}

const houseName = (id: string) => props.content.house(id)?.name ?? id;
const carrierRateOf = (id: string) => props.content.house(id)?.genePool.fontCarrierRate ?? 0;
</script>

<template>
  <header>
    <h2>Character templates</h2>
    <p>
      The seed cast is twelve people who exist in 1042. Everyone the next five centuries
      produces — suitors, grooms, rivals, tutors, wanderers — is rolled from one of these.
      A template is a recipe, not a person: it says which house rolls the genome, and that
      decides whether they carry anything at all.
    </p>
  </header>

  <div class="bar">
    <button
      v-for="r in roles" :key="r" class="btn"
      :style="roleFilter === r ? 'border-color:var(--rubric);color:var(--rubric)' : ''"
      @click="roleFilter = r"
    >{{ r }}</button>
  </div>

  <div class="cols wide">
    <div class="panel">
      <h3>{{ shown.length }} templates</h3>
      <div class="list">
        <button
          v-for="t in shown" :key="t.id" class="row"
          :class="{ on: t.id === selectedId }"
          @click="selectedId = t.id; preview = null"
        >
          <span class="badge" :class="t.frequency">{{ t.frequency }}</span>
          <span class="t">{{ t.title }}<br /><span class="sub">{{ t.role }} · {{ t.id }}</span></span>
        </button>
      </div>
    </div>

    <div v-if="current" class="panel">
      <h3>{{ current.id }}</h3>

      <label>Title</label>
      <input type="text" v-model="current.title" />

      <label>Role</label>
      <select v-model="current.role">
        <option v-for="r in ['suitor','groom','rival','retainer','the_match','ward','hostage','wanderer']" :key="r" :value="r">{{ r }}</option>
      </select>

      <FrequencyPicker v-model="current.frequency" />

      <label>Sex</label>
      <select v-model="current.sex">
        <option value="any">any</option>
        <option value="female">female</option>
        <option value="male">male</option>
      </select>

      <label>Age at arrival</label>
      <div style="display:flex;gap:8px">
        <input type="number" v-model.number="current.ageAtArrival.min" />
        <input type="number" v-model.number="current.ageAtArrival.max" />
      </div>

      <label>Gene pools — the field that decides everything</label>
      <div v-for="(h, i) in current.houses" :key="i" class="note" style="margin:4px 0">
        <strong>{{ houseName(h.house) }}</strong> · weight {{ h.weight }} ·
        font carrier rate
        <span :style="{ color: carrierRateOf(h.house) > 0 ? 'var(--rubric)' : 'var(--ink-faint)' }">
          {{ (carrierRateOf(h.house) * 100).toFixed(1) }}%
        </span>
      </div>

      <label>Traits</label>
      <div>
        <span v-for="t in current.traits" :key="t" class="chip">{{ t }}</span>
        <span v-if="!current.traits.length" class="sub" style="color:var(--ink-faint);font-size:12px">none</span>
      </div>

      <label>Cast slots</label>
      <div>
        <span v-for="s in current.castSlots" :key="s" class="chip">{{ s }}</span>
        <span v-if="!current.castSlots.length" class="sub" style="color:var(--ink-faint);font-size:12px">none</span>
      </div>

      <label>Blurb</label>
      <textarea v-model="current.blurb" style="min-height:80px" />

      <label>Conditions</label>
      <ConditionBuilder v-model="current.conditions" />

      <div class="note" v-if="current.unique">
        <strong>Unique.</strong> Never minted while one is alive — the recurring cast is
        refilled only when the last occupant dies.
      </div>
      <div class="note" v-if="FREQUENCY_PROFILES[current.frequency].perRunCap">
        Rationed: at most {{ FREQUENCY_PROFILES[current.frequency].perRunCap }} of this tier
        appear in an entire run, no two within
        {{ FREQUENCY_PROFILES[current.frequency].cooldownYears }} years.
      </div>

      <!-- ── Rolled preview ─────────────────────────────────────────── -->
      <div class="bar" style="margin:16px 0 8px">
        <button class="btn primary" @click="roll(24)">Roll 24 of these</button>
        <span v-if="preview" style="font-size:12.5px;color:var(--ink-soft)">
          {{ (preview.carrierRate * 100).toFixed(0) }}% carry something ·
          mean font {{ preview.meanFont.toFixed(1) }}
        </span>
      </div>

      <div v-if="preview" style="display:flex;flex-wrap:wrap;gap:6px">
        <div
          v-for="(s, i) in preview.sample" :key="i"
          :title="`${s.name} · ${s.house} · font ${s.font}`"
          style="display:flex;align-items:center;gap:5px;border:1px solid var(--rule);border-radius:3px;padding:4px 7px"
        >
          <Sigil :seed="i * 7919 + previewSeed" :size="20" :sex="s.sex" :expressing="s.canExpress" />
          <span style="font-size:11.5px">
            {{ s.name.split(' ')[0] }}
            <span :style="{ color: s.font > 0 ? 'var(--rubric)' : 'var(--ink-faint)' }">{{ s.font }}</span>
          </span>
        </div>
      </div>
      <p v-if="preview && preview.carrierRate === 0" class="note" style="color:var(--rubric)">
        Not one of these carries anything. If this template is meant to be a route into the
        blood, its houses are wrong — and no amount of reading the form would have told you.
      </p>

      <ProseVariantEditor
        collection-key="characterTemplates"
        :id="current.id"
        :model-value="current"
      />

      <SaveControl collection-key="characterTemplates" :id="current.id" />
    </div>
  </div>
</template>
