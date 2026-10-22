#!/usr/bin/env node
// Run: node --import tsx tools/primordial-report.mjs --runs=64 --output=report.json
// Counterfactual normal catalogue vs the shipped responses, on paired seeds.
import { writeFileSync } from 'node:fs';
import { loadContent } from '@ed/content';
import { indexContent, primordialInventory } from '@ed/schema';
import { bootstrap } from '../packages/core/src/sim.ts';
import { runYears } from '../packages/core/src/year/step.ts';
import { saveGame, loadGame } from '../packages/core/src/save.ts';
import { isCurrentFamily } from '../packages/core/src/presence.ts';
import { phenotypeOf } from '../packages/core/src/people/factory.ts';
import { expectRate } from '../packages/core/src/testing.ts';
import { selectEnding } from '../packages/core/src/ending.ts';
import { heldAcres } from '../packages/core/src/land.ts';

const option = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const runs = Number(option('runs') ?? 64);
if (!Number.isInteger(runs) || runs < 1) throw Error('--runs must be a positive integer');
const content = loadContent();
const baseline = structuredClone(content.bundle);
for (const event of baseline.events) {
  const groups = event.interaction.kind === 'narration' ? [event.interaction] : event.interaction.choices;
  for (const group of groups) for (const outcome of group.outcomes) delete outcome.primordial;
}
const control = indexContent(baseline);
const inventory = primordialInventory(content.bundle.events);
const report = { rule: 'min(EP/100, 0.9), shuffled independent local trials, stop at first success',
  seeds: Array.from({length:runs}, (_, i) => 186800 + 7*i), campaigns: {},
  responses: inventory.filter(row => row.response).length,
  scope: 'Authored outcomes only. Annual mortality, economy upkeep and muster attrition have no incident adapter.' };
for (const [campaign, years] of [['short',300], ['long',500]]) {
  const totals = { qualifying:0, knownSite:0, eligible:0, interventions:0, expected:0, variance:0, remoteExcluded:0,
    livesSaved:0, missingPrevented:0, crownsPreserved:0, estateYieldPreserved:0, lifeSavingHouses:0, localPoolSizes:{}, localEP:[],
    nonMitigating:0, normalReach: new Set(), rescuedReach: new Set() };
  const trials=[]; const rows=[]; const attempted = new Set();
  for (const seed of report.seeds) {
    const pair={seed};
    for (const enabled of [false,true]) {
      const ctx = bootstrap(enabled ? content : control, seed, 1042, campaign);
      const beforeLives=totals.livesSaved;
      if (enabled) ctx.observePrimordial = observation => {
        if (!observation.normal.categories.length) return;
        totals.qualifying++;
        if (observation.attendance) totals.knownSite++;
        const size=observation.candidates.length;
        totals.localPoolSizes[size]=(totals.localPoolSizes[size]??0)+1;
        const copy=loadGame(saveGame(ctx),content);
        const present=new Set(observation.attendance?.people??[]);
        totals.remoteExcluded += copy.world.people.living().filter(p=>isCurrentFamily(copy,p)
          &&p.awakening.awakened&&!present.has(p.id)&&phenotypeOf(p,copy.genetics,copy.world.year).eldritch.canExpress).length;
        if(!size)return;
        if(!observation.probability){totals.nonMitigating++;return;}
        totals.eligible++;totals.expected+=observation.probability;totals.variance+=observation.probability*(1-observation.probability);
        totals.localEP.push(...observation.candidates.map(candidate=>candidate.ep));
        attempted.add(`${observation.event}/${observation.choiceId??'_'}/${observation.selectedOutcome}`);
        trials.push({p:observation.probability,success:Boolean(observation.actor)});
        if(observation.actor)totals.interventions++;
      };
      runYears(ctx,years);
      const normal = ctx.world.decisionLog.filter(row=>row.kind==='outcome'&&!row.primordial);
      if(enabled){
        for(const row of normal)totals.normalReach.add(`${row.event}/${row.choiceId??'_'}/${row.outcomeId}`);
        for(const row of ctx.world.decisionLog){if(row.kind!=='outcome'||!row.primordial)continue;const r=row.primordial;
          totals.rescuedReach.add(`${row.event}/${row.choiceId??'_'}/${row.outcomeId}`);
          totals.livesSaved+=r.normal.deaths.filter(id=>!r.committed.deaths.includes(id)).length;
          totals.missingPrevented+=r.normal.missing.filter(id=>!r.committed.missing.includes(id)).length;
          totals.crownsPreserved+=r.normal.cashLoss-r.committed.cashLoss;
          totals.estateYieldPreserved+=r.normal.estateLoss-r.committed.estateLoss;
        }
        if(totals.livesSaved>beforeLives)totals.lifeSavingHouses++;
      }
      pair[enabled?'interventions':'control']={year:ctx.world.year,
        livingFamily:ctx.world.people.living().filter(p=>isCurrentFamily(ctx,p)).length,
        treasury:ctx.world.treasury,acres:heldAcres(ctx),bestRung:ctx.world.ascension.best,
        endingReading:selectEnding(ctx),normalOutcomes:normal.length};
    }
    rows.push(pair);
  }
  const n=trials.length; const expected=n?totals.expected/n:0;
  const se=n?Math.sqrt(totals.variance)/n:0;
  const observed=n?totals.interventions/n:0;
  let rateEvidence='insufficient eligible incidents for an expectRate assertion';
  if(n&&totals.interventions>0&&totals.interventions<n){
    const conservativeSE=Math.max(se,Math.sqrt(observed*(1-observed)/n));
    const floor=Math.max(.000001,expected-6*conservativeSE), ceiling=Math.min(.999999,expected+6*conservativeSE);
    expectRate({hits:totals.interventions,n,floor,what:`${campaign}: intervention frequency vs local-pool expectation`});
    expectRate({hits:totals.interventions,n,ceiling,what:`${campaign}: intervention frequency vs local-pool expectation`});
    rateEvidence={floor,ceiling,minimumMarginSE:2,standardisedDifference:se?(observed-expected)/se:null};
  }
  const eps=totals.localEP.sort((a,b)=>a-b);
  report.campaigns[campaign]={...totals,normalReach:totals.normalReach.size,rescuedReach:[...totals.rescuedReach].sort(),
    localEP:{n:eps.length,min:eps[0]??null,median:eps[Math.floor(eps.length/2)]??null,max:eps.at(-1)??null},
    expectedRate:expected,observedRate:observed,rateEvidence,
    neverAttempted:inventory.filter(row=>row.response&&!attempted.has(row.path)).map(row=>row.path),rows};
  process.stdout.write(`${campaign}: ${totals.qualifying} qualifying; ${n} eligible; ${totals.interventions} interventions; expected ${totals.expected.toFixed(2)}; ${totals.livesSaved} lives saved\n`);
}
const json=JSON.stringify(report,null,2)+'\n';
if(option('output'))writeFileSync(option('output'),json);else process.stdout.write(json);
