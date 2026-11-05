# CI fixture drift: closure evidence for #2477

Audit date: 5 November 2026. Source inspected at
`b6239261ef51fa65cfeaedca21844e37b75c083b`.

The implementation requested by #2477 is already shipped. This audit verifies
that implementation and supplies the missing local execution and repeated
integration evidence. It introduces no replacement fix or weaker assertion.

## Mechanism and local verification

[`codemap.test.ts`](../packages/core/src/codemap.test.ts) captures complete
before/after manifests in the dirty-subdirectory planner test and both timestamp
regressions. `assertUnchangedSnapshot` throws the per-path
`describeSnapshotChanges` diagnostic when their SHA changes. Persistent Git
configuration changes and ordinary file writes still fail the snapshot check.

Each temporary Git repository sets `maintenance.auto=false` and `gc.auto=0`
before its first commit. This isolates fixtures from automatically scheduled
Git bookkeeping. Git file timestamp refreshes and disappeared transient locks
are handled separately from durable file bytes. The planner itself remains
read-only.

The complete focused suite passed on the local Windows checkout with Node
22.23.4: **117 tests, 8.29 seconds**. Command:

```text
node node_modules/vitest/vitest.mjs run packages/core/src/codemap.test.ts
```

The local executor selected the repository's supported Node 22 runtime through
`npm exec --package=node@22`. No test was skipped or assertion changed.

## Repeated exact-integration evidence

Sample fixed by query: the latest **20 completed** `check.yml` runs with event
`merge_group` when inspected, created on 5 November between 01:49:21 and
06:34:45 UTC. Each is a distinct native integration commit, rather than a
PR-head check or a rerun counted as another integration.

For **every row**, the inspected jobs `fast lane`,
`windows (typecheck + validate + fast lane)`, `gates (batch)` and `CI required`
all concluded `success`. Optional installer jobs were skipped and are not
counted as validation. The overall workflow conclusion alone was not used as
the evidence for the Linux and Windows tests.

| Native integration run | Head prefix |
| --- | --- |
| [41981350028](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41981350028) | `b6239261` |
| [41979619524](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41979619524) | `022c6edf` |
| [41978147028](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41978147028) | `2c8ca370` |
| [41976897390](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41976897390) | `9b859e3d` |
| [41975547782](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41975547782) | `7ed2e0a3` |
| [41974456076](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41974456076) | `f5a2ae2d` |
| [41972616964](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41972616964) | `4bc8e62a` |
| [41971258510](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41971258510) | `f6af0025` |
| [41969576069](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41969576069) | `a3e341fb` |
| [41968132354](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41968132354) | `78df385e` |
| [41966346896](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41966346896) | `6c8ab542` |
| [41964437031](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41964437031) | `0fa5b311` |
| [41963245034](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41963245034) | `a56fbc99` |
| [41962162237](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41962162237) | `20e32ee4` |
| [41960211725](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41960211725) | `c1745a1a` |
| [41958316799](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41958316799) | `68efb5e5` |
| [41956572219](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41956572219) | `d3643672` |
| [41954230971](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41954230971) | `025da89f` |
| [41953022196](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41953022196) | `fc7083d3` |
| [41951089609](https://github.com/EldritchDynasty/EldritchDynasty/actions/runs/41951089609) | `b8225c14` |

## Disposition

Close #2477 with the existing production fix, strict regression protections,
successful local suite and these twenty comparable integrations. No recurrence
was observed in this sample. This does not deterministically reproduce the old
rare race or prove that a future Git version cannot expose another one. A new
failure should retain the emitted path-level manifest diagnostic and open a
bounded regression issue against its exact integration SHA.

The ready PR carrying this report still needs its own exact-head required CI
and native merge-group checks. Historical green checks do not validate its
other changes.
