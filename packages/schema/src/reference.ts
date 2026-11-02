import { z } from 'zod';
import { EffectS, EventTierS, PoolSpecS, PurposeS, SlotRoleS, SlotSpecS } from './event.js';
import { TargetS } from './target.js';
import { ConditionS, FilterS, RegisterS, RespectTierS, CompareOpS } from './conditions.js';
import { StateRungS } from './decider.js';
import { SuccessorS } from './arc.js';
import { ChronicleWeightS, FrequencyS, FREQUENCY_PROFILES } from './frequency.js';
import { MembershipKindS, PersonStatusS, RetainerRoleS } from './person.js';
import { AttributeKindS, SexS } from './attributes.js';
import { CONTENT_RULES } from './rules.js';

/**
 * THE VOCABULARY, READ OFF THE SCHEMAS.
 *
 * Authoring an event or wiring an effect used to mean reading `event.ts`,
 * `conditions.ts`, `frequency.ts`, `attributes.ts` and `person.ts` — about
 * seven hundred lines of Zod and commentary — to answer questions as small as
 * "what are the slot roles" and "what fields does a rumour effect take".
 *
 * This reads the answers off the schemas themselves and `npm run gen:docs`
 * renders them to `docs/VOCABULARY.md`. Generated, so it cannot drift; one
 * file, so it costs a fraction of the reading it replaces.
 *
 * The renderer lives in `core/src/tools/gen-docs.ts`. This file only describes.
 */

export interface Variant {
  /** The discriminating key or literal — `rumour`, `ageActive`, `head`. */
  name: string;
  /** `field: type` for everything the variant carries, minus the discriminant. */
  fields: string[];
}

export interface Vocabulary {
  effects: Variant[];
  conditions: Variant[];
  filters: Variant[];
  targets: string[];
  /** Who takes a branch. See `decider.ts`. */
  deciders: { name: string; shape: string; note: string }[];
  /** How an arc successor asks what just happened. See `arc.ts`. */
  successorGuards: string[];
  enums: { name: string; values: string[]; note?: string }[];
  frequencies: {
    tier: string; cap: string; cooldown: string; record: string;
    rumour: string; chronicle: string;
  }[];
  rules: { id: string; about: string }[];
}

// ── Type rendering ────────────────────────────────────────────────────────

/**
 * Zod 4 publishes every schema's definition as `.def`, discriminated by a
 * `type` string, so walking one needs no reach into private fields. One widening
 * from the base schema type to the union of Zod's own kinds lets each `case`
 * below narrow to the fields that kind really has; it lives here, once, rather
 * than at each of the places that walk a schema.
 */
type Schema = z.core.$ZodType;
const defOf = (s: Schema) => (s as z.core.$ZodTypes)._zod.def;
type ObjectSchema = z.ZodObject;

/**
 * The schema a refinement-free reader sees through a pipe. `.transform()`
 * pipes the schema INTO a transform, and `z.preprocess()` pipes a transform
 * into the schema; either way the described shape is the side that is not
 * the bare function.
 */
const throughPipe = (def: z.core.$ZodPipeDef): Schema =>
  defOf(def.in).type === 'transform' ? def.out : def.in;

/** A literal's text. Zod 4 lets one literal carry several values. */
const literalText = (values: readonly unknown[]): string => values.map((v) => JSON.stringify(v)).join('|');

