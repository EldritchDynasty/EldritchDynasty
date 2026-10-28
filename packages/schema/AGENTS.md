# schema — the single source of truth

Zod schemas and the types they infer. Nothing here simulates anything, reads a
file, or knows what a year is. Its only dependency is `zod`.

## The shape

```
ids.ts            branded ids. They ARE strings — no cast needed to read one.
exhaustive.ts     assertNever. The compiler as the checklist.
event.ts          EventTemplate, Effect, Target, SlotRole, Interaction, Record block
primordial.ts     SceneSite, emergency harm/prices and saved intervention records
conditions.ts     Condition, Filter, CompareOp, RespectTier, Register
attributes.ts     AttributeDef, TraitDef, the affinities, canLearn
genome.ts         LocusDef, Genome, EldritchProfile, GenePool
person.ts         Person, membership, contracts, the phenotype cache
age/arc/branch/heirloom/house/clause/character.ts   one concept each
content.ts        ContentBundle — one array per collection, as authored
assemble.ts       CONTENT_LAYOUT: which collection comes from which file
content-index.ts  Content — the bundle with its lookups built
save.ts           SavedGame, and the compile-time check that it matches runtime
rules.ts          CONTENT_RULES — validation, one named rule at a time
prose.ts          the countable half of the voice contract
reference.ts      reads the vocabularies off the schemas for `npm run gen:docs`
validate.ts       the runner: validateBundle, runRule
```

## The rules that bite here

- **Never write a second definition of what an event is.** The editor validates
  against these schemas, the game loads against them, CI checks the content
  directory against them.
- **A closed union stays closed.** Adding a variant should break the build at
  every site that handles it — which works only because those sites end in
  `assertNever`.
- **Adding a field to a state type means adding it to `save.ts`.**
  `SAVE_SHAPES_AGREE` fails to compile if the two drift. Do not "fix" that
  check by widening it.
- **Saved prose is an artefact, not a translation lookup.** Keep the rendered
  words of Chronicle pages and other persisted diegetic records; localisation
  may use stable message ids before rendering, but loading an old save must not
  require an old translation catalogue. See [docs/LOCALISATION.md](../../docs/LOCALISATION.md).
- **Guarded outcomes still need a total draw.** `Outcome.onlyIf` uses slot
  filters, with `outcomes/guard` restricting the supported partitions and
  `outcomes/cover` requiring an available fallback or complementary guards.
  A check band selects an outcome directly, so it cannot use `onlyIf`.
- **Emergency responses are complete outcomes.** `Outcome.primordial` replaces
  the normal effects and public Record together; `site` and `agreedPrices`
  describe attendance and specific accepted prices. Validate these through the
  existing rules, not a second content schema.
- **Branded ids are assignable to `string`.** If you find yourself writing
  `as unknown as string`, you do not need it. Going the other way is `asId<T>`.
- **`CONTENT_LAYOUT` is the only statement of where content lives.** Both
  loaders read it. Add a collection there, not in a loader.

## Adding a validation rule

One `ValidationRule` in `rules.ts` — an id, a sentence, a function — appended to
`CONTENT_RULES`. Test it alone: `runRule('your/rule', bundle)`. Errors block a
save; warnings do not, and that is deliberate.

After changing any vocabulary: `npm run gen:docs`. `docs.test.ts` fails if the
generated reference is stale.

## Invariant details

### 5. The verbs are enumerated, never scripted

`Effect`, `Condition`, `Filter`, `Target`, `Decider` and `SlotRole` are closed unions. Adding a variant is a deliberate act with a compiler error at every site that has to keep up — the correct amount of friction.

That only holds because each of those sites now ends in `assertNever`. It did not before: a `switch` with no default and an `if ('x' in c)` chain ending in `return true` both accept a new variant in silence — the effect applies nothing, the condition **passes**, and every event carrying it fires unconditionally for a thousand years. Never end one of those functions with a permissive default.

### 16. Every post is a man's

`canHoldPost` (`packages/schema/src/career.ts`) is the only placement gate. All three doors that write `Person.career` ask it: the player's `career` order at the table, the steward's `placePosts`, and the authored `career` effect.

- **§18's careers are institutions, not menu items** — a commission in the Warden's levy, ordination at the Bramme chapter house, a place in the King's household, a Braccish partnership, a bench at Cawdry, a berth out of Sarrow, a bed at the Colleges. Every one of them is closed to a woman.
- **No `sex` field on `CareerDef`.** A per-career flag is one the ninth career forgets to set.
- The three doors asked only for an age. So the steward bought commissions for daughters out of a treasury with six seats to spend, the table offered them, and the clergy's Madness cover and breeding-pool exclusion landed on women — while the prose those events carry says *"ordination is not a post a man leaves"*, *"Two sons, and one place"*, *"He is very good at it"*.
- **`careers/gate`** is the content half. The engine gate turns a mis-cast placement into a placement that does NOTHING — the outcome fires, pays its Respect, writes its chronicle line, and nobody is placed. The rule refuses any bundle whose `career` effect casts from a slot that is not already gated to men, the same way `madness/gate` does.
- This is **not** the Mystic restriction and shares no code with it. A woman is barred from the posts and from nothing else: the tutor's term, the shelf, the Threshold four, the Match and the Record are all hers.
