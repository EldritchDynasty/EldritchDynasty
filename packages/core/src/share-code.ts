import { z } from 'zod';
import type {
  CampaignId, Content, ContentBundle, FounderAnswer, FoundingConfiguration, Gender, LibraryRun, PrologueDef, ProseMode,
  ProseVariant, Sex,
} from '@ed/schema';
import { assertNever, FounderIdentityS, indexContent, PERSON_NAME_MAX, SAVE_FORMAT } from '@ed/schema';
import { campaignDef } from './campaign.js';
import { FRIEND_NAME_MAX, MAX_FRIENDS, normaliseFriends } from './people/friends.js';
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
  | { kind: 'invalid_names' }
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
  const foundings = w.decisionLog.filter((row) => row.kind === 'founding');
  if (!foundings.length) return { ok: false, unavailable: 'not_founded' };
  const founding = foundings[0]!;
  const persisted = w.founding;
  // Recovered saves can disagree with their historical decision log. A share
  // code promises the actual founding, not whichever log row happens to come
  // first. Ambiguous duplicate founding rows are not a reproducible answer.
  // Loaded saves are schema-checked, but restored/programmatically amended
  // worlds can have corrupt founding rows. Export is a read-only UI operation:
  // fail closed here rather than throwing from trim(), normaliseFriends() or
  // Object.entries() and taking down the ending/share screen.
  if (foundings.length !== 1 || !persisted
    || typeof founding.houseName !== 'string'
    || !Array.isArray(founding.friends)
    || !Array.isArray(w.friends)
    || w.friends.some((friend) => !friend || typeof friend.name !== 'string'
      || (friend.sex !== 'male' && friend.sex !== 'female'))
    || founding.friends.some((friend) => !friend || typeof friend.name !== 'string'
      || (friend.sex !== 'male' && friend.sex !== 'female'))
    || !persisted.answers || typeof persisted.answers !== 'object'
    || Array.isArray(persisted.answers)
    || Object.values(persisted.answers).some((answer) => typeof answer !== 'string')
    || persisted.year !== founding.year
    || persisted.houseName !== founding.houseName
    || persisted.heirloom !== founding.heirloom
    || persisted.grudge !== founding.grudge) {
    return { ok: false, unavailable: 'unrepresentable' };
  }
  const def = ctx.content.prologue;
  // The product path founds every campaign at its own start year. A run built
  // any other way is a test's house, and a code would promise what `newGame`'s
  // front door cannot begin.
  // The public Start UI restricts seeds to uint32, but core's newGame API
  // also accepts other numbers. Do not export a code whose wire schema will
  // reject its own seed when a caller founded the world programmatically.
  if (!def || founding.year !== campaignDef(w.campaign).startYear
    || !Number.isInteger(w.seed) || w.seed < 0 || w.seed > 0xffffffff) {
    return { ok: false, unavailable: 'unrepresentable' };
  }
  // The signing trims and collapses whitespace before writing its founding
  // log, and refuses invisible-only names. A restored or corrupted log may
  // no longer meet that contract. Never export a name that the same signing
  // would change or refuse, even when the sender leaves names out of the code.
  const houseName = founding.houseName.trim().replace(/\s+/g, ' ');
  if (!wellFormedUtf16(houseName) || houseName !== founding.houseName
    || !houseName.replace(/\p{Default_Ignorable_Code_Point}/gu, '').trim()
    || houseName.length > HOUSE_NAME_MAX) {
    return { ok: false, unavailable: 'unrepresentable' };
  }
  // A restored or programmatically altered decision log can pass the compact
  // wire schema but fail the signing's real friend rules. Reuse that validator
  // and require its result to be unchanged: silently dropping an invisible
  // name, normalizing spelling, or refusing duplicates would break the
  // founding that this code promises to reproduce.
  // Names can be spent or released during play, and their due years advance
  // independently of the founding. Their recorded identity and order must not:
  // importing a code with a different live roster would not start this house.
  if (w.friends.length !== founding.friends.length
    || w.friends.some((friend, i) =>
      friend.name !== founding.friends[i]?.name || friend.sex !== founding.friends[i]?.sex)) {
    return { ok: false, unavailable: 'unrepresentable' };
  }
  // TextEncoder replaces lone UTF-16 surrogates with U+FFFD. Such a name
  // cannot survive a share-code round-trip even if the signer stored it.
  // Refuse before both anonymous and named export rather than promising
  // a founding that the decoder can never recreate byte-for-byte.
  if (founding.friends.some((friend) => !wellFormedUtf16(friend.name))) {
    return { ok: false, unavailable: 'unrepresentable' };
  }
  const checkedFriends = normaliseFriends(ctx, founding.friends, founding.year);
  if (!checkedFriends.ok
    || checkedFriends.friends.length !== founding.friends.length
    || checkedFriends.friends.some((friend, i) =>
      friend.name !== founding.friends[i]!.name || friend.sex !== founding.friends[i]!.sex)) {
    return { ok: false, unavailable: 'unrepresentable' };
  }

  const signings = w.decisionLog.filter((row) => row.kind === 'signing');
  const signing = signings[0];
  if (signing && (!signing.answers || typeof signing.answers !== 'object'
    || Array.isArray(signing.answers)
    || Object.values(signing.answers).some((answer) => typeof answer !== 'string'))) {
    return { ok: false, unavailable: 'unrepresentable' };
  }
  const given = signing?.answers ?? {};
  // The signing is a once-only founding answer. A stray historical row, a
  // duplicate, or an answer disagreeing with persisted founding state cannot
  // be silently used to generate a different house's share code.
  const persistedAnswers = Object.entries(persisted.answers);
  if (signings.length > 1 || (signing && signing.year !== founding.year)
    || persistedAnswers.length !== Object.keys(given).length
    || persistedAnswers.some(([question, answer]) => given[question] !== answer)) {
    return { ok: false, unavailable: 'unrepresentable' };
  }
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
  // A restored or programmatically altered signing row may contain an invalid
  // founder identity. Check it before the exhaustive wire switches, which
  // otherwise throw, and in both privacy modes: omitting a bad name must not
  // turn an unrepresentable founding into a seemingly valid share code.
  if (founder !== undefined && (!FounderIdentityS.safeParse(founder).success
    || (founder.name !== undefined
      && (founder.name.length > PERSON_NAME_MAX || !validFounderName(founder.name))))) {
    return { ok: false, unavailable: 'unrepresentable' };
  }
  const payload: Payload = [
    ...editionOf(ctx.content, opts.build),
    campaignLetter(w.campaign),
    w.seed,
    founder === undefined ? 0 : names && founder.name !== undefined
      ? [genderLetter(founder.gender), bodyLetter(founder.configuration), founder.name]
      : [genderLetter(founder.gender), bodyLetter(founder.configuration)],
    answers,
    heirloom,
    grudge,
    names ? founding.houseName : 0,
    founding.friends.map((f) => sexLetter(f.sex)).join(''),
    names ? founding.friends.map((f) => f.name) : 0,
  ];
  // The decision log can outlive changes to signing's limits (or be built
  // programmatically). Do not publish a code that this very reader would
  // reject as malformed or oversized. Refuse rather than dropping inputs.
  if (!PayloadS.safeParse(payload).success) return { ok: false, unavailable: 'unrepresentable' };
  const code = encode(payload);
  if (code.length > SHARE_CODE_MAX) return { ok: false, unavailable: 'unrepresentable' };
  return { ok: true, code };
}

