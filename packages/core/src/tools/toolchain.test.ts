import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse } from 'yaml';

/**
 * ONE STATEMENT OF THE NODE VERSION, AND EVERYTHING ELSE READS IT.
 *
 * Node was pinned twenty-three times by hand — `node-version: 22` in six
 * workflows — with no `.nvmrc`, no `engines`, and a devcontainer on the Node
 * feature's floating `lts`, which by then meant 24. CI ran 22; the container
 * a contributor opened ran 24; a reproduction (#1932) was reported on 24.19.0.
 * Nothing disagreed out loud, because nothing compared them.
 *
 * `.nvmrc` is the statement now. `actions/setup-node` reads it through
 * `node-version-file`, the game devcontainer's image tag is checked against
 * it, and `engines` must admit it. A contract nothing enforces drifts back to
 * twenty-three copies, so this suite is the enforcement.
 */

const REPO = join(import.meta.dirname, '../../../..');
const read = (rel: string) => readFileSync(join(REPO, rel), 'utf8');

const NVMRC = read('.nvmrc');
const MAJOR = Number(NVMRC.trim());

const { satisfies } = (await import(pathToFileURL(join(REPO, 'tools/doctor.mjs')).href)) as {
  satisfies: (version: string, range: string) => boolean;
};

type Step = { uses?: string; with?: Record<string, unknown> };
type Workflow = { jobs?: Record<string, { steps?: Step[] }> };

const WORKFLOWS = readdirSync(join(REPO, '.github/workflows')).filter((f) => /\.ya?ml$/.test(f));
const uses = (step: Step, action: string) => String(step.uses ?? '').startsWith(`${action}@`);

describe('.nvmrc', () => {
  it('names one major and nothing else', () => {
    expect(NVMRC, '`.nvmrc` should be a bare major such as `22`, which every reader agrees on').toMatch(/^\d+\n?$/);
    expect(MAJOR).toBeGreaterThanOrEqual(22);
  });
});

describe('the workflows', () => {
  it('hard-code no Node version', () => {
    const offenders = WORKFLOWS.flatMap((f) =>
      read(`.github/workflows/${f}`).split('\n')
        .map((line, i) => ({ line, at: `${f}:${i + 1}` }))
        .filter(({ line }) => /^\s*node-version\s*:/.test(line))
        .map(({ at, line }) => `${at}  ${line.trim()}`));
    expect(offenders, 'use `node-version-file: .nvmrc` — a version stated twice is wrong in one place').toEqual([]);
  });

  /**
   * `node-version-file` resolves against the workspace, so the step only
   * means `.nvmrc` if a checkout has put the repository root there first. A
   * checkout into a `path:` subdirectory, or a non-cone sparse checkout that
   * leaves root files out, would hand setup-node a file that is not there.
   */
  it('read .nvmrc in every setup-node step, after a checkout that brings it', () => {
    let seen = 0;
    for (const f of WORKFLOWS) {
      const workflow = parse(read(`.github/workflows/${f}`)) as Workflow;
      for (const [job, { steps = [] }] of Object.entries(workflow.jobs ?? {})) {
        steps.forEach((step, i) => {
          if (!uses(step, 'actions/setup-node')) return;
          seen++;
          const where = `${f} → ${job}, step ${i + 1}`;
          expect(step.with?.['node-version-file'], where).toBe('.nvmrc');
          const checkout = steps.slice(0, i).find((s) => uses(s, 'actions/checkout'));
          expect(checkout, `${where}: no checkout before setup-node, so .nvmrc is not on disk`).toBeDefined();
          expect(checkout?.with?.path, `${where}: checkout into a subdirectory`).toBeUndefined();
          expect(checkout?.with?.['sparse-checkout-cone-mode'], `${where}: a non-cone sparse checkout can omit .nvmrc`)
            .not.toBe(false);
        });
      }
    }
    expect(seen, 'found no setup-node steps, so this passed by checking nothing').toBeGreaterThan(20);
  });
});

/**
 * Every devcontainer configuration, by folder. The CatDesk one is a host for
 * a ChatGPT connector bridge, kept byte-for-byte in behaviour when it moved;
 * it is named here so leaving it out is a decision on the record rather than
 * an omission, and so a third configuration cannot be added without saying
 * which Node it runs.
 */
const CONTAINERS = readdirSync(join(REPO, '.devcontainer'), { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(REPO, '.devcontainer', d.name, 'devcontainer.json')))
  .map((d) => d.name)
  .sort();
const EXEMPT: Record<string, string> = {
  catdesk: 'CatDesk/.NET host moved without behaviour change (#1934); its Node feature still floats on lts',
};

/** The Node major a devcontainer runs, from its image tag or its Node feature. */
function containerNode(text: string): string | null {
  const feature = /"ghcr\.io\/devcontainers\/features\/node:\d+"\s*:\s*\{[^}]*"version"\s*:\s*"([^"]+)"/.exec(text)?.[1];
  if (feature) return feature;
  return /"image"\s*:\s*"[^"]*\/javascript-node:(\d+)[^"]*"/.exec(text)?.[1] ?? null;
}

describe('the devcontainers', () => {
  it('live in named folders, with nothing left at the top level to shadow the picker', () => {
    expect(CONTAINERS).toEqual(['catdesk', 'game']);
    expect(existsSync(join(REPO, '.devcontainer/devcontainer.json'))).toBe(false);
  });

  for (const name of CONTAINERS.filter((n) => !EXEMPT[n])) {
    it(`${name} runs the Node major .nvmrc names`, () => {
      const node = containerNode(read(`.devcontainer/${name}/devcontainer.json`));
      expect(node, `${name}'s devcontainer states no Node version this test can read`).not.toBeNull();
      expect(node, `${name} would run Node ${node} while CI runs ${MAJOR}`).toBe(String(MAJOR));
    });
  }

  it('reads a floating feature version as a version, so it cannot slip through', () => {
    expect(containerNode('"ghcr.io/devcontainers/features/node:1": { "version": "lts" }')).toBe('lts');
    expect(containerNode('"image": "mcr.microsoft.com/devcontainers/javascript-node:22-bookworm"')).toBe('22');
  });

  it('exempts only configurations that exist', () => {
    for (const name of Object.keys(EXEMPT)) expect(CONTAINERS).toContain(name);
  });
});

describe('engines', () => {
  const engines = (JSON.parse(read('package.json')) as { engines?: Record<string, string> }).engines ?? {};

  it('admits the .nvmrc major and nothing past it', () => {
    expect(engines.node, 'root package.json declares no engines.node').toBeDefined();
    expect(satisfies(`${MAJOR}.0.0`, engines.node!)).toBe(true);
    expect(satisfies(`${MAJOR}.99.0`, engines.node!)).toBe(true);
    expect(satisfies(`${MAJOR + 1}.0.0`, engines.node!), 'engines admits a major CI never runs').toBe(false);
    expect(satisfies(`${MAJOR - 1}.99.0`, engines.node!)).toBe(false);
  });

  it('names the npm that major bundles', () => {
    expect(engines.npm).toBeDefined();
    expect(satisfies('10.9.4', engines.npm!)).toBe(true);
  });

  it('is recorded in the lockfile the same way, so npm install has nothing to rewrite', () => {
    const lock = JSON.parse(read('package-lock.json')) as { packages: Record<string, { engines?: unknown }> };
    expect(lock.packages['']?.engines).toEqual(engines);
  });
});
