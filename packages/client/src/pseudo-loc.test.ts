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

  it('refuses repeated pseudo-localisation flags regardless of order or value', () => {
    expect(pseudoLocRequested('?pseudo-loc=1&pseudo-loc=0')).toBe(false);
    expect(pseudoLocRequested('?pseudo-loc=0&pseudo-loc=1')).toBe(false);
    expect(pseudoLocRequested('?pseudo-loc=1&pseudo-loc=1')).toBe(false);
    expect(pseudoLocRequested('?pseudo-loc&pseudo-loc=true')).toBe(false);
    expect(pseudoLocRequested('?pseudo-loc=0&other=1')).toBe(false);
    expect(pseudoLocRequested('?pseudo-loc=true&other=1&other=2')).toBe(true);
  });

  it('does not rewrite editable text or implicit option values (#1030)', async () => {
    const root = document.createElement('main');
    root.innerHTML = [
      '<div contenteditable="true">Write this <strong>yourself</strong></div>',
      '<textarea>Draft that must stay editable</textarea>',
      '<select>',
      '  <option>Implicit value</option>',
      '  <option value="stable">Visible caption</option>',
      '</select>',
      '<p>Ordinary display text</p>',
    ].join('');
    document.body.append(root);

    const editable = root.querySelector('[contenteditable]')!;
    const textarea = root.querySelector('textarea')!;
    const implicit = root.querySelector('option:not([value])') as HTMLOptionElement;
    const explicit = root.querySelector('option[value]') as HTMLOptionElement;
    const display = root.querySelector('p')!;
    const stop = installPseudoLocalisation(root);

    expect(editable.textContent).toBe('Write this yourself');
    expect(textarea.textContent).toBe('Draft that must stay editable');
    expect(implicit.textContent).toBe('Implicit value');
    expect(implicit.value).toBe('Implicit value');
    expect(explicit.value).toBe('stable');
    expect(explicit.textContent).toMatch(/^⟦.*⟧$/);
    expect(display.textContent).toMatch(/^⟦.*⟧$/);

    // The same safety rule must hold for mutations after Vue has mounted.
    editable.querySelector('strong')!.textContent = 'new words';
    textarea.textContent = 'New draft';
    implicit.textContent = 'New implicit value';
    explicit.textContent = 'Updated caption';
    display.textContent = 'New display text';
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(editable.textContent).toBe('Write this new words');
    expect(textarea.textContent).toBe('New draft');
    expect(implicit.textContent).toBe('New implicit value');
    expect(implicit.value).toBe('New implicit value');
    expect(explicit.value).toBe('stable');
    expect(explicit.textContent).toMatch(/^⟦.*⟧$/);
    expect(display.textContent).toMatch(/^⟦.*⟧$/);
    stop();
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
  it('preserves mixed-case contenteditable hosts before and after reactive updates (#2141)', async () => {
    const root = document.createElement('main');
    root.innerHTML = [
      '<div contenteditable="TRUE">Edited <strong>inside</strong></div>',
      '<div contenteditable="PlAiNtExT-OnLy">Plain draft</div>',
      '<div contenteditable="tRuE"><span class="fixed" contenteditable="FALSE">Fixed caption</span><span class="draft">Continued draft</span></div>',
      '<p>Ordinary display</p>',
    ].join('');
    document.body.append(root);

    const upper = root.children[0] as HTMLElement;
    const plaintext = root.children[1] as HTMLElement;
    const nested = root.children[2] as HTMLElement;
    const fixed = nested.querySelector('.fixed')!;
    const draft = nested.querySelector('.draft')!;
    const display = root.querySelector('p')!;
    const stop = installPseudoLocalisation(root);

    // The browser treats the values as case-insensitive. An explicitly
    // noneditable child is display text; inheriting siblings remain editable.
    expect(upper.textContent).toBe('Edited inside');
    expect(plaintext.textContent).toBe('Plain draft');
    expect(draft.textContent).toBe('Continued draft');
    expect(fixed.textContent).toMatch(/^⟦.*⟧$/);
    expect(display.textContent).toMatch(/^⟦.*⟧$/);

    upper.querySelector('strong')!.textContent = 'new words';
    plaintext.textContent = 'Changed draft';
    fixed.textContent = 'Updated label';
    draft.textContent = 'More draft';
    display.textContent = 'More display';
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(upper.textContent).toBe('Edited new words');
    expect(plaintext.textContent).toBe('Changed draft');
    expect(draft.textContent).toBe('More draft');
    expect(fixed.textContent).toMatch(/^⟦.*⟧$/);
    expect(display.textContent).toMatch(/^⟦.*⟧$/);
    stop();
  });

});
