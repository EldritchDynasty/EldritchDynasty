import { z } from 'zod';

/** Shared, non-simulation definitions in both reading registers. */
const WordsS = z.object({
  original: z.string().trim().min(1),
  plainenglish: z.string().trim().min(1),
});
export const GlossaryTermS = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]*$/),
  names: WordsS,
  aliases: z.object({
    original: z.array(z.string().trim().min(1)).min(1),
    plainenglish: z.array(z.string().trim().min(1)).min(1),
  }),
  definition: WordsS,
  related: z.array(z.string()).default([]),
});
export type GlossaryTerm = z.infer<typeof GlossaryTermS>;
