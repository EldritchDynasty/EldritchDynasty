<script setup lang="ts">
import { computed, ref } from 'vue';
import type { EpilogueView, SessionView } from '@ed/core';
import type { GameActions } from '../lib/game';
import Entry from './Entry.vue';
import {
  PLATE, afterimageLayout, afterimageModel, afterimageName, type Measure,
} from '../lib/book';

const props = defineProps<{ view: SessionView; epilogue: EpilogueView; actions: GameActions }>();
defineEmits<{ (e: 'open'): void }>();

/**
 * THE LAST NIGHT (concept §23, issue #39).
 *
 * The closing text is assembled from the chronicle the player wrote —
 * including the omissions, which print here as dated blank lines exactly as
 * they do in the book, because they are the artefact and they are what the
 * creditor spent the night reading.
 *
 * The ring is the shape of the screen: the prologue's own three beats,
 * restated, with the one element the five centuries changed marked. Everything
 * else on the page is in the frame's register and the last line is not, and
 * the drop is the effect.
 */
const reckoning = computed(() => props.epilogue.reckoning);

const afterimage = computed(() => afterimageModel({
  houseName: props.view.houseName,
  campaignName: props.view.campaign.name,
  seed: props.view.seed,
  year: props.epilogue.year,
  endingTitle: props.epilogue.title,
  endingSummary: props.epilogue.summary,
  reckoning: {
    pages: props.epilogue.reckoning.pages,
    blanks: props.epilogue.reckoning.blanks,
    embellished: props.epilogue.reckoning.embellished,
    standingLies: props.epilogue.reckoning.standingLies,
    provenLies: props.epilogue.reckoning.provenLies,
    clauses: props.epilogue.reckoning.clauses,
    clausesTotal: props.epilogue.reckoning.clausesTotal,
    attestedTitle: props.epilogue.reckoning.attested === 'none'
      ? 'nothing at all'
      : props.epilogue.reckoning.attestedTitle,
    livingBlood: props.epilogue.reckoning.livingBlood,
  },
  read: props.epilogue.read,
}));

const savingAfterimage = ref(false);

/**
 * ONE PAGE SOMEBODY CAN HAND TO SOMEBODY ELSE (#260).
 *
 * This deliberately uses the same fixed plate, ink, vellum and wrapping seam
 * as the Chronicle export rather than screenshotting the current DOM. The
 * current viewport is an accident; the finished house is not.
 */