// ── reading one ──────────────────────────────────────────────────────────

/** A named code may advertise only names the signing itself can keep.
 * Anonymous names are supplied later, but a name already in the wire payload
 * must not pass preview if founding would normalize or discard it.
 */
/** UTF-8 has no representation for an unpaired UTF-16 surrogate. Iterating
 * code points preserves valid pairs (including emoji) while exposing lone
 * surrogates as values in the reserved D800-DFFF range.
 */
function wellFormedUtf16(name: string): boolean {
  for (const character of name) {
    const point = character.codePointAt(0)!;
    if (point >= 0xd800 && point <= 0xdfff) return false;
  }
  return true;
}

function canonicalVisibleName(name: string): boolean {
  return wellFormedUtf16(name) && name === name.trim().replace(/\s+/g, ' ')
    && !!name.replace(/\p{Default_Ignorable_Code_Point}/gu, '').trim();
}

/** An explicitly blank founder answer is part of the signing log and may
 * reproduce the authored founder. Invisible-only *nonblank* answers are not:
 * they look like an answered name but display no name in either reading mode.
 * Unlike house/friend names, a founder answer is kept byte-for-byte, including
 * spaces, so do not normalize it here.
 */
function validFounderName(name: string): boolean {
  return wellFormedUtf16(name)
    && (!name.trim() || !!name.replace(/\p{Default_Ignorable_Code_Point}/gu, '').trim());
}

