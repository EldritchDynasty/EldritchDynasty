import { describe, expect, it } from 'vitest';
import { loadBundle } from '@ed/content';
import type { ContentBundle, EventTemplate } from '@ed/schema';
import { desugarInline, EventTemplateS, indexContent, isInlineArcId } from '@ed/schema';

const base = loadBundle();

/**
 * INLINE FOLLOW-UPS (`Outcome.next`), compiled to arcs.
 *
 * The property under test is not "it produces an arc" but the two that keep
 * this from becoming a second branching system: what it compiles is a REAL
 * `ArcDef` the ordinary runtime advances, and it compiles into the INDEX and
 * never into the bundle — so the editor's write-back cannot serialise a
 * compiled arc back into somebody's YAML.
 */

/** A narration event with one outcome, named. */
function beat(id: string, slots: string[] = []): EventTemplate {
  return {
    id,
    title: id,
    tier: 'family',
    frequency: 'uncommon',
    weight: 100,
    repeatable: true,
    cooldownYears: 0,
    tags: [],
    purposes: ['change_standing', 'change_relationship', 'buy_patience'],
    slots: Object.fromEntries(slots.map((s) => [s, { role: 'family_member', castBy: 'engine', optional: false, filters: [], bind: 'event' }])),
    checks: [],
    reads: [],
    body: 'A body long enough to be a body and not a note, which the shape rule asks for.',
    accounts: [],
    interaction: {
      kind: 'narration',
      outcomes: [{ id: `${id}_done`, weight: 100, text: 'And so.', tags: [], effects: [] }],
    },
  } as EventTemplate;
}

function link(e: EventTemplate, to: string, keep: string[] = []): EventTemplate {
  if (e.interaction.kind !== 'narration') throw new Error('unreachable');
  e.interaction.outcomes[0]!.next = { event: to, after: 'immediate', keep };
  return e;
}

const bundleOf = (events: EventTemplate[]): ContentBundle =>
  ({ ...base, events: [...base.events, ...events] }) as ContentBundle;

describe('desugarInline', () => {
  it('compiles one link into an arc whose entry is the follow-up', () => {
    const first = link(beat('t_first'), 't_second');
    const out = desugarInline([first, beat('t_second')], []);

    expect(out.arcs).toHaveLength(1);
    const arc = out.arcs[0]!;
    expect(isInlineArcId(arc.id)).toBe(true);
    expect(arc.inline).toBe(true);
    expect(arc.entry).toBe('t_second');
    expect(arc.nodes.map((n) => n.event)).toEqual(['t_second']);
  });

  it('leaves the root firing ambiently and takes the follow-up out of the pool', () => {
    // The asymmetry is the design: the first beat is an event, and everything
    // after it is a consequence. `ambientPool` skips anything with an `arc`.
    const out = desugarInline([link(beat('t_first'), 't_second'), beat('t_second')], []);
    const byId = new Map(out.events.map((e) => [e.id, e]));
    expect(byId.get('t_first')!.arc).toBeUndefined();
    expect(byId.get('t_second')!.arc).toEqual({ of: out.arcs[0]!.id, node: 't_second' });
  });

  it('gives the root outcome the triggers that start the arc', () => {
    const out = desugarInline([link(beat('t_first'), 't_second'), beat('t_second')], []);
    const root = out.events.find((e) => e.id === 't_first')!;
    if (root.interaction.kind !== 'narration') throw new Error('unreachable');
    expect(root.interaction.outcomes[0]!.triggers).toEqual({ arc: out.arcs[0]!.id, op: 'start' });
  });

  it('compiles a three-long chain into ONE arc with three nodes', () => {
    const out = desugarInline(
      [link(beat('t_a'), 't_b'), link(beat('t_b'), 't_c'), link(beat('t_c'), 't_d'), beat('t_d')],
      [],
    );
    expect(out.arcs).toHaveLength(1);
    expect(out.arcs[0]!.nodes.map((n) => n.id)).toEqual(['t_b', 't_c', 't_d']);
    expect(out.arcs[0]!.nodes[0]!.successors[0]).toMatchObject({ to: 't_c' });
    expect(out.arcs[0]!.nodes[2]!.successors[0]).toMatchObject({ to: 'end' });
  });

  it('carries `keep` through as the arc\'s persistent bindings', () => {
    // Which is the whole reason this exists rather than a `schedule` effect:
    // the follow-up is about the same person.
    const out = desugarInline([link(beat('t_first', ['RIVAL']), 't_second', ['RIVAL']), beat('t_second', ['RIVAL'])], []);
    expect(out.arcs[0]!.bindings).toEqual(['RIVAL']);
  });

  it('does not place an event twice when a chain loops', () => {
    const out = desugarInline([link(beat('t_x'), 't_y'), link(beat('t_y'), 't_y')], []);
    expect(out.arcs[0]!.nodes).toHaveLength(1);
    expect(out.arcs[0]!.nodes[0]!.successors[0]).toMatchObject({ to: 't_y' });
  });

  it('drops a link naming an event that does not exist rather than compiling a dangling node', () => {
    // `arcs/wiring` is what reports it. Compiling the node anyway would give
    // the arc a node whose event `mustEvent` throws on, mid-run.
    const out = desugarInline([link(beat('t_only'), 'not_a_real_event')], []);
    expect(out.arcs).toHaveLength(0);
  });

  it('compiles nothing for a chain that is wholly a cycle', () => {
    // Nothing leads into it, so nothing can start it. `arcs/inline` says so;
    // compiling an arc no event triggers would only hide that.
    const out = desugarInline([link(beat('t_p'), 't_q'), link(beat('t_q'), 't_p')], []);
    expect(out.arcs).toHaveLength(0);
  });

  it('is idempotent — compiling twice does not start the same story twice', () => {
    // `indexContent` is called on the same content in a dozen places, and two
    // arcs racing to tell one story is not a failure anyone would trace back.
    const events = [link(beat('t_first'), 't_second'), beat('t_second')];
    const once = desugarInline(events, []);
    const twice = desugarInline(once.events, once.arcs);
    expect(twice.arcs).toHaveLength(1);
    expect(twice.arcs.map((a) => a.id)).toEqual(once.arcs.map((a) => a.id));
  });

  it('does nothing at all — not even a copy — to content with no inline links', () => {
    // Identity, not equality. `indexContent` runs this on every call, including
    // in the editor on every render.
    const events = [beat('t_alone'), beat('t_also_alone')];
    const out = desugarInline(events, []);
    expect(out.events).toBe(events);
    expect(out.arcs).toHaveLength(0);
  });
});

