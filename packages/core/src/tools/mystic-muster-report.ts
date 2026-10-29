/** #1874: paired public-session field/home policies; descriptive evidence, not a balance gate. */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { loadContent } from '@ed/content';
import { indexContent, type Content, type ContentBundle, type MysticService } from '@ed/schema';
import { CAMPAIGNS } from '../campaign.js';
import { isFieldWorking } from '../mystic.js';
import { GameSession, newGame, resumeGame } from '../session.js';
import { canonical, digestOf } from '../save.js';
import { livingBlood } from '../ending.js';
import { meanEvidence, rateEvidence } from './mystic-baseline.js';

export const FIELD_POLICIES = ['none', 'home', 'deploy'] as const;
export type FieldPolicy = typeof FIELD_POLICIES[number];

interface DutyRecord {
  working: string; house: string; site: 'home' | 'field'; service: MysticService;
  fate?: 'returned' | 'captured' | 'dead' | 'departed';
}

/** Study and purchase only what the Table offers; the same policy serves all paired columns. */
export function train(s: GameSession, content: Content, elapsed: number): void {
  const table = s.table();
  const affinities = [...new Set(content.mysticWorkings.filter(isFieldWorking).map(w => w.affinity))].sort();
  const offset = elapsed % affinities.length;
  const priorities = [...affinities.slice(offset), ...affinities.slice(0, offset)];
  const lot = table.auction?.items.find(l => l.kind === 'spellbook' && !l.bid && l.reserve * 2 <= table.treasury
    && content.spellbooks.some(b => b.name === l.name && priorities.includes(b.affinity)));
  if (lot && s.order({ kind: 'lotBid', lot: lot.id, bid: { currency: 'coin', amount: Math.round(lot.reserve * 1.5) } }).ok) return;
  const missing = table.missingPrimers.filter(b => priorities.some(a => a === b.affinity) && !b.queued && b.canPay
    && b.fee + b.reserve * 2 <= table.treasury).sort((a, b) => a.book.localeCompare(b.book))[0];
  if (elapsed % 12 === 0 && missing && s.order({ kind: 'seekBook', book: missing.book }).ok) return;
  const busy = new Set(table.studying.map(study => study.person));
  const next = table.shelf.filter(shelf => priorities.includes(content.mustSpellbook(shelf.book).affinity))
    .flatMap(shelf => shelf.readers.filter(reader => !busy.has(reader.person)).map(reader => ({
      person: reader.person, book: shelf.book, affinity: content.mustSpellbook(shelf.book).affinity,
    }))).sort((a, b) => priorities.indexOf(a.affinity) - priorities.indexOf(b.affinity)
      || a.book.localeCompare(b.book) || a.person.localeCompare(b.person))[0];
  if (next) s.order({ kind: 'study', person: next.person, book: next.book });
}

/** Returns only treatment counts; decisions never depend on observer state. */
export function applyFieldPolicy(s: GameSession, content: Content, policy: FieldPolicy) {
  if (policy === 'none') return { transferred: 0, ransomPaid: 0 };
  let transferred = 0;
  let ransomPaid = 0;
  let table = s.table();
  const fieldOffers = table.mystic.offers.filter(o => o.targets.some(t => t.target.kind === 'muster'));
  if (policy === 'deploy' && fieldOffers.length) {
    // A kept Life duty proves its required books are completed. Transfer only
    // to a field working those same books permit, then let the shared quote decide.
    if (!table.mystic.duties.some(d => isFieldWorking(content.mysticWorking(d.working)!)
      && content.mysticWorking(d.working)?.benefit.kind === 'field_care')) {
      for (const home of table.mystic.duties.filter(d => content.mysticWorking(d.working)?.benefit.kind === 'life_care'
        && d.status === 'serving')) {
        const known = content.mysticWorking(home.working)!;
        const offer = fieldOffers.find(o => content.mysticWorking(o.working)?.benefit.kind === 'field_care'
          && content.mysticWorking(o.working)!.books.every(b => known.books.includes(b))
          && table.treasury >= o.preparation + o.upkeep * 5);
        if (!offer) continue;
        if (s.order({ kind: 'mysticRelease', assignment: home.id }).ok) {
          const target = offer.targets[0]!;
          if (s.order({ kind: 'mysticAssign', person: home.person, working: offer.working,
            target: target.target, bindings: target.bindings }).ok) transferred++;
        }
        break;
      }
    }
    for (const original of fieldOffers) {
      table = s.table();
      const offer = table.mystic.offers.find(o => o.working === original.working)!;
      const kind = content.mysticWorking(offer.working)!.benefit.kind;
      if (table.mystic.duties.some(d => content.mysticWorking(d.working)?.benefit.kind === kind)) continue;
      const reader = [...offer.practitioners].sort((a, b) => Number(Boolean(a.studying)) - Number(Boolean(b.studying))
        || a.person.localeCompare(b.person))[0];
      const target = offer.targets[0];
      if (reader && target && table.treasury >= offer.preparation + offer.upkeep * 5) s.order({
        kind: 'mysticAssign', person: reader.person, working: offer.working, target: target.target, bindings: target.bindings,
      });
    }
  }
  table = s.table();
  if (!table.mystic.duties.some(d => content.mysticWorking(d.working)?.benefit.kind === 'life_care')) {
    const offer = table.mystic.offers.find(o => o.working === 'sickroom_watch');
    const reader = offer?.practitioners[0];
    const target = offer?.targets.find(t => t.target.kind === 'hall' && t.target.hall === 'main');
    if (offer && reader && target && table.treasury >= offer.preparation + offer.upkeep * 5) s.order({
      kind: 'mysticAssign', person: reader.person, working: offer.working, target: target.target, bindings: target.bindings,
    });
  }
  // Ransom is a deliberate affordable purchase, through the normal public verb.
  for (const captive of s.table().captives) if (captive.ok && s.table().treasury >= captive.price + 20) {
    const result = s.order({ kind: 'ransom', person: captive.person });
    if (result.ok) ransomPaid += result.spent ?? 0;
  }
  return { transferred, ransomPaid };
}

