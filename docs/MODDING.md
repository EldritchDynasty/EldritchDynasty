# Modding Eldritch Dynasty

The **Eldritch Dynasty Mod Editor** is a small, unsupported authoring surface for
adding local content. It is deliberately not a Workshop, package manager, or
compatibility layer. It exposes the same content model, validator, and
simulation instruments used by the game repository.

Reviewed against `main` at `8b09dbee` on 26 October 2026. Start with
[README.md's setup](../README.md#run-locally) for repository development and
[packages/content/AGENTS.md](../packages/content/AGENTS.md) for authoring
rules. [VOCABULARY.md](VOCABULARY.md) is the generated reference for the
schema's effects, conditions, filters and validation rules.

## Where local content lives

The desktop host owns one writable mod root:

```
<shared desktop userData>/mods/content/
```

The separately named game and Mod Editor deliberately share the game's desktop
profile. On a standard Windows installation that makes the content directory:

```
%APPDATA%\Eldritch Dynasty\mods\content\
```

The host sets this shared profile explicitly; it does **not** use the Mod
Editor's product name for `userData`. The host remains the authority if
Windows redirects that profile. The editor never needs an absolute path: it reads shipped content for references and
writes only paths rooted under `mods/content`.

Mirror the shipped content layout beneath that root when adding files, for
example:

```
mods/content/
  events/
    my_house_stories.yaml
  arcs/
    my_substories.yaml
```

### V1 rule: add, do not override

User content may add new files and new content ids. It may **not** shadow a
shipped file or reuse a shipped id. There is no override order, patch syntax,
dependency graph, or load-order system. A collision is a validation error.

## Validate before playing

Open **Instruments → Validate** in the Mod Editor.

This is the game's real `validateBundle` rule set, not a friendlier fork. An
error names the rule, source file, and content id in the same shape as CI:

```
ERROR  [rule/name] events/my_house_stories.yaml → event:my_event: explanation
```

Errors mean the combined shipped + user bundle is not playable. Warnings are
authoring advice and do not block the bundle.

## Check fire rate

Open **Instruments → Fire rate** and run gate 4.

This is the same fire-rate judgement used by CI, including its 0.5% floor and
the ladder-playing acquittal for content that is reachable only when a house
actively climbs. The smaller default sample is useful while editing; **Use CI
settings** selects the full 800-run, 500-year sample and can take a long time.

**`frequency` is a rationing tier, not a weight.** Adding `common` templates
changes competition with every ambient tier. A template's `weight` multiplies
its tier's frequency weight in the shared draw; it does not buy more time
inside a tier's global cooldown. Measure the whole affected pool.

Frame events are different: they run on the record-reading frame cadence rather
than the ambient Frequency ledger.

## Check what can actually resolve

Fire rate counts runs in which an event fires. It does not prove that every
choice is affordable, every required person can be cast, or every outcome can
resolve. When an outcome uses `onlyIf`, its guard filters the weighted draw
against the actual cast; the remaining outcomes are renormalised. Provide an
unguarded fallback or complementary guards on the same required engine-cast
slot. Validation rejects unsupported guard combinations and uncovered draws.
Checked choices use their check bands instead of outcome guards.

For repository content, run `npm run gates -- outcome-reach` to inspect the
full sampled report. It distinguishes event/choice exposure, eligible guarded
casts and check readings. A sampled zero with positive but insufficient
expected exposure remains **unproven**; no exposure and a sufficiently powered
miss are different failures. Deterministic execution witnesses establish that
a constructed outcome can resolve, without establishing its ordinary campaign
frequency. The merge-blocking scope uses those witnesses, while the full
sample remains scheduled evidence; see
[COMMANDS.md](COMMANDS.md#ci-and-the-janitor).

Gate reports are evidence about the bundle and policies measured. Adding a
template changes competition, so recheck affected events and outcomes rather
than treating an earlier green report as proof for the new bundle.

## Play with local content

Launch the ordinary desktop game after placing valid files under the shared desktop
profile's `mods/content` directory. The desktop game composes those
files with the shipped bundle before Vue mounts and validates the combined
result through the same rules.

For repository development, use the desktop shell for both sides of the
workflow. Close the Mod Editor before launching the game:

```bash
npm run mod-editor --workspace @ed/shell
# after authoring/validation, close the Mod Editor
npm run shell
```

`npm run play` launches the browser client. It is useful for ordinary client
development, but it has no desktop filesystem bridge and therefore does **not**
read the shared `mods/content` directory.

The ordinary desktop game with **no** user-content files keeps the precompiled
shipped content path: it does not load the YAML parser or change the simulation.

## Saves remember what content they used

A save stores provenance for authored ids it actually references.

If a run used `events/my_house_stories.yaml` and that file (or a referenced id
inside it) is later removed, the game refuses to load the save rather than
silently substituting a different world. The error names both the missing id
and its former YAML file.

Changing a mod can therefore make existing saves unavailable. Restore the
content that save referenced to resume it.

The game does **not** embed a whole mod inside every save.

## Deliberately out of scope

The Mod Editor does not provide:

- Steam Workshop or a mod browser;
- downloading/installing other people's mods;
- dependencies between mods;
- load-order controls;
- overrides or patches of shipped content;
- compatibility promises or a support SLA.

Those are different products. V1 is one local folder, the existing editor, and
the same validation rules the shipped game already trusts.
