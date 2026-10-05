import { describe, expect, it } from 'vitest';
import { SeedPersonS } from './content.js';
import { PERSON_NAME_MAX, PersonNameS } from './person.js';

describe('person-name contract (#343)', () => {
  it('keeps person names short and trims outer whitespace', () => {
    expect(PERSON_NAME_MAX).toBe(32);
    const longest = 'A'.repeat(PERSON_NAME_MAX);
    expect(PersonNameS.parse(`  ${longest}  `)).toBe(longest);
    expect(() => PersonNameS.parse('A'.repeat(PERSON_NAME_MAX + 1))).toThrow();
    expect(() => PersonNameS.parse('   ')).toThrow();
  });

  it('uses the same contract for the authored founding cast', () => {
    const founder = SeedPersonS.parse({
      key: 'founder',
      name: '  Daveed Gearithy  ',
      sex: 'male',
      born: 1004,
      house: 'house_gearithy',
    });

    expect(founder.name).toBe('Daveed Gearithy');
    expect(() => SeedPersonS.parse({
      key: 'founder',
      name: 'D'.repeat(PERSON_NAME_MAX + 1),
      sex: 'male',
      born: 1004,
      house: 'house_gearithy',
    })).toThrow();
  });
});
