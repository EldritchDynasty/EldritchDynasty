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
 * Zod's internals are not part of its public types, so reaching into `_def` needs
 * one cast. It is here, once, rather than at each of the eight places that walk
 * a schema — which is the same bargain every other cast in this codebase makes.
 */
type ZodDef = Record<string, unknown>;
const defOf = (s: z.ZodTypeAny): ZodDef => (s as unknown as { _def: ZodDef })._def;

/** A short, readable type for one field. Depth-limited: this is a reference, not a spec. */
export function typeOf(schema: z.ZodTypeAny, depth = 0): string {
  const def = defOf(schema);
  const kind = String(def.typeName);

  if (depth > 3) return '…';

  // Named short-circuits. `Target` expands to five alternatives and appears on
  // six effects; spelling it out each time buries the field that matters.
  if (schema === TargetS) return 'Target';
  if (schema === ConditionS) return 'Condition';
  if (schema === FilterS) return 'Filter';

  switch (kind) {
    case 'ZodString': return 'string';
    case 'ZodNumber': return 'number';
    case 'ZodBoolean': return 'boolean';
    case 'ZodNull': return 'null';
    case 'ZodUnknown':
    case 'ZodAny': return 'any';
    case 'ZodLiteral': return JSON.stringify(def.value);
    case 'ZodEnum': return (def.values as string[]).join('|');
    case 'ZodNativeEnum': return 'enum';
    case 'ZodBranded': return typeOf(def.type as z.ZodTypeAny, depth);
    case 'ZodEffects': return typeOf(def.schema as z.ZodTypeAny, depth);
    case 'ZodOptional': return `${typeOf(def.innerType as z.ZodTypeAny, depth)}?`;
    case 'ZodNullable': return `${typeOf(def.innerType as z.ZodTypeAny, depth)}|null`;
    case 'ZodDefault': {
      const inner = typeOf(def.innerType as z.ZodTypeAny, depth);
      const value = (def.defaultValue as () => unknown)();
      return `${inner} = ${JSON.stringify(value)}`;
    }
    case 'ZodArray': return `${typeOf(def.type as z.ZodTypeAny, depth + 1)}[]`;
    case 'ZodRecord': return `record<${typeOf(def.valueType as z.ZodTypeAny, depth + 1)}>`;
    case 'ZodTuple':
      return `[${(def.items as z.ZodTypeAny[]).map((i) => typeOf(i, depth + 1)).join(', ')}]`;
    case 'ZodUnion':
      return (def.options as z.ZodTypeAny[]).map((o) => typeOf(o, depth + 1)).join(' | ');
    case 'ZodDiscriminatedUnion':
      return (def.options as z.ZodTypeAny[]).map((o) => typeOf(o, depth + 1)).join(' | ');
    case 'ZodLazy':
      // Condition and Filter are recursive. Name them rather than expanding.
      return schema === ConditionS ? 'Condition' : schema === FilterS ? 'Filter' : 'recursive';
    case 'ZodObject': {
      const shape = (schema as unknown as z.AnyZodObject).shape;
      return `{${Object.keys(shape).join(', ')}}`;
    }
    default: return kind.replace(/^Zod/, '').toLowerCase();
  }
}

function fieldsOf(obj: z.AnyZodObject, skip: string[] = []): string[] {
  return Object.entries(obj.shape)
    .filter(([k]) => !skip.includes(k))
    .map(([k, v]) => `${k}: ${typeOf(v as z.ZodTypeAny)}`);
}

// ── Union walking ─────────────────────────────────────────────────────────

function discriminated(schema: z.ZodTypeAny, key: string): Variant[] {
  const options = (defOf(schema).options as z.AnyZodObject[]) ?? [];
  return options.map((o) => ({
    name: String(defOf(o.shape[key] as z.ZodTypeAny).value),
    fields: fieldsOf(o, [key]),
  }));
}

/**
 * `Condition` and `Filter` discriminate by WHICH KEY IS PRESENT rather than by
 * a `kind` field, so the variant's name is its first key.
 */
function keyed(lazy: z.ZodTypeAny): Variant[] {
  const inner = (defOf(lazy).getter as () => z.ZodTypeAny)();
  const options = (defOf(inner).options as z.AnyZodObject[]) ?? [];
  return options.map((o) => {
    const keys = Object.keys(o.shape);
    const head = keys[0]!;
    return {
      name: head,
      fields: [
        `${head}: ${typeOf(o.shape[head] as z.ZodTypeAny)}`,
        ...fieldsOf(o, [head]),
      ],
    };
  });
}