export function playFieldCampaign(source: Content | ContentBundle, seed: number, campaign: 'short' | 'long',
  policy: FieldPolicy, observed = true, reloadAtYear?: number) {
  const content = indexContent(source);
  let s = newGame(content, { seed, campaign, decider: 'chronicler' });
  s.order({ kind: 'marriages', policy: 'in' });
  const metrics = { practitionerYears: 0, deployedYears: 0, pausedStudyYears: 0, warYears: 0,
    fieldCareWithoutHomeCoverYears: 0, homeCarersSent: 0, ransomPaid: 0, injuryEpisodes: 0, enemyDutyYears: 0,
    records: {} as Record<string, DutyRecord> };
  const recoveries = new Map<string, number>();
  const sample = () => {
    const w = s.ctx.world;
    const table = s.table();
    const qualified = new Set(table.mystic.offers.flatMap(o => o.practitioners.map(p => p.person)));
    for (const duty of table.mystic.duties) qualified.add(duty.person);
    metrics.practitionerYears += qualified.size;
    metrics.pausedStudyYears += w.mystic.pauses.filter(p => w.mystic.assignments.some(a => a.id === p.assignment && !a.house)).length;
    metrics.warYears += Number(w.muster.commitments.some(c => c.status === 'in_the_field'));
    const ownField = w.mystic.assignments.filter(a => !a.house && a.target.kind === 'muster');
    metrics.deployedYears += ownField.length;
    metrics.enemyDutyYears += w.mystic.assignments.filter(a => a.house && a.status === 'serving').length;
    metrics.fieldCareWithoutHomeCoverYears += Number(ownField.some(a => content.mysticWorking(a.working)?.benefit.kind === 'field_care')
      && !table.mystic.duties.some(d => content.mysticWorking(d.working)?.benefit.kind === 'life_care' && d.status === 'serving'));
    for (const p of w.people.all()) if (p.fieldRecoveryUntil !== undefined && recoveries.get(p.id) !== p.fieldRecoveryUntil) {
      metrics.injuryEpisodes++; recoveries.set(p.id, p.fieldRecoveryUntil);
    }
    for (const a of w.mystic.assignments) metrics.records[a.id] = {
      working: a.working, house: a.house ?? w.playerHouse, site: a.target.kind === 'muster' ? 'field' : 'home', service: { ...a.service },
    };
    for (const c of w.muster.commitments) for (const a of c.fieldService ?? []) metrics.records[a.id] = {
      working: a.working, house: a.house ?? w.playerHouse, site: 'field', service: { ...a.service }, fate: a.fate,
    };
  };
  for (let elapsed = 0; elapsed < CAMPAIGNS[campaign].years && !s.ctx.world.ending; elapsed++) {
    if (s.pending.length) s.letHimDecide();
    const treatment = applyFieldPolicy(s, content, policy);
    metrics.homeCarersSent += treatment.transferred;
    metrics.ransomPaid += treatment.ransomPaid;
    train(s, content, elapsed);
    s.keepSuggestedNames();
    if (s.year === reloadAtYear) s = resumeGame(JSON.parse(JSON.stringify(s.save())), content, { decider: 'chronicler' });
    s.advance();
    if (observed) sample();
  }
  const saved = s.save();
  return { seed, campaign, policy, years: s.year - CAMPAIGNS[campaign].startYear, playerHouse: s.ctx.world.playerHouse,
    metrics, treasury: s.ctx.world.treasury, blood: livingBlood(s.ctx.world), ending: s.ctx.world.ending?.id,
    fingerprint: digestOf(s.ctx), fullSaveHash: createHash('sha256').update(canonical({ ...saved, savedAt: '' })).digest('hex'), ctx: s.ctx };
}

