// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import {
  installPseudoLocalisation,
  pseudoLocalise,
  pseudoLocRequested,
} from './pseudo-loc';

describe('pseudo localisation (#276)', () => {
  afterEach(() => {
    document.body.replaceChildren();
    delete document.documentElement.dataset.pseudoLoc;
  });

  it('expands readable text by about thirty-five per cent and brackets it', () => {
    const source = 'The house remembers what was written';
    const rendered = pseudoLocalise(source);

    expect(rendered.startsWith('⟦')).toBe(true);
    expect(rendered.endsWith('⟧')).toBe(true);

    const sourceLetters = [...source].filter((char) => /\p{L}/u.test(char)).length;
    const renderedLetters = [...rendered].filter((char) => /\p{L}/u.test(char)).length;
    expect(renderedLetters / sourceLetters).toBeGreaterThanOrEqual(1.34);
    expect(renderedLetters / sourceLetters).toBeLessThanOrEqual(1.40);
  });

  it('keeps surrounding whitespace, numbers and an already transformed string stable', () => {
    expect(pseudoLocalise('  House Gearithy  ')).toMatch(/^  ⟦.*⟧  $/);
    expect(pseudoLocalise('1542')).toBe('1542');
    expect(pseudoLocalise('   ')).toBe('   ');

    const once = pseudoLocalise('Read it whole');
    expect(pseudoLocalise(once)).toBe(once);
  });

  it('requires the explicit development query flag shape', () => {
    expect(pseudoLocRequested('?pseudo-loc')).toBe(true);
    expect(pseudoLocRequested('?pseudo-loc=1')).toBe(true);
    expect(pseudoLocRequested('?pseudo-loc=true')).toBe(true);
    expect(pseudoLocRequested('?pseudo-loc=0')).toBe(false);
    expect(pseudoLocRequested('?other=1')).toBe(false);
  });

  it('covers existing and dynamically rendered text plus accessibility labels', async () => {
    const root = document.createElement('main');
    root.innerHTML = [
      '<button aria-label="Read the Chronicle">Read it whole</button>',
      '<span>1542</span>',
      '<style>.thing { content: "do not touch"; }</style>',
    ].join('');
    document.body.append(root);

    const stop = installPseudoLocalisation(root);
    expect(document.documentElement.dataset.pseudoLoc).toBe('true');

    const button = root.querySelector('button')!;
    expect(button.textContent).toMatch(/^⟦.*⟧$/);
    expect(button.getAttribute('aria-label')).toMatch(/^⟦.*⟧$/);
    expect(root.querySelector('span')!.textContent).toBe('1542');
    expect(root.querySelector('style')!.textContent).toContain('do not touch');

    const dynamic = document.createElement('p');
    dynamic.textContent = 'A new decision waits here';
    root.append(dynamic);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(dynamic.textContent).toMatch(/^⟦.*⟧$/);

    dynamic.textContent = 'The answer changed';
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(dynamic.textContent).toMatch(/^⟦.*⟧$/);

    stop();
    expect(document.documentElement.dataset.pseudoLoc).toBeUndefined();
  });
});
