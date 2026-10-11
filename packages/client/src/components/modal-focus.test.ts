// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { modalFocusable } from '../lib/modal.js';

/**
 * Native disclosure bodies do not become tab stops until their <details>
 * opens. The first <summary> remains reachable while closed.
 */
describe('modal native disclosure focus', () => {
  function focusIds(card: HTMLElement): string[] {
    return modalFocusable(card).map((node) => node.id);
  }

  it('tabs to a closed details summary but not its hidden controls', () => {
    const card = document.createElement('article');
    card.innerHTML = [
      '<button id="before">Before</button>',
      '<details id="disclosure">',
      '  <summary id="summary" tabindex="0">More</summary>',
      '  <button id="hidden">Only when open</button>',
      '</details>',
      '<button id="after">After</button>',
    ].join('');
    document.body.appendChild(card);
    try {
      expect(focusIds(card)).toEqual(['before', 'summary', 'after']);
      card.querySelector('details')!.open = true;
      expect(focusIds(card)).toEqual(['before', 'summary', 'hidden', 'after']);
    } finally {
      card.remove();
    }
  });

  it('keeps nested disclosure content hidden until every parent opens', () => {
    const card = document.createElement('article');
    card.innerHTML = [
      '<details id="outer">',
      '  <summary id="outer-summary" tabindex="0">Outer</summary>',
      '  <details id="inner">',
      '    <summary id="inner-summary" tabindex="0">Inner</summary>',
      '    <button id="leaf">Leaf</button>',
      '  </details>',
      '</details>',
    ].join('');
    document.body.appendChild(card);
    try {
      expect(focusIds(card)).toEqual(['outer-summary']);
      card.querySelector<HTMLDetailsElement>('#outer')!.open = true;
      expect(focusIds(card)).toEqual(['outer-summary', 'inner-summary']);
      card.querySelector<HTMLDetailsElement>('#inner')!.open = true;
      expect(focusIds(card)).toEqual(['outer-summary', 'inner-summary', 'leaf']);
    } finally {
      card.remove();
    }
  });
});
