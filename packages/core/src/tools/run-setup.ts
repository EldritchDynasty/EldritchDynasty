import type { CampaignId, Content, ContentBundle, FoundingConfiguration } from '@ed/schema';
import { CampaignIdS, FoundingConfigurationS } from '@ed/schema';
import { campaignDef } from '../campaign.js';
import { bootstrap } from '../sim.js';
import type { SimCtx } from '../world.js';

/**
 * WHAT A MEASURED RUN IS FOUNDED AS (#1867).
 *
 * Every gate used to bootstrap the authored founder on the Long Line and vary
 * only the year count, so a blood mother — a different first generation, and
 * by the scratch measurement a different ladder — was a house no gate had
 * ever played. A setup names the campaign and the founding configuration;
 * absent is exactly the bootstrap every gate made before, so CI's runs and
 * their fingerprints are unchanged.
 */
export interface RunSetup {
  campaign?: CampaignId;
  founding?: FoundingConfiguration;
}

/**
 * The founder a measured configuration signs as: the matching gender, so the
 * prose a run writes reads as the body it measures.
 */
export function bootstrapRun(source: ContentBundle | Content, seed: number, setup: RunSetup = {}): SimCtx {
  const campaign = setup.campaign ?? 'long';
  const signing = setup.founding
    ? { founder: { gender: setup.founding === 'blood_mother' ? 'woman' as const : 'man' as const, configuration: setup.founding } }
    : undefined;
  return bootstrap(source, seed, campaignDef(campaign).startYear, campaign, [], signing);
}

/** `--campaign=short` and `--founding=blood_mother`, validated against the schema's own vocabulary. */
export function runSetupFlags(args: readonly string[]): RunSetup {
  const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
  const campaign = flag('campaign');
  const founding = flag('founding');
  return {
    ...(campaign !== undefined ? { campaign: CampaignIdS.parse(campaign) } : {}),
    ...(founding !== undefined ? { founding: FoundingConfigurationS.parse(founding) } : {}),
  };
}

/** One line a report can print, so a number is never read without the house it measured. */
export function runSetupLabel(setup: RunSetup): string {
  return `${setup.campaign ?? 'long'} · ${setup.founding ?? 'authored founder'}`;
}
