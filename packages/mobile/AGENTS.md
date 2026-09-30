# mobile — the Android and iOS shell

Capacitor wraps the already-built `@ed/client` application. This package owns
the native projects, platform services, and store artefacts. It owns no game
rules, simulation state, content, or duplicate client UI.

**Platforms.** Android is built and ships through Google Play. **iPhone (iOS)
is a supported target by owner decision (2026-09-29) and is not built yet**:
[#349](https://github.com/JamesFlames/EldritchDynasty/issues/349) adds the
Capacitor iOS project, a macOS CI job and the App Store listing. macOS and
Linux desktop builds are out of scope.

## The seam

`src/platform-bridge.ts` is the mobile implementation of the client's
`Platform` interface: one bridge for Android and iOS, not a fork. It uses only
cross-platform Capacitor plugins (filesystem, preferences, share, app). If a
platform ever needs a branch, it takes the platform as an argument (AGENTS.md,
"Supported environments"). No file in `packages/client/src` may name an
Android, iOS or Capacitor API. The client receives the generic
`window.edPlatform` bridge before it starts.

Saves are opaque JSON. Full save snapshots and the Library of Houses live under
Capacitor `Filesystem`'s app-owned `Directory.Data`
(`eldritch/saves/*.json` and `eldritch/library.json`), while core remains
the only authority that validates and resumes them. Android builds before #349
stored those payloads in `Preferences`; `src/storage.ts` migrates each legacy
key only after its durable file write succeeds. Keep that fallback until a
deliberate compatibility decision removes it. Do not add a second save schema
here.

Interchange files are different from durable state: export writes a JSON file
to `Directory.Documents` and hands its URI to the native share sheet. Import
must feed the selected JSON back to core unchanged.

## Commands

```bash
npm run sync --workspace @ed/mobile     # bundle the host bridge, copy client assets, sync plugins
npm run android                          # rebuild, sync, install/run the debug build on a selected device
```

`android/variables.gradle` pins min/compile/target SDK values explicitly. The
tag CI job creates `keystore.properties` from repository secrets; keys and that
file are ignored and must never be committed.

## Boundaries

- Keep all native dependencies and status/safe-area work here.
- Android's back button (`onBack`) never fires on iOS. Nothing in the client may
  depend on it being the only way back.
- `packages/client/dist` is generated. The bridge injection script may prepare
  it for `cap sync`; do not hand-edit it.
- The app must keep working offline. Do not add analytics, crash reporting, or
  a network dependency without revisiting the Play data-safety declaration.

## The store privacy declarations

The same rule covers both stores: Play's Data safety form and, once #349 files
it, the App Store's privacy label, which must read **Data Not Collected**.

### Play

`store/listing.md` files the Data safety form as **no data collected, none
transmitted** — true because neither this package nor `@ed/client` makes a
network call or ships an analytics/crash SDK (`@capacitor/*` deps here are
all local device APIs: filesystem, preferences, share, app, android).

That declaration becomes false the moment either package adds one. Before
adding Play Games Services, an analytics library, a crash reporter, or any
`fetch`/`XMLHttpRequest`/websocket call anywhere under `packages/client/src`
or `packages/mobile/src`: update `store/listing.md`'s data-safety section and
`store/privacy-policy.html` first, and refile the Play Console form before
that build ships. A filed form that no longer matches the app is a
compliance failure with this repository's exact signature (AGENTS.md
invariant 11) — the field still reads "no data collected" and nothing
enforces that it stay true.
