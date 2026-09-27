import type { SessionView } from '@ed/core';

export type MemberView = SessionView['halls'][number]['members'][number];

/**
 * WHO THIS PERSON HANGS UNDER, ACCORDING TO THE BOOK.
 *
 * The tree is drawn from `record.parents` and never from `parents` — a forged
 * dowry moves the first and not the second, and a house that has bought itself
 * a grandmother should see the grandmother it bought. The truth is on the card
 * when you open it.
 *
 * The father where the hall holds him, the mother otherwise, so that a child
 * with both parents present hangs once rather than twice. A hall is not a
 * house (invariant 15): the parent may be alive in another hall entirely, in
 * which case the child is a root of this one, which is exactly what a cadet
 * branch looks like from the inside.
 */
export function recordedParent(m: MemberView, hall: MemberView[]): string | undefined {
  const claimed = m.record.parents;
  const here = (id: string | undefined) => (id && hall.some((x) => x.id === id) ? id : undefined);
  return here(claimed.father) ?? here(claimed.mother);
}

/**
 * A MARRIAGE IS AN EDGE (issue #56).
 *
 * The tree nests by parentage, so a spouse married in from another house had
 * no parent here and became a ROOT — a row of her own, between two of the
 * house's children, joined to her husband by nothing but a line of text
 * inside a card nobody had opened. In a game whose most consequential
 * recurring decision is who marries whom.
 *
 * So a spouse who is only a root because she married in is drawn beside her
 * husband instead of beneath nobody.
 *
 * ── THE THING THIS MUST NOT DO ────────────────────────────────────────────
 *
 * Lose anybody. Children hang off `recordedParent`, which answers with the
 * father where the hall holds him and the mother otherwise — so the parent a
 * child hangs under may well be the married-in one. Attach her to her husband
 * without moving her children and her descendants leave the tree silently,
 * which is this repository's failure mode with a family in it.
 *
 * Hence two rules, and the second is the one doing the work:
 *
 *   - She is attached only when her husband is NOT himself a root, so exactly
 *     one of the pair anchors the row and the anchor is the one with blood in
 *     this hall.
 *   - `children` returns the children of BOTH of them. Whoever the record
 *     hangs a child under, the child appears under the couple.
 */
export function partner(m: MemberView, hall: MemberView[]): MemberView | undefined {
  return m.spouse ? hall.find((x) => x.id === m.spouse!.id) : undefined;
}

/** Who is drawn beside somebody rather than on a row of their own. */
function attached(hall: MemberView[]): Set<string> {
  const out = new Set<string>();
  for (const m of hall) {
    if (recordedParent(m, hall) !== undefined) continue; // has blood here; anchors itself
    const spouse = partner(m, hall);
    if (!spouse) continue;
    // Only where the spouse anchors the row. Two rootless partners stay two
    // rows: attaching either to the other would pick one arbitrarily, and the
    // arbitrary pick is the one that reads as a mistake.
    if (recordedParent(spouse, hall) === undefined) continue;
    // And never both ways round, which would draw neither.
    if (out.has(spouse.id)) continue;
    out.add(m.id);
  }
  return out;
}

/**
 * The people in this hall nobody in this hall is recorded as the parent of —
 * less those drawn beside a spouse who anchors the row instead.
 */
export function roots(hall: MemberView[]): MemberView[] {
  const beside = attached(hall);
  return hall.filter((m) => recordedParent(m, hall) === undefined && !beside.has(m.id));
}

/**
 * The people this hall records as theirs — and as their partner's, because the
 * couple is drawn as one row and a child hangs under whichever of them the
 * record names.
 */
export function children(m: MemberView, hall: MemberView[]): MemberView[] {
  const beside = attached(hall);
  const spouse = partner(m, hall);
  const alsoTheirs = spouse && beside.has(spouse.id) ? spouse.id : undefined;
  return hall.filter((x) => {
    const under = recordedParent(x, hall);
    return under === m.id || (alsoTheirs !== undefined && under === alsoTheirs);
  });
}

/** The spouse drawn on this row, where there is one. */
export function drawnBeside(m: MemberView, hall: MemberView[]): MemberView | undefined {
  const spouse = partner(m, hall);
  return spouse && attached(hall).has(spouse.id) ? spouse : undefined;
}


export type KinshipRelation = 'father' | 'mother' | 'son' | 'daughter' | 'husband' | 'wife';

export interface KinshipStep {
  /** The next person on the recorded path. */
  person: MemberView;
  /** What that person is to the person immediately before them. */
  relation: KinshipRelation;
}

/**
 * HOW THE BOOK SAYS TWO PEOPLE ARE RELATED (#268).
 *
 * This deliberately walks the same recorded parentage the tree draws, plus
 * marriages. It never consults `MemberView.parents`: a forged lineage must
 * produce the forged relationship path, because that is the relationship the
 * household can actually plan from.
 *
 * The caller supplies the flattened members from every hall it wants to make
 * navigable. That is what lets a path cross a cadet-hall boundary without
 * teaching this pure client helper what a hall is.
 */
export function kinshipPath(
  a: MemberView | string,
  b: MemberView | string,
  members: MemberView[],
): KinshipStep[] | undefined {
  const byId = new Map(members.map((member) => [member.id, member]));
  const startId = typeof a === 'string' ? a : a.id;
  const goalId = typeof b === 'string' ? b : b.id;

  if (!byId.has(startId) || !byId.has(goalId)) return undefined;
  if (startId === goalId) return [];

  const edges = new Map<string, KinshipStep[]>();
  const connect = (from: string, to: string, relation: KinshipRelation): void => {
    const person = byId.get(to);
    if (!person) return;
    const list = edges.get(from) ?? [];
    if (!list.some((edge) => edge.person.id === to && edge.relation === relation)) {
      list.push({ person, relation });
      edges.set(from, list);
    }
  };
  const childRelation = (child: MemberView): KinshipRelation => (
    child.sex === 'female' ? 'daughter' : 'son'
  );
  const spouseRelation = (spouse: MemberView): KinshipRelation => (
    spouse.sex === 'female' ? 'wife' : 'husband'
  );

  for (const member of members) {
    const { father, mother } = member.record.parents;
    if (father) {
      connect(member.id, father, 'father');
      connect(father, member.id, childRelation(member));
    }
    if (mother) {
      connect(member.id, mother, 'mother');
      connect(mother, member.id, childRelation(member));
    }

    const spouseId = member.spouse?.id;
    const spouse = spouseId ? byId.get(spouseId) : undefined;
    if (spouse) {
      connect(member.id, spouse.id, spouseRelation(spouse));
      connect(spouse.id, member.id, spouseRelation(member));
    }
  }

  const previous = new Map<string, { id: string; step: KinshipStep }>();
  const seen = new Set<string>([startId]);
  const queue: string[] = [startId];

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const here = queue[cursor]!;
    for (const step of edges.get(here) ?? []) {
      const next = step.person.id;
      if (seen.has(next)) continue;
      seen.add(next);
      previous.set(next, { id: here, step });

      if (next === goalId) {
        const path: KinshipStep[] = [];
        let at = goalId;
        while (at !== startId) {
          const link = previous.get(at);
          if (!link) return undefined;
          path.push(link.step);
          at = link.id;
        }
        return path.reverse();
      }

      queue.push(next);
    }
  }

  return undefined;
}
