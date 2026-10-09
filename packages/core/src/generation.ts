import type { Person } from '@ed/schema';
import type { GenerationQuestion, SimCtx } from './world.js';
import { heirApparent } from './people/succession.js';
import { branchOf } from './people/branches.js';
import { rungTitle } from './ascension.js';
import { campaignDef } from './campaign.js';
import { msg } from './messages.js';

/**
 * `say` renders the question only once it is chosen, so a Plain English miss
 * is reported for the words the player is shown and not for every pressure
 * that lost. `text` stays in place, empty, so the chosen question keeps the
 * key order it has always been saved in.
 */
type Candidate = GenerationQuestion & { score: number; say: () => string };

const openDiscrepancies = (ctx: SimCtx): number =>
  [...ctx.world.discrepancies.values()].filter((d) => d.state === 'open').length;

const livingBlood = (ctx: SimCtx): Person[] =>
  ctx.world.people.blood(ctx.world.playerHouse).filter((p) => p.status === 'alive');

function candidate(
  kind: GenerationQuestion['kind'],
  score: number,
  say: () => string,
  opened: number,
  baseline: number,
  subject?: Person,
): Candidate {
  const signature = `${kind}:${subject?.id ?? '-'}`;
  return {
    kind, score, text: '', opened, baseline, signature,
    ...(subject ? { subject: subject.id, subjectName: subject.name } : {}),
    say,
  };
}

/**
 * ONE QUESTION FOR ONE GENERATION (issue #213).
 *
 * Pure. It reads pressures that already exist and chooses the strongest one.
 * The chosen value is copied onto the succession record by the two places a
 * Head can first take the seal, so it cannot change underneath the player as
 * the generation unfolds.
 */
export function chooseGenerationQuestion(
  ctx: SimCtx,
  previous?: GenerationQuestion,
): GenerationQuestion | undefined {
  const w = ctx.world;
  const head = w.people.living().find((p) => p.castSlots.includes('head'));
  if (!head) return undefined;

  const candidates: Candidate[] = [];
  const heir = heirApparent(ctx, head.id);
  if (heir && heir.madness >= 25) {
    candidates.push(candidate(
      'unstable_heir', 100,
      () => msg(ctx, 'generation.question.unstable_heir',
        '{HEIR} stands nearest the seal, and the strain is already visible. Do we risk the line on him?',
        { HEIR: heir.name }),
      w.year, heir.madness, heir,
    ));
  }

  const blood = livingBlood(ctx);
  const thinAt = Math.max(5, Math.floor(w.bloodHighWater * 0.35));
  if (blood.length <= thinAt) {
    candidates.push(candidate(
      'thin_line', 90,
      () => msg(ctx, 'generation.question.thin_line',
        'Only {COUNT} of the blood are living. Can {HEAD} leave the line stronger than he found it?',
        { COUNT: String(blood.length), HEAD: head.name }),
      w.year, blood.length, head,
    ));
  }

  const discrepancies = openDiscrepancies(ctx);
  if (discrepancies >= 2) {
    candidates.push(candidate(
      'record', 80,
      () => msg(ctx, 'generation.question.record',
        'The chronicle carries {COUNT} open contradictions. Does {HEAD} protect the legend, or leave something the house can prove?',
        { COUNT: String(discrepancies), HEAD: head.name }),
      w.year, discrepancies, head,
    ));
  }

  const totalClauses = campaignDef(w.campaign).clauses;
  const remaining = totalClauses - w.clausesRecovered.size;
  if (remaining > 0 && remaining <= 2) {
    candidates.push(candidate(
      'ledger', 70,
      () => (remaining === 1
        ? msg(ctx, 'generation.question.ledger_one',
          'The Ledger is one clause from complete. Does {HEAD} fund the reading, or the house that must survive it?',
          { HEAD: head.name })
        : msg(ctx, 'generation.question.ledger',
          'The Ledger is {COUNT} clauses from complete. Does {HEAD} fund the reading, or the house that must survive it?',
          { COUNT: String(remaining), HEAD: head.name })),
      w.year, w.clausesRecovered.size, head,
    ));
  }

  const troubled = [...w.branches.values()]
    .filter((b) => b.grievance >= 60)
    .sort((a, b) => b.grievance - a.grievance)[0];
  if (troubled) {
    candidates.push({
      kind: 'branch',
      score: 60,
      text: '',
      opened: w.year,
      baseline: troubled.grievance,
      subject: troubled.id,
      subjectName: troubled.name,
      signature: `branch:${troubled.id}`,
      say: () => msg(ctx, 'generation.question.branch',
        '{BRANCH} is close to breaking with the seat. Can {HEAD} keep that hall in the family?',
        { BRANCH: troubled.name, HEAD: head.name }),
    });
  }

  const daughter = blood
    .filter((p) => p.sex === 'female' && w.year - p.born >= 16 && w.year - p.born <= 38
      && !p.marriages.some((m) => m.to === undefined))
    .sort((a, b) => a.born - b.born)[0];
  if (daughter) {
    candidates.push(candidate(
      'match', 50,
      () => msg(ctx, 'generation.question.match',
        '{DAUGHTER} is old enough for the Match. Is her blood kept close, or spent outward for what the house needs now?',
        { DAUGHTER: daughter.name }),
      w.year, 0, daughter,
    ));
  }

  if (w.ascension.rung !== 'none') {
    candidates.push(candidate(
      'ascension', 40,
      () => msg(ctx, 'generation.question.ascension',
        '{HEAD} inherits a house standing at {RUNG}. Can this generation hold the climb without spending the line beneath it?',
        { HEAD: head.name, RUNG: rungTitle(w.ascension.rung) }),
      w.year, Object.keys(w.ascension.reachedAt).length, head,
    ));
  }

  candidates.sort((a, b) => b.score - a.score || a.signature.localeCompare(b.signature));
  const picked = candidates.find((c) => c.signature !== previous?.signature);
  if (!picked) return undefined;
  const { score: _score, say, ...question } = picked;
  return { ...question, text: say() };
}

