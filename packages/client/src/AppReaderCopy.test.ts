import { readFileSync } from 'node:fs';
import { computed, ref } from 'vue';
import { describe, expect, it } from 'vitest';
import type { ProseMode } from '@ed/schema';
import { appShellCopy, clockBlockers } from './lib/app-shell-copy';

describe('App shell reader-language controls (#1675, #1676, #1677)', () => {
  it('keeps every original shell heading and control name intact', () => {
    expect(appShellCopy('original')).toMatchObject({
      noticeDismiss: 'Dismiss',
      ageRegion: 'What matters in these years',
      ageHeading: 'In these years',
      generationHeading: 'This generation',
      generationSince: 'since',
      previousQuestion: 'What became of the last question',
      clockHeading: 'The clock',
      advanceOne: 'A year',
      advanceFive: 'Five',
      advanceGeneration: 'A generation',
      advanceToYear: 'On, to',
      waitingSuffix: 'the year does not turn until it is answered.',
      helpToggleOpen: 'Reading, marks and keys',
      helpToggleClose: 'Hide reading help',
      startLink: 'Saves & new game',
      helpReading: 'Reading',
      helpMarks: 'Marks',
      helpKeys: 'Keys',
      navHouse: 'The house',
      navTable: 'The table',
      navAbroad: 'Abroad',
      navChronicle: 'The chronicle',
    });
    expect(clockBlockers('original', 2, 1)).toBe('2 decisions · 1 child waiting');
  });

  it('explains Age pressure, clock durations, help and navigation in Plain English', () => {
    expect(appShellCopy('plainenglish')).toMatchObject({
      ageRegion: 'Current pressures on the family',
      ageHeading: 'What matters during this period',
      previousQuestion: 'Answer to the previous question',
      clockHeading: 'Advance time',
      advanceOne: 'Advance 1 year',
      advanceFive: 'Advance 5 years',
      advanceGeneration: 'Advance 25 years',
      advanceToYear: 'Advance to',
      helpReading: 'Reading settings',
      helpMarks: 'Meaning of symbols',
      helpKeys: 'Keyboard shortcuts',
      navTable: 'Family orders',
      navAbroad: 'Other families and rumours',
    });
    expect(clockBlockers('plainenglish', 2, 1)).toBe('2 decisions awaiting an answer · 1 child needs a name');
    expect(clockBlockers('plainenglish', 0, 2)).toBe('2 children need a name');
    expect(clockBlockers('plainenglish', 0, 0)).toBe('');
  });

  it('changes display words reactively without changing facts or stored state', () => {
    const mode = ref<ProseMode>('original');
    const labels = computed(() => appShellCopy(mode.value));
    expect(labels.value.clockHeading).toBe('The clock');
    mode.value = 'plainenglish';
    expect(labels.value.clockHeading).toBe('Advance time');
    expect(labels.value.navChronicle).toBe('Chronicle');
    mode.value = 'original';
    expect(labels.value.clockHeading).toBe('The clock');
    expect(labels.value.navChronicle).toBe('The chronicle');
  });

  it('keeps the four time-advance verbs and pane destinations unchanged', () => {
    const source = readFileSync(new URL('./App.vue', import.meta.url), 'utf8');
    for (const action of [
      '@click="actions.advance(1)"',
      '@click="actions.advance(5)"',
      '@click="actions.advance(25)"',
      '@click="actions.advance(view.campaign.endYear - view.year)"',
      '@click="pane = \'house\'"',
      '@click="pane = \'table\'"',
      '@click="pane = \'abroad\'"',
      '@click="pane = \'chronicle\'"',
      ':disabled="waiting"',
      ':aria-pressed="pane === \'chronicle\'"',
      ':aria-label="shellCopy.ageRegion"',
      '{{ shellCopy.previousQuestion }}',
      '{{ shellCopy.helpMarks }}',
    ]) {
      expect(source).toContain(action);
    }
  });
});
