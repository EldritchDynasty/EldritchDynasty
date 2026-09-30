<script setup lang="ts">
import { computed } from 'vue';
import type { ReadingFont, TextScale } from '../lib/accessibility';

const props = defineProps<{
  textScale: TextScale;
  readingFont: ReadingFont;
  skipSeenProse: boolean;
  reduceMotion: boolean;
  showEverythingFromStart: boolean;
}>();

const emit = defineEmits<{
  'update:textScale': [value: TextScale];
  'update:readingFont': [value: ReadingFont];
  'update:skipSeenProse': [value: boolean];
  'update:reduceMotion': [value: boolean];
  'update:showEverythingFromStart': [value: boolean];
}>();

const textScaleModel = computed<TextScale>({
  get: () => props.textScale,
  set: (value) => emit('update:textScale', value),
});

const readingFontModel = computed<ReadingFont>({
  get: () => props.readingFont,
  set: (value) => emit('update:readingFont', value),
});

const skipSeenModel = computed<boolean>({
  get: () => props.skipSeenProse,
  set: (value) => emit('update:skipSeenProse', value),
});

const reduceMotionModel = computed<boolean>({
  get: () => props.reduceMotion,
  set: (value) => emit('update:reduceMotion', value),
});

const showEverythingModel = computed<boolean>({
  get: () => props.showEverythingFromStart,
  set: (value) => emit('update:showEverythingFromStart', value),
});
</script>

<template>
  <div class="reading-settings stack">
    <label class="small">
      Text size
      <select v-model="textScaleModel">
        <option value="standard">Standard</option>
        <option value="large">Large</option>
        <option value="largest">Largest</option>
      </select>
    </label>

    <label class="small">
      Typeface
      <select v-model="readingFontModel">
        <option value="book">Book face</option>
        <option value="readable">Readable sans</option>
      </select>
    </label>

    <label class="small">
      Skip reading I've already done
      <input v-model="skipSeenModel" type="checkbox" />
    </label>

    <label class="small">
      Reduce motion
      <input v-model="reduceMotionModel" type="checkbox" />
    </label>

    <label class="small">
      Show everything from the start
      <input v-model="showEverythingModel" type="checkbox" />
    </label>

    <p class="dim small">
      Exact repeated Age openings are skipped. A repeated prologue reveals its opening and
      three passive beats at once. Decisions, outcomes, rites and frame scenes still stop for you.
    </p>
  </div>
</template>

<style scoped>
label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
p { margin: 0; line-height: 1.55; }
</style>
