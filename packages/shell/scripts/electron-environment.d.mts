/**
 * Return the environment inherited by a real Electron child process.
 *
 * ELECTRON_RUN_AS_NODE is deliberately removed; every other key is preserved.
 */
export function electronEnvironment(parentEnv?: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