/** A short, readable type for one field. Depth-limited: this is a reference, not a spec. */
export function typeOf(schema: Schema, depth = 0): string {
  const def = defOf(schema);

  if (depth > 3) return '…';

  // Named short-circuits. `Target` expands to five alternatives and appears on
  // six effects; spelling it out each time buries the field that matters.
  if (schema === TargetS) return 'Target';
  if (schema === ConditionS) return 'Condition';
  if (schema === FilterS) return 'Filter';

  // Zod 4 has no wrapper for `.brand()` or `.refine()`: both stay on the
  // schema they decorate, so neither needs a case of its own here.
  switch (def.type) {
    case 'string': return 'string';
    case 'number': return 'number';
    case 'boolean': return 'boolean';
    case 'null': return 'null';
    case 'unknown':
    case 'any': return 'any';
    case 'literal': return literalText(def.values);
    case 'enum': return Object.values(def.entries).join('|');
    case 'pipe': return typeOf(throughPipe(def), depth);
    case 'optional': return `${typeOf(def.innerType, depth)}?`;
    case 'nullable': return `${typeOf(def.innerType, depth)}|null`;
    case 'default': return `${typeOf(def.innerType, depth)} = ${JSON.stringify(def.defaultValue)}`;
    case 'array': return `${typeOf(def.element, depth + 1)}[]`;
    case 'record': return `record<${typeOf(def.valueType, depth + 1)}>`;
    case 'tuple': return `[${def.items.map((i) => typeOf(i, depth + 1)).join(', ')}]`;
    case 'union': return def.options.map((o) => typeOf(o, depth + 1)).join(' | ');
    case 'lazy':
      // Condition and Filter are recursive. Name them rather than expanding.
      return 'recursive';
    case 'object': return `{${Object.keys(def.shape).join(', ')}}`;
    default: return def.type;
  }
}

function fieldsOf(obj: ObjectSchema, skip: string[] = []): string[] {
  return Object.entries(obj.shape)
    .filter(([k]) => !skip.includes(k))
    .map(([k, v]) => `${k}: ${typeOf(v)}`);
}

// ── Union walking ─────────────────────────────────────────────────────────

/** A union's alternatives, each an object. The unions read here are all of objects. */
function objectOptions(schema: Schema): ObjectSchema[] {
  const def = defOf(schema);
  return def.type === 'union' ? def.options as ObjectSchema[] : [];
}

/** The value of a literal discriminant, as the vocabulary names it. */
const discriminant = (o: ObjectSchema, key: string): string => {
  const def = defOf(o.shape[key]!);
  return def.type === 'literal' ? String(def.values[0]) : String(undefined);
};

function discriminated(schema: Schema, key: string): Variant[] {
  return objectOptions(schema).map((o) => ({
    name: discriminant(o, key),
    fields: fieldsOf(o, [key]),
  }));
}

/**
 * `Condition` and `Filter` discriminate by WHICH KEY IS PRESENT rather than by
 * a `kind` field, so the variant's name is its first key.
 */
function keyed(lazy: Schema): Variant[] {
  const def = defOf(lazy);
  const inner = def.type === 'lazy' ? def.getter() : lazy;
  return objectOptions(inner).map((o) => {
    const keys = Object.keys(o.shape);
    const head = keys[0]!;
    return {
      name: head,
      fields: [
        `${head}: ${typeOf(o.shape[head]!)}`,
        ...fieldsOf(o, [head]),
      ],
    };
  });
}

// ── The vocabulary ────────────────────────────────────────────────────────