type Run = Omit<ReturnType<typeof playFieldCampaign>, 'ctx'>;
export function summariseFieldCampaigns(runs: readonly Run[]) {
  return (['short', 'long'] as const).flatMap(campaign => FIELD_POLICIES.map(policy => {
    const rows = runs.filter(r => r.campaign === campaign && r.policy === policy);
    if (!rows.length) return undefined;
    const sum = (r: Run, site: 'home' | 'field', read: (service: MysticService) => number) => Object.values(r.metrics.records)
      .filter(d => d.house === r.playerHouse && d.site === site).reduce((total, d) => total + read(d.service), 0);
    const estimate = (read: (r: Run) => number) => meanEvidence(rows.map(read));
    const controls = new Map(runs.filter(r => r.campaign === campaign && r.policy === 'home').map(r => [r.seed, r]));
    const difference = (read: (r: Run) => number) => meanEvidence(rows.map(r => read(r) - read(controls.get(r.seed)!)));
    return { campaign, policy, runs: rows.length,
      housesWithFieldDuty: rateEvidence(rows.filter(r => sum(r, 'field', s => s.servedYears) > 0).length, rows.length),
      practitionerYears: estimate(r => r.metrics.practitionerYears), deployedYears: estimate(r => r.metrics.deployedYears),
      fieldServedYears: estimate(r => sum(r, 'field', s => s.servedYears)),
      menKept: estimate(r => sum(r, 'field', s => s.menKept ?? 0)),
      officersKept: estimate(r => sum(r, 'field', s => s.livesKept)),
      homeLivesKept: estimate(r => sum(r, 'home', s => s.livesKept)),
      supplySaved: estimate(r => sum(r, 'field', s => s.crownsKept ?? 0)),
      fieldSpent: estimate(r => sum(r, 'field', s => s.spent)),
      ransomPaid: estimate(r => r.metrics.ransomPaid),
      netFieldCoin: estimate(r => sum(r, 'field', s => (s.crownsKept ?? 0) - s.spent) - r.metrics.ransomPaid),
      opportunities: estimate(r => sum(r, 'field', s => s.opportunities ?? 0)),
      homeCarersSent: estimate(r => r.metrics.homeCarersSent),
      uncoveredFieldCareYears: estimate(r => r.metrics.fieldCareWithoutHomeCoverYears),
      pausedStudyYears: estimate(r => r.metrics.pausedStudyYears), injuryEpisodes: estimate(r => r.metrics.injuryEpisodes),
      captures: estimate(r => Object.values(r.metrics.records).filter(d => d.house === r.playerHouse && d.fate === 'captured').length),
      deaths: estimate(r => Object.values(r.metrics.records).filter(d => d.house === r.playerHouse && d.fate === 'dead').length),
      enemyDutyYears: estimate(r => r.metrics.enemyDutyYears),
      pairedAgainstHome: { treasury: difference(r => r.treasury), blood: difference(r => r.blood),
        homeLivesKept: difference(r => sum(r, 'home', s => s.livesKept)) },
    };
  }).filter(row => row !== undefined));
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('/mystic-muster-report.ts')) {
  const runs = Number(process.argv[2] ?? 24);
  const seedBase = Number(process.argv[3] ?? 187400);
  if (!Number.isSafeInteger(runs) || runs < 1 || !Number.isSafeInteger(seedBase)) throw new Error('Expected positive runs and integer seed base');
  const content = loadContent();
  const samples: Run[] = [];
  const controls: { seed: number; campaign: string; policy: string; equal: boolean }[] = [];
  for (const campaign of ['short', 'long'] as const) for (const policy of FIELD_POLICIES) for (let i = 0; i < runs; i++) {
    const { ctx: _ctx, ...run } = playFieldCampaign(content, seedBase + i, campaign, policy);
    samples.push(run);
    if (i === 0) {
      const unobserved = playFieldCampaign(content, seedBase + i, campaign, policy, false);
      const equal = unobserved.fullSaveHash === run.fullSaveHash;
      controls.push({ seed: seedBase + i, campaign, policy, equal });
      if (!equal) throw new Error(`Observer changed the full save for ${campaign}/${policy}/${seedBase + i}`);
    }
    if ((i + 1) % 4 === 0) process.stderr.write(`${campaign}/${policy}: ${i + 1}/${runs}\n`);
  }
  const report = { seedBase, runs, controls, summary: summariseFieldCampaigns(samples), samples };
  if (process.argv[4]) writeFileSync(process.argv[4], JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ seedBase, runs, controls, summary: report.summary }, null, 2));
}
