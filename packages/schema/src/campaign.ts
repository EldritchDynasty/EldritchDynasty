import { z } from 'zod';

/** The product campaign selected for a run (issue #66). */
export const CampaignIdS = z.enum(['short', 'long', 'demo']);
export type CampaignId = z.infer<typeof CampaignIdS>;