/** What actually became of a generation's opening question. No projected outcomes. */
export function answerGenerationQuestion(ctx: SimCtx, q: GenerationQuestion): string {
  const w = ctx.world;
  const subject = q.subject ? w.people.get(q.subject) : undefined;

  switch (q.kind) {
    case 'unstable_heir': {
      if (!subject || subject.status !== 'alive') {
        return q.subjectName !== undefined
          ? msg(ctx, 'generation.answer.heir_died', '{HEIR} did not live to take the seal.', { HEIR: q.subjectName })
          : msg(ctx, 'generation.answer.heir_died_unnamed', 'The heir did not live to take the seal.');
      }
      if (subject.castSlots.includes('head')) {
        return msg(ctx, 'generation.answer.heir_sealed',
          '{HEIR} took the seal. His Madness now stands at {MADNESS}, against {BASELINE} when the question opened.',
          { HEIR: subject.name, MADNESS: String(Math.round(subject.madness)), BASELINE: String(Math.round(q.baseline)) });
      }
      return msg(ctx, 'generation.answer.heir_passed_over',
        '{HEIR} lived through the generation but did not take the seal; his Madness now stands at {MADNESS}.',
        { HEIR: subject.name, MADNESS: String(Math.round(subject.madness)) });
    }
    case 'thin_line': {
      const now = livingBlood(ctx).length;
      const v = { BASELINE: String(q.baseline), NOW: String(now) };
      return now > q.baseline
        ? msg(ctx, 'generation.answer.blood_grew', 'The living blood grew: {BASELINE} when the generation opened, {NOW} when it closed.', v)
        : now < q.baseline
          ? msg(ctx, 'generation.answer.blood_thinned', 'The living blood thinned: {BASELINE} when the generation opened, {NOW} when it closed.', v)
          : msg(ctx, 'generation.answer.blood_held', 'The living blood held: {BASELINE} when the generation opened, {NOW} when it closed.', v);
    }
    case 'record': {
      const now = openDiscrepancies(ctx);
      const proved = [...w.discrepancies.values()].filter((d) => d.state === 'proven').length;
      return msg(ctx, 'generation.answer.record',
        'The book closed the generation with {NOW} open contradictions; {PROVED} had been proven by then.',
        { NOW: String(now), PROVED: String(proved) });
    }
    case 'ledger': {
      const now = w.clausesRecovered.size;
      const v = { GAINED: String(Math.max(0, now - q.baseline)), NOW: String(now) };
      return now - q.baseline === 1
        ? msg(ctx, 'generation.answer.ledger_one',
          'The house recovered {GAINED} Ledger clause during the generation, bringing the total to {NOW}.', v)
        : msg(ctx, 'generation.answer.ledger',
          'The house recovered {GAINED} Ledger clauses during the generation, bringing the total to {NOW}.', v);
    }
    case 'branch': {
      const branch = q.subject ? w.branches.get(q.subject) : undefined;
      if (!branch) {
        return q.subjectName !== undefined
          ? msg(ctx, 'generation.answer.branch_gone', '{BRANCH} did not remain a standing cadet hall.', { BRANCH: q.subjectName })
          : msg(ctx, 'generation.answer.branch_gone_unnamed', 'The troubled hall did not remain a standing cadet hall.');
      }
      return msg(ctx, 'generation.answer.branch',
        "{BRANCH}'s grievance stands at {GRIEVANCE}, against {BASELINE} when the generation opened.",
        { BRANCH: branch.name, GRIEVANCE: String(Math.round(branch.grievance)), BASELINE: String(Math.round(q.baseline)) });
    }
    case 'match': {
      if (!subject || subject.status !== 'alive') {
        return q.subjectName !== undefined
          ? msg(ctx, 'generation.answer.daughter_died', '{DAUGHTER} did not live to make that marriage.', { DAUGHTER: q.subjectName })
          : msg(ctx, 'generation.answer.daughter_died_unnamed', 'The daughter did not live to make that marriage.');
      }
      const marriage = subject.marriages.find((m) => m.to === undefined);
      if (!marriage) {
        return msg(ctx, 'generation.answer.unmarried', '{DAUGHTER} remained unmarried when the generation closed.',
          { DAUGHTER: subject.name });
      }
      const spouse = w.people.get(marriage.spouse);
      const outward = spouse && spouse.houseOfOrigin !== w.playerHouse;
      return outward
        ? msg(ctx, 'generation.answer.married_out', '{DAUGHTER} married outward, into {HOUSE}.',
          { DAUGHTER: subject.name, HOUSE: ctx.content.house(spouse!.houseOfOrigin)?.name ?? spouse!.houseOfOrigin })
        : msg(ctx, 'generation.answer.married_in', "{DAUGHTER} married within the house's own blood.",
          { DAUGHTER: subject.name });
    }
    case 'ascension':
      return msg(ctx, 'generation.answer.ascension',
        'The house closes the generation at {RUNG}; its high-water mark is {BEST}.',
        { RUNG: rungTitle(w.ascension.rung), BEST: rungTitle(w.ascension.best) });
  }
}