export function vocabulary(): Vocabulary {
  const targetDef = defOf(TargetS);
  const targets = (targetDef.type === 'union' ? targetDef.options : []).flatMap((o) => {
    const def = defOf(o);
    if (def.type === 'enum') return Object.values(def.entries).map(String);
    return def.type === 'object' ? [`{ ${Object.keys(def.shape).join(', ')} }`] : [];
  });

  return {
    effects: discriminated(EffectS, 'kind'),
    conditions: keyed(ConditionS),
    filters: keyed(FilterS),
    targets,
    deciders: [
      {
        name: 'player',
        shape: "decidedBy: player",
        note: 'The docket stops the clock and asks. The default, and what a choice event has always been.',
      },
      {
        name: 'chance',
        shape: "decidedBy: chance",
        note: 'A weighted draw over the branches, each worth the sum of its outcomes\' weights.',
      },
      {
        name: 'state',
        shape: `decidedBy: { state: [{${fieldsOf(StateRungS).join(', ')}}] }`,
        note: 'A ladder, read top down: the first rung whose `when` holds takes the branch it names. '
          + 'A final rung with no `when` is the else. The family\'s own condition decides.',
      },
      {
        name: 'party',
        shape: 'decidedBy: { party: { check: string } }',
        note: 'The player casts the `castBy: player` slots — that is his decision — and the named Check, '
          + 'pooled over exactly those people, picks the branch. Its bands name CHOICE ids, not outcome ids.',
      },
    ],
    successorGuards: fieldsOf(SuccessorS),
    enums: [
      { name: 'SlotRole', values: SlotRoleS.options, note: 'Who a slot may cast. `core/src/events/slots.ts` narrows the pool. Slot fields: '
        + fieldsOf(SlotSpecS).map((s) => `\`${s}\``).join(' · ') },
      { name: 'PoolSpec', values: discriminated(PoolSpecS, 'kind').map((p) => p.name + (p.fields.length ? ': ' + p.fields.join('; ') : '')),
        note: 'What a check scores. family_knows is binary completed knowledge; slot attributes all come from the same participant.' },
      { name: 'Purpose', values: PurposeS.options, note: 'Every template declares exactly three, all distinct.' },
      { name: 'EventTier', values: EventTierS.options, note: '`frame` events run in their own year phase, gated by `reads` rather than `conditions`.' },
      { name: 'Frequency', values: FrequencyS.options, note: 'A rationing tier, not a weight synonym. See the table below.' },
      { name: 'ChronicleWeight', values: ChronicleWeightS.options, note: 'How an entry renders. Decided by frequency, not authored.' },
      { name: 'RespectTier', values: RespectTierS.options, note: 'Ordered. Decay floors at `known`; `unknown` has to be done to you.' },
      { name: 'Register', values: RegisterS.options, note: 'An Age\'s texture. Two Ages of one register never run consecutively.' },
      { name: 'CompareOp', values: CompareOpS.options },
      { name: 'Sex', values: SexS.options },
      { name: 'PersonStatus', values: PersonStatusS.options, note: '`guardian` is the Narrator after they cross over — never `alive` again.' },
      { name: 'MembershipKind', values: MembershipKindS.options, note: 'One OPEN record per person. Two puts them in two halls at once.' },
      { name: 'RetainerRole', values: RetainerRoleS.options, note: 'An `archivist` in post is what makes an Age pay its clause.' },
      { name: 'AttributeKind', values: AttributeKindS.options, note: 'The list of attributes is open; nothing in the engine counts them.' },
    ],
    frequencies: FrequencyS.options.map((tier) => {
      const p = FREQUENCY_PROFILES[tier];
      return {
        tier,
        cap: p.perRunCap === null ? 'none' : `${p.perRunCap}/run`,
        cooldown: p.cooldownYears ? `${p.cooldownYears} yr` : 'none',
        record: p.record,
        rumour: p.rumour,
        chronicle: p.named ? `${p.chronicle}, named` : p.chronicle,
      };
    }),
    rules: CONTENT_RULES.map((r) => ({ id: r.id, about: r.about })),
  };
}

// ── Field descriptors, for a form rather than a page ──────────────────────

/**
 * THE SAME TRICK AS `vocabulary()`, AIMED AT A FORM.
 *
 * `typeOf` renders a field as a sentence for a human to read. An editor needs
 * the same information as a decision — which control to draw — and reading it
 * back out of `"add|remove"` by splitting on a pipe would be parsing prose.
 *
 * So this walks the same Zod schemas and answers the machine's question. The
 * payoff is the one this codebase keeps paying for elsewhere: adding an
 * `Effect` kind gives it a form in the editor for free, and a hand-maintained
 * table of twenty-two effect kinds cannot drift from the union it describes,
 * because there is no such table.
 */
