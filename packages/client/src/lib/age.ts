/** The numeric age stays visible; only this expanded wording is read aloud. */
export function ageLabel(age: number): string {
  return `${age} ${age === 1 ? 'year' : 'years'} old`;
}
