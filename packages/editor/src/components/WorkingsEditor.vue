<script setup lang="ts">
import { computed, ref, shallowRef } from 'vue';
import { MysticWorkingDefS, MysticBenefitS, asId, fieldsOfSchema, type FieldSpec, type MysticWorkingDef } from '@ed/schema';
import { addGrudge, bootstrap, beginCommitment, beginStudy, covertOpportunities, isCurrentFamily, isFieldWorking, mysticTargets, prepareCovertOperation, quoteCommission, quoteDuty } from '@ed/core';
import { fileOf, rawContent, store } from '../lib/store';
import { isWritableContentPath } from '../lib/content';
import { watchEdits } from '../lib/watch-edits';
import FieldInput from './FieldInput.vue';
import SaveControl from './SaveControl.vue';
import ProseVariantEditor from './ProseVariantEditor.vue';

const selected = ref(store.bundle.mysticWorkings[0]?.id ?? '');
const current = computed(() => store.bundle.mysticWorkings.find(w => w.id === selected.value));
const writable = computed(() => {
  const path = current.value && fileOf('mysticWorkings', current.value.id);
  return path !== undefined && isWritableContentPath(path);
});
watchEdits(current, 'mysticWorkings', () => writable.value);
const fields = fieldsOfSchema(MysticWorkingDefS, ['id', 'benefit']);
const variants = MysticBenefitS.options.map(s => ({ kind: s.shape.kind.value, fields: fieldsOfSchema(s, ['kind']) }));
const benefit = computed(() => variants.find(v => v.kind === current.value?.benefit.kind));
const issues = computed(() => {
  if (!current.value) return [];
  const result = MysticWorkingDefS.safeParse(current.value);
  return result.success ? [] : result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`);
});
function setField(key: string, value: unknown) {
  if (!current.value || !writable.value) return;
  const row = current.value as unknown as Record<string, unknown>;
  if (value === undefined) delete row[key]; else row[key] = value;
}
function setBenefitField(key: string, value: unknown) {
  if (!current.value || !writable.value) return;
  const row = current.value.benefit as unknown as Record<string, unknown>;
  if (value === undefined) delete row[key]; else row[key] = value;
}
function seed(field: FieldSpec): unknown {
  if (field.fallback !== undefined) return field.fallback;
  const c = field.control;
  return c.kind === 'number' ? 0 : c.kind === 'boolean' ? false : c.kind === 'enum' ? c.options[0]
    : c.kind === 'object' ? {} : c.kind === 'stringList' ? [] : '';
}
function changeBenefit(kind: string) {
  const v = variants.find(v => v.kind === kind);
  if (!current.value || !v || !writable.value) return;
  current.value.benefit = Object.fromEntries([['kind', kind], ...v.fields.filter(f => !f.optional).map(f => [f.key, seed(f)])]) as MysticWorkingDef['benefit'];
}
const sex = ref<'male' | 'female'>('female');
const preview = shallowRef<ReturnType<typeof quoteDuty>>();
function evaluate() {
  if (!current.value || issues.value.length) return;
  const ctx = bootstrap(rawContent(), 1875, 1042);
  const w = ctx.content.mysticWorking(current.value.id)!;
  const p = ctx.world.people.household(ctx.world.playerHouse, ctx.world.year)
    .find(p => p.sex === sex.value && (w.benefit.kind !== 'covert_support' || !p.becomesGuardian))!;
  // This is a private, explicitly qualified fixture, not a new way to learn in play.
  p.spellsKnown = w.books.map(b => asId(b));
  p.awakening.awakened = true;
  if (w.benefit.kind === 'commission') {
    p.traits.add(asId('colleges_warrant'));
    const patron = ctx.world.people.living().find(person => person.castSlots.includes('rival'))!;
    const house = ctx.world.people.householdOf(patron.id, ctx.world.year)!;
    const quote = quoteCommission(ctx, p.id, w.id, house);
    preview.value = { ...quote, preparation: quote.price };
    return;
  }
  if (w.benefit.kind === 'library_care') {
    const book = w.books[0]!;
    ctx.world.library.set(book, { id: book, acquiredYear: 1041, condition: 60 });
  }
  if (w.benefit.kind === 'convalescence' || w.benefit.kind === 'teaching') {
    const relative = ctx.world.people.household(ctx.world.playerHouse, ctx.world.year)
      .find(person => person.id !== p.id && !person.becomesGuardian && person.sex === 'female' && isCurrentFamily(ctx, person))!;
    if (w.benefit.kind === 'convalescence') relative.acquired.health = -8;
    else {
      const book = ctx.content.spellbook(w.books[0]!)!;
      ctx.world.library.set(book.id, { id: book.id, acquiredYear: 1041, condition: 80 });
      relative.awakening.awakened = true; relative.acquired[book.affinity] = 100;
      if (relative.phenotype) relative.phenotype.dirty = true;
      beginStudy(ctx, relative, book);
    }
  }
  if (isFieldWorking(w)) beginCommitment(ctx, 10, 'the_wars');
  if (w.benefit.kind === 'covert_support') {
    const enemy = ctx.world.people.living().find(p => p.castSlots.includes('rival'))!;
    addGrudge(ctx, ctx.world.playerHouse, enemy.id, { severity: 75, inheritance: 'house_wide' });
    const opportunity = covertOpportunities(ctx).find(o => o.target.id === enemy.id)!;
    prepareCovertOperation(ctx, { opportunity: opportunity.id, operative: p.id,
      purpose: 'settle_grudge', preparation: 'hasty' });
  }
  const target = mysticTargets(ctx, w)[0];
  preview.value = quoteDuty(ctx, { person: p.id, working: w.id,
    target: target?.target ?? { kind: 'hall', hall: 'main' }, bindings: target?.bindings });
}
</script>

<template>
  <header><h2>Mystic workings</h2><p>Learned duties, their costs and their real system effects. The quote preview uses the engine.</p></header>
  <div class="workings-layout">
    <aside class="panel">
      <div class="list">
        <button v-for="working in store.bundle.mysticWorkings" :key="working.id" class="row working-row"
          :class="{ on: selected === working.id }" @click="selected = working.id; preview = undefined">
          <span class="t">{{ working.name }}</span><span class="sub">{{ working.affinity }}</span>
        </button>
      </div>
    </aside>
    <section v-if="current" class="panel working-form">
      <h3>{{ current.name }} <small class="muted">{{ current.id }}</small></h3>
      <p v-if="!writable" class="muted">This source is reference-only.</p>
      <fieldset :disabled="!writable">
        <FieldInput v-for="field in fields" :key="field.key" :spec="field"
          :model-value="(current as unknown as Record<string, unknown>)[field.key]" @update:model-value="v => setField(field.key, v)" />
        <label>Benefit
          <select :value="current.benefit.kind" @change="changeBenefit(($event.target as HTMLSelectElement).value)">
            <option v-for="v in variants" :key="v.kind" :value="v.kind">{{ v.kind }}</option>
          </select>
        </label>
        <FieldInput v-for="field in benefit?.fields ?? []" :key="field.key" :spec="field"
          :model-value="(current.benefit as unknown as Record<string, unknown>)[field.key]" @update:model-value="v => setBenefitField(field.key, v)" />
      </fieldset>
      <p v-for="issue in issues" :key="issue" class="error">{{ issue }}</p>
      <ProseVariantEditor collection-key="mysticWorkings" :id="current.id" :model-value="current" :disabled="!writable" />
      <SaveControl collection-key="mysticWorkings" :id="current.id" />
      <hr>
      <h4>Qualified-reader quote</h4>
      <p class="muted">A private founding-world fixture assumes the required books are completed. No live world, study or counter is changed.</p>
      <p v-if="current.benefit.kind === 'covert_support'" class="muted">This private fixture also prepares a paid expedition against a known rival with a qualifying grievance. The reader travels on that expedition.</p>
      <p v-if="current.benefit.kind === 'commission'" class="muted">This fixture adds the actual warrant and quotes a finite commission from a known rival house. It grants no warrant in a live game.</p>
      <p v-if="current.collaborator" class="muted">The order can be prepared alone, but its benefit requires a different learned, available and paid reader keeping {{ current.collaborator }} at the same site.</p>
      <p v-if="current.benefit.kind === 'library_care'" class="muted">The fixture holds one real damaged copy. Care cannot reach an absent copy or a book at the binder.</p>
      <p v-if="current.benefit.kind === 'teaching' || current.benefit.kind === 'convalescence'" class="muted">The fixture provides an actual resident pupil or injured relative for the shared target evaluator.</p>
      <label>Reader <select v-model="sex"><option value="female">woman</option><option value="male">man</option></select></label>
      <button class="btn" :disabled="issues.length > 0" @click="evaluate">Evaluate the actual quote</button>
      <p v-if="preview">{{ preview.ok ? 'Available' : preview.reason }} · {{ preview.preparation }} crowns to prepare
        · {{ preview.upkeep }} yearly · ready {{ preview.ready }}</p>
    </section>
  </div>
</template>

<style scoped>
.workings-layout { display: grid; grid-template-columns: 240px minmax(0, 1fr); gap: 16px; }
.working-row { display: grid; gap: 4px; }
.working-form fieldset { border: 0; padding: 0; }
@media (max-width: 720px) { .workings-layout { grid-template-columns: 1fr; } }
</style>