async function saveAfterimage(): Promise<void> {
  savingAfterimage.value = true;
  try {
    const gauge = document.createElement('canvas').getContext('2d');
    if (!gauge) return;
    const measure: Measure = (text, font) => {
      gauge.font = font;
      return gauge.measureText(text).width;
    };

    const model = afterimage.value;
    const layout = afterimageLayout(model, measure);
    const width = PLATE.width;
    const {
      endingFont, summaryFont, quoteFont, endingLines, summaryLines, quoteLines,
    } = layout;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = layout.height;
    const ink = canvas.getContext('2d');
    if (!ink) return;

    ink.fillStyle = PLATE.ground;
    ink.fillRect(0, 0, canvas.width, canvas.height);

    let y = 66;
    ink.fillStyle = PLATE.ink;
    ink.font = `500 34px ${PLATE.serif}`;
    ink.fillText(model.houseName, PLATE.pad, y);

    y += 28;
    ink.fillStyle = PLATE.faint;
    ink.font = `13px ${PLATE.serif}`;
    ink.fillText(model.strap, PLATE.pad, y);

    y += 24;
    ink.strokeStyle = PLATE.rule;
    ink.beginPath();
    ink.moveTo(PLATE.pad, y);
    ink.lineTo(width - PLATE.pad, y);
    ink.stroke();

    y += 52;
    ink.fillStyle = PLATE.rubric;
    ink.font = endingFont;
    for (const line of endingLines) {
      ink.fillText(line, PLATE.pad, y);
      y += 38;
    }

    y += 4;
    ink.fillStyle = PLATE.ink;
    ink.font = summaryFont;
    for (const line of summaryLines) {
      ink.fillText(line, PLATE.pad, y);
      y += 30;
    }

    y += 22;
    ink.strokeStyle = PLATE.rule;
    ink.beginPath();
    ink.moveTo(PLATE.pad, y);
    ink.lineTo(width - PLATE.pad, y);
    ink.stroke();
    y += 32;

    for (const fact of model.facts) {
      ink.textAlign = 'left';
      ink.fillStyle = PLATE.faint;
      ink.font = `14px ${PLATE.serif}`;
      ink.fillText(fact.label, PLATE.pad, y);

      ink.textAlign = 'right';
      ink.fillStyle = PLATE.ink;
      ink.font = `17px ${PLATE.serif}`;
      ink.fillText(fact.value, width - PLATE.pad, y);
      y += 42;
    }
    ink.textAlign = 'left';

    if (model.quote) {
      y += 8;
      ink.strokeStyle = PLATE.rule;
      ink.beginPath();
      ink.moveTo(PLATE.pad, y);
      ink.lineTo(width - PLATE.pad, y);
      ink.stroke();
      y += 32;

      ink.fillStyle = PLATE.faint;
      ink.font = `12px ${PLATE.serif}`;
      const title = model.quote.title ? ` · ${model.quote.title}` : '';
      ink.fillText(`FROM THE CHRONICLE · ${model.quote.year}${title}`, PLATE.pad, y);
      y += 34;

      ink.fillStyle = PLATE.ink;
      ink.font = quoteFont;
      for (const line of quoteLines) {
        ink.fillText(line, PLATE.pad + 18, y);
        y += 31;
      }
    }

    ink.fillStyle = PLATE.faint;
    ink.font = `12px ${PLATE.serif}`;
    ink.fillText('Eldritch Dynasty · House Afterimage', PLATE.pad, canvas.height - 28);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = afterimageName(props.view.houseName, props.view.seed, props.epilogue.year);
    link.click();
    URL.revokeObjectURL(url);
  } finally {
    savingAfterimage.value = false;
  }
}
</script>

