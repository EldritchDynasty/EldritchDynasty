import { z } from 'zod';
import type {
  CampaignId, Content, ContentBundle, FounderAnswer, FoundingConfiguration, Gender, LibraryRun, PrologueDef, ProseMode,
  ProseVariant, Sex,
} from '@ed/schema';
import { assertNever, indexContent, PERSON_NAME_MAX, SAVE_FORMAT } from '@ed/schema';
import { campaignDef } from './campaign.js';
import { FRIEND_NAME_MAX, MAX_FRIENDS } from './people/friends.js';
import { HOUSE_NAME_MAX, type FoundingChoice } from './prologue.js';
import { hashSeed } from './rng.js';
import { newGame, type GameSession } from './session.js';
import type { SimCtx } from './world.js';

/**
 * A SHARE CODE: SAME FOUNDING, DIFFERENT HOUSE (#1995).
 *
 * A player who exports a Chronicle plate or an Afterimage can hand a friend
 * the starting point that house grew from. The code carries the founding and
 * nothing after it: campaign, run seed, who signed (gender and founding
 * body), the Examination answers, the heirloom, the grudge and the friends'
 * roster. It never carries a later decision, a Library run, a Table
 * order or a single year of play.
 *
 * WHAT IS PERSONAL STAYS OUT BY DEFAULT. The founder's name, the house's name
 * and the friends' names are what a player typed. They are left out unless the
 * sender asks for them (`names: true`). Those names are not decoration — a
 * friend's name cannot be handed out while a living person wears it, and every
 * name joins the set later children's names are drawn against — so a code
 * without them encodes the friends' number and sexes and the recipient names
 * them. `SharedFounding.missing` says which names the recipient supplies, and
 * the client says so. This is the same encoded founding setup, not the same
 * world: the recipient's own Library still applies, and different names may
 * part the two houses from the year a name is first used.
 *
 * WHAT IS EXACT. Under the same edition, the same names and the same Library
 * inputs, a founding begun from a code saves the same canonical bytes as the
 * one it was taken from (`share-code.test.ts`). The edition is three facts —
 * the save format, a fingerprint of the content's mechanics bundle and the
 * build the host says it is — and a code from any other edition is refused
 * with the reason. Offering a different house while saying "same founding"
 * would be the lie this check exists to refuse. Prose catalogues are not in
 * the fingerprint: Plain English changes the words, never the world.
 *
 * DEMONSTRATION CODES DO NOT EXIST. The demo fixes its founder's death date;
 * it is not a full campaign's starting point and is never read as one.
 *
 * ENCODING. `ED1.` + base64url(UTF-8 JSON tuple) + `.` + a 32-bit check over
 * the body. The check makes a truncated or mistyped code a stated
 * refusal rather than a parse error, or worse, a different seed. Because the
 * edition pins the content, the tuple names the heirloom, the grudge and each
 * Examination answer by its place in the authored prologue rather than by id,
 * and every closed vocabulary by one letter: a code without names is about
 * 120 characters, short enough for an exported plate. `SHARE_CODE_MAX` holds
 * the largest founding the signing can write, every name at its longest in a
 * three-byte script (`share-code.test.ts` builds it).
 *
 *   [format, content, build, campaign, seed,
 *    founder: 0 | [gender, body] | [gender, body, name],
 *    answers: [] | one answer index per question, -1 for unanswered,
 *    heirloom index, grudge index,
 *    house: 0 | name,  friend sexes: 'fmf…',  friend names: 0 | [name…]]
 *
 * A house name present means the sender included names; then and only then
 * do the founder's and the friends' names appear.
 */

/** The codec's own version: the digit after `ED`. */
export const SHARE_CODE_VERSION = 1;
/** Longer than any founding the signing can write (`share-code.test.ts` builds it). */
export const SHARE_CODE_MAX = 2400;

const PREFIX = `ED${SHARE_CODE_VERSION}`;

// ── the closed vocabularies, one letter each ─────────────────────────────

