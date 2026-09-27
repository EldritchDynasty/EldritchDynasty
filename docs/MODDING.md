# Modding Eldritch Dynasty

The **Eldritch Dynasty Mod Editor** is a small, unsupported authoring surface for
adding local content. It is deliberately not a Workshop, package manager, or
compatibility layer. It exposes the same content model, validator, and
simulation instruments used by the game repository.

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

**`frequency` is a rationing tier, not a weight.** Adding thirty `common`
templates silently rations every other common template. The per-template
`weight` only nudges selection *within* that tier.

Frame events are different: they run on the record-reading frame cadence rather
than the ambient Frequency ledger.

## Play with local content

Launch the ordinary desktop game after placing valid files under the shared desktop
profile's `mods/content` directory. The desktop game composes those
files with the shipped bundle before Vue mounts and validates the combined
result through the same rules.

For repository development:

```bash
npm run mod-editor --workspace @ed/shell
npm run play
```

The ordinary game with **no** user-content files keeps the precompiled shipped
content path: it does not load the YAML parser or change the simulation.

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
