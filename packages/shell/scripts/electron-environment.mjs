/**
 * Environment inherited by the real Electron binary.
 *
 * Codex and some Node-hosted tools set ELECTRON_RUN_AS_NODE for their own
 * Electron process. That flag is inherited by child processes, where it turns
 * our `electron .` launch back into plain Node. The resulting error claims
 * that `electron` has no BrowserWindow export even though the application was
 * never running under Electron at all.
 *
 * Remove only that host-control flag. Everything else, including the
 * development server URL and the Mod Editor mode, belongs to the child.
 */
export function electronEnvironment(environment = process.env) {
  const childEnvironment = { ...environment };
  delete childEnvironment.ELECTRON_RUN_AS_NODE;
  return childEnvironment;
}