function campaignLetter(id: CampaignId): 's' | 'l' | 'd' {
  switch (id) {
    case 'short': return 's';
    case 'long': return 'l';
    case 'demo': return 'd';
    default: return assertNever(id, 'campaign');
  }
}
function genderLetter(g: Gender): 'm' | 'w' | 'n' {
  switch (g) {
    case 'man': return 'm';
    case 'woman': return 'w';
    case 'nonbinary': return 'n';
    default: return assertNever(g, 'gender');
  }
}
function bodyLetter(c: FoundingConfiguration): 'f' | 'm' {
  switch (c) {
    case 'blood_father': return 'f';
    case 'blood_mother': return 'm';
    default: return assertNever(c, 'founding configuration');
  }
}
function sexLetter(sex: Sex): 'f' | 'm' {
  switch (sex) {
    case 'female': return 'f';
    case 'male': return 'm';
    default: return assertNever(sex, 'sex');
  }
}
const CAMPAIGN_OF = { s: 'short', l: 'long', d: 'demo' } as const satisfies Record<ReturnType<typeof campaignLetter>, CampaignId>;
const GENDER_OF = { m: 'man', w: 'woman', n: 'nonbinary' } as const satisfies Record<ReturnType<typeof genderLetter>, Gender>;
const BODY_OF = { f: 'blood_father', m: 'blood_mother' } as const satisfies Record<ReturnType<typeof bodyLetter>, FoundingConfiguration>;
const SEX_OF = { f: 'female', m: 'male' } as const satisfies Record<ReturnType<typeof sexLetter>, Sex>;

const GenderL = z.enum(['m', 'w', 'n']);
const BodyL = z.enum(['f', 'm']);
const Index = z.number().int().min(0);

const PayloadS = z.tuple([
  z.number().int(),
  z.string().max(16),
  z.string().max(16),
  z.enum(['s', 'l', 'd']),
  z.number().int().min(0).max(0xffffffff),
  z.union([z.literal(0), z.tuple([GenderL, BodyL]), z.tuple([GenderL, BodyL, z.string().max(PERSON_NAME_MAX)])]),
  z.array(z.number().int().min(-1)).max(8),
  Index,
  Index,
  z.union([z.literal(0), z.string().min(1).max(HOUSE_NAME_MAX)]),
  z.string().regex(new RegExp(`^[fm]{0,${MAX_FRIENDS}}$`)),
  z.union([z.literal(0), z.array(z.string().min(1).max(FRIEND_NAME_MAX)).max(MAX_FRIENDS)]),
]);
type Payload = z.infer<typeof PayloadS>;

/** The text a code leaves to its recipient. */
export type SharedName = 'founder' | 'house' | 'friends';

/** A code, read: what it would found, by content id, and what the recipient still has to say. */
export interface SharedFounding {
  campaign: 'short' | 'long';
  seed: number;
  startYear: number;
  /** Present exactly when the signing said who signed; absent is the authored founder. */
  founder?: { gender: Gender; configuration: FoundingConfiguration; name?: string };
  answers: Record<string, string>;
  heirloom: string;
  grudge: string;
  houseName?: string;
  friends: { sex: Sex; name?: string }[];
  /** Names the sender left out. Empty when the code carries every name the founding used. */
  missing: SharedName[];
}

/**
 * WHY A CODE WAS REFUSED, as data. The client words each kind in both reading
 * modes (`client/src/lib/share-code.ts`); core keeps no English here, so a
 * refusal cannot be shown in one mode only.
 */
export type ShareCodeProblem =
  | { kind: 'empty' }
  | { kind: 'too_long'; max: number }
  | { kind: 'not_a_code' }
  | { kind: 'unsupported_version'; version: string }
  | { kind: 'damaged' }
  | { kind: 'other_edition'; differs: ('format' | 'content' | 'build')[] }
  | { kind: 'demonstration' }
  | { kind: 'names_needed'; missing: SharedName[] }
  | { kind: 'refused'; reason: string };

/**
 * Why a code could not be made from this run: it has no founding yet, it is
 * the Demonstration, or it was founded some way the front door cannot begin
 * (another start year, or an answer its own prologue no longer lists).
 */
export type ShareCodeUnavailable = 'not_founded' | 'demonstration' | 'unrepresentable';

