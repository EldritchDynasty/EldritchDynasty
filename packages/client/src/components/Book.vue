<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { ChronicleEntry, SessionView } from '@ed/core';
import type { ProseMode } from '@ed/schema';
import { modalFocusable, useModal } from '../lib/modal';
import { findEntry, linksFor } from '../lib/causes';
import type { GameActions, GameStore } from '../lib/game';
import Entry from './Entry.vue';
import RecordedLife from './RecordedLife.vue';
import { downloadBlob } from '../lib/download';
import {
  LENSES, PLAIN_LENS_LABELS, MAX_PLATE_CANVAS_HEIGHT, PLATE, ageBoundariesForPages, isWritten, plateFoot, plateFootLines, plateHeight, plateName, plateRows, plateSubtitle, plateSvg, reads, rowFont,
  type Lens, type Measure,
} from '../lib/book';

const props = defineProps<{
  book: ChronicleEntry[];
  /** Only the surrounding UI, never a previously saved page, changes modes. */
  proseMode?: ProseMode;
  /**
   * The Ages the house has been through, running ones included (issue #81).
   * Every one of them draws a rule at the year it began, and only the ones
   * the chronicle gave a word to draw a NAME — §20's first rule is that the
   * family finds out what these years were afterwards, like everyone else,
   * and a reading pane that named all of them would be that rule inverted on
   * the one screen whose whole job is showing what the house wrote down.
   */
  ages: SessionView['ages'];
  /** For the plate's heading. The book is this house's book. */
  houseName: string;
  close: () => void;
  /** Only the two reads behind a page's way back (issue #269). */
  actions: Pick<GameActions, 'causeOf' | 'answeredBy' | 'shareCode'>;
  /** Open at this page, because the panel followed a link past its window. */
  focus?: string;
  /** Public names from kept pages, including ancestors outside the living halls. */
  people?: SessionView['chroniclePeople'];
  milestones?: GameStore['milestones'];
  person?: string;
}>();

/**
 * THE WHOLE BOOK, READABLE (issue #48).
 *
 * The player writes this across a Long Line and could see the last sixty
 * lines of it. The only character who ever read the finished thing was the
 * creditor, on the last night, in the epilogue.
 *
 * Pages and life notes quote the family's account and link to its sources.
 * They never reconcile or explain it: there is no narrator who knows the
 * truth — there is only Daveed, and he is not neutral.
 */
const plain = computed(() => props.proseMode === 'plainenglish');
const historyPerson = ref<string | undefined>(props.person);
watch(() => props.person, (id) => { if (id) void readLife(id); else historyPerson.value = undefined; });
const historyName = computed(() => props.people?.find((person) => person.id === historyPerson.value)?.name);
const names = computed(() => new Map(props.people?.map((person) => [person.id, person.name]) ?? []));
const history = ref<HTMLElement | null>(null);
let historyOrigin: HTMLElement | null = null;
const historyDestination = ref<string | null>(null);
function peopleFor(entry: ChronicleEntry): { id: string; name: string }[] {
  if (!props.milestones || !isWritten(entry)) return [];
  const ids = new Set([...(entry.people ?? []), ...(entry.claims ?? []).flatMap((claim) => claim.kind === 'deed' ? [claim.person] : [])]);
  return [...ids].flatMap((id) => {
    const name = names.value.get(id);
    return name ? [{ id, name }] : [];
  });
}
async function readLife(id: string): Promise<void> {
  historyPerson.value = id;
  historyDestination.value = null;
  await nextTick();
  history.value?.scrollIntoView({ block: 'start' });
  history.value?.focus();
}
function followLife(id: string): void {
  historyOrigin = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  historyDestination.value = id;
  void follow(id);
}
function returnToLife(): void {
  const target = historyOrigin && modalFocusable(history.value).includes(historyOrigin) ? historyOrigin : history.value;
  target?.scrollIntoView({ block: 'center' });
  target?.focus();
}
/** The lenses select the same entries in either reading mode. Only their labels change. */

const card = ref<HTMLElement | null>(null);
useModal(card, () => props.close());

/**
 * WHAT THE PLAYER IS LOOKING FOR IN NINE HUNDRED YEARS OF IT.
 *
 * A house that left forty things out across a run should be able to look at
 * nothing but the blanks — which is a question about the player's own conduct
 * and the only way in the game to ask it.
 */
const lens = ref<Lens>('all');

