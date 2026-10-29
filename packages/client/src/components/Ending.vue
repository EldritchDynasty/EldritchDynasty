<script setup lang="ts">
import { computed, ref } from 'vue';
import type { AchievementView, EpilogueView, SessionView } from '@ed/core';
import type { ProseMode } from '@ed/schema';
import type { GameActions } from '../lib/game';
import Entry from './Entry.vue';
import { downloadBlob } from '../lib/download';
import {
  PLATE, afterimageLayout, afterimageModel, afterimageName, type Measure,
} from '../lib/book';

const props = defineProps<{ view: SessionView; epilogue: EpilogueView; achievements?: readonly AchievementView[]; actions: GameActions; proseMode?: ProseMode }>();
const emit = defineEmits<{ (e: 'open'): void; (e: 'update:proseMode', mode: ProseMode): void }>();

function selectProseMode(event: Event): void {
  const mode = (event.target as HTMLSelectElement).value;
  if (mode === 'original' || mode === 'plainenglish') emit('update:proseMode', mode);
}

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
/** Reader-local framing follows the mode; recorded epilogue and quotes keep their words. */
const plain = computed(() => props.proseMode === 'plainenglish');

/**
 * THE SAME BEGINNING (#1995). The founding as a code, names left out unless
 * the reader asks. Read through the store each time the box is ticked; the
 * code never changes with anything the house did after the signing.
 */
const shareNames = ref(false);
const share = computed(() => props.actions.shareCode(shareNames.value));
function selectAll(event: Event): void {
  if (event.target instanceof HTMLTextAreaElement) event.target.select();
}

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
      ? null
      : props.epilogue.reckoning.attestedTitle,
    livingBlood: props.epilogue.reckoning.livingBlood,
  },
  read: props.epilogue.read,
  evidence: props.epilogue.afterimage,
  members: props.view.halls?.flatMap((hall) => hall.members),
}, props.proseMode));

const savingAfterimage = ref(false);
const afterimageError = ref<string | null>(null);

/**
 * ONE PAGE SOMEBODY CAN HAND TO SOMEBODY ELSE (#260).
 *
 * This deliberately uses the same fixed plate, ink, vellum and wrapping seam
 * as the Chronicle export rather than screenshotting the current DOM. The
 * current viewport is an accident; the finished house is not.
 */
