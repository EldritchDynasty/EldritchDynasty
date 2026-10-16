import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CORE_MESSAGE_VARIANTS_FILE, contentProseEntries, proseOriginalHash, setContentProseText } from '@ed/schema';
import { coreMessageAddress } from '../messages.js';
import { coreMessageEntries } from './core-message-audit.js';
import { pendingPlainEnglishWorklist } from './string-audit-cli.js';
import {
  VOICES, auditContentFile, auditRepository, auditVueFile, contentVoice,
  plainEnglishCoverage, plainEnglishCoverageFor,
  plainEnglishContentWorkItems, plainEnglishCoreWorkItems, plainEnglishWorklist, report,
  literals, sentenceLiterals, unclassifiedContentKeys,
} from './string-audit.js';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '../../../..');

describe('the string-source audit (issue #276)', () => {
  it('tags content by where it lives', () => {
    expect(contentVoice('prologue.yaml')).toBe('prologue');
    expect(contentVoice('clauses.yaml')).toBe('ledger');
    expect(contentVoice('tales.yaml')).toBe('tale');
    expect(contentVoice('endings.yaml')).toBe('frame');
    expect(contentVoice('ages/ages.yaml')).toBe('age');
    expect(contentVoice('events/weather.yaml')).toBe('event');
  });

  it('makes a frame-tier event an interlude wherever it is filed, and counts its slots', () => {
    const rows = auditContentFile('events/somewhere.yaml', [
      'events:',
      '  - id: a_plain_scene',
      '    title: The Plain Scene',
      '    body: "{HEAD} went out to the barn and {KIN} did not."',
      '  - id: frame_a_cut_away',
      '    tier: frame',
      '    title: A Room in 1542',
      '    body: The candle was lower than it had been.',
    ].join('\n'));
    expect(rows.map((r) => [r.voice, r.strings, r.interpolations])).toEqual([
      ['event', 2, 2],
      ['interlude', 2, 0],
    ]);
  });

  it('counts no id, and no designer note the player never sees', () => {
    const rows = auditContentFile('characters/founding.yaml', [
      'characters:',
      '  - id: daveed_gearithy',
      ['    name: Dav', 'eed Gearithy'].join(''),
      '    note: The first head. Never shown to anybody at all.',
    ].join('\n'));
    expect(rows).toEqual([expect.objectContaining({ voice: 'event', strings: 1, words: 2 })]);
  });

  it('gives prose stable semantic work-item addresses instead of wording identity', () => {
    const authored = [
      'events:',
      '  - id: a_scene',
      '    title: The Same Words',
      '    body: "{HEAD} heard the same words and {KIN} answered."',
      '    interaction:',
      '      choices:',
      '        - id: take_it',
      '          label: Take the same words',
      '          outcomes:',
      '            - id: accepted',
      '              text: The same words appear here',
      '  - id: another_scene',
      '    title: The Same Words',
      '    body: The same words appear here',
    ].join('\n');
    const reworded = authored
      .replace('The same words appear here', 'Different language appears here')
      .replace('Take the same words', 'Choose the offered answer');

    const before = plainEnglishContentWorkItems('events/example.yaml', authored);
    const after = plainEnglishContentWorkItems('events/example.yaml', reworded);

    expect(before.map((x) => x.address)).toEqual(after.map((x) => x.address));
    expect(new Set(before.map((x) => x.address)).size).toBe(before.length);
    expect(before.find((x) => x.address.endsWith('events[id=a_scene].body'))?.interpolations)
      .toEqual(['{HEAD}', '{KIN}']);
    expect(before.find((x) => x.text === 'The same words appear here')?.address)
      .toContain('outcomes[id=accepted].text');
    expect(before.filter((x) => x.text === 'The Same Words').map((x) => x.address)).toEqual([
      'content:events/example.yaml#events[id=a_scene].title',
      'content:events/example.yaml#events[id=another_scene].title',
    ]);
  });

  it('uses the same structural path to edit Original without changing its stable address', () => {
    const document = {
      events: [{
        id: 'a_scene',
        title: 'The Original Title',
        body: 'The house opens the old book and reads it.',
      }],
    };
    const before = contentProseEntries('events/example.yaml', document);
    const title = before.find((entry) => entry.address.endsWith('.title'))!;

    expect(setContentProseText(document, title.path, 'A Clearer Original Title')).toBe(true);
    const after = contentProseEntries('events/example.yaml', document);

    expect(document.events[0]!.title).toBe('A Clearer Original Title');
    expect(after.map((entry) => entry.address)).toEqual(before.map((entry) => entry.address));
  });

  it('uses a founding character key rather than its array position', () => {
    const items = plainEnglishContentWorkItems('characters/founding.yaml', [
      'characters:',
      '  - key: founder',
      ['    name: Dav', 'eed Gearithy'].join(''),
      '  - key: wife',
      '    name: Eilwen Gearithy',
    ].join('\n'));
    expect(items.map((x) => x.address)).toEqual([
      'content:characters/founding.yaml#characters[key=founder].name',
      'content:characters/founding.yaml#characters[key=wife].name',
    ]);
  });

  it('does not treat quoted braces as interpolation boundaries (#1757)', () => {
    const examples = [
      ["const line = \`The clerk said ${mark === '}' ? 'yes' : 'no'} before dawn.\`;",
        "${mark === '}' ? 'yes' : 'no'}"],
      ["const line = \`The clerk said ${mark === '{' ? 'yes' : 'no'} before dawn.\`;",
        "${mark === '{' ? 'yes' : 'no'}"],
      ["const line = \`The clerk said ${mark === '\\'}' ? 'yes' : 'no'} before dawn.\`;",
        "${mark === '\\'}' ? 'yes' : 'no'}"],
    ] as const;
    for (const [source, token] of examples) {
      const found = literals(source);
      expect(found).toHaveLength(1);
      expect(found[0]!.interpolations).toEqual([token]);
      expect(found[0]!.sourceText).toBe(`The clerk said ${token} before dawn.`);
      const worklist = plainEnglishCoreWorkItems('year/example.ts', source);
      expect(worklist).toHaveLength(1);
      expect(worklist[0]!.text).toBe(`The clerk said ${token} before dawn.`);
      expect(worklist[0]!.interpolations).toEqual([token]);
    }
  });

  it('gives generated narrative prose a wording-independent source ordinal and keeps template tokens', () => {
    const before = plainEnglishCoreWorkItems('year/example.ts', [
      "const first = 'The house paid and the clerk looked away.';",
      "const second = `\${name} was born, and \${guardian.name} named the child.`;",
    ].join('\n'));
    const after = plainEnglishCoreWorkItems('year/example.ts', [
      "const first = 'The family paid and the clerk said nothing.';",
      "const second = `\${name} arrived, and \${guardian.name} gave the child a name.`;",
    ].join('\n'));
    expect(before.map((x) => x.address)).toEqual(after.map((x) => x.address));
    expect(before.map((x) => x.address)).toEqual([
      'core:year/example.ts#literal[1]',
      'core:year/example.ts#literal[2]',
    ]);
    expect(before[1]).toMatchObject({
      text: '${name} was born, and ${guardian.name} named the child.',
      interpolations: ['${name}', '${guardian.name}'],
    });
  });

  it('does not renumber later core work items when earlier wording stops qualifying as prose', () => {
    const before = plainEnglishCoreWorkItems('year/example.ts', [
      "const first = 'The house remembers this sentence.';",
      "const second = 'The second sentence keeps its identity.';",
    ].join('\n'));
    const after = plainEnglishCoreWorkItems('year/example.ts', [
      "const first = 'Gone now';",
      "const second = 'The second sentence keeps its identity.';",
    ].join('\n'));

    expect(before.map((x) => x.address)).toEqual([
      'core:year/example.ts#literal[1]',
      'core:year/example.ts#literal[2]',
    ]);
    expect(after).toHaveLength(1);
    expect(after[0]?.address).toBe('core:year/example.ts#literal[2]');
    expect(after[0]?.address).toBe(before[1]?.address);
  });

  it('keeps explicit core message identities through insertions, file moves and escaped wording', () => {
    const source = [
      "// msg(ctx, 'ignored.comment', 'Do not inventory this comment.');",
      "msg(ctx, 'adviser.test.name', 'The seal\\'s holder is {NAME}.', { NAME: person.name });",
      "msg(ctx, 'adviser.test.short', 'Read {NAME}.', { NAME: person.name });",
      "const legacy = 'An unmigrated sentence still needs a counterpart.';",
    ].join('\n');
    const before = plainEnglishCoreWorkItems('advisers.ts', source);
    const after = plainEnglishCoreWorkItems('moved/advisers.ts', `const extra = 'A new unrelated sentence.';\n${source}`);
    const keyed = before.filter((item) => item.address.startsWith('core:messages#'));
    expect(keyed).toEqual([
      { source: 'core', file: 'advisers.ts', voice: 'adviser', address: coreMessageAddress('adviser.test.name'),
        text: "The seal's holder is {NAME}.", words: 5, interpolations: ['{NAME}'] },
      { source: 'core', file: 'advisers.ts', voice: 'adviser', address: coreMessageAddress('adviser.test.short'),
        text: 'Read {NAME}.', words: 2, interpolations: ['{NAME}'] },
    ]);
    expect(before).toHaveLength(3);
    expect(after.filter((item) => item.address.startsWith('core:messages#'))).toEqual(
      keyed.map((item) => ({ ...item, file: 'moved/advisers.ts' })),
    );
  });

  it('omits Match drift-check Originals only when case, msg key and wording agree (#1714)', () => {
    const source = [
      'function matchFutureMessage(ctx: any, key: string, original: string) {',
      '  switch (key) {',
      "    case 'match.future.reason.matched':",
      "      return checked('The family papers preserve this choice.', msg(ctx, 'match.future.reason.matched', 'The family papers preserve this choice.'));",
      "    case 'match.future.reason.drifted':",
      "      return checked('The house spoke these older words.', msg(ctx, 'match.future.reason.drifted', 'The house spoke these newer words.'));",
      "    case 'match.future.reason.other':",
      "      return checked('The family read the first version.', msg(ctx, 'match.future.reason.wrong', 'The family read the first version.'));",
      '  }',
      '}',
      "const genuine = 'The family wrote a separate page.';",
      "checked('A real standalone notice to keep.', msg(ctx, 'other.standalone', 'A real standalone notice to keep.'));",
    ].join('\n');
    const rows = plainEnglishCoreWorkItems('session.ts', source);
    const legacy = rows.filter((row) => row.address.includes('#literal['));
    expect(legacy.map((row) => row.text)).toEqual([
      'The house spoke these older words.',
      'The family read the first version.',
      'The family wrote a separate page.',
      'A real standalone notice to keep.',
    ]);
    expect(rows.filter((row) => row.address.startsWith('core:messages#'))).toHaveLength(4);
    // The original literal positions are retained even though one disappeared.
    const unrelated = plainEnglishCoreWorkItems('other.ts', source)
      .find((row) => row.text === 'The family wrote a separate page.');
    expect(legacy.find((row) => row.text === unrelated?.text)?.address.split('#')[1])
      .toBe(unrelated?.address.split('#')[1]);
  });

  it('omits only ambition catalogue fields with a matching keyed view counterpart (#1714)', () => {
    const source = [
      'const HOUSE_AMBITIONS = [',
      "  { id: 'deepen_blood', name: 'Deepen the blood', purpose: 'Keep a broad living bloodline safe.' },",
      "  { id: 'secure_branches', name: 'Secure the branches', purpose: 'Keep the whole house alive.' },",
      '];',
      'function ambitionProse(ctx: any) {',
      "  msg(ctx, 'ambition.name.deepen_blood', 'Deepen the blood');",
      "  msg(ctx, 'ambition.purpose.deepen_blood', 'Keep a broad living bloodline safe.');",
      "  msg(ctx, 'ambition.name.secure_branches', 'Secure the branches');",
      "  msg(ctx, 'ambition.purpose.secure_branches', 'The branches have a different purpose.');",
      '}',
      "const genuine = 'The family asked an entirely separate question.';",
    ].join('\n');
    const rows = plainEnglishCoreWorkItems('ambition.ts', source);
    expect(rows.filter((row) => row.address.includes('#literal[')).map((row) => row.text))
      .toEqual(['Keep the whole house alive.', 'The family asked an entirely separate question.']);
    expect(rows.filter((row) => row.address.startsWith('core:messages#'))).toHaveLength(4);
    // Similar-looking files must not gain a broad suppression rule.
    expect(plainEnglishCoreWorkItems('another.ts', source)
      .filter((row) => row.address.includes('#literal['))).toHaveLength(5);
  });

  it('does not inventory production Match verification or translated ambition catalogue twice (#1714)', () => {
    const session = readFileSync(join(REPO, 'packages/core/src/session.ts'), 'utf8');
    const match = plainEnglishCoreWorkItems('session.ts', session);
    expect(match).toContainEqual(expect.objectContaining({
      address: coreMessageAddress('match.future.reason.blood.close-kin'),
      text: 'the family papers put this match among close kin',
    }));
    expect(match.some((row) => row.address.includes('#literal[')
      && row.text === 'the family papers put this match among close kin')).toBe(false);

    const ambition = readFileSync(join(REPO, 'packages/core/src/ambition.ts'), 'utf8');
    const rows = plainEnglishCoreWorkItems('ambition.ts', ambition);
    expect(rows).toContainEqual(expect.objectContaining({
      address: coreMessageAddress('ambition.purpose.deepen_blood'),
      text: 'Keep a broad living bloodline from thinning away.',
    }));
    expect(rows.some((row) => row.address.includes('#literal[')
      && row.text === 'Keep a broad living bloodline from thinning away.')).toBe(false);
  });

  it('classifies only achievement calibration fields, keeping display copy and neighboring contexts (#1774)', () => {
    const source = [
      'const ACHIEVEMENT_CATALOG = { example: {',
      "  title: 'The Last Page', description: 'Finish the whole campaign.',",
      "  calibration: 'Calibration evidence for the launch.',",
      "  other: 'Keep this neighboring player text.',",
      "  nested: { calibration: 'Keep this nested player text.' },",
      '} } as const satisfies Catalogue;',
      "const another = { example: { calibration: 'Keep this other catalogue text.' } };",
      "const ACHIEVEMENT_CATALOGUE = { example: { calibration: 'Keep this similarly named text.' } };",
      'const ACHIEVEMENT_COPY = { example: {',
      "  title: defineMessage('achievement.example.title', 'New display title'),",
      "  calibration: 'Calibration evidence for the static catalogue.',",
      '} };',
    ].join('\n');
    const all = plainEnglishCoreWorkItems('other.ts', source);
    const found = plainEnglishCoreWorkItems('achievements.ts', source);
    expect(found).toEqual(all.filter((row) => !row.text.startsWith('Calibration'))
      .map((row) => ({ ...row, file: 'achievements.ts', address: row.address.replace('other.ts', 'achievements.ts') })));
  });

  it('inventories static catalogue definitions and inline messages under their explicit keys (#1779)', () => {
    const source = [
      "const title = defineMessage('achievement.example.title', 'Done');",
      "const description = defineMessage('achievement.example.description', 'Finish the whole campaign.');",
      "msg(ctx, 'example.inline', 'A separate inline message.');",
      "otherMessage('unknown.key', 'Keep this neighboring prose.');",
    ].join('\n');
    const rows = plainEnglishCoreWorkItems('achievements.ts', source);
    expect(rows).toContainEqual(expect.objectContaining({
      address: coreMessageAddress('achievement.example.title'), text: 'Done',
    }));
    expect(rows).toContainEqual(expect.objectContaining({
      address: coreMessageAddress('achievement.example.description'), text: 'Finish the whole campaign.',
    }));
    expect(rows).toContainEqual(expect.objectContaining({
      address: coreMessageAddress('example.inline'), text: 'A separate inline message.',
    }));
    expect(rows.filter((row) => row.address.includes('#literal[')).map((row) => row.text))
      .toEqual(['Keep this neighboring prose.']);
  });

  it('rejects dynamic catalogue identities and collisions with inline messages (#1779)', () => {
    for (const source of [
      "defineMessage(key, 'A fixed Original.');",
      "defineMessage('fixed.key', original);",
    ]) expect(() => coreMessageEntries(source)).toThrow(/literal key.*Original/);
    expect(() => coreMessageEntries([
      "defineMessage('same.key', 'A fixed Original.');",
      "msg(ctx, 'same.key', 'A second Original.');",
    ].join('\n'))).toThrow('Duplicate core message key: same.key');
  });

  it('classifies Match renderer templates only in the verified scorer, preserving keyed and unknown calls (#1774)', () => {
    const source = [
      'function matchFuture() {',
      "  reason('blood.example', 'Compatibility evidence from the scorer.');",
      "  renderText('match.future.confidence.mixed', 'Compatibility qualifier from the scorer.');",
      "  reason('blood.callback', () => 'Keep this callback player text.');",
      "  reason('blood.unknown', writePage('Keep this unknown call text.'));",
      "  reason('blood.keyed', msg(ctx, 'match.visible', 'Keep this keyed player text.'));",
      "  other('unknown', 'Keep this other call text.');",
      "  const visible = 'Keep this neighboring player text.';",
      '}',
      "function otherReader() { reason('blood.example', 'Keep this other function text.'); }",
    ].join('\n');
    for (const file of ['people/match.ts', 'people\\match.ts']) {
      const all = plainEnglishCoreWorkItems(file, source.replace('function matchFuture()', 'function otherScorer()'));
      const found = plainEnglishCoreWorkItems(file, source);
      expect(found).toEqual(all.filter((row) => !row.text.startsWith('Compatibility')));
    }
    expect(plainEnglishCoreWorkItems('other.ts', source)).toHaveLength(8);
  });

  it('keeps every production scorer Original backed by the checked keyed renderer (#1774)', () => {
    const source = readFileSync(join(REPO, 'packages/core/src/people/match.ts'), 'utf8');
    const all = plainEnglishCoreWorkItems('other.ts', source);
    const found = plainEnglishCoreWorkItems('people/match.ts', source);
    const retained = new Set(found.map((row) => row.text));
    const removed = all.filter((row) => !retained.has(row.text));
    const session = plainEnglishCoreWorkItems('session.ts', readFileSync(join(REPO, 'packages/core/src/session.ts'), 'utf8'));
    const originals = new Set(session.filter((row) => row.address.startsWith('core:messages#match.future.')).map((row) => row.text));
    expect(removed).toHaveLength(20);
    for (const row of removed) {
      if (row.text === 'these years make ${lower} unusually important') {
        for (const kind of ['blood', 'standing', 'continuity', 'mystery']) {
          expect(originals.has(`these years make ${kind} unusually important`)).toBe(true);
        }
      } else expect(originals.has(row.text), row.text).toBe(true);
    }
  });

  it('keeps official campaign names classified only in the reviewed catalogue fields (#1774)', () => {
    const source = [
      "const CAMPAIGNS = { short: { name: 'A Short Line' }, long: { name: 'A Long Line' },",
      "  future: { name: 'A Future Line' }, changed: { name: 'A Changed Line' } };",
      "const other = { short: { name: 'A Short Line' } };",
      "msg(ctx, 'campaign.visible', 'A Long Line');",
    ].join('\n');
    const found = plainEnglishCoreWorkItems('campaign.ts', source);
    expect(found.map((row) => row.text)).toEqual(['A Future Line', 'A Changed Line', 'A Short Line', 'A Long Line']);
    expect(plainEnglishCoreWorkItems('other.ts', source)).toHaveLength(6);
    expect(plainEnglishCoreWorkItems('campaign.ts', source.replace("name: 'A Short Line'", "name: 'The Short Campaign'")))
      .toContainEqual(expect.objectContaining({ text: 'The Short Campaign' }));
  });

  it('classifies reviewed proper-name formats without dropping narrative, keyed text or unrelated helpers (#1774)', () => {
    const cases = [
      ['people/names.ts', 'uniqueName', '`${base} the ${ordinalSuffix(n)}`'],
      ['people/names.ts', 'uniqueName', '`${stem} the ${ordinalSuffix(n)}`'],
      ['people/minting.ts', 'rollRecipe', '`${name} of ${place}`'],
      ['events/slots.ts', 'nameList', "`${names.slice(0, -1).join(', ')} and ${names[names.length - 1]!}`"],
    ];
    for (const [file, owner, template] of cases) {
      const source = [
        `function ${owner}() { return ${template}; }`,
        `function otherReader() { return ${template}; }`,
        "const narrative = 'The family kept its old names.';",
        "msg(ctx, 'names.visible', 'The family kept its old names.');",
      ].join('\n');
      const all = plainEnglishCoreWorkItems(file!, source.replace(`function ${owner}()`, 'function otherOwner()'));
      const found = plainEnglishCoreWorkItems(file!, source);
      expect(found).toEqual(all.slice(1));
      expect(plainEnglishCoreWorkItems(file!.replaceAll('/', '\\'), source).map((row) => row.text))
        .toEqual(found.map((row) => row.text));
      expect(plainEnglishCoreWorkItems('other.ts', source)).toHaveLength(all.length);
    }
    const source = [
      'function currentGrudges() {',
      ' const holder = (modeCtx) => !from ? houseName(modeCtx, rel.from)',
      '   : from === outsider ? `${from.name} of ${houseName(modeCtx, house)}` : from.name;',
      ' const target = (modeCtx) => !to ? houseName(modeCtx, rel.to)',
      '   : to === outsider ? `${to.name} of ${houseName(modeCtx, house)}` : to.name;',
      " const prose = 'The creditor remembered that name.';",
      '}',
      'function anotherReader() { return `${from.name} of ${houseName(modeCtx, house)}`; }',
    ].join('\n');
    const all = plainEnglishCoreWorkItems('relationship-threads.ts', source.replace('function currentGrudges()', 'function otherReader()'));
    expect(plainEnglishCoreWorkItems('relationship-threads.ts', source)).toEqual(all.slice(2));
  });

  it('classifies only unused stored lineage claims at their two document-writing boundaries (#1774)', () => {
    const cases = [
      ['people/papers.ts', [
        'function filePedigree() {',
        " const doc: LineageDocument = { claims: 'Stored document coverage and seals.', other: 'Keep this nearby player prose.' };",
        " const other: OtherDocument = { claims: 'Keep this other document prose.' };",
        " const nested: LineageDocument = { claims: writePage('Keep this unknown call prose.') };",
        " const callback: LineageDocument = { claims: () => 'Keep this callback prose.' };",
        '}',
      ].join('\n')],
      ['events/effects.ts', [
        'function applyEffect() {',
        " p.lineageDocuments.push({ claims: 'Stored document ancestry and coverage.', other: 'Keep this nearby player prose.' });",
        " p.otherDocuments.push({ claims: 'Keep this other document prose.' });",
        " p.lineageDocuments.push({ claims: msg(ctx, 'paper.visible', 'Keep this keyed player prose.') });",
        '}',
      ].join('\n')],
    ];
    for (const [file, source] of cases) {
      const all = plainEnglishCoreWorkItems('other.ts', source!);
      const found = plainEnglishCoreWorkItems(file!, source!);
      expect(found.map((row) => row.text)).toEqual(all.filter((row) => !row.text.startsWith('Stored')).map((row) => row.text));
      expect(plainEnglishCoreWorkItems(file!.replace('/', '\\'), source!).map((row) => row.text))
        .toEqual(found.map((row) => row.text));
    }
  });

  it('rejects duplicate keys and dynamic identities or Originals before they can masquerade as stable messages', () => {
    expect(() => plainEnglishCoreWorkItems('advisers.ts', [
      "msg(ctx, 'adviser.duplicate', 'First message.');",
      "msg(ctx, 'adviser.duplicate', 'Second message.');",
    ].join('\n'))).toThrow('Duplicate core message key');
    expect(() => plainEnglishCoreWorkItems('advisers.ts', "msg(ctx, key, 'An unstable identity.');"))
      .toThrow('literal key');
    expect(() => plainEnglishCoreWorkItems('advisers.ts', "msg(ctx, 'adviser.dynamic', `Hello ${name}.`);"))
      .toThrow('uninterpolated Original');
  });

  it('fingerprints keyed core Originals for actionable missing, stale and invalid coverage', () => {
    const items = plainEnglishCoreWorkItems('advisers.ts', "msg(ctx, 'adviser.test', 'A name for {NAME}.');");
    const item = items[0]!;
    const of = proseOriginalHash(item.text);
    const variant = { address: item.address, of, plainenglish: 'This is {NAME}.' };
    expect(plainEnglishCoverageFor(items, [variant])).toMatchObject({ current: 1, missing: 0, stale: 0, invalid: 0 });
    expect(plainEnglishCoverageFor(items, [])).toMatchObject({ missing: 1, remaining: [{ expectedOf: of }] });
    expect(plainEnglishCoverageFor([{ ...item, text: 'Another name for {NAME}.' }], [variant]))
      .toMatchObject({ current: 0, stale: 1 });
    expect(plainEnglishCoverageFor(items, [{ ...variant, plainenglish: 'This is somebody.' }]))
      .toMatchObject({ invalid: 1 });
  });

  it('credits keyed core counterparts but never legacy literal addresses in the pending worklist (#1019)', () => {
    const items = plainEnglishCoreWorkItems('example.ts', [
      "msg(ctx, 'audit.pending', 'The archivist saw {NAME} return.');",
      "const legacy = 'A sentence that still lacks a runtime key.';",
    ].join('\n'));
    const keyed = items.find((item) => item.address === coreMessageAddress('audit.pending'))!;
    const legacy = items.find((item) => item.address.includes('#literal['))!;
    const reviewed = {
      address: keyed.address, of: proseOriginalHash(keyed.text),
      plainenglish: 'The archivist watched {NAME} come back.',
    };
    // A fabricated legacy row must not get credit: there is no runtime lookup.
    const fakeLegacy = {
      address: legacy.address, of: proseOriginalHash(legacy.text),
      plainenglish: 'This sentence still has no message key.',
    };
    expect(plainEnglishCoverageFor(items, [reviewed, fakeLegacy])).toMatchObject({
      current: 1, missing: 1, remaining: [{ address: legacy.address, status: 'missing' }],
    });
    const current = pendingPlainEnglishWorklist(items, [reviewed, fakeLegacy]);
    expect(current.map((row) => [row.address, row.variantStatus])).toEqual([
      [legacy.address, 'missing'],
    ]);
    expect(pendingPlainEnglishWorklist(items, [fakeLegacy]).find((row) => row.address === keyed.address))
      .toMatchObject({ variantStatus: 'missing', expectedOf: reviewed.of });
    expect(pendingPlainEnglishWorklist(items, [{ ...reviewed, of: '0000000000000000' }])
      .find((row) => row.address === keyed.address))
      .toMatchObject({ variantStatus: 'stale', expectedOf: reviewed.of, authoredOf: '0000000000000000' });
  });

  it('finds sentences in code, and not comments, imports or developer messages', () => {
    const found = sentenceLiterals([
      "import { x } from './a module with spaces.js';",
      '// a comment that reads like a sentence here',
      "/* and 'a quoted one' in a block comment too */",
      "throw new Error('this is for a developer only');",
      "const id = 'not_a_sentence';",
      "const line = `${name} was born, and named.`;",
      "const other = 'The house paid, and did not say why.';",
    ].join('\n'));
    expect(found).toEqual(['X was born, and named.', 'The house paid, and did not say why.']);
  });

  it('excludes multiline console arguments without renumbering neighbouring narrative (#1443)', () => {
    const source = [
      "const before = 'The house kept its book.';",
      'console.log(',
      '  reportHeading.padEnd(80),',
      "  'This diagnostic has no player consumer.',",
      "  ready ? 'The diagnostic batch is ready.' : 'The diagnostic batch is incomplete.',",
      ');',
      "const after = 'The house read its book.';",
    ].join('\n');
    const all = plainEnglishCoreWorkItems('example.ts', source.replace('console.log', 'showPlayerNotice'));
    const found = plainEnglishCoreWorkItems('example.ts', source);
    expect(found).toEqual(all.filter((row) => row.text.startsWith('The house')));
    expect(found.map((row) => row.address)).toEqual([
      'core:example.ts#literal[1]', 'core:example.ts#literal[5]',
    ]);
  });

  it('excludes only phase metadata, retaining other why fields and phase-run prose (#1443)', () => {
    const source = [
      "const narrative = { why: 'The house refused the creditor.' };",
      'export const YEAR_PHASES = [',
      '  {',
      "    why: 'This explanation concerns internal ordering. ' + 'It is not a chronicle page.',",
      '    run() {',
      "      const notice = { why: 'The creditor came for the book.' };",
      '    },',
      '  },',
      "  { 'why': 'Another internal ordering explanation.' },",
      '] as const;',
      "const tail = 'The book stayed in the house.';",
    ].join('\n');
    const all = plainEnglishCoreWorkItems('year/phases.ts', source.replace('YEAR_PHASES', 'PLAYER_NOTICES'));
    const found = plainEnglishCoreWorkItems('year/phases.ts', source);
    expect(found).toEqual(all.filter((row) => [
      'The house refused the creditor.', 'The creditor came for the book.', 'The book stayed in the house.',
    ].includes(row.text)));
    expect(plainEnglishCoreWorkItems('year\\phases.ts', source)).toEqual(found.map((row) => ({
      ...row, file: 'year\\phases.ts', address: row.address.replace('year/phases.ts', 'year\\phases.ts'),
    })));
    // A similarly named field/constant elsewhere has not been classified as
    // developer-only: never discard it based on the word "why" alone.
    expect(plainEnglishCoreWorkItems('story.ts', source)).toHaveLength(all.length);
  });

  it('keeps keyed messages, unknown nested calls and callback prose inside diagnostics (#1443)', () => {
    const source = [
      "console.log(msg(ctx, 'audit.visible', 'The house kept the signed page.'));",
      "console.log(writeChronicle('The creditor seized the signed page.'));",
      "console.log(() => { return 'The creditor read the signed page.'; });",
      "const line = 'Another page for the player.';",
    ].join('\n');
    expect(plainEnglishCoreWorkItems('example.ts', source).map((row) => [row.address, row.text])).toEqual([
      [coreMessageAddress('audit.visible'), 'The house kept the signed page.'],
      ['core:example.ts#literal[3]', 'The creditor seized the signed page.'],
      ['core:example.ts#literal[4]', 'The creditor read the signed page.'],
      ['core:example.ts#literal[5]', 'Another page for the player.'],
    ]);
  });

  it('classifies only directly returned witness failure reasons in the verified helper context (#1765)', () => {
    for (const name of ['executeOutcomeWitness', 'executeFrameOutcomeWitness']) {
      const source = [
        `export function ${name}() {`,
        "  const notice = 'The creditor has read the page.';",
        "  const unused = { ok: false, reason: 'The house keeps this private page.' };",
        "  const callback = () => { return { ok: false, reason: 'The creditor keeps the signed page.' }; };",
        "  if (a) return { ok: false, reason: 'The witness cannot fill this slot.' };",
        "  if (b) return { ok: false, reason: available ?? `The witness has no choice ${id}.` };",
        "  if (c) return { ok: true, reason: 'The family has completed this page.' };",
        "  if (d) return { ok: false, reason: writeChronicle('The family paid the creditor.') };",
        "  return { ok: false, reason: msg(ctx, 'witness.visible', 'The family read the signed page.') };",
        '}',
        "function anotherHelper() { return { ok: false, reason: 'The family burned the signed page.' }; }",
      ].join('\n');
      const all = plainEnglishCoreWorkItems('events/reach.ts', source.replace(name, 'playerOutcome'));
      const found = plainEnglishCoreWorkItems('events/reach.ts', source);
      expect(found).toEqual(all.filter((row) => !row.text.startsWith('The witness')));
      expect(found.some((row) => row.address === coreMessageAddress('witness.visible'))).toBe(true);
      expect(plainEnglishCoreWorkItems('events\\reach.ts', source)).toEqual(found.map((row) => ({
        ...row, file: 'events\\reach.ts', address: row.address.replace('events/reach.ts', 'events\\reach.ts'),
      })));
      expect(plainEnglishCoreWorkItems('story.ts', source)).toHaveLength(all.length);
    }
  });

  it('classifies the verified CLI report accumulator while preserving other prose and ordinals (#1765)', () => {
    const source = [
      'export function renderAchievementRates() {',
      "  const before = 'The family kept the signed page.';",
      "  const out = ['Achievement diagnostic report heading.', ...(ready ? ['The diagnostic batch is ready.'] : [])];",
      "  out.push(`The diagnostic sample contains ${runs} runs.`);",
      "  out.push(writeChronicle('The creditor took the signed page.'));",
      "  out.push(() => 'The creditor read the signed page.');",
      "  out.push(msg(ctx, 'report.visible', 'The family read the signed page.'));",
      "  return out.join('\\n');",
      '}',
      "function playerReport() { const out = ['The family lost the signed page.']; out.push('The house rewrote the old page.'); }",
    ].join('\n');
    const all = plainEnglishCoreWorkItems('achievement-rates.ts', source.replace('renderAchievementRates', 'playerRates'));
    const found = plainEnglishCoreWorkItems('achievement-rates.ts', source);
    expect(found).toEqual(all.filter((row) => !row.text.includes('diagnostic')));
    expect(found.some((row) => row.address === coreMessageAddress('report.visible'))).toBe(true);
    expect(plainEnglishCoreWorkItems('another-report.ts', source)).toHaveLength(all.length);
  });

  it('keeps Ascension player text while classifying exact predicate contracts (#1769)', () => {
    const source = [
      "function powerShortfall() { return `Diagnostic power ${power} below ${need}.`; }",
      "function bookShortfall() { return 'Diagnostic books are missing.'; }",
      "function affinityShortfall() { return 'Diagnostic arts are missing.'; }",
      "function standingOf() { return { blocked: 'Diagnostic expression is missing.', text: 'The blood does not answer him.' }; }",
      "const other = { blocked: 'The creditor has closed the gate.' };",
      'function gateFor() {',
      "  gateBlocker('power', 'power', 'Diagnostic exact predicate failed.', 'The family needs stronger blood.', 'Seek a different Match.');",
      "  respectBlocker(ctx, 'Diagnostic respect predicate failed.', target);",
      "  costBlocker(ctx, 'Diagnostic cost predicate failed.', target);",
      "  overborneBlocker(ctx, 'Diagnostic mind predicate failed.');",
      "  gateBlocker('power', 'power', writeChronicle('The family opened its book.'), text, hint);",
      "  gateBlocker('power', 'power', () => 'The creditor opened the book.', text, hint);",
      "  gateBlocker('power', 'power', msg(ctx, 'diagnosis.visible', 'The family paid its debt.'), text, hint);",
      '}',
    ].join('\n');
    const all = plainEnglishCoreWorkItems('ascension.ts', source.replace(
      /\b(?:powerShortfall|bookShortfall|affinityShortfall|standingOf|gateBlocker|respectBlocker|costBlocker|overborneBlocker)\b/g,
      'otherFunction',
    ));
    const found = plainEnglishCoreWorkItems('ascension.ts', source);
    expect(found).toEqual(all.filter((row) => !row.text.startsWith('Diagnostic')));
    expect(plainEnglishCoreWorkItems('story.ts', source)).toHaveLength(all.length);
  });

  it('classifies only replay mismatch arguments and direct report returns (#1769)', () => {
    const source = [
      "function replay() { throw new ReplayMismatchError('Diagnostic replay inputs differ.'); }",
      'function describeDecision() {',
      "  if (a) return `Diagnostic decision ${id} was recorded.`;",
      "  if (b) return writeChronicle('The family recorded its answer.');",
      "  if (c) return () => 'The creditor recorded the answer.';",
      "  return msg(ctx, 'replay.visible', 'The family kept its answer.');",
      '}',
      "const other = new ReplayMismatchError('The family refused its answer.');",
      "function anotherReport() { return 'The creditor took the answer.'; }",
    ].join('\n');
    const all = plainEnglishCoreWorkItems('replay.ts', source
      .replace('function replay()', 'function otherReplay()')
      .replace('function describeDecision()', 'function otherDescribeDecision()'));
    const found = plainEnglishCoreWorkItems('replay.ts', source);
    expect(found).toEqual(all.filter((row) => !row.text.startsWith('Diagnostic')));
    expect(plainEnglishCoreWorkItems('story.ts', source)).toHaveLength(all.length);
  });

  it('classifies only loadGame format diagnostics, preserving other exception and player text (#1769)', () => {
    const source = [
      'function loadGame() {',
      "  if (a) throw new SaveFormatError(`Diagnostic unreadable save ${format}.`);",
      "  if (b) throw new SaveFormatError(writeChronicle('The family saved the page.'));",
      "  if (c) throw new SaveFormatError(() => 'The creditor saved the page.');",
      "  throw new SaveFormatError(msg(ctx, 'save.visible', 'The family kept the page.'));",
      '}',
      "const other = new SaveFormatError('The family refused the page.');",
    ].join('\n');
    const all = plainEnglishCoreWorkItems('save.ts', source.replace('function loadGame()', 'function playerNotice()'));
    const found = plainEnglishCoreWorkItems('save.ts', source);
    expect(found).toEqual(all.filter((row) => !row.text.startsWith('Diagnostic')));
    expect(plainEnglishCoreWorkItems('story.ts', source)).toHaveLength(all.length);
  });

  it('classifies only verified content-index error-context arguments, on either path separator (#1769)', () => {
    for (const [file, method] of [['events/arcs.ts', 'mustArc'], ['year/phases.ts', 'mustEvent']] as const) {
      const source = [
        `ctx.content.${method}('The first argument stays.', 'Diagnostic missing content context.');`,
        `other.content.${method}('another_id', 'The family preserved this page.');`,
        `ctx.content.${method}('an_id', writeChronicle('The family signed this page.'));`,
        `ctx.content.${method}('an_id', () => 'The creditor read this page.');`,
        `ctx.content.${method}('an_id', msg(ctx, 'content.visible', 'The family read this page.'));`,
      ].join('\n');
      const all = plainEnglishCoreWorkItems(file, source.replaceAll('ctx.content.', 'unknown.content.'));
      const found = plainEnglishCoreWorkItems(file, source);
      expect(found).toEqual(all.filter((row) => !row.text.startsWith('Diagnostic')));
      expect(plainEnglishCoreWorkItems(file.replace('/', '\\'), source)).toEqual(found.map((row) => ({
        ...row, file: file.replace('/', '\\'), address: row.address.replace(file, file.replace('/', '\\')),
      })));
      expect(plainEnglishCoreWorkItems('story.ts', source)).toHaveLength(all.length);
    }
  });

  it('classifies the hollow-year lookup identity only when its mechanical reader is present (#1769)', () => {
    const definition = "const HOLLOW_YEAR = 'the hollow year';";
    const source = [
      definition,
      'function isHollowYearHomozygote() { return load.names.includes(HOLLOW_YEAR); }',
      "const visible = 'the hollow year';",
      "msg(ctx, 'hollow.visible', 'the hollow year');",
    ].join('\n');
    const all = plainEnglishCoreWorkItems('people/demography.ts', source.replace('isHollowYearHomozygote', 'anotherReader'));
    const found = plainEnglishCoreWorkItems('people/demography.ts', source);
    expect(found).toEqual(all.slice(1));
    expect(plainEnglishCoreWorkItems('people/demography.ts', definition)).toHaveLength(1);
    expect(plainEnglishCoreWorkItems('story.ts', source)).toHaveLength(all.length);
    expect(plainEnglishCoreWorkItems('people\\demography.ts', source)).toEqual(found.map((row) => ({
      ...row, file: 'people\\demography.ts', address: row.address.replace('people/demography.ts', 'people\\demography.ts'),
    })));
  });

  it('reads a component three ways and skips bound attributes and mustaches', () => {
    const rows = auditVueFile('components/Thing.vue', [
      '<template>',
      '  <!-- not this -->',
      '  <button title="Answer the docket" :title="bound">Answer {{ count }}</button>',
      '  <p>{{ onlyAnExpression }}</p>',
      '</template>',
      '<script setup lang="ts">',
      "const hint = 'Nobody in the hall can read.';",
      '</script>',
    ].join('\n'));
    expect(rows.map((r) => [r.source, r.strings])).toEqual([
      ['client-template', 1],
      ['client-attribute', 1],
      ['client-script', 1],
    ]);
  });

  it('includes one-word player-visible tale bias in the migration queue', () => {
    const yaml = [
      'tales:',
      '  - id: a_legend',
      '    teller: singers from the northern hall',
      '    bias: wistful',
      '    text: The borrowed ring never came home.',
    ].join('\n');
    const entries = plainEnglishContentWorkItems('tales.yaml', yaml);
    expect(entries.map((entry) => entry.address)).toEqual([
      'content:tales.yaml#tales[id=a_legend].teller',
      'content:tales.yaml#tales[id=a_legend].bias',
      'content:tales.yaml#tales[id=a_legend].text',
    ]);
    expect(entries.find((entry) => entry.address.endsWith('.bias'))?.words).toBe(1);
    expect(unclassifiedContentKeys(yaml)).toEqual([]);
    expect(auditContentFile('tales.yaml', yaml)).toEqual([
      expect.objectContaining({ voice: 'tale', strings: 3 }),
    ]);

    const bias = entries.find((entry) => entry.address.endsWith('.bias'))!;
    const reviewed = {
      address: bias.address,
      of: proseOriginalHash(bias.text),
      plainenglish: 'They want the ring to return.',
    };
    expect(plainEnglishCoverageFor([bias], [])).toMatchObject({ missing: 1, current: 0 });
    expect(plainEnglishCoverageFor([bias], [reviewed])).toMatchObject({ missing: 0, current: 1 });
  });

  it('notices a prose field that neither list accounts for', () => {
    expect(unclassifiedContentKeys([
      'events:',
      '  - id: a_scene',
      '    title: Counted, because title is known',
      '    whisper: a new field somebody added last week',
      '    note: a designer note, known not to count',
      '    tag: single_word_ids_are_never_prose',
    ].join('\n'))).toEqual(['whisper']);
  });

  it('knows whether every multi-word content field counts', () => {
    const content = join(REPO, 'packages/content');
    const walk = (d: string): string[] => readdirSync(join(content, d)).flatMap((e) => {
      const rel = d ? `${d}/${e}` : e;
      return statSync(join(content, rel)).isDirectory() ? walk(rel) : rel.endsWith('.yaml') ? [rel] : [];
    });
    const unknown = walk('').flatMap((f) =>
      unclassifiedContentKeys(readFileSync(join(content, f), 'utf8')).map((k) => `${f} → ${k}`));
    expect(
      unknown,
      'a content key carries prose and string-audit.ts does not say whether a player reads it: '
      + 'add it to CONTENT_PROSE_KEYS, or to CONTENT_NOT_PROSE with the reason',
    ).toEqual([]);
  });

  it('inventories the real repository in every voice, the same way twice', () => {
    const rows = auditRepository(REPO);
    const voices = new Set(rows.map((r) => r.voice));
    expect(VOICES.filter((v) => !voices.has(v))).toEqual([]);
    expect(report(auditRepository(REPO), { files: true })).toEqual(report(rows, { files: true }));
  });

  it('makes the #410 worklist exactly cover the audit\'s non-interface narrative strings', () => {
    const rows = auditRepository(REPO);
    const expected = rows
      .filter((r) => r.voice !== 'interface')
      .reduce((sum, r) => sum + r.strings, 0);
    const items = plainEnglishWorklist(REPO);
    expect(items.length).toBe(expected);
    expect(new Set(items.map((x) => x.address)).size).toBe(items.length);
    expect(plainEnglishWorklist(REPO)).toEqual(items);
    expect(items.some((x) => x.voice === 'event')).toBe(true);
    expect(items.some((x) => x.voice === 'chronicler')).toBe(true);
  });
  it('reports missing, stale, current, unsafe tokens and identical Plain English counterparts', () => {
    const items = plainEnglishContentWorkItems('events/prose.yaml', [
      'events:',
      '  - id: offered',
      '    body: "{HEAD} gave the book to {HEAD} once more."',
    ].join('\n'));
    expect(items).toHaveLength(1);
    const item = items[0]!;
    const valid = {
      address: item.address,
      of: proseOriginalHash(item.text),
      plainenglish: '{HEAD} handed {HEAD} the book again.',
    };

    expect(plainEnglishCoverageFor(items, [])).toMatchObject({
      total: 1, current: 0, missing: 1, stale: 0, invalid: 0,
      remaining: [{ status: 'missing', address: item.address, expectedOf: valid.of }],
    });
    expect(plainEnglishCoverageFor(items, [valid])).toMatchObject({
      total: 1, current: 1, missing: 0, stale: 0, invalid: 0, remaining: [],
    });
    expect(plainEnglishCoverageFor(items, [{ ...valid, of: '0000000000000000' }]))
      .toMatchObject({ current: 0, stale: 1, missing: 0, invalid: 0,
        remaining: [{ status: 'stale', expectedOf: valid.of }] });
    expect(plainEnglishCoverageFor(items, [{ ...valid, of: undefined }]))
      .toMatchObject({ current: 0, stale: 1, missing: 0, invalid: 0 });
    expect(plainEnglishCoverageFor(items, [{ ...valid, plainenglish: '{HEAD} took the book.' }]))
      .toMatchObject({ current: 0, stale: 0, invalid: 1, missing: 0 });
    expect(plainEnglishCoverageFor(items, [{ ...valid, plainenglish: item.text }]))
      .toMatchObject({ current: 0, invalid: 1, missing: 0, stale: 0 });
  });

  it('credits only variants authored beside the Original YAML', () => {
    const root = mkdtempSync(join(tmpdir(), 'ed-prose-coverage-'));
    const events = join(root, 'packages/content/events');
    mkdirSync(events, { recursive: true });
    const original = [
      'events:',
      '  - id: a_scene',
      '    body: The clerk brought the deed back from town.',
    ].join('\n');
    const item = plainEnglishContentWorkItems('events/one.yaml', original)[0]!;
    const variant = [
      'proseVariants:',
      '  - address: ' + JSON.stringify(item.address),
      '    of: ' + proseOriginalHash(item.text),
      '    plainenglish: The clerk returned with the deed.',
    ].join('\n');

    try {
      writeFileSync(join(events, 'one.yaml'), original);
      writeFileSync(join(events, 'two.yaml'), variant);
      expect(plainEnglishCoverage(root)).toMatchObject({
        total: 1, current: 0, missing: 1, stale: 0, invalid: 0,
      });

      writeFileSync(join(events, 'one.yaml'), original + '\n' + variant);
      rmSync(join(events, 'two.yaml'));
      expect(plainEnglishCoverage(root)).toMatchObject({
        total: 1, current: 1, missing: 0, stale: 0, invalid: 0,
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('credits stable core message counterparts only in the shipped messages catalogue (#1019)', () => {
    const root = mkdtempSync(join(tmpdir(), 'ed-core-prose-coverage-'));
    const core = join(root, 'packages/core/src');
    const content = join(root, 'packages/content');
    mkdirSync(core, { recursive: true });
    mkdirSync(content, { recursive: true });
    const source = "msg(ctx, 'audit.coverage', 'A name for {NAME} is written.');";
    const item = plainEnglishCoreWorkItems('example.ts', source)[0]!;
    const originalHash = proseOriginalHash(item.text);
    const yamlFor = (of: string) => [
      'proseVariants:',
      '  - address: ' + JSON.stringify(item.address),
      '    of: ' + JSON.stringify(of),
      '    plainenglish: The clerk recorded {NAME}.',
    ].join('\n') + '\n';
    const messages = join(content, CORE_MESSAGE_VARIANTS_FILE);

    try {
      writeFileSync(join(core, 'example.ts'), source);
      writeFileSync(messages, yamlFor(originalHash));
      expect(plainEnglishCoverage(root)).toMatchObject({
        total: 1, current: 1, missing: 0, stale: 0, invalid: 0, remaining: [],
      });
      writeFileSync(messages, yamlFor('0000000000000000'));
      expect(plainEnglishCoverage(root)).toMatchObject({
        total: 1, current: 0, missing: 0, stale: 1, invalid: 0,
        remaining: [{ address: item.address, status: 'stale', expectedOf: originalHash }],
      });
      // A valid-looking key in another YAML file must never be counted.
      const other = join(content, 'events');
      mkdirSync(other, { recursive: true });
      writeFileSync(join(other, 'elsewhere.yaml'), yamlFor(originalHash));
      writeFileSync(messages, 'proseVariants: []\n');
      expect(plainEnglishCoverage(root)).toMatchObject({
        total: 1, current: 0, missing: 1, stale: 0,
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('accounts for the complete source inventory without changing the old worklist', () => {
    const full = plainEnglishWorklist(REPO);
    const coverage = plainEnglishCoverage(REPO);
    expect(coverage.total).toBe(full.length);
    expect(coverage.current + coverage.missing + coverage.stale + coverage.invalid)
      .toBe(coverage.total);
    expect(coverage.remaining.length).toBe(coverage.missing + coverage.stale + coverage.invalid);
    expect(coverage.remaining.every((row) => row.source === 'core' || row.expectedOf !== undefined)).toBe(true);
    expect(plainEnglishCoverage(REPO)).toEqual(coverage);
  });

});

/** The migration has reached zero; new or changed player copy must stay reviewed. */
describe('shipped Plain English coverage (#1779)', () => {
  it('ships a current counterpart for every inventoried player-facing item', () => {
    const coverage = plainEnglishCoverage(REPO);
    expect({ missing: coverage.missing, stale: coverage.stale, invalid: coverage.invalid })
      .toEqual({ missing: 0, stale: 0, invalid: 0 });
    expect(coverage.remaining).toEqual([]);
    expect(coverage.current).toBe(coverage.total);
  });
});