const from = ref<number | null>(null);

/**
 * ANY ENTRY IN UNDER THREE INTERACTIONS (issue #69).
 *
 * The lenses answer "show me my own conduct" and the century buttons answer
 * "take me to 1400". Neither answers "the line about Wystan", which is the
 * question a player actually has — they remember a person and a thing that
 * happened, never a year and a frequency tier.
 *
 * Matched against the title and the body, and NOT against the year: typing
 * `12` should not hand back every entry of the twelfth century as though it
 * had matched a word. The century buttons are the year control.
 */
const find = ref('');

const shown = computed(() =>
  props.book.filter((e) => reads(e, { lens: lens.value, from: from.value, find: find.value })));

/**
 * A WINDOW OVER THE BOOK, NOT THE BOOK (issue #69).
 *
 * #82 took a finished run from 3,738 entries to about 705, which makes drawing
 * all of them survivable rather than correct. The acceptance is explicit —
 * *"the client never holds the whole book in a reactive structure it
 * re-renders"* — and the shape of that mistake does not depend on it currently
 * hurting: a content drop that doubles the book would make it hurt, silently,
 * in the one screen the issue exists to make shareable.
 *
 * So the list draws a slice and grows it as the reader reaches the end. Not a
 * fixed-height virtual list, deliberately: entries are four different sizes by
 * frequency, and a virtualiser that assumes a row height would put the rubric
 * of an illuminated entry half a line off its own text.
 */
const PAGE = 120;
const drawn = ref(PAGE);
const page = computed(() => shown.value.slice(0, drawn.value));
const more = computed(() => shown.value.length - page.value.length);
const nextPageSize = computed(() => Math.min(PAGE, more.value));

// Any change of what is being looked FOR starts the reading again. `follow`
// waits a tick after widening the reading, so this has run before it sets the
// window itself.
watch([lens, from, find], () => { drawn.value = PAGE; });

function onScroll(e: Event): void {
  const el = e.target as HTMLElement;
  if (el.scrollHeight - el.scrollTop - el.clientHeight < 400) {
    drawn.value = Math.min(shown.value.length, drawn.value + PAGE);
  }
}

/**
 * THE WAY BACK (issue #269), asked only of the pages drawn.
 */
const links = computed(() => linksFor(page.value, {
  causeOf: (id) => props.actions.causeOf(id),
  answeredBy: (id) => props.actions.answeredBy(id),
}));

const pages = ref<HTMLElement | null>(null);
const marked = ref<string | null>(null);
let unmark: ReturnType<typeof setTimeout> | undefined;
let followRequest = 0;

// Closing the volume disposes its transient page highlight and invalidates
// follow() calls suspended at nextTick, so they cannot focus a dead page.
onBeforeUnmount(() => {
  ++followRequest;
  clearTimeout(unmark);
});

/**
 * Follow a link to the page it names. A lens, a search or a century can hide
 * the target, and the window may not have reached it yet; a link that did
 * nothing in either case would read as a broken one. So the reading widens to
 * the whole book first, and the window grows until the page is drawn.
 */
async function follow(id: string): Promise<void> {
  const request = ++followRequest;
  if (!shown.value.some((e) => e.id === id)) {
    lens.value = 'all';
    from.value = null;
    find.value = '';
    await nextTick();
    if (request !== followRequest) return;
  }
  const at = shown.value.findIndex((e) => e.id === id);
  if (at < 0) return;
  if (at >= drawn.value) drawn.value = at + 1;

  // Shared Entry.vue adds tabindex=-1 only while marked. Render the mark
  // before focusing, including when the target was outside the drawn window.
  clearTimeout(unmark);
  marked.value = id;
  await nextTick();
  if (request !== followRequest) return;
  const el = findEntry(pages.value, id);
  el?.scrollIntoView({ block: 'center' });
  el?.focus({ preventScroll: true });
  unmark = setTimeout(() => {
    if (request === followRequest) marked.value = null;
  }, 2400);
}

// The volume can remain mounted while its caller targets another Chronicle
// page. Honour subsequent focus requests using the same last-request-wins
// navigation path as a cause link; undefined does not move the reader.
watch(() => props.focus, (id) => { if (id) void follow(id); });
onMounted(() => {
  if (props.focus) void follow(props.focus);
  else if (props.person) void readLife(props.person);
});

