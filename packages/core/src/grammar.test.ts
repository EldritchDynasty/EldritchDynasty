import { describe, expect, it } from 'vitest';
import { loadContent } from '@ed/content';
import { renderBody } from './events/slots.js';
import { formOf, grammarOf } from './people/grammar.js';
import { place, testWorld } from './testing.js';

const bundle = loadContent();

/**
 * `{SLOT.form}` IN THE ENGINE (#1867, step 0). The founder's grammar is the
 * player's to state, so prose about the founder cannot write "he" by hand.
 * These assert the renderer follows whoever is actually cast — one man, one
 * woman, a party — and that a token it cannot resolve stays visible.
 */
describe('rendering slot forms', () => {
  const cast = () => {
    const ctx = testWorld(bundle);
    const him = place(ctx, { sex: 'male', age: 40, name: 'Aldous' });
    const her = place(ctx, { sex: 'female', age: 38, name: 'Bren' });
    return { ctx, him, her };
  };

  it('follows the person cast, not the author', () => {
    const { ctx, him, her } = cast();
    const body = '{HEAD} set down {HEAD.their} cup. {HEAD.They} {HEAD.was} not hungry.';
    expect(renderBody(body, { HEAD: him.id }, ctx)).toBe('Aldous set down his cup. He was not hungry.');
    expect(renderBody(body, { HEAD: her.id }, ctx)).toBe('Bren set down her cup. She was not hungry.');
  });

  it('takes the plural for a party of more than one, and the member\'s own grammar for a party of one', () => {
    const { ctx, him, her } = cast();
    const body = '{SENT} rode out; {SENT.they} {SENT.has} not come back.';
    expect(renderBody(body, { SENT: [him.id, her.id] }, ctx)).toBe('Aldous and Bren rode out; they have not come back.');
    expect(renderBody(body, { SENT: [her.id] }, ctx)).toBe('Bren rode out; she has not come back.');
  });

  it('leaves an uncast slot or an unknown form as written, rather than an empty word', () => {
    const { ctx, him } = cast();
    expect(renderBody('{ABSENT.their} cup', {}, ctx)).toBe('{ABSENT.their} cup');
    expect(renderBody('{HEAD.thier} cup', { HEAD: him.id }, ctx)).toBe('{HEAD.thier} cup');
  });

  it('is the same answer the hand-assembled chronicle lines get', () => {
    const { him, her } = cast();
    expect(grammarOf(him)).toBe('masculine');
    expect([formOf(him, 'they'), formOf(him, 'their')]).toEqual(['he', 'his']);
    expect([formOf(her, 'they'), formOf(her, 'their')]).toEqual(['she', 'her']);
  });
});
