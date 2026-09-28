# schema — the single source of truth

Zod schemas and the types they infer. Nothing here simulates anything, reads a
file, or knows what a year is. Its only dependency is `zod`.

## The shape

```
ids.ts            branded ids. They ARE strings — no cast needed to read one.
exhaustive.ts     assertNever. The compiler as the checklist.
event.ts          EventTemplate, Effect, Target, SlotRole, Interaction, Record block
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
