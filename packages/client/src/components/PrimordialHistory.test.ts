// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { loadContent } from '@ed/content';
import {
  ELDRITCH_GIFT, GameSession, commitOutcome, genomeOf, loadGame, phenotypeOf, place, queueRecord,
  resolveRecord, saveGame, setProseMode, testRng, testWorld,
} from '@ed/core';
import Chronicle from './Chronicle.vue';

const content = loadContent();
describe('private primordial history (#1868)', () => {
  for (const mode of ['original', 'plainenglish'] as const) {
    it(`keeps the actor and material receipt accessible after public omission (${mode})`, async () => {
      let session: GameSession | undefined;
      for (let seed = 1; seed <= 32; seed++) {
        const ctx = testWorld(content, seed);
        const donor = ctx.world.people.living().find(p => phenotypeOf(p, ctx.genetics, ctx.world.year).eldritch.canExpress)!;
        const actor = place(ctx, { name: 'Edric', sex: 'male', age: 30, awakened: true });
        actor.genome = { kind: 'materialized', genome: genomeOf(donor, ctx.genetics) };
        actor.phenotype = undefined;
        actor.acquired[ELDRITCH_GIFT] = 1000;
        setProseMode(ctx, mode);
        const event = content.mustEvent('the_hall_burns');
        if (event.interaction.kind === 'narration') throw Error('hall fire has choices');
        const choice = event.interaction.choices[0]!;
        const fill = { HEAD: ctx.world.narrator! };
        const result = commitOutcome(ctx, event, choice.outcomes[0]!, fill, choice.id, testRng('history'));
        if (!result.primordial) continue;
        const pending = queueRecord(ctx, result.event, result.entryId, result.fill, choice.id, result.outcome.id)!;
        resolveRecord(ctx, pending.id, 'omit');
        session = new GameSession(loadGame(saveGame(ctx), content));
        break;
      }
      expect(session).toBeDefined();
      const view = session!.view();
      const history = view.interventions![0]!;
      expect(view.chronicle.find(page => page.id === history.page)?.text).toBeNull();
      const wrapper = mount(Chronicle, { props: {
        view, frame: [], proseMode: mode,
        actions: { causeOf: () => undefined, answeredBy: () => [], advice: () => [] },
      }, global: { stubs: { Entry: true, AdviserHelp: true } } });
      expect(wrapper.get('summary').text()).toContain(mode === 'plainenglish' ? 'Primordial interventions' : 'What the blood prevented');
      expect(wrapper.text()).toContain('Edric');
      expect(wrapper.text()).toContain(history.receipt);
      expect(wrapper.text()).toContain(history.manifestation);
      const actorButton = wrapper.findAll('button').find(button => button.text() === 'Edric')!;
      await actorButton.trigger('click');
      expect(wrapper.emitted('person')).toEqual([[history.actor]]);
      const publicPage = wrapper.findAll('button').find(button => button.text() === (mode === 'plainenglish'
        ? 'Open the public Chronicle page' : 'Read what the house wrote'))!;
      await publicPage.trigger('click');
      expect(wrapper.emitted('open')).toEqual([[history.page]]);
      wrapper.unmount();
    });
  }
});
