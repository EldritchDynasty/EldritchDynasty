# Dev Containers

Two configurations, one per folder. VS Code (**Dev Containers: Reopen in
Container**) and Codespaces offer a picker when a repository has more than one.

| Choose | When | Folder |
|---|---|---|
| **Eldritch Dynasty: game and editor** | You are working on this repository: the game, the editor, content, tests. | [`game/`](game/devcontainer.json) |
| **CatDesk Vue + .NET** | You are hosting CatDesk, so ChatGPT can reach this and sibling repositories through an MCP connector. | [`catdesk/`](catdesk/devcontainer.json) |

If you are not sure, you want **game**.

## Game and editor

Node only, on `mcr.microsoft.com/devcontainers/javascript-node:22-bookworm`.
The major in that tag is the one in [`.nvmrc`](../.nvmrc); CI reads the same
file, and `packages/core/src/tools/toolchain.test.ts` fails if the container,
the workflows and `engines` stop agreeing.

On creation it runs `npm run setup -- --browser`, the same setup path the agent
session hook takes: `npm ci` into an empty `node_modules`, then Playwright's
Chromium, launched once to prove it starts. Ports 5174 (`npm run play`, the
game) and 5173 (`npm run dev`, the editor) are forwarded.

`npm run doctor` reports what is not ready, and the command that fixes each
thing, without installing anything.

**Do not share a `node_modules` between the host and the container.** One
installed on Windows or macOS carries that platform's binaries (esbuild's,
for one). `npm run setup` notices — its fingerprint records the platform — and
refreshes it with `npm install`, which changes the host's install in turn.
Use a clone made inside the container (**Dev Containers: Clone
Repository in Container Volume**), or do not install on the host.

## CatDesk

This container gives CatDesk read/write access to the host directory that
contains this repository. Every sibling repository in that directory appears
inside the container under `/workspaces/repos`.

It moved to `catdesk/` unchanged in behaviour, so its Node is still the Node
feature's floating `lts` rather than `.nvmrc` — that is why
`toolchain.test.ts` names it as an exemption. Use the game container for
work whose results have to match CI.

The install is pinned to the tested CatDesk 0.8.0 release. Update that version
in `catdesk/post-create.sh` deliberately rather than installing an unreviewed
latest release whenever the container is rebuilt.

### Start CatDesk

1. In VS Code, run **Dev Containers: Reopen in Container** and pick
   **CatDesk Vue + .NET**.
2. Open a terminal in the container and run `catdesk`.
3. For coding, choose CatDesk's computer/workspace mode. Browser control would
   control a browser installed in the container, not the normal host browser.
4. On first launch, enter the ngrok authtoken and static domain requested by
   CatDesk. They are saved in the `catdesk-state` Docker volume, not this repo.
5. Add the HTTPS MCP URL displayed by CatDesk as a custom app/connector in
   ChatGPT and scan its tools.

Port forwarding alone is not enough: ChatGPT connects to a remote MCP endpoint,
so CatDesk's ngrok tunnel must be running while the connector is in use.

### Repository instructions

CatDesk has one workspace root. Because that root is `/workspaces/repos`, a
repository's own `AGENTS.md` is below the root and is not selected automatically.
On first creation, the container seeds `~/.catdesk/AGENTS.md` (from
`catdesk/catdesk-AGENTS.md`) with a rule to read the target repository's
instructions before changing it. That copy lives in the `catdesk-state` volume,
so you can customize it without committing personal instructions or losing them
during a rebuild.

All sibling repositories are mounted read/write. To reduce the trust boundary,
replace `workspaceMount` with explicit bind mounts for only the repositories
CatDesk should be allowed to modify.