async function saveAfterimage(): Promise<void> {
  if (savingAfterimage.value) return;
  savingAfterimage.value = true;
  afterimageError.value = null;
  try {
    const gauge = document.createElement('canvas').getContext('2d');
    if (!gauge) throw new Error('2D canvas unavailable');
    const measure: Measure = (text, font) => {
      gauge.font = font;
      return gauge.measureText(text).width;
    };

    // Keep the export filename paired with the same snapshot painted below.
    // `toBlob` is asynchronous: the mounted ending can receive new props mid-encode.
    const model = afterimage.value;
    const filename = afterimageName(props.view.houseName, props.view.seed, props.epilogue.year);
    const layout = afterimageLayout(model, measure);
    const width = PLATE.width;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = layout.height;
    const ink = canvas.getContext('2d');
    if (!ink) throw new Error('2D canvas unavailable');

    ink.fillStyle = PLATE.ground;
    ink.fillRect(0, 0, canvas.width, canvas.height);
    let y = 64;
    for (const row of layout.rows) {
      if (row.rule) {
        ink.strokeStyle = row.colour;
        ink.beginPath();
        ink.moveTo(PLATE.pad, y);
        ink.lineTo(width - PLATE.pad, y);
        ink.stroke();
      } else {
        ink.fillStyle = row.colour;
        ink.font = `${row.italic ? 'italic ' : ''}${row.size}px ${PLATE.serif}`;
        ink.fillText(row.text, PLATE.pad, y);
      }
      y += row.size * 1.5 + row.gap;
    }

    ink.fillStyle = PLATE.faint;
    ink.font = `12px ${PLATE.serif}`;
    ink.fillText(model.footer, PLATE.pad, canvas.height - 28);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('PNG export unavailable');
    downloadBlob(blob, filename);
  } catch {
    afterimageError.value = 'The house afterimage could not be saved. Try again.';
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
        <span>{{ plain ? 'Chronicle excerpts' : 'What the book said' }}</span>
        <!-- The creditor read the whole thing. So can the house that wrote it
             (issue #48). -->
        <button class="quiet small" @click="$emit('open')">{{ plain ? 'Read full Chronicle' : 'Read it whole' }}</button>
      </h3>
      <!-- One component, so the blank here and the blank in the panel are the
           same artefact drawn the same way — including the sentence a screen
           reader gets, which used to exist in one of the two places. -->
      <Entry
        v-for="(entry, i) in epilogue.read"
        :key="entry.id ?? entry.year + ':' + i"
        :entry="entry"
        :prose-mode="proseMode"
        read
      />
    </section>

    <!-- WHERE IT BEGAN (#1867 §6). Collection returns to the player: who
         signed, what the house was first asked to decide and what the book
         made of it, and the plan it kept in view. All read off this run. -->
    <section v-if="epilogue.beginning" class="beginning" aria-labelledby="beginning-title">
      <h3 id="beginning-title" class="label">{{ plain ? 'How the family started' : 'Where it began' }}</h3>
      <p class="small">
        <template v-if="plain">
          {{ epilogue.beginning.founder }} signed the agreement in {{ view.campaign.startYear }}<template v-if="epilogue.beginning.guardianSince !== undefined">, and guided the family as its guardian from {{ epilogue.beginning.guardianSince }}</template>.
        </template>
        <template v-else>
          {{ epilogue.beginning.founder }} signed in {{ view.campaign.startYear }}<template v-if="epilogue.beginning.guardianSince !== undefined">, and kept the house as its guardian from {{ epilogue.beginning.guardianSince }}</template>.
        </template>
      </p>
      <Entry
        v-for="(entry, i) in epilogue.beginning.pages"
        :key="'beginning:' + (entry.id ?? entry.year + ':' + i)"
        :entry="entry"
        :prose-mode="proseMode"
        read
      />
      <p v-if="epilogue.beginning.ambition" class="small beginning-ambition">
        <span class="rubric">{{ plain ? 'Family goal:' : 'The house set out to:' }}</span>
        {{ epilogue.beginning.ambition.name }}. {{ epilogue.beginning.ambition.progress }}. {{ epilogue.beginning.ambition.status }}
      </p>
    </section>

    <section class="tally">
      <h3 class="label">{{ plain ? 'Ending summary' : 'The reckoning' }}</h3>
      <dl>
        <div><dt>{{ plain ? 'Family name' : 'The house' }}</dt><dd>{{ view.houseName }}</dd></div>
        <!-- The run's number, for replaying it or reporting it (#59). The
             running game keeps it behind a control (#356); here it is part of
             the permanent record of what was played. -->
        <div><dt>{{ plain ? 'Game seed' : 'The line' }}</dt><dd>seed #{{ view.seed }}</dd></div>
        <div v-if="epilogue.founding">
          <dt>{{ plain ? 'Requested in' : 'Asked for, in' }} {{ view.campaign.startYear }}</dt><dd>{{ epilogue.founding.heirloomName }}</dd>
        </div>
        <div v-if="epilogue.founding">
          <dt>{{ plain ? 'Debt never repaid' : 'And never paid back' }}</dt><dd>{{ epilogue.founding.grudgeName }}</dd>
        </div>
        <div><dt>{{ plain ? 'Pages recorded' : 'Pages written' }}</dt><dd>{{ reckoning.pages }}</dd></div>
        <div><dt>{{ plain ? 'Pages left blank' : 'Left blank' }}</dt><dd>{{ reckoning.blanks }}</dd></div>
        <div><dt>{{ plain ? 'Entries embellished' : 'Improved' }}</dt><dd>{{ reckoning.embellished }}</dd></div>
        <div>
          <dt>{{ plain ? 'Lies not yet exposed' : 'Lies still standing' }}</dt>
          <dd>{{ reckoning.standingLies }} <span class="dim">({{ reckoning.provenLies }} {{ plain ? 'exposed' : 'caught' }})</span></dd>
        </div>
        <div>
          <dt>{{ plain ? 'Contract clauses recovered' : 'The contract, recovered' }}</dt>
          <dd>{{ reckoning.clauses }} of {{ reckoning.clausesTotal }} clauses</dd>
        </div>
        <div>
          <dt>{{ plain ? 'Highest level claimed in the Chronicle' : 'What the book attests' }}</dt>
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
          <dt>{{ plain ? 'Highest level supported by evidence' : 'And could show' }}</dt>
          <dd>
            {{ reckoning.substantiated === 'none' ? 'nothing at all' : reckoning.substantiatedTitle }}
            <span class="dim">
              {{ plain ? '— ' + reckoning.standingLies + ' claims were challenged but supported only by their own pages' : '— ' + reckoning.standingLies + ' pages were asked after, and answered with themselves' }}
            </span>
          </dd>
        </div>
        <div><dt>{{ plain ? 'Living blood relatives' : 'At the table' }}</dt><dd>{{ reckoning.livingBlood }}</dd></div>
      </dl>
    </section>

    <section v-if="afterimage.memories.length" class="house-memory" aria-labelledby="house-memory-title">
      <h3 id="house-memory-title" class="label">{{ plain ? 'People and records remembered' : 'What remains of the house' }}</h3>
      <article v-for="(memory, index) in afterimage.memories" :key="index" class="memory">
        <h4 class="label">{{ memory.heading }}</h4>
        <p v-if="memory.text" class="memory-name">{{ memory.text }}</p>
        <template v-if="memory.source">
          <p class="memory-date">{{ memory.source.year }}<template v-if="memory.source.text !== null && memory.source.title"> · {{ memory.source.title }}</template></p>
          <hr v-if="memory.source.text === null" class="memory-blank" :aria-label="plain ? 'Blank page' : 'A silence in the book'">
          <blockquote v-else>{{ memory.source.text }}</blockquote>
        </template>
      </article>
    </section>

    <!-- THE RING. Three beats, one substitution, and the substitution is what
         the five centuries cost. -->
    <section class="ring">
      <h3 class="label">{{ plain ? 'Three promises' : 'A debt of three parts' }}</h3>
      <ol>
        <li v-for="(beat, i) in epilogue.ring" :key="i" :class="{ changed: beat.changed }">
          <p class="given" :class="{ mark: beat.changed === 'given' }">{{ beat.given }}</p>
          <p class="owed" :class="{ mark: beat.changed === 'owed' }">{{ beat.owed }}</p>
        </li>
      </ol>
    </section>

    <p class="closing">{{ epilogue.closing }}</p>

    <section v-if="share.ok" class="share" aria-labelledby="share-title">
      <h3 id="share-title" class="label">{{ plain ? 'Share this starting point' : 'The same beginning' }}</h3>
      <p class="small">
        <template v-if="plain">Give this code to a friend. They start from the same founding: the same seed and the same choices at the signing. Nothing that happened after the signing is in it. Their own completed games still apply, and different names can lead to a different family.</template>
        <template v-else>Hand this to someone and they sign the same night: the same seed, the same answers, the same gift and the same grudge. Nothing the house did afterwards is in it. Their own Library still stands behind them, and other names may make another house.</template>
      </p>
      <label class="small share-names">
        <input v-model="shareNames" type="checkbox" />
        {{ plain ? 'Include the names you typed (founder, family and friends)' : 'Put the names in it too: the founder\'s, the house\'s and the friends\'' }}
      </label>
      <label class="dim small" for="share-code">{{ plain ? 'Share code' : 'The code' }}</label>
      <textarea id="share-code" class="share-code" readonly rows="3" spellcheck="false" :value="share.code" @focus="selectAll" />
    </section>

    <div class="row ending-actions">
      <button class="quiet" :disabled="savingAfterimage" @click="saveAfterimage()">
        {{ savingAfterimage ? (plain ? 'Saving image…' : 'Setting the afterimage…') : (plain ? 'Save ending image' : 'Save the house afterimage') }}
      </button>
      <button class="quiet" @click="actions.restart()">{{ plain ? 'Start another house' : 'Another house' }}</button>
    </div>
    <p v-if="afterimageError" class="afterimage-error rubric small" role="alert">{{ plain ? 'Could not save the ending image. Try again.' : afterimageError }}</p>
    <label class="ending-settings">
      Prose version
      <select :value="proseMode ?? 'original'" @change="selectProseMode">
        <option value="original">Original</option>
        <option value="plainenglish">Plain English</option>
      </select>
    </label>
    <details v-if="achievements?.length" class="achievements">
      <summary>Achievements earned ({{ achievements.length }})</summary>
      <ul>
        <li v-for="achievement in achievements" :key="achievement.id">
          <strong>{{ achievement.title }}</strong>
          <p>{{ achievement.description }}</p>
        </li>
      </ul>
    </details>
  </main>
</template>

<style scoped>
.ending { max-width: 64ch; margin: 0 auto; padding: 80px 26px 90px; }
.ending-settings { display: flex; align-items: center; gap: 12px; margin-top: 18px; color: var(--ink-faint); font-size: var(--t-fine); }
.achievements { margin-top: 28px; color: var(--ink-soft); }
.achievements summary { cursor: pointer; }
.achievements ul { padding-left: 22px; }
.achievements li { margin-top: 16px; }
.achievements p { margin: 4px 0 0; font-size: var(--t-fine); }
.year { font-size: var(--t-display); margin: 0; letter-spacing: .08em; color: var(--ink-faint); }
h1 { font-size: var(--t-year); font-weight: 400; margin: 0 0 8px; color: var(--rubric); }
.summary { margin: 0 0 28px; font-size: var(--t-fine); color: var(--ink-faint); }
.frame {
  font-size: var(--t-body); line-height: 1.8; color: var(--ink-soft);
  white-space: pre-line; margin: 0 0 34px;
}
.read { margin-bottom: 34px; }
.beginning { margin-bottom: 34px; }
.beginning-ambition { margin-top: 10px; }
.share { margin-top: 28px; }
.share-names { display: flex; gap: 8px; align-items: baseline; margin: 10px 0; }
.share-names input { width: auto; }
.share-code { display: block; width: 100%; font-family: ui-monospace, Menlo, Consolas, monospace; font-size: var(--t-fine); word-break: break-all; resize: vertical; }
.beginning .rubric { color: var(--rubric); }
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
.house-memory { margin-top: 32px; }
.memory { margin: 24px 0; overflow-wrap: anywhere; }
.memory h4 { color: var(--rubric); margin: 0 0 8px; }
.memory-name { color: var(--ink); font-size: var(--t-card); margin: 0 0 8px; }
.memory-date { color: var(--ink-faint); font-size: var(--t-fine); margin: 0 0 4px; }
.memory blockquote { color: var(--ink-soft); margin: 0; font-style: italic; line-height: 1.75; }
.memory-blank { border: 0; border-top: 1px solid var(--rule); margin: 16px 0 24px; }
.afterimage-error { margin: 10px 0 0; }
</style>
