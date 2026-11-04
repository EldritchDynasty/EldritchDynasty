import { describe, expect, it } from 'vitest';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

type Stage = 'browser' | 'probe' | 'dependencies';
type Result = { ok: boolean; timedOut?: boolean };
const tool = await import(pathToFileURL(join(import.meta.dirname, '../../../../tools/ci-browser.mjs')).href) as {
  provisionCiBrowser(options: {
    run(stage: Stage, timeout: number): Result;
    now?: () => number;
    log?: (line: string) => void;
    platform?: string;
  }): void;
};

function runner(outcomes: Partial<Record<Stage, Result[]>> = {}, platform = 'linux') {
  const calls: { stage: Stage; timeout: number }[] = [];
  let clock = 0;
  const options = {
    platform,
    now: () => clock,
    log: () => {},
    run: (stage: Stage, timeout: number) => {
      calls.push({ stage, timeout });
      clock += 1000;
      return outcomes[stage]?.shift() ?? { ok: true };
    },
  };
  return { calls, options, advance: (ms: number) => { clock += ms; } };
}

describe('bounded Chromium provisioning (#2904)', () => {
  it('verifies launch without apt on a ready runner, including Windows', () => {
    for (const platform of ['linux', 'win32']) {
      const r = runner({}, platform);
      tool.provisionCiBrowser(r.options);
      expect(r.calls.map(c => c.stage)).toEqual(['browser', 'probe']);
    }
  });

  it('recovers one failed download and still requires a real launch', () => {
    const r = runner({ browser: [{ ok: false }, { ok: true }] });
    tool.provisionCiBrowser(r.options);
    expect(r.calls.map(c => c.stage)).toEqual(['browser', 'browser', 'probe']);
  });

  it('repairs missing Linux dependencies and verifies launch again', () => {
    const r = runner({ probe: [{ ok: false }, { ok: true }], dependencies: [{ ok: false }, { ok: true }] });
    tool.provisionCiBrowser(r.options);
    expect(r.calls.map(c => c.stage)).toEqual(['browser', 'probe', 'dependencies', 'dependencies', 'probe']);
  });

  it('fails after both downloads fail without running a probe', () => {
    const r = runner({ browser: [{ ok: false }, { ok: false }] });
    expect(() => tool.provisionCiBrowser(r.options)).toThrow('both attempts');
    expect(r.calls.map(c => c.stage)).toEqual(['browser', 'browser']);
  });

  it('refuses unavailable dependencies or a browser that still cannot launch', () => {
    const refused = runner({ probe: [{ ok: false }], dependencies: [{ ok: false }, { ok: false }] });
    expect(() => tool.provisionCiBrowser(refused.options)).toThrow('both attempts');
    const broken = runner({ probe: [{ ok: false }, { ok: false }] });
    expect(() => tool.provisionCiBrowser(broken.options)).toThrow('could not launch after');
    const windows = runner({ probe: [{ ok: false }] }, 'win32');
    expect(() => tool.provisionCiBrowser(windows.options)).toThrow('could not launch');
    expect(windows.calls.map(c => c.stage)).not.toContain('dependencies');
  });

  it('never retries a timed-out installer or exceeds the remaining budget', () => {
    const timedOut = runner({ browser: [{ ok: false, timedOut: true }] });
    expect(() => tool.provisionCiBrowser(timedOut.options)).toThrow('timed out');
    expect(timedOut.calls).toHaveLength(1);
    const spent = runner({ probe: [{ ok: false }] });
    const run = spent.options.run;
    spent.options.run = (stage, timeout) => {
      const result = run(stage, timeout);
      if (stage === 'browser') spent.advance(220_000);
      return result;
    };
    tool.provisionCiBrowser(spent.options);
    expect(spent.calls.map(c => c.timeout)).toEqual([90_000, 19_000, 18_000, 17_000]);
    const exhausted = runner();
    exhausted.options.run = () => { exhausted.advance(240_000); return { ok: true }; };
    expect(() => tool.provisionCiBrowser(exhausted.options)).toThrow('budget');
  });
});
