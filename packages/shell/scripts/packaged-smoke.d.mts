export type PackagedSmokeRunner = (
  executable: string,
  args: string[],
  env: NodeJS.ProcessEnv,
) => Promise<void>;

export interface PackagedSmokeOptions {
  platform?: NodeJS.Platform;
  run?: PackagedSmokeRunner;
  parentEnv?: NodeJS.ProcessEnv;
}

export type PackagedSmokeResult =
  | { skipped: true }
  | { skipped: false; executable: string };

export function findPackagedExecutable(releaseDir: string): Promise<string>;

export function smokePackagedApp(
  releaseDir: string,
  options?: PackagedSmokeOptions,
): Promise<PackagedSmokeResult>;
