import { proseOriginalHash } from './prose-variants.js';
import type { EventTemplate, Outcome } from './event.js';
import type { Issue, ValidationRule } from './validate.js';
import { effectHarmPolicy, potentialHarms, PRIMORDIAL_ACTOR_SLOT } from './primordial.js';
import { NARRATOR_TOKEN, slotTokens } from './forms.js';

export function primordialOutcomes(event: EventTemplate) {
  return event.interaction.kind === 'narration'
    ? [{ id: '_', outcomes: event.interaction.outcomes }] : event.interaction.choices;
}

const fail = (rule: string, where: string, message: string): Issue => ({ level: 'error', rule, where, message });

function validatePrices(o: Pick<Outcome, 'effects' | 'agreedPrices'>, event: EventTemplate): string[] {
  const seen = new Set<number>();
  return (o.agreedPrices ?? []).flatMap(price => {
    const effect = o.effects[price.effect];
    const errors: string[] = [];
    if (seen.has(price.effect)) errors.push(`duplicate price effect ${price.effect}`);
    seen.add(price.effect);
    const material = effect && (effect.kind === 'treasury' && effect.delta < 0
      || effect.kind === 'spellbook' && effect.op === 'remove_copy'
      || effect.kind === 'heirloom' && effect.op === 'transfer'
      || effect.kind === 'land' && effect.op === 'seize');
    // A casualty on an expedition cannot be excused as a price. Sacrifice
    // belongs to the rite verb itself, which already has its own policy.
    const rites = primordialOutcomes(event).flatMap(group => group.outcomes.flatMap(row => row.effects))
      .filter(e => e.kind === 'rite');
    const subject = effect?.kind === 'status' && typeof effect.target !== 'string' && 'slot' in effect.target ? effect.target.slot : undefined;
    const sacrifice = price.reason === 'sacrifice' && effect?.kind === 'status' && effect.status === 'dead'
      && typeof effect.target !== 'string' && 'slot' in effect.target
      && rites.some(rite => rite.rite === price.rite && rite.subject === subject);
    if (price.reason === 'sacrifice' ? !sacrifice : !material) errors.push(`effect ${price.effect} is not a validated agreed price`);
    if (price.reason !== 'sacrifice' && price.rite) errors.push('only a named sacrifice declares a rite');
    return errors;
  });
}

function reducesPotential(normal: Outcome): boolean {
  const final = normal.primordial!;
  const price = new Set(normal.agreedPrices?.map(p => p.effect));
  const effects = normal.effects.filter((_, i) => !price.has(i));
  const cash = (es: typeof effects) => es.reduce((n, e) => n + (e.kind === 'treasury' ? e.delta : 0), 0);
  const respect = (es: typeof effects) => es.reduce((n, e) => n + (e.kind === 'respect' ? e.delta : e.kind === 'discrepancy' && e.op === 'prove' ? -1 : 0), 0);
  if (cash(effects) < 0 && cash(final.effects) > cash(effects)) return true;
  if (respect(effects) <= -2 && respect(final.effects) > respect(effects)) return true;
  return effects.some(effect => {
    if (!effectHarmPolicy(effect)) return false;
    if (effect.kind !== 'status' && effect.kind !== 'land' && effect.kind !== 'spellbook' && effect.kind !== 'heirloom') return false;
    return !final.effects.some(candidate => JSON.stringify(candidate) === JSON.stringify(effect));
  });
}