/**
 * Boundary positions are indexed into the actually drawn page, not calendar
 * years. A missing/filtered starting-year page still gets its Age rubric at
 * the first page after the change. The printed year stays the true beginning.
 */
const boundaries = computed(() =>
  ageBoundariesForPages(page.value, props.ages, from.value));

/**
 * A PAGE SOMEBODY WOULD POST (issue #69).
 *
 * *"A game whose players generate beautiful, unrepeatable, inherently
 * shareable artefacts has a distribution channel the other 23,999 have to pay
 * for."* This project writes the best prose in its genre seven hundred lines
 * at a time and, until now, threw all of it away at the edge of a sixty-entry
 * column.
 *
 * Drawn on a canvas rather than screenshotted off the DOM, for three reasons
 * that all matter: no dependency, a fixed 1200px width that does not inherit
 * whatever the reader's window happens to be, and the OMISSIONS come out right
 * — a dated blank line is the single most striking thing this game produces
 * and a naive HTML-to-image pass renders it as nothing at all.
 *
 * It exports WHAT IS ON SCREEN, filters and all. A player who has lensed the
 * book down to their forty blanks wants a plate of the blanks.
 */
const plating = ref(false);
const plateError = ref<string | null>(null);
const PLATE_ERROR = 'The page could not be saved. Try a smaller selection or another browser.';

async function plate(): Promise<void> {
  // The disabled button updates on Vue's next render tick. Two synchronous
  // clicks before that patch must not start competing canvas exports.
  if (plating.value) return;
  plateError.value = null;
  plating.value = true;
  try {
    const entries = shown.value;
    // An export is one snapshot: props may change while PNG encoding awaits toBlob.
    const houseName = props.houseName;
    const plateCaption = plateSubtitle(entries, lens.value, props.proseMode);
    const gauge = document.createElement('canvas').getContext('2d');
    if (!gauge) { plateError.value = PLATE_ERROR; return; }
    const measure: Measure = (text, font) => {
      gauge.font = font;
      return gauge.measureText(text).width;
    };

    const rows = plateRows(entries, measure);
    // The founding, never its names: see `plateFoot` (#1995).
    const share = props.actions.shareCode(false);
    const foot = plateFoot(share.ok ? share.code : null, measure, props.proseMode);
    const height = plateHeight(rows, foot);
    // Full Long-Line books exceed browser canvas dimensions. Keep every
    // Chronicle line (and the ruled omissions) in a vector download instead
    // of silently dropping the entire image when getContext/toBlob fails.
    if (height > MAX_PLATE_CANVAS_HEIGHT) {
      const svg = plateSvg(rows, houseName, plateCaption, foot);
      downloadBlob(
        new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }),
        plateName(houseName, entries).replace(/\.png$/, '.svg'),
      );
      return;
    }

    const canvas = document.createElement('canvas');
    canvas.width = PLATE.width;
    canvas.height = height;
    const c = canvas.getContext('2d');
    if (!c) { plateError.value = PLATE_ERROR; return; }

    c.fillStyle = PLATE.ground;
    c.fillRect(0, 0, canvas.width, canvas.height);

    c.fillStyle = PLATE.ink;
    c.font = `500 30px ${PLATE.serif}`;
    c.fillText(houseName, PLATE.pad, 64);
    c.fillStyle = PLATE.faint;
    c.font = `13px ${PLATE.serif}`;
    c.fillText(plateCaption, PLATE.pad, 88);
    c.strokeStyle = PLATE.rule;
    c.beginPath();
    c.moveTo(PLATE.pad, 106);
    c.lineTo(PLATE.width - PLATE.pad, 106);
    c.stroke();

    let y = PLATE.head;
    for (const r of rows) {
      y += r.size * 1.2;
      if (r.rule) {
        c.strokeStyle = PLATE.rule;
        c.beginPath();
        c.moveTo(PLATE.pad, y - 4);
        c.lineTo(PLATE.width - PLATE.pad, y - 4);
        c.stroke();
      } else {
        c.fillStyle = r.colour;
        c.font = rowFont(r);
        c.fillText(r.text, PLATE.pad, y);
      }
      y += r.size * 0.3 + r.gap;
    }

    c.fillStyle = PLATE.faint;
    for (const line of plateFootLines(foot, canvas.height)) {
      c.font = rowFont({ size: 12, mono: line.mono });
      c.fillText(line.text, PLATE.pad, line.y);
    }

    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
    if (!blob) { plateError.value = PLATE_ERROR; return; }
    downloadBlob(blob, plateName(houseName, entries));
  } catch {
    // Canvas allocation/encoding and browser download APIs can all fail.
    // A silent click would leave a reader thinking their page was saved.
    plateError.value = PLATE_ERROR;
  } finally {
    plating.value = false;
  }
}