// ── The vocabulary ────────────────────────────────────────────────────────

export function vocabulary(): Vocabulary {
  const targets = ((defOf(TargetS).options) as z.ZodTypeAny[]).flatMap((o) => {
    const def = defOf(o);
    if (String(def.typeName) === 'ZodEnum') return def.values as string[];
    return [`{ ${Object.keys((o as unknown as z.AnyZodObject).shape).join(', ')} }`];
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
      { name: 'PersonStatus', values: PersonStatusS.options, note: '`guardian` is the Narrator after he crosses over — never `alive` again.' },
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

function controlOf(schema: z.ZodTypeAny, depth = 0): FieldControl {
  if (schema === TargetS) return { kind: 'target' };

  const def = defOf(schema);
  const kind = String(def.typeName);

  switch (kind) {
    case 'ZodString': return { kind: 'string' };
    case 'ZodNumber': return { kind: 'number' };
    case 'ZodBoolean': return { kind: 'boolean' };
    case 'ZodEnum': return { kind: 'enum', options: def.values as string[] };
    case 'ZodLiteral': return { kind: 'enum', options: [String(def.value)] };
    case 'ZodBranded':
    case 'ZodEffects':
      return controlOf((def.type ?? def.schema) as z.ZodTypeAny, depth);
    case 'ZodArray': {
      const inner = controlOf(def.type as z.ZodTypeAny, depth + 1);
      if (inner.kind === 'string') return { kind: 'stringList' };
      return { kind: 'opaque', note: 'a list this form cannot draw' };
    }
    case 'ZodUnion': {
      const options = (def.options as z.ZodTypeAny[]) ?? [];
      const kinds = options.map((o) => String(defOf(o).typeName));
      // `boolean | number | string` — a flag's value.
      if (kinds.every((k) => k === 'ZodBoolean' || k === 'ZodNumber' || k === 'ZodString')) {
        return { kind: 'scalar' };
      }
      // A union of literals is an enum wearing a different hat.
      if (kinds.every((k) => k === 'ZodLiteral')) {
        return { kind: 'enum', options: options.map((o) => String(defOf(o).value)) };
      }
      return { kind: 'opaque', note: 'one of several shapes — edit this one in YAML' };
    }
    case 'ZodObject': {
      if (depth > 2) return { kind: 'opaque', note: 'nested too deep for a form' };
      return { kind: 'object', fields: fieldsOfSchema(schema as z.AnyZodObject, [], depth + 1) };
    }
    default:
      return { kind: 'opaque', note: `${kind.replace(/^Zod/, '').toLowerCase()} — edit this one in YAML` };
  }
}

export function fieldsOfSchema(obj: z.AnyZodObject, skip: string[] = [], depth = 0): FieldSpec[] {
  return Object.entries(obj.shape)
    .filter(([k]) => !skip.includes(k))
    .map(([key, raw]) => {
      let schema = raw as z.ZodTypeAny;
      let optional = false;
      let fallback: unknown;

      // Unwrap in a loop: `z.string().optional()` and `z.number().default(0)`
      // both wrap, and `.optional().default()` wraps twice.
      for (let i = 0; i < 4; i++) {
        const def = defOf(schema);
        const name = String(def.typeName);
        if (name === 'ZodOptional') { optional = true; schema = def.innerType as z.ZodTypeAny; continue; }
        if (name === 'ZodDefault') {
          fallback = (def.defaultValue as () => unknown)();
          schema = def.innerType as z.ZodTypeAny;
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
  for (const option of (defOf(EffectS).options as z.AnyZodObject[]) ?? []) {
    const kind = String(defOf(option.shape.kind as z.ZodTypeAny).value);
    out[kind] = fieldsOfSchema(option, ['kind']);
  }
  return out;
}

/** Every effect kind there is, in schema order. The editor's kind selector. */
export function effectKinds(): string[] {
  return ((defOf(EffectS).options as z.AnyZodObject[]) ?? [])
    .map((o) => String(defOf(o.shape.kind as z.ZodTypeAny).value));
}
