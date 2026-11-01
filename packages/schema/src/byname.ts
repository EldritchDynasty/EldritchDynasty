import { z } from 'zod';

/**
 * EARNED BYNAMES (issue #1990, contract in `docs/BYNAME-CONTRACT.md`).
 *
 * `Person.epithet` was plumbed end to end (saved, seedable, shown) and nothing
 * ever set it. A byname is now earned at one boundary: the moment a Record
 * block commits a page that makes a claim about one named person. The pen
 * decides it. Record writes the attested name; Embellish writes the
 * flattering one and ties it to the lie; Omit writes nothing and takes
 * nothing away.
 *
 * The wording is authored on the Record option itself (`RecordBynameS`),
 * beside the claims it rests on, so a byname can never say more than the
 * page it came from. The provenance (`BynameGrantS`) is saved on the
 * person, and the words go into `Person.epithet`, frozen in the prose mode
 * the reader saw at the time (`docs/LOCALISATION.md`: saved words are
 * history).
 */

/** The two pens that can write a byname. Omit is a dated blank and claims nothing. */
export const BYNAME_PENS = ['record', 'embellish'] as const;
export const BynamePenS = z.enum(BYNAME_PENS);
export type BynamePen = z.infer<typeof BynamePenS>;

/**
 * Authored on `record.options.record` or `record.options.embellish`.
 *
 * `slot` names ONE slot of the event. The engine grants only when that slot
 * cast exactly one person AND the committed page carries a claim about that
 * person — a multi-person slot, an empty optional slot or a page whose claim
 * went elsewhere grants nothing (`byname/slot` checks the authored half).
 *
 * `text` follows the name with a space: `Ada Gearithy` + `the Early-Woken`.
 * It is prose (Plain English counterpart by address), never a token string.
 */
export const RecordBynameS = z.object({
  slot: z.string().min(1),
  text: z.string().min(1),
}).strict();
export type RecordByname = z.infer<typeof RecordBynameS>;

/**
 * WHERE A BYNAME CAME FROM — a closed union (invariant 5). Every consumer
 * ends in `assertNever`, so a second source (a death, a rite, a succession)
 * is a deliberate variant with a compiler error at each reader, never a
 * string somebody has to remember to handle.
 *
 * `record`: a Record block committed the page `page`, with pen `pen`, about
 * this person. `choice` / `outcome` name the authored choice- or
 * outcome-specific Record when one was used, so the source is the exact
 * authored block and never a guess from `(event, year)`. `discrepancy` is
 * the authored lie an Embellish opened.
 */
export const BynameSourceS = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('record'),
    event: z.string(),
    pen: BynamePenS,
    page: z.string(),
    choice: z.string().optional(),
    outcome: z.string().optional(),
    discrepancy: z.string().optional(),
  }).strict(),
]);
export type BynameSource = z.infer<typeof BynameSourceS>;
export type BynameSourceKind = BynameSource['kind'];

/**
 * What became of the lie a byname rests on, for THIS page only.
 *
 * A Discrepancy's id is authored, not per occurrence: the same template can
 * embellish twice and `world.discrepancies` holds one state for both
 * (contract, "Repeated-discrepancy audit"). So the settlement is stamped on
 * the grant at the moment the proof or burial lands, and only on the grant
 * whose page is the telling that proof addressed — the latest embellished
 * page carrying that id. A grant whose telling was superseded while still
 * open stays `claimed` for good; nothing is inferred later from the map.
 */
export const BynameSettlementS = z.object({
  state: z.enum(['proven', 'buried']),
  year: z.number(),
}).strict();
export type BynameSettlement = z.infer<typeof BynameSettlementS>;

/**
 * The saved provenance of an earned byname. The words themselves live in
 * `Person.epithet`; this says where they came from. A person with an
 * authored or legacy epithet and no grant has no known source, and none is
 * ever fabricated for them.
 */
export const BynameGrantS = z.object({
  source: BynameSourceS,
  year: z.number(),
  settled: BynameSettlementS.optional(),
}).strict();
export type BynameGrant = z.infer<typeof BynameGrantS>;

/**
 * How the reader is told the byname stands, derived from the grant alone:
 *
 *   attested  Record wrote it — the house's honest account, which may be unkind
 *   claimed   Embellish wrote it and nothing has settled that telling
 *   contested the lie it rests on was proven
 *   buried    the lie it rests on was buried — unproven, never "true"
 *   unknown   a byname with no saved source (authored, or an older save)
 */
export const BYNAME_STANDINGS = ['attested', 'claimed', 'contested', 'buried', 'unknown'] as const;
export type BynameStanding = typeof BYNAME_STANDINGS[number];