export interface ShareCodeOptions {
  /** Include the founder's, the house's and the friends' names. Off unless asked. */
  names?: boolean;
  /** What the host calls this build. Two builds' codes are not interchangeable. */
  build?: string;
}

export type ShareCodeResult = { ok: true; code: string } | { ok: false; unavailable: ShareCodeUnavailable };
export type ReadShareCodeResult = { ok: true; founding: SharedFounding } | { ok: false; problem: ShareCodeProblem };

/**
 * The content's mechanics, fingerprinted. Two 32-bit FNV passes over the
 * bundle's JSON with the prose catalogue left out: a compatibility check
 * against an honest mismatch, not a signature against a forger.
 */
export function contentEdition(source: ContentBundle | Content): string {
  const { proseVariants: _words, ...mechanics } = indexContent(source).bundle;
  const json = JSON.stringify(mechanics);
  return hashSeed('edition-a', json).toString(36) + hashSeed('edition-b', json).toString(36);
}

function editionOf(content: Content, build = ''): [number, string, string] {
  return [SAVE_FORMAT, contentEdition(content), hashSeed('build', build).toString(36)];
}

// ── encoding ─────────────────────────────────────────────────────────────

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function toBase64Url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    const chars = Math.min(4, Math.ceil(((bytes.length - i) * 8) / 6));
    for (let c = 0; c < chars; c++) out += B64[(n >> (18 - 6 * c)) & 63];
  }
  return out;
}

