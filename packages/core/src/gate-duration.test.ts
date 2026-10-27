import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { join } from 'node:path';
import {
  checkGateDuration,
  readGateDurations,
} from '../../../tools/gate-duration.mjs';

const REPO = join(import.meta.dirname, '../../..');

const config = {
  measured: '2026-09-28',
  maxFactor: 1.25,
  lanes: {
    batch: { seconds: 100, evidence: 'fixture' },
    war: { seconds: 50, evidence: 'fixture' },
  },
};

describe('gate duration guard', () => {
  it('accepts a measurement inside the stated factor', () => {
    expect(checkGateDuration('batch', 124, config).ok).toBe(true);
  });

  it('rejects a stale committed figure beyond the stated factor', () => {
    const result = checkGateDuration('batch', 126, config);
    expect(result.ok).toBe(false);
    expect(result.factor).toBeCloseTo(1.26);
    expect(result.limitSeconds).toBe(125);
  });

  it('fails closed when CI adds a lane with no committed duration', () => {
    expect(() => checkGateDuration('endings', 10, config)).toThrow(/no committed duration/);
  });

  it('rejects invalid elapsed time instead of treating it as fast', () => {
    expect(() => checkGateDuration('batch', Number.NaN, config)).toThrow(/invalid elapsed/);
  });

  describe('a baseline belongs to the runner class it was measured on (#1947)', () => {
    // A public repository's standard Linux runner has 4 CPUs, a private one's 2.
    const classed = {
      ...config,
      cpus: 4,
      lanes: {
        batch: { seconds: 100, evidence: 'fixture', byCpus: { 2: { seconds: 160, evidence: 'fixture' } } },
        war: { seconds: 50, evidence: 'fixture' },
      },
    };

    it('judges each class against its own measurement', () => {
      expect(checkGateDuration('batch', 126, classed, 4)).toMatchObject({ judged: true, ok: false, baselineSeconds: 100 });
      expect(checkGateDuration('batch', 126, classed, 2)).toMatchObject({ judged: true, ok: true, baselineSeconds: 160 });
      expect(checkGateDuration('batch', 201, classed, 2)).toMatchObject({ judged: true, ok: false, limitSeconds: 200 });
    });

    it('reports an unmeasured class instead of judging it by another class', () => {
      expect(checkGateDuration('war', 500, classed, 2)).toMatchObject({ judged: false, ok: true, baselineSeconds: null, cpus: 2 });
      expect(checkGateDuration('war', 63, classed, 4)).toMatchObject({ judged: true, ok: false });
    });

    it('still fails closed on a lane with no committed duration at all', () => {
      expect(() => checkGateDuration('endings', 10, classed, 2)).toThrow(/no committed duration/);
    });

    it('commits the 4-CPU class and the 2-CPU batch measurement the private runner needs', () => {
      const committed = readGateDurations();
      expect(committed.cpus).toBe(4);
      expect(checkGateDuration('batch', 1, committed, 2).judged).toBe(true);
      expect(committed.lanes.batch?.byCpus?.['2']?.evidence).toMatch(/run[s]? 40431290331/);
      // The day it went private: 774s on 2 CPUs passes its own class and
      // still fails the 4-CPU budget it was wrongly held to.
      expect(checkGateDuration('batch', 774, committed, 2).ok).toBe(true);
      expect(checkGateDuration('batch', 774, committed, 4).ok).toBe(false);
    });

    it('says NOT JUDGED out loud, with what to record', () => {
      // 1300s is inside war's 4-CPU guard, so either branch exits 0.
      const run = spawnSync(process.execPath, [join(REPO, 'tools/gate-duration.mjs'), '--check', 'war', '1300'], {
        encoding: 'utf8',
      });
      expect(run.status, run.stderr).toBe(0);
      if (availableParallelism() === readGateDurations().cpus) {
        expect(run.stdout).toContain(`on a ${readGateDurations().cpus}-CPU host`);
      } else {
        expect(run.stdout).toContain('NOT JUDGED');
        expect(run.stdout).toContain(`::warning::gate-duration: war has no ${availableParallelism()}-CPU baseline`);
      }
    });
  });

  it('covers every gate lane CI runs', () => {
    const workflow = readFileSync(join(REPO, '.github/workflows/check.yml'), 'utf8');
    const matrix = /^\s*lane:\s*\[([^\]]+)\]/m.exec(workflow);
    expect(matrix, 'check.yml no longer declares a gate lane matrix this rule can read').toBeTruthy();

    const ciLanes = matrix![1]!.split(',').map((lane) => lane.trim()).sort();
    const recorded = Object.keys(readGateDurations().lanes).sort();
    expect(ciLanes).toEqual(['batch']);
    expect(recorded).toEqual(['batch', 'blood', 'endings', 'fire-rate', 'war']);
    expect(ciLanes.every((lane) => recorded.includes(lane))).toBe(true);
  });

  it('retains structured per-gate timings for every measured lane', () => {
    const workflow = readFileSync(join(REPO, '.github/workflows/check.yml'), 'utf8');
    expect(workflow).toContain(
      '--timings-json gate-timings-${{ matrix.lane }}.json',
    );
    expect(workflow).toMatch(
      /name: retain structured gate timings[\s\S]*?if: always\(\)[\s\S]*?name: gate-timings-\$\{\{ matrix\.lane \}\}[\s\S]*?path: gate-timings-\$\{\{ matrix\.lane \}\}\.json/,
    );
  });
});

describe('the Windows tag policy handed off by issue #321', () => {
  const workflow = readFileSync(join(REPO, '.github/workflows/check.yml'), 'utf8');

  it('packages pre-releases unsigned and makes production prove Authenticode', () => {
    expect(workflow).toMatch(
      /name: package unsigned Windows pre-release[\s\S]*?if: contains\(github\.ref_name, '-'\)[\s\S]*?run: node scripts\/dist-windows\.mjs\s/,
    );
    expect(workflow).toMatch(
      /name: package production Windows release and require Authenticode[\s\S]*?if: \$\{\{ !contains\(github\.ref_name, '-'\) \}\}[\s\S]*?run: node scripts\/dist-windows\.mjs --require-signature/,
    );
    expect(workflow).not.toContain('WINDOWS_CERTIFICATE_BASE64');
    expect(workflow).not.toContain('windows-cert.pfx');
  });

  it('retains the proof JSON beside the exact installer', () => {
    expect(workflow).toMatch(
      /name: Eldritch-Dynasty-\$\{\{ github\.ref_name \}\}-windows[\s\S]*?packages\/shell\/release\/\*\.exe[\s\S]*?packages\/shell\/release\/windows-release-proof\.json/,
    );
  });
});
