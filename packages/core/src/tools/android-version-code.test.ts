import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const BUILD_GRADLE = join(
  import.meta.dirname,
  '../../../../mobile/android/app/build.gradle',
);
const source = readFileSync(BUILD_GRADLE, 'utf8');

describe('Android release versionCode', () => {
  it('includes the workflow rerun attempt in a bounded run-number stride', () => {
    expect(source).toContain("System.getenv('GITHUB_RUN_NUMBER')");
    expect(source).toContain("System.getenv('GITHUB_RUN_ATTEMPT')");
    expect(source).toContain(
      'def computedVersionCode = runNumber * versionCodeAttemptStride + runAttempt',
    );

    const stride = Number(
      source.match(/def versionCodeAttemptStride = (\d+)L/)?.[1],
    );
    expect(stride).toBeGreaterThan(2);

    const code = (run: number, attempt: number) => run * stride + attempt;
    expect(code(42, 1)).not.toBe(code(42, 2));
    expect(code(42, stride - 1)).toBeLessThan(code(43, 1));
  });

  it('keeps local builds on the deterministic fallback code', () => {
    expect(source).toContain('def androidVersionCode = 1');
    expect(source).toContain('versionCode androidVersionCode');
  });

  it('guards the Android/Play versionCode ceiling', () => {
    expect(source).toContain('computedVersionCode > 2100000000L');
  });
});
