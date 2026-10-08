import { z } from 'zod';
import { TargetS } from './target.js';

/**
 * THE CLAIM VOCABULARY (issue #19) — what a chronicle entry, a Record option
 * or a tale actually SAYS about a person, as opposed to what happened.
 *
 * Built last, deliberately: frame `reads` are discrepancy queries, the Record
 * challenge pool scores off `ChronicleEntry` as it stands, and tales key off
 * event ids — none of it needed a structured claim. By now, what an entry
 * claims is a matter of record rather than of taste, so this is a real,
 * closed union (attr / trait / death / deed) rather than another string.
 *
 * Authored against a slot `Target`, exactly like an `Effect` — a claim in a
 * `RecordBlock` or a `TaleDef` is instantiated once per firing, against
 * whoever was actually cast. `resolveClaim` in `core/src/record.ts` turns one
 * into a `ResolvedClaim` per person the target names.
 */
// #587: YAML flow-map commas can create unknown null-valued keys. Never strip
// those keys from authored claims: reject them rather than silently truncating
// what a Record claims happened.
export const ClaimS = z.discriminatedUnion('kind', [
  /** Only meaningful on an `AttributeDef` with `recordable: true`. */
  z.object({ kind: z.literal('attr'), target: TargetS, attr: z.string(), value: z.number() }).strict(),
  z.object({ kind: z.literal('trait'), target: TargetS, trait: z.string(), has: z.boolean() }).strict(),
  /** `year` omitted means "the year this claim was made" — resolved at apply time, like a `status: dead` effect. */
  z.object({ kind: z.literal('death'), target: TargetS, year: z.number().optional(), cause: z.string() }).strict(),
  /** A claimed deed, with nothing to mechanically verify it against — see `deriveRecordView`. */
  z.object({ kind: z.literal('deed'), target: TargetS, text: z.string() }).strict(),
]);
export type Claim = z.infer<typeof ClaimS>;

/** A `Claim` with its `Target` already resolved to one person. What a `ChronicleEntry` actually stores. */
export const ResolvedClaimS = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('attr'), person: z.string(), attr: z.string(), value: z.number() }),
  z.object({ kind: z.literal('trait'), person: z.string(), trait: z.string(), has: z.boolean() }),
  z.object({ kind: z.literal('death'), person: z.string(), year: z.number(), cause: z.string() }),
  z.object({ kind: z.literal('deed'), person: z.string(), text: z.string() }),
]);
export type ResolvedClaim = z.infer<typeof ResolvedClaimS>;
