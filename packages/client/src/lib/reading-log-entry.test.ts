import { describe, expect, it } from 'vitest';
import { ReadingLog } from './reading-log.js';

/**
 * A saved run's public identity is watched before its Chronicle confirms the
 * pickup. The first-session observer must not assign that tentative identity
 * to a different house's signing or invent a title-screen house (#2905).
 */
function observer() {
  let time = 0;
  const log = new ReadingLog(
    () => time,
    { sha: 'test', platform: 'browser' },
    '2026-11-05T00:00:00.000Z',
    { visible: true, focused: true },
  );
  return { log, at(value: number) { time = value; } };
}

describe('first-session entry boundaries across tentative pickups (#2905)', () => {
  it('does not invent a previous house from a title-screen pickup run marker', () => {
    const { log, at } = observer();
    at(100);
    log.note({ kind: 'action', verb: 'resume', act: 'start' });
    at(150);
    // App observes the new identity ahead of the Chronicle's pickup marker.
    log.note({ kind: 'run', campaign: 'long', seed: 91 });
    at(200);
    log.chronicle([]);
    at(250);
    log.end('exported');

    const artifact = log.artifact();
    expect(artifact.events.filter((event) => event.kind === 'run')).toHaveLength(1);
    expect(artifact.events.some((event) => event.kind === 'pickup')).toBe(true);
    expect(artifact.summary.entries).toEqual([]);
    expect(artifact.summary.gaps.some((gap) => gap.to.kind === 'new-run')).toBe(false);
  });

  it('censors the abandoned signing under its original campaign, not the loaded one', () => {
    const { log, at } = observer();
    log.note({ kind: 'action', verb: 'begin', act: 'start' });
    log.note({ kind: 'run', campaign: 'short', seed: 4 });
    at(50);
    log.note({ kind: 'action', verb: 'found', act: 'signing', status: 'accepted' });
    at(75);
    log.note({ kind: 'action', verb: 'enter', act: 'signing', status: 'returned' });
    at(100);
    log.note({ kind: 'action', verb: 'load', act: 'start' });
    at(125);
    log.note({ kind: 'run', campaign: 'long', seed: 8 });
    at(150);
    log.chronicle([]);
    at(200);
    log.end('exported');

    expect(log.artifact().summary.entries).toEqual([{
      startedAt: 0, campaign: 'short', foundedAt: 50, enteredAt: 75,
      firstAcceptedCommand: null, wallMs: 150, foregroundMs: 150, censored: true,
    }]);
    // The prior house existed, so a real pickup *does* close its unfinished gap.
    expect(log.artifact().summary.gaps.filter((gap) => gap.to.kind === 'new-run')).toHaveLength(1);
  });

  it('does not rewrite the prior entry when an attempted pickup never confirms', () => {
    const { log, at } = observer();
    log.note({ kind: 'action', verb: 'begin', act: 'start' });
    log.note({ kind: 'run', campaign: 'short', seed: 12 });
    at(20);
    log.note({ kind: 'action', verb: 'found', act: 'signing', status: 'accepted' });
    at(30);
    log.note({ kind: 'action', verb: 'resume', act: 'start' });
    at(40);
    log.note({ kind: 'run', campaign: 'long', seed: 17 });
    // No successful Chronicle pickup. No old-house completion can be inferred.
    at(70);
    log.end('exported');

    expect(log.artifact().summary.entries).toEqual([{
      startedAt: 0, campaign: 'short', foundedAt: 20, enteredAt: null,
      firstAcceptedCommand: null, wallMs: 70, foregroundMs: 70, censored: true,
    }]);
    expect(log.artifact().summary.gaps.some((gap) => gap.to.kind === 'new-run')).toBe(false);
  });

  it('restarts identity normally when a new Begin supersedes a pending pickup', () => {
    const { log, at } = observer();
    log.note({ kind: 'action', verb: 'begin', act: 'start' });
    log.note({ kind: 'run', campaign: 'short', seed: 12 });
    at(20);
    log.note({ kind: 'action', verb: 'found', act: 'signing', status: 'accepted' });
    at(30);
    log.note({ kind: 'action', verb: 'importSave', act: 'start' });
    at(40);
    log.note({ kind: 'run', campaign: 'long', seed: 17 });
    at(50);
    log.note({ kind: 'action', verb: 'begin', act: 'start' });
    at(55);
    log.note({ kind: 'run', campaign: 'demo', seed: 99 });
    at(60);
    log.note({ kind: 'action', verb: 'found', act: 'signing', status: 'accepted' });
    at(70);
    log.note({ kind: 'action', verb: 'enter', act: 'signing', status: 'returned' });
    at(90);
    log.note({ kind: 'action', verb: 'match', act: 'answer', status: 'accepted' });
    at(100);
    log.end('exported');

    expect(log.artifact().summary.entries).toEqual([
      {
        startedAt: 0, campaign: 'short', foundedAt: 20, enteredAt: null,
        firstAcceptedCommand: null, wallMs: 50, foregroundMs: 50, censored: true,
      },
      {
        startedAt: 50, campaign: 'demo', foundedAt: 60, enteredAt: 70,
        firstAcceptedCommand: { at: 90, verb: 'match' },
        wallMs: 40, foregroundMs: 40, censored: false,
      },
    ]);
  });
});
