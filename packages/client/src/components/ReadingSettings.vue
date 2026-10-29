<script setup lang="ts">
import { computed } from 'vue';
import type { ProseMode } from '@ed/schema';
import type { ReadingFont, TextScale } from '../lib/accessibility';

const props = withDefaults(defineProps<{
  textScale: TextScale;
  readingFont: ReadingFont;
  proseMode: ProseMode;
  skipSeenProse: boolean;
  reduceMotion: boolean;
  showEverythingFromStart?: boolean;
  /** The progressive-reveal option belongs to the in-run "Reading, marks and keys" panel. */
  showProgressiveRevealOption?: boolean;
  /** The §24 sound bed (#1986): on/off, and a level over cues and drone together. */
  sound?: boolean;
  soundVolume?: number;
  /** Sound belongs to the in-run panel, where the house is there to be heard. */
  showSoundOption?: boolean;
}>(), {
  proseMode: 'original',
  showEverythingFromStart: false,
  showProgressiveRevealOption: false,
  sound: true,
  soundVolume: 1,
  showSoundOption: false,
});

const emit = defineEmits<{
  'update:textScale': [value: TextScale];
  'update:readingFont': [value: ReadingFont];
  'update:proseMode': [value: ProseMode];
  'update:skipSeenProse': [value: boolean];
  'update:reduceMotion': [value: boolean];
  'update:showEverythingFromStart': [value: boolean];
  'update:sound': [value: boolean];
  'update:soundVolume': [value: number];
}>();

const textScaleModel = computed<TextScale>({
  get: () => props.textScale,
  set: (value) => emit('update:textScale', value),
});

const readingFontModel = computed<ReadingFont>({
  get: () => props.readingFont,
  set: (value) => emit('update:readingFont', value),
});

const proseModeModel = computed<ProseMode>({
  get: () => props.proseMode,
  set: (value) => emit('update:proseMode', value),
});

const skipSeenModel = computed<boolean>({
  get: () => props.skipSeenProse,
  set: (value) => emit('update:skipSeenProse', value),
});

const reduceMotionModel = computed<boolean>({
  get: () => props.reduceMotion,
  set: (value) => emit('update:reduceMotion', value),
});

const plainEnglish = computed(() => props.proseMode === 'plainenglish');

const showEverythingModel = computed<boolean>({
  get: () => props.showEverythingFromStart,
  set: (value) => emit('update:showEverythingFromStart', value),
});

const soundModel = computed<boolean>({
  get: () => props.sound,
  set: (value) => emit('update:sound', value),
});

/** Whole percentages on the slider; the preference keeps 0..1. */
const volumePercent = computed(() => Math.round(props.soundVolume * 100));
const volumeText = computed(() => `${volumePercent.value}%`);
function setVolume(event: Event) {
  const value = Number((event.target as HTMLInputElement).value);
  if (Number.isFinite(value)) emit('update:soundVolume', Math.min(100, Math.max(0, value)) / 100);
}
</script>

<template>
  <div class="reading-settings stack" role="group" :aria-label="plainEnglish ? 'Choose how to read' : 'Reading preferences'">
    <label class="small">
      {{ plainEnglish ? 'How big the text is' : 'Text size' }}
      <select v-model="textScaleModel">
        <option value="standard">{{ plainEnglish ? 'Normal' : 'Standard' }}</option>
        <option value="large">Large</option>
        <option value="largest">{{ plainEnglish ? 'Extra large' : 'Largest' }}</option>
      </select>
    </label>

    <label class="small">
      {{ plainEnglish ? 'Font' : 'Typeface' }}
      <select v-model="readingFontModel">
        <option value="book">{{ plainEnglish ? 'Book-style letters' : 'Book face' }}</option>
        <option value="readable">{{ plainEnglish ? 'Simple letters' : 'Readable sans' }}</option>
      </select>
    </label>

    <label class="small">
      {{ plainEnglish ? 'Writing style' : 'Prose' }}
      <select v-model="proseModeModel" :aria-label="plainEnglish ? 'Writing style' : 'Prose style'">
        <option value="original">Original</option>
        <option value="plainenglish">Plain English</option>
      </select>
    </label>

    <label class="small">
      {{ plainEnglish ? 'Skip passages I have read before' : "Skip reading I've already done" }}
      <input v-model="skipSeenModel" type="checkbox" />
    </label>

    <label class="small">
      {{ plainEnglish ? 'Use fewer animations' : 'Reduce motion' }}
      <input v-model="reduceMotionModel" type="checkbox" />
    </label>

    <label v-if="showProgressiveRevealOption" class="small">
      {{ plainEnglish ? 'Show all options right away' : 'Show everything from the start' }}
      <input v-model="showEverythingModel" type="checkbox" />
    </label>

    <template v-if="showSoundOption">
      <label class="small">
        {{ plainEnglish ? 'Play sounds' : 'Sound' }}
        <input v-model="soundModel" type="checkbox" />
      </label>
      <label class="small">
        {{ plainEnglish ? 'How loud' : 'Volume' }}
        <input
          type="range" min="0" max="100" step="10"
          :value="volumePercent" :disabled="!sound" :aria-valuetext="volumeText"
          @input="setVolume"
        />
      </label>
      <p class="dim small">
        {{ plainEnglish
          ? 'Sounds only repeat what the screen already says. You never need them to play.'
          : 'Every sound repeats something the page already says; none is needed to play.' }}
      </p>
    </template>

    <p v-if="plainEnglish" class="dim small">
      Your reading choices do not change the game rules. Choosing Plain English changes new writing,
      not pages already saved in the Chronicle. If you turn on skipping, you can skip Age openings
      you have read before, and a familiar prologue is revealed at once. You still see decisions,
      outcomes, rites and scenes.
    </p>
    <p v-else class="dim small">
      Prose changes apply to new material; pages already written in the Chronicle keep the words
      you saw. Exact repeated Age openings are skipped when enabled. A repeated prologue reveals its
      passive beats at once. Decisions, outcomes, rites and frame scenes still stop for you.
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