function fromBase64Url(text: string): Uint8Array | undefined {
  if (text.length % 4 === 1) return undefined;
  const out: number[] = [];
  let bits = 0;
  let acc = 0;
  for (const ch of text) {
    const v = B64.indexOf(ch);
    if (v < 0) return undefined;
    acc = ((acc << 6) | v) & 0xffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}

function check(body: string): string {
  return hashSeed(PREFIX, body).toString(36);
}

function encode(payload: Payload): string {
  const body = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  return `${PREFIX}.${body}.${check(body)}`;
}

// ── making one ───────────────────────────────────────────────────────────

/** The founding this run was given, as a code. Only from its own logged answers. */
export function shareCodeOf(ctx: SimCtx, opts: ShareCodeOptions = {}): ShareCodeResult {
  const w = ctx.world;
  if (w.campaign === 'demo') return { ok: false, unavailable: 'demonstration' };
  const founding = w.decisionLog.find((row) => row.kind === 'founding');
  if (!founding) return { ok: false, unavailable: 'not_founded' };
  const def = ctx.content.prologue;
  // The product path founds every campaign at its own start year. A run built
  // any other way is a test's house, and a code would promise what `newGame`'s
  // front door cannot begin.
  if (!def || founding.year !== campaignDef(w.campaign).startYear) return { ok: false, unavailable: 'unrepresentable' };
  const signing = w.decisionLog.find((row) => row.kind === 'signing');
  const given = signing?.answers ?? {};
  const answers = Object.keys(given).length ? def.examination.map((q) => {
    const id = given[q.id];
    return id === undefined ? -1 : q.answers.findIndex((a) => a.id === id);
  }) : [];
  const heirloom = def.heirlooms.findIndex((h) => String(h.heirloom) === founding.heirloom);
  const grudge = def.grudges.findIndex((g) => String(g.house) === founding.grudge);
  const answered = answers.filter((a) => a >= 0).length;
  if (heirloom < 0 || grudge < 0 || answered !== Object.keys(given).length) return { ok: false, unavailable: 'unrepresentable' };

  const names = opts.names === true;
  const founder = signing?.founder;
  const payload: Payload = [
    ...editionOf(ctx.content, opts.build),
    campaignLetter(w.campaign),
    w.seed,
    !founder ? 0 : names && founder.name !== undefined
      ? [genderLetter(founder.gender), bodyLetter(founder.configuration), founder.name]
      : [genderLetter(founder.gender), bodyLetter(founder.configuration)],
    answers,
    heirloom,
    grudge,
    names ? founding.houseName : 0,
    founding.friends.map((f) => sexLetter(f.sex)).join(''),
    names ? founding.friends.map((f) => f.name) : 0,
  ];
  return { ok: true, code: encode(payload) };
}

// ── reading one ──────────────────────────────────────────────────────────

/** A payload's indices against the prologue it claims, or undefined if any is out of place. */
function resolve(p: Payload, def: PrologueDef, campaign: 'short' | 'long'): SharedFounding | undefined {
  const [, , , , seed, founderCode, answerCodes, heirloomAt, grudgeAt, house, sexes, friendNames] = p;
  const names = house !== 0;
  // Names travel together or not at all.
  if (names !== (friendNames !== 0)) return undefined;
  if (friendNames !== 0 && friendNames.length !== sexes.length) return undefined;
  if (!names && founderCode !== 0 && founderCode.length === 3) return undefined;
  if (answerCodes.length && answerCodes.length !== def.examination.length) return undefined;

  const answers: Record<string, string> = {};
  for (const [i, at] of answerCodes.entries()) {
    if (at < 0) continue;
    const q = def.examination[i]!;
    const a = q.answers[at];
    if (!a) return undefined;
    answers[q.id] = a.id;
  }
  const heirloom = def.heirlooms[heirloomAt];
  const grudge = def.grudges[grudgeAt];
  if (!heirloom || !grudge) return undefined;
  // A signing row exists exactly when someone signed or answered; an
  // all-unanswered list is not a thing the export writes.
  if (answerCodes.length && !Object.keys(answers).length) return undefined;

  const founder = founderCode === 0 ? undefined : {
    gender: GENDER_OF[founderCode[0]],
    configuration: BODY_OF[founderCode[1]],
    ...(founderCode.length === 3 ? { name: founderCode[2] } : {}),
  };
  const friends = [...sexes].map((s, i) => ({
    sex: SEX_OF[s as 'f' | 'm'],
    ...(friendNames !== 0 ? { name: friendNames[i]! } : {}),
  }));
  const missing: SharedName[] = names ? [] : [
    // The authored founder (no `founder` at all) has no typed name to supply;
    // nor does a house with no friends. The house always has a typed name.
    ...(founder ? ['founder' as const] : []),
    'house' as const,
    ...(friends.length ? ['friends' as const] : []),
  ];
  return {
    campaign,
    seed,
    startYear: campaignDef(campaign).startYear,
    ...(founder ? { founder } : {}),
    answers,
    heirloom: String(heirloom.heirloom),
    grudge: String(grudge.house),
    ...(names ? { houseName: house } : {}),
    friends,
    missing,
  };
}

/**
 * Read a code without touching a run. Whitespace anywhere is ignored, because
 * a code copied off an image or a wrapped line arrives with it.
 */
export function readShareCode(
  code: string,
  source: ContentBundle | Content,
  opts: { build?: string } = {},
): ReadShareCodeResult {
  // Permit ordinary line wrapping, but bound the raw input before stripping
  // whitespace. Otherwise a megabyte of spaces plus a valid small code
  // bypasses SHARE_CODE_MAX and needlessly reaches normalization.
  if (code.length > SHARE_CODE_MAX * 2) return { ok: false, problem: { kind: 'too_long', max: SHARE_CODE_MAX } };
  const text = code.replace(/\s+/g, '');
  if (!text) return { ok: false, problem: { kind: 'empty' } };
  if (text.length > SHARE_CODE_MAX) return { ok: false, problem: { kind: 'too_long', max: SHARE_CODE_MAX } };
  const head = /^ED(\d+)\./.exec(text);
  if (!head) return { ok: false, problem: { kind: 'not_a_code' } };
  if (head[1] !== String(SHARE_CODE_VERSION)) return { ok: false, problem: { kind: 'unsupported_version', version: head[1]! } };
  const parts = text.split('.');
  if (parts.length !== 3 || check(parts[1]!) !== parts[2]) return { ok: false, problem: { kind: 'damaged' } };
  const bytes = fromBase64Url(parts[1]!);
  // Base64url has unused trailing bits for 1- or 2-byte final groups.
  // Reject a re-sealed alias with nonzero padding bits: only codes emitted
  // by this encoder may name a founding, not several spellings of one.
  if (!bytes || toBase64Url(bytes) !== parts[1]) return { ok: false, problem: { kind: 'damaged' } };
  let payload: Payload;
  try {
    const result = PayloadS.safeParse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
    if (!result.success) return { ok: false, problem: { kind: 'damaged' } };
    payload = result.data;
  } catch {
    return { ok: false, problem: { kind: 'damaged' } };
  }
  // A checksum checks copying errors, not authorship. Still require the one
  // serialized form this encoder actually emits: re-sealed JSON with extra
  // whitespace or alternate escaping must not create aliases for one founding.
  if (encode(payload) !== text) return { ok: false, problem: { kind: 'damaged' } };
  const content = indexContent(source);
  const here = editionOf(content, opts.build);
  const differs = (['format', 'content', 'build'] as const).filter((_, i) => payload[i] !== here[i]);
  if (differs.length) return { ok: false, problem: { kind: 'other_edition', differs } };
  const campaign = CAMPAIGN_OF[payload[3]];
  if (campaign === 'demo') return { ok: false, problem: { kind: 'demonstration' } };
  const founding = content.prologue && resolve(payload, content.prologue, campaign);
  if (!founding) return { ok: false, problem: { kind: 'damaged' } };
  return { ok: true, founding };
}

// ── beginning from one ───────────────────────────────────────────────────

/** The names a recipient gives a code that left them out. */
export interface SharedNames {
  founder?: string;
  house?: string;
  /** One per friend in the code's roster, in its order. */
  friends?: readonly string[];
}

export interface ShareCodeStart {
  build?: string;
  names?: SharedNames;
  libraryRuns?: readonly LibraryRun[];
  proseMode?: ProseMode;
  proseVariants?: readonly ProseVariant[];
  decider?: 'ask' | 'chronicler';
}

export type ShareCodeBegin = { ok: true; session: GameSession; founding: SharedFounding } | { ok: false; problem: ShareCodeProblem };

/**
 * A NEW RUN, FOUNDED FROM A CODE. Through `newGame` and `GameSession.found`,
 * exactly as a signing is, so every founding refusal is the signing's own and
 * nothing here writes to a world. Nothing is returned on refusal; whatever
 * run the caller already holds is untouched.
 */
export function newGameFromShareCode(
  code: string,
  source: ContentBundle | Content,
  opts: ShareCodeStart = {},
): ShareCodeBegin {
  const read = readShareCode(code, source, { build: opts.build });
  if (!read.ok) return read;
  const f = read.founding;
  const given = opts.names ?? {};
  const houseName = f.houseName ?? given.house?.trim() ?? '';
  const friendNames = f.friends.map((friend, i) => friend.name ?? given.friends?.[i]?.trim() ?? '');
  const missing: SharedName[] = [
    ...(!houseName ? ['house' as const] : []),
    ...(friendNames.some((name) => !name) ? ['friends' as const] : []),
  ];
  if (missing.length) return { ok: false, problem: { kind: 'names_needed', missing } };

  // A founder name the code left out is the recipient's to give, or to
  // leave blank. An authored founder (no founder payload) is not a missing
  // name: caller-provided, possibly stale input must not turn it into a
  // different signing behind the code's back.
  const founderName = f.founder?.name ?? given.founder?.trim();
  const founder: FounderAnswer | undefined = f.founder
    ? { gender: f.founder.gender, configuration: f.founder.configuration, ...(founderName ? { name: founderName } : {}) }
    : undefined;

  const session = newGame(source, {
    seed: f.seed,
    startYear: f.startYear,
    campaign: f.campaign,
    libraryRuns: opts.libraryRuns,
    proseMode: opts.proseMode,
    proseVariants: opts.proseVariants,
    decider: opts.decider,
  });
  const choice: FoundingChoice = {
    houseName,
    heirloom: f.heirloom,
    grudge: f.grudge,
    ...(f.friends.length ? { friends: f.friends.map((friend, i) => ({ name: friendNames[i]!, sex: friend.sex })) } : {}),
    ...(Object.keys(f.answers).length ? { answers: { ...f.answers } } : {}),
    ...(founder ? { founder } : {}),
  };
  const result = session.found(choice);
  if (!result.ok) return { ok: false, problem: { kind: 'refused', reason: result.reason ?? '' } };
  return { ok: true, session, founding: f };
}
