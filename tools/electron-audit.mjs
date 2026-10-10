import { appendFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

/**
 * The dependency audit is evidence, not a dependency updater. The 2026-10-06
 * baseline in docs/DEPENDENCIES.md contains accepted build-only moderate
 * advisories; fail on any high/critical advisory without treating those
 * historical moderate findings as a failed release.
 */
const SEVERITIES = ['critical', 'high', 'moderate', 'low', 'info'];
const ELECTRON_NAMES = new Set([
  'electron', '@electron/get', '@electron-internal/extract-zip', 'extract-zip',
  'electron-builder', 'app-builder-lib',
]);

export function inspectDependencyAudit(report) {
  if (!report || typeof report !== 'object' || Array.isArray(report)
    || report.error || !report.vulnerabilities
    || typeof report.vulnerabilities !== 'object'
    || Array.isArray(report.vulnerabilities)) {
    throw new Error('npm audit did not return a valid vulnerabilities object');
  }

  const findings = Object.entries(report.vulnerabilities).map(([name, row]) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)
      || !SEVERITIES.includes(row.severity)) {
      throw new Error('npm audit returned invalid severity for ' + name);
    }
    const advisoryIds = Array.isArray(row.via)
      ? row.via.filter((v) => v && typeof v === 'object' && typeof v.url === 'string')
        .map((v) => v.url.split('/').pop()).filter(Boolean)
      : [];
    return { name, severity: row.severity, advisories: [...new Set(advisoryIds)].sort() };
  }).sort((a, b) => a.name.localeCompare(b.name));

  const counts = Object.fromEntries(SEVERITIES.map((severity) =>
    [severity, findings.filter((row) => row.severity === severity).length]));
  const blocking = findings.filter((row) => row.severity === 'critical' || row.severity === 'high');
  const electron = findings.filter((row) => ELECTRON_NAMES.has(row.name));
  return { findings, counts, blocking, electron };
}

function markdown({ counts, blocking, electron, findings }) {
  const lines = [
    '## npm lockfile dependency audit',
    '',
    'Audited the repository lockfile using the current npm advisory database.',
    'The JSON report is retained as a workflow artifact; no dependency was changed.',
    '',
    '| Severity | Packages |',
    '| --- | ---: |',
    ...SEVERITIES.map((level) => '| ' + level + ' | ' + counts[level] + ' |'),
    '',
    '### Electron and packaging dependency findings',
    ...(electron.length
      ? electron.map(({ name, severity, advisories }) =>
        '- ' + name + ': ' + severity + (advisories.length ? ' (' + advisories.join(', ') + ')' : ''))
      : ['- None reported.']),
    '',
    '### High or critical advisories',
    ...(blocking.length
      ? blocking.map(({ name, severity, advisories }) =>
        '- ' + name + ': ' + severity + (advisories.length ? ' (' + advisories.join(', ') + ')' : ''))
      : ['- None reported.']),
    '',
    'Moderate/low/info findings (' + (findings.length - blocking.length)
      + ') need review against docs/DEPENDENCIES.md; they are not automatically dismissed.',
  ];
  return lines.join('\n') + '\n';
}

async function main() {
  const path = process.argv[2];
  if (!path) throw new Error('usage: node tools/electron-audit.mjs <audit.json|->');
  let raw = '';
  if (path === '-') {
    for await (const chunk of process.stdin) raw += chunk.toString();
  } else {
    raw = await readFile(path, 'utf8');
  }
  const result = inspectDependencyAudit(JSON.parse(raw));
  const summary = markdown(result);
  process.stdout.write(summary);
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, summary, 'utf8');
  }
  if (result.blocking.length) {
    throw new Error('npm audit found ' + result.blocking.length + ' high/critical vulnerable package(s)');
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