/** The centuries the book actually covers, as somewhere to jump to. */
const centuries = computed(() => {
  const out = new Set<number>();
  for (const e of props.book) out.add(Math.floor(e.year / 100) * 100);
  return [...out].sort((a, b) => a - b);
});

const counts = computed(() => ({
  all: props.book.length,
  blank: props.book.filter((e) => !isWritten(e)).length,
  improved: props.book.filter((e) => e.record === 'embellish').length,
  illuminated: props.book.filter((e) => e.weight === 'illuminated').length,
}));
</script>

<template>
  <div class="scrim" @click="close()">
    <!-- `.volume`, not `.book`: the chronicle TAB in the pane switcher is
         already `.book` (issue #57), and two different things under one class
         name in one app is a rule that lands on the wrong element the first
         time somebody writes an unscoped selector. The panel is a window on
         the last sixty lines; this is the volume. -->
    <article ref="card" class="volume" role="dialog" aria-modal="true" :aria-label="plain ? 'Full Chronicle' : 'the chronicle, whole'" @click.stop>
      <header>
        <div class="row top">
          <h3 class="label">{{ plain ? 'Chronicle' : 'The book' }}</h3>
          <div class="row">
            <!-- The point of the whole screen: a page somebody would post. It
                 plates WHAT IS ON SCREEN, filters and all — a player who has
                 lensed the book down to their forty blanks wants the blanks. -->
            <button class="quiet small" :disabled="plating || !shown.length" @click="plate()">
              {{ plating ? (plain ? 'Saving…' : 'Setting the plate…') : (plain ? 'Save an image' : 'Save this as a page') }}
            </button>
            <button class="quiet small" @click="close()">{{ plain ? 'Close' : 'Close it' }}</button>
          </div>
        </div>
        <p class="dim small">
          {{ counts.all }} {{ counts.all === 1 ? 'entry' : 'entries' }} · {{ counts.blank }} {{ plain ? 'blank' : 'left blank' }} ·
          {{ counts.improved }} {{ plain ? 'changed' : 'improved' }} · {{ counts.illuminated }} {{ plain ? 'highlighted' : 'illuminated' }}
        </p>
        <p v-if="plateError" role="alert" class="note">{{ plain ? 'Could not save the image. Try fewer entries or another browser.' : plateError }}</p>

        <div class="wrap lenses">
          <button
            v-for="l in LENSES"
            :key="l.id"
            class="quiet small"
            :class="{ on: lens === l.id }"
            :aria-pressed="lens === l.id"
            @click="lens = l.id"
          >{{ plain ? PLAIN_LENS_LABELS[l.id] : l.label }}</button>
        </div>

        <div class="row find">
          <label class="said-not-shown" for="chronicle-book-search">{{ plain ? 'Search the Chronicle' : 'Search the book' }}</label>
          <input
            id="chronicle-book-search"
            v-model="find"
            type="search"
            :placeholder="plain ? 'Search by name or word' : 'a name, a word, a thing that happened'"
          />
          <button v-if="find" class="quiet small" @click="find = ''">{{ plain ? 'Clear search' : 'clear' }}</button>
        </div>

        <div v-if="centuries.length > 1" class="wrap jump">
          <span class="dim small">{{ plain ? 'From' : 'from' }}</span>
          <button
            class="quiet small"
            :class="{ on: from === null }"
            :aria-pressed="from === null"
            @click="from = null"
          >{{ plain ? 'Start' : 'the beginning' }}</button>
          <button
            v-for="c in centuries"
            :key="c"
            :aria-label="plain ? `Show Chronicle entries from ${c}` : `Read the book from ${c}`"
            class="quiet small"
            :class="{ on: from === c }"
            :aria-pressed="from === c"
            @click="from = c"
          >{{ c }}</button>
        </div>
      </header>

      <!-- Oldest first, which is the order a book is read in and the reverse of
           the panel's. The panel answers "what just happened"; this is the
           volume. -->
      <div ref="pages" class="pages" @scroll.passive="onScroll">
        <section v-if="historyName && historyPerson && milestones" ref="history" tabindex="-1" class="person-history" :aria-label="plain ? `${historyName}'s recorded history` : `The recorded life of ${historyName}`">
          <h4>{{ historyName }}</h4>
          <RecordedLife :person="historyPerson" :read="milestones" :prose-mode="proseMode" @book="followLife" />
        </section>
        <template v-for="(entry, i) in page" :key="entry.id ?? entry.year + ':' + i">
          <!-- Several Ages may have begun between these two surviving pages.
               Use the real began year, even if no page from that year survives. -->
          <div v-for="age in boundaries.get(i) ?? []" :key="age.began" class="boundary">
            <span class="dim small year">{{ age.began }}</span>
            <span v-if="age.name" class="age">{{ age.name }}</span>
            <span v-else class="dim small unnamed">{{ plain ? 'This Age has no name in the Chronicle' : 'these years, which the house never named' }}</span>
          </div>
          <Entry
            :entry="entry"
            :prose-mode="proseMode"
            :links="entry.id ? links.get(entry.id) : undefined"
            :marked="!!entry.id && marked === entry.id"
            :people="peopleFor(entry)"
            @follow="follow"
            @person="readLife"
          />
          <button v-if="historyDestination === entry.id && historyName" type="button" class="quiet small return-life" @click="returnToLife()">{{ plain ? `Return to ${historyName}'s recorded history` : `Back to the recorded life of ${historyName}` }}</button>
        </template>
        <p v-if="!shown.length" class="dim small">
          {{ plain ? 'No Chronicle entries match.' : 'Nothing in the book answers to that.' }}
        </p>
        <!-- Reached by scrolling; the button is for a keyboard, which does not
             scroll a container it has not focused. -->
        <button v-if="more" class="quiet small" @click="drawn += nextPageSize">
          {{ plain ? `Show ${nextPageSize} more ${nextPageSize === 1 ? 'entry' : 'entries'}` : `${more} more` }}
        </button>
      </div>
    </article>
  </div>
</template>

<style scoped>
.person-history { border-bottom: 1px solid var(--rule); padding-bottom: 8px; margin-bottom: 16px; }
.person-history h4 { margin: 0; font-size: var(--t-card); font-weight: 400; }
.return-life { min-height: 44px; margin-bottom: 8px; text-align: left; }
.scrim {
  position: fixed; inset: 0; z-index: 20;
  background: color-mix(in srgb, var(--vellum-deep) 88%, transparent);
  display: grid; place-items: center; padding: 30px;
  /* NO OVERLAY HONOURED THE SAFE AREA (issue #106). `inset: 0` reaches under a
     notch and a gesture bar on any device that has one; `env()` falls back to
     0 on anything without, so this costs nothing on a rectangle. */
  padding-top: max(30px, env(safe-area-inset-top));
  padding-bottom: max(30px, env(safe-area-inset-bottom));
  padding-left: max(30px, env(safe-area-inset-left));
  padding-right: max(30px, env(safe-area-inset-right));
  /* The row is the window, not the content, or "Read it whole" cannot scroll
     (#356). Why, measured: `lib/overlays.test.ts`. */
  grid-template-rows: minmax(0, 100%);
}
.volume {
  background: var(--vellum); border: 1px solid var(--rule);
  width: min(64ch, 100%); max-height: 100%;
  display: flex; flex-direction: column;
}
header { padding: 16px 22px 12px; border-bottom: 1px solid var(--rule); }
.top { justify-content: space-between; align-items: baseline; }
.lenses, .jump { margin-top: 8px; }
.jump { align-items: baseline; }
.pages { overflow-y: auto; padding: 18px 22px 26px; }
.find { margin-top: 8px; }
.find input { flex: 1; min-width: 0; }
/* The rule at an Age boundary. It is a division in the book, so it looks like
   one: a line across the page with the word over it, where there is a word. */
.boundary {
  display: flex; align-items: center; gap: 10px;
  margin: 22px 0 14px; border-top: 1px solid var(--rule); padding-top: 10px;
}
.boundary .year { font-variant-numeric: tabular-nums; }
.boundary .age {
  font-variant: small-caps; letter-spacing: .08em; color: var(--rubric); font-size: var(--t-card);
}
.boundary .unnamed { font-style: italic; }
button.on { color: var(--ink); background: var(--vellum-deep); border-color: var(--rule); }
</style>