/** A payload's indices against the prologue it claims, or undefined if any is out of place. */
function resolve(p: Payload, def: PrologueDef, campaign: 'short' | 'long'): SharedFounding | undefined {
  const [, , , , seed, founderCode, answerCodes, heirloomAt, grudgeAt, house, sexes, friendNames] = p;
  const names = house !== 0;
  // Names travel together or not at all.
  if (names !== (friendNames !== 0)) return undefined;
  if (friendNames !== 0 && friendNames.length !== sexes.length) return undefined;
  if (!names && founderCode !== 0 && founderCode.length === 3) return undefined;
  if (founderCode !== 0 && founderCode.length === 3 && !validFounderName(founderCode[2])) return undefined;
  // The payload schema checks lengths and wire types. The actual signing also
  // rejects noncanonical/blank names and case-insensitive duplicate friends.
  // Refuse those here, before displaying a supposedly valid founding preview.
  if (house !== 0 && !canonicalVisibleName(house)) return undefined;
  if (friendNames !== 0) {
    const seen = new Set<string>();
    for (const name of friendNames) {
      const key = name.toLowerCase();
      if (!canonicalVisibleName(name) || seen.has(key)) return undefined;
      seen.add(key);
    }
  }
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
  // QR/clipboard/native bridges are runtime inputs, even when their TypeScript
  // adapters promise a string. Refuse malformed values before reading .length
  // or invoking string methods; a bad paste must not throw out of Start.
  if (typeof code !== 'string') return { ok: false, problem: { kind: 'not_a_code' } };
  // Exported images can yield aggressively wrapped codes, with indentation
  // between even individual characters. Allow up to three separator characters
  // per code character, while bounding raw input before normalization so a
  // megabyte of whitespace cannot hide a small otherwise-valid code.
  if (code.length > SHARE_CODE_MAX * 4) return { ok: false, problem: { kind: 'too_long', max: SHARE_CODE_MAX } };
  // Rich-text copies can carry invisible Unicode formatting around or
  // between visible ASCII code characters: bidi controls, soft hyphens,
  // combining grapheme joiners, variation selectors, and others. None belong
  // to the wire alphabet. Strip the whole default-ignorable category rather
  // than a hand-maintained subset, only after bounding the raw input.
  const text = code.replace(/[\s\p{Default_Ignorable_Code_Point}]+/gu, '');
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

/** A platform adapter may supply unknown values at runtime despite the TypeScript seam.
 * Refuse invalid user text before constructing a new simulation session. */
const SharedNamesS = z.object({
  founder: z.string().optional(),
  house: z.string().optional(),
  friends: z.array(z.string()).max(MAX_FRIENDS).optional(),
});

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
  // A complete named code provides every name itself. Any recipient fields
  // left over from an earlier anonymous import are unused and must not veto
  // this canonical founding, even when a host supplies malformed stale data.
  // Anonymous codes still validate every supplied field, including surplus
  // friend names that would otherwise be silently dropped.
  const recipientNames = f.missing.length === 0 ? {} : opts.names === undefined ? {} : opts.names;
  const parsedNames = SharedNamesS.safeParse(recipientNames);
  if (!parsedNames.success) {
    return { ok: false, problem: { kind: 'invalid_names' } };
  }
  const given = parsedNames.data;
  // A complete named code also owns an absent founder-name answer. Only an
  // anonymous code asks the recipient for one; stale input must neither change
  // that complete founding nor cause its unused name to fail validation (#3039).
  const recipientFounder = f.missing.includes('founder') ? given.founder : undefined;
  // Anonymous codes encode an exact friend roster. Extra supplied names must
  // not disappear silently while the import claims to honour the recipient's
  // founding; this also applies to a code with no friends at all.
  if (f.houseName === undefined && (given.friends?.length ?? 0) > f.friends.length) {
    return { ok: false, problem: { kind: 'invalid_names' } };
  }
  // A recipient may leave the founder answer blank, but not submit an
  // invisible-only name in place of one. Check before newGame so import
  // remains atomic and agrees with staged signing's visible-name rule.
  if (recipientFounder !== undefined) {
    const supplied = recipientFounder.trim();
    // The signing stores the untrimmed nonblank answer in its log. Even when
    // the displayed name fits, an overlong raw answer cannot be encoded in a
    // named code later; reject before creating an unshareable founding.
    if ((supplied.length > 0 && recipientFounder.length > PERSON_NAME_MAX)
      || !validFounderName(supplied)) {
      return { ok: false, problem: { kind: 'invalid_names' } };
    }
  }
  const houseName = f.houseName ?? given.house?.trim() ?? '';
  const friendNames = f.friends.map((friend, i) => friend.name ?? given.friends?.[i]?.trim() ?? '');
  // The normal signing checks lengths before mutating its world, but a share
  // import must reject an oversized recipient name before even constructing a
  // fresh GameSession. Normalize exactly as foundHouse/normaliseFriends do:
  // whitespace padding alone must not make a valid name too long.
  const signingLength = (name: string) => name.trim().replace(/\s+/g, ' ').length;
  if (!wellFormedUtf16(houseName) || friendNames.some((name) => !wellFormedUtf16(name))
    || signingLength(houseName) > HOUSE_NAME_MAX
    || friendNames.some((name) => signingLength(name) > FRIEND_NAME_MAX)) {
    return { ok: false, problem: { kind: 'invalid_names' } };
  }
  // Unlike manual signing's optional friends, a shared roster is required:
  // every encoded friend must receive a visible name. The founding validator
  // skips invisible-only optional names, which would silently shorten an
  // imported roster and break the code's mechanical founding contract (#2264).
  const missing: SharedName[] = [
    ...(!houseName.replace(/\p{Default_Ignorable_Code_Point}/gu, '').trim() ? ['house' as const] : []),
    ...(friendNames.some((name) => !name.replace(/\p{Default_Ignorable_Code_Point}/gu, '').trim())
      ? ['friends' as const] : []),
  ];
  if (missing.length) return { ok: false, problem: { kind: 'names_needed', missing } };

  // A founder name the code left out is the recipient's to give, or to
  // leave blank. An authored founder (no founder payload) is not a missing
  // name: caller-provided, possibly stale input must not turn it into a
  // different signing behind the code's back.
  // Manual signing keeps a nonblank answer byte-for-byte in its decision log;
  // bootstrap alone trims the displayed name. Preserve the same answer here
  // so supplying the same excluded names reproduces the canonical founding.
  const founderName = f.founder?.name ?? recipientFounder;
  // An explicit empty name is a real signing answer in the decision log:
  // blank leaves the authored person's name, but it is still recorded. A
  // named code must preserve that answer byte-for-byte to reproduce its save.
  // When names were excluded, however, a blank recipient field is no answer.
  const founder: FounderAnswer | undefined = f.founder
    ? {
        gender: f.founder.gender,
        configuration: f.founder.configuration,
        ...(f.founder.name !== undefined
          ? { name: f.founder.name }
          : founderName?.trim() ? { name: founderName } : {}),
      }
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