describe('indexContent', () => {
  it('compiles into the index and leaves the authored bundle untouched', () => {
    // The line that stops the editor writing a compiled arc back to disk.
    // Counted as a DELTA, because the shipped content has inline chains of its
    // own and this test is not about how many.
    const b = bundleOf([link(beat('t_first'), 't_second'), beat('t_second')]);
    const authoredArcs = b.arcs.length;
    const before = indexContent({ ...base } as ContentBundle).arcs.length;
    const content = indexContent(b);

    expect(content.arcs.length).toBe(before + 1);
    expect(content.bundle.arcs.length).toBe(authoredArcs);
    expect(content.bundle.events.find((e) => e.id === 't_second')!.arc).toBeUndefined();
    expect(content.event('t_second')!.arc).toBeDefined();
  });

  it('makes the compiled arc reachable by id, the way any other arc is', () => {
    const content = indexContent(bundleOf([link(beat('t_first'), 't_second'), beat('t_second')]));
    const arc = content.arcs.find((a) => a.inline)!;
    expect(content.arc(arc.id)).toBe(arc);
    expect(() => content.mustArc(arc.id)).not.toThrow();
  });
});

describe('a `next` lives on an outcome, and an unknown key is an error (#995)', () => {
  /** A one-choice event, with `extra` spread onto the choice, its outcome or the event. */
  function choiceEvent(extra: { choice?: object; outcome?: object; event?: object } = {}) {
    const { interaction: _narration, ...rest } = beat('t_strict');
    return {
      ...rest,
      ...extra.event,
      interaction: {
        kind: 'choice',
        choices: [{
          id: 'go', label: 'Go.', ...extra.choice,
          outcomes: [{ id: 'gone', weight: 100, text: 'Gone.', ...extra.outcome }],
        }, {
          id: 'stay', label: 'Stay.',
          outcomes: [{ id: 'stayed', weight: 100, text: 'Stayed.' }],
        }],
      },
    };
  }
  const unrecognised = (value: unknown) => {
    const parsed = EventTemplateS.safeParse(value);
    if (parsed.success) return [];
    return parsed.error.issues
      .filter((issue) => issue.code === 'unrecognized_keys')
      .map((issue) => ({ path: issue.path.join('.'), keys: (issue as { keys: string[] }).keys }));
  };

  it('starts from an event that is valid as it stands, so each case below isolates one key', () => {
    expect(EventTemplateS.safeParse(choiceEvent()).success).toBe(true);
  });

  it('rejects a `next` written on the choice instead of stripping it in silence', () => {
    // Zod strips unknown keys by default. Two shipped callbacks were authored
    // one indent too shallow, parsed cleanly, and never chained (#995).
    expect(unrecognised(choiceEvent({ choice: { next: { event: 't_later' } } })))
      .toEqual([{ path: 'interaction.choices.0', keys: ['next'] }]);
  });

  it('rejects an unknown key on an outcome and on the event itself', () => {
    expect(unrecognised(choiceEvent({ outcome: { nxt: { event: 't_later' } } })))
      .toEqual([{ path: 'interaction.choices.0.outcomes.0', keys: ['nxt'] }]);
    expect(unrecognised(choiceEvent({ event: { condition: {} } })))
      .toEqual([{ path: '', keys: ['condition'] }]);
  });

  it('accepts the same `next` on the outcome, where it belongs', () => {
    expect(EventTemplateS.safeParse(choiceEvent({ outcome: { next: { event: 't_later' } } })).success).toBe(true);
  });

  it('chains both ninety-year callbacks the shipped content writes, and draws neither ambiently', () => {
    const content = indexContent(base);
    expect(String(content.event('the_clause_read_back')!.arc?.of))
      .toBe('inline_the_toll_on_the_plank_bridge__halved');
    expect(String(content.event('the_file_a_clerk_went_looking_for')!.arc?.of))
      .toBe('inline_the_alewife_and_the_licence__asserted');
  });
});