<template>
  <main class="ending">
    <p class="year">{{ epilogue.year }}</p>
    <h1>{{ epilogue.title }}</h1>
    <p class="summary">{{ epilogue.summary }}</p>

    <p class="frame">{{ epilogue.opening }}</p>

    <!-- WHAT WAS READ OUT. The blanks are read too, and take as long as a page. -->
    <section v-if="epilogue.read.length" class="read">
      <h3 class="label row top">
        <span>What the book said</span>
        <!-- The creditor read the whole thing. So can the house that wrote it
             (issue #48). -->
        <button class="quiet small" @click="$emit('open')">Read it whole</button>
      </h3>
      <!-- One component, so the blank here and the blank in the panel are the
           same artefact drawn the same way — including the sentence a screen
           reader gets, which used to exist in one of the two places. -->
      <Entry
        v-for="(entry, i) in epilogue.read"
        :key="entry.id ?? entry.year + ':' + i"
        :entry="entry"
        read
      />
    </section>

    <section class="tally">
      <h3 class="label">The reckoning</h3>
      <dl>
        <div><dt>The house</dt><dd>{{ view.houseName }}</dd></div>
        <div v-if="epilogue.founding">
          <dt>Asked for, in {{ view.campaign.startYear }}</dt><dd>{{ epilogue.founding.heirloomName }}</dd>
        </div>
        <div v-if="epilogue.founding">
          <dt>And never paid back</dt><dd>{{ epilogue.founding.grudgeName }}</dd>
        </div>
        <div><dt>Pages written</dt><dd>{{ reckoning.pages }}</dd></div>
        <div><dt>Left blank</dt><dd>{{ reckoning.blanks }}</dd></div>
        <div><dt>Improved</dt><dd>{{ reckoning.embellished }}</dd></div>
        <div>
          <dt>Lies still standing</dt>
          <dd>{{ reckoning.standingLies }} <span class="dim">({{ reckoning.provenLies }} caught)</span></dd>
        </div>
        <div>
          <dt>The contract, recovered</dt>
          <dd>{{ reckoning.clauses }} of {{ reckoning.clausesTotal }} clauses</dd>
        </div>
        <div>
          <dt>What the book attests</dt>
          <dd>
            {{ reckoning.attested === 'none' ? 'nothing at all' : reckoning.attestedTitle }}
            <span v-if="reckoning.attestedYear" class="dim">since {{ reckoning.attestedYear }}</span>
          </dd>
        </div>
        <!-- WHAT THE READING TOOK, shown only where it differs from the
             claim. For a house that kept an honest book these are the same
             number and a row saying so twice is noise; for a house that did
             not, this is the whole of what the last night did to it, and
             §29.3's guard rail says the cost has to be findable. -->
        <div v-if="reckoning.rungsWithheld > 0">
          <dt>And could show</dt>
          <dd>
            {{ reckoning.substantiated === 'none' ? 'nothing at all' : reckoning.substantiatedTitle }}
            <span class="dim">
              — {{ reckoning.standingLies }} pages were asked after, and answered with themselves
            </span>
          </dd>
        </div>
        <div><dt>At the table</dt><dd>{{ reckoning.livingBlood }}</dd></div>
      </dl>
    </section>

    <!-- THE RING. Three beats, one substitution, and the substitution is what
         the five centuries cost. -->
    <section class="ring">
      <h3 class="label">A debt of three parts</h3>
      <ol>
        <li v-for="(beat, i) in epilogue.ring" :key="i" :class="{ changed: beat.changed }">
          <p class="given" :class="{ mark: beat.changed === 'given' }">{{ beat.given }}</p>
          <p class="owed" :class="{ mark: beat.changed === 'owed' }">{{ beat.owed }}</p>
        </li>
      </ol>
    </section>

    <p class="closing">{{ epilogue.closing }}</p>

    <div class="row ending-actions">
      <button class="quiet" :disabled="savingAfterimage" @click="saveAfterimage()">
        {{ savingAfterimage ? 'Setting the afterimage…' : 'Save the house afterimage' }}
      </button>
      <button class="quiet" @click="actions.restart()">Another house</button>
    </div>
  </main>
</template>

<style scoped>
.ending { max-width: 64ch; margin: 0 auto; padding: 80px 26px 90px; }
.year { font-size: var(--t-display); margin: 0; letter-spacing: .08em; color: var(--ink-faint); }
h1 { font-size: var(--t-year); font-weight: 400; margin: 0 0 8px; color: var(--rubric); }
.summary { margin: 0 0 28px; font-size: var(--t-fine); color: var(--ink-faint); }
.frame {
  font-size: var(--t-body); line-height: 1.8; color: var(--ink-soft);
  white-space: pre-line; margin: 0 0 34px;
}
.read { margin-bottom: 34px; }
.read .top { justify-content: space-between; align-items: baseline; gap: 10px; }
.tally dl { margin: 0; display: grid; gap: 5px; }
.tally div { display: flex; gap: 12px; border-bottom: 1px solid var(--rule); padding-bottom: 4px; }
.tally dt { flex: 1; color: var(--ink-faint); font-size: var(--t-fine); }
.tally dd { margin: 0; font-size: var(--t-card); }
.ring { margin-top: 36px; }
.ring ol { list-style: none; margin: 0; padding: 0; }
.ring li { border-top: 1px solid var(--rule); padding-top: 16px; margin-bottom: 14px; }
.ring p { margin: 0 0 12px; line-height: 1.75; color: var(--ink-soft); font-size: var(--t-card); }
.ring .owed { font-style: italic; }
.ring .mark { color: var(--ink); border-left: 2px solid var(--rubric); padding-left: 12px; }
.closing {
  margin: 40px 0 30px; padding-top: 22px; border-top: 1px solid var(--rule);
  font-size: var(--t-lead); color: var(--ink);
}
.ending-actions { justify-content: space-between; gap: 12px; flex-wrap: wrap; }
</style>