export type FieldControl =
  | { kind: 'number' }
  | { kind: 'string' }
  | { kind: 'boolean' }
  | { kind: 'enum'; options: string[] }
  /** `boolean | number | string` — a flag's value, which may be any of the three. */
  | { kind: 'scalar' }
  | { kind: 'target' }
  | { kind: 'stringList' }
  | { kind: 'object'; fields: FieldSpec[] }
  /** Something no generic control can honestly draw. The editor says so rather than guessing. */
  | { kind: 'opaque'; note: string };

export interface FieldSpec {
  key: string;
  optional: boolean;
  /** Present when the schema fills the field in; the editor seeds new values with it. */
  fallback?: unknown;
  control: FieldControl;
}

function controlOf(schema: Schema, depth = 0): FieldControl {
  if (schema === TargetS) return { kind: 'target' };

  const def = defOf(schema);

  switch (def.type) {
    case 'string': return { kind: 'string' };
    case 'number': return { kind: 'number' };
    case 'boolean': return { kind: 'boolean' };
    case 'enum': return { kind: 'enum', options: Object.values(def.entries).map(String) };
    case 'literal': return { kind: 'enum', options: def.values.map(String) };
    case 'pipe': return controlOf(throughPipe(def), depth);
    case 'array': {
      const inner = controlOf(def.element, depth + 1);
      if (inner.kind === 'string') return { kind: 'stringList' };
      return { kind: 'opaque', note: 'a list this form cannot draw' };
    }
    case 'union': {
      const kinds = def.options.map((o) => defOf(o).type);
      // `boolean | number | string` — a flag's value.
      if (kinds.every((k) => k === 'boolean' || k === 'number' || k === 'string')) {
        return { kind: 'scalar' };
      }
      // A union of literals is an enum wearing a different hat.
      if (def.options.every((o) => defOf(o).type === 'literal')) {
        return {
          kind: 'enum',
          options: def.options.flatMap((o) => {
            const d = defOf(o);
            return d.type === 'literal' ? d.values.map(String) : [];
          }),
        };
      }
      return { kind: 'opaque', note: 'one of several shapes — edit this one in YAML' };
    }
    case 'object': {
      if (depth > 2) return { kind: 'opaque', note: 'nested too deep for a form' };
      return { kind: 'object', fields: fieldsOfSchema(schema as ObjectSchema, [], depth + 1) };
    }
    default:
      return { kind: 'opaque', note: `${def.type} — edit this one in YAML` };
  }
}

export function fieldsOfSchema(obj: ObjectSchema, skip: string[] = [], depth = 0): FieldSpec[] {
  return Object.entries(obj.shape)
    .filter(([k]) => !skip.includes(k))
    .map(([key, raw]) => {
      let schema: Schema = raw;
      let optional = false;
      let fallback: unknown;

      // Unwrap in a loop: `z.string().optional()` and `z.number().default(0)`
      // both wrap, and `.optional().default()` wraps twice.
      for (let i = 0; i < 4; i++) {
        const def = defOf(schema);
        if (def.type === 'optional') { optional = true; schema = def.innerType; continue; }
        if (def.type === 'default') {
          fallback = def.defaultValue;
          schema = def.innerType;
          continue;
        }
        break;
      }

      const spec: FieldSpec = { key, optional, control: controlOf(schema, depth) };
      if (fallback !== undefined) spec.fallback = fallback;
      return spec;
    });
}

/** Effect kind -> the fields a form must draw for it. Derived, never listed. */
export function effectFields(): Record<string, FieldSpec[]> {
  const out: Record<string, FieldSpec[]> = {};
  for (const option of objectOptions(EffectS)) {
    out[discriminant(option, 'kind')] = fieldsOfSchema(option, ['kind']);
  }
  return out;
}

/** Every effect kind there is, in schema order. The editor's kind selector. */
export function effectKinds(): string[] {
  return objectOptions(EffectS).map((o) => discriminant(o, 'kind'));
}
