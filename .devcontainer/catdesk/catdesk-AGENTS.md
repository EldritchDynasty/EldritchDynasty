# Cross-repository workspace

- Work only in the repository the user identifies for the current task.
- Before changing a repository, read its `AGENTS.md` and any more specific
  `AGENTS.md` files below it, then follow them.
- Treat every sibling repository as out of scope unless the user explicitly
  includes it.
- Preserve existing uncommitted work and inspect `git status` before editing.
- Do not expose credentials, tokens, or files outside `/workspaces/repos`.