export const primordialCoverage: ValidationRule = {
  id: 'primordial/coverage',
  about: 'Every potentially major ordinary outcome has a material, non-recursive authored response and paired feedback.',
  check(content) {
    const issues: Issue[] = [];
    for (const event of content.events) for (const choice of primordialOutcomes(event)) for (const o of choice.outcomes) {
      const where = `event:${event.id}/${choice.id}/${o.id}`;
      for (const message of validatePrices(o, event)) issues.push(fail(this.id, where, message));
      if (potentialHarms(o).length && !o.primordial) issues.push(fail(this.id, where, `missing primordial response for ${potentialHarms(o).join(', ')}`));
      if (!o.primordial) continue;
      const response = o.primordial;
      if (response.id === o.id || choice.outcomes.some(other => other.id === response.id)) issues.push(fail(this.id, where, 'response identity collides with an ordinary outcome'));
      for (const message of validatePrices(response, event)) issues.push(fail(this.id, where, message));
      if (!reducesPotential(o)) issues.push(fail(this.id, where, 'cosmetic response: no material harm is reduced'));
      const tokenSet = (text: string) => slotTokens(text).map(t => t.raw).sort();
      const slotSet = (text: string) => [...new Set(slotTokens(text).map(t => t.slot))];
      const path = `#events[id=${encodeURIComponent(event.id)}].interaction.${choice.id === '_'
        ? `outcomes[id=${encodeURIComponent(o.id)}]`
        : `choices[id=${encodeURIComponent(choice.id)}].outcomes[id=${encodeURIComponent(o.id)}]`}.primordial.text`;
      const source = content.sourceOf(event.id);
      const counterpart = content.proseVariants.find(row => source ? row.address === `content:${source}${path}` : row.address.endsWith(path));
      if (!counterpart || counterpart.of !== proseOriginalHash(response.text) || !counterpart.plainenglish.trim()) issues.push(fail(this.id, where, 'missing current Plain English response counterpart'));
      const english = counterpart?.plainenglish ?? '';
      if (!tokenSet(response.text).includes(`{${PRIMORDIAL_ACTOR_SLOT}}`) || !tokenSet(english).includes(`{${PRIMORDIAL_ACTOR_SLOT}}`)) {
        issues.push(fail(this.id, where, 'both response texts must name {PRIMORDIAL_ACTOR}'));
      }
      if (JSON.stringify(tokenSet(response.text)) !== JSON.stringify(tokenSet(english))) issues.push(fail(this.id, where, 'response prose modes have different tokens'));
      for (const token of slotSet(response.text)) if (token !== PRIMORDIAL_ACTOR_SLOT && token !== NARRATOR_TOKEN && !event.slots[token]) issues.push(fail(this.id, where, `unresolved response token {${token}}`));
      if ((event.record || event.recordByChoice || event.recordByOutcome) && !response.record) issues.push(fail(this.id, where, 'response must preserve the existing Record choices with its own account'));
      if (response.next && !content.event(response.next.event)) issues.push(fail(this.id, where, `missing response successor ${response.next.event}`));
      if (response.triggers && !content.arc(response.triggers.arc)) issues.push(fail(this.id, where, `missing response arc ${response.triggers.arc}`));
    }
    return issues;
  },
};

export const primordialSite: ValidationRule = {
  id: 'primordial/site',
  about: 'Potentially major incidents declare one physical site with resolvable participant slots.',
  check(content) {
    const issues: Issue[] = [];
    for (const career of content.careers) if (!career.resident) issues.push(fail(this.id, `career:${career.id}`, 'career must declare home or away residence'));
    for (const event of content.events) for (const choice of primordialOutcomes(event)) for (const o of choice.outcomes) {
      if (!potentialHarms(o).length && !o.primordial) continue;
      const where = `event:${event.id}/${choice.id}/${o.id}`;
      const site = o.site ?? event.site;
      if (!site) { issues.push(fail(this.id, where, 'missing incident site')); continue; }
      const slots = site.kind === 'hall' ? [...(typeof site.hall === 'string' ? [] : [site.hall.slot]), ...(site.visitors ?? [])]
        : site.kind === 'muster' || site.kind === 'person' || site.kind === 'covert' ? [] : site.slots;
      if (site.kind === 'person' || site.kind === 'covert') issues.push(fail(this.id, where, 'authored scenes bind slots; concrete person/expedition sites are runtime assignment targets'));
      for (const slot of slots) if (!event.slots[slot] || event.slots[slot]!.optional) issues.push(fail(this.id, where, `site requires an existing required person slot: ${slot}`));
      for (const slot of slots) if (['heirloom', 'spellbook', 'rival_house', 'guardian'].includes(event.slots[slot]?.role ?? '')) issues.push(fail(this.id, where, `site slot ${slot} is not physical person attendance`));
      if (site.kind === 'parcel' && !content.parcel(site.parcel)) issues.push(fail(this.id, where, `site names an unknown parcel: ${site.parcel}`));
    }
    return issues;
  },
};
