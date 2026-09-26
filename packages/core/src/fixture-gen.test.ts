import { gzipSync } from 'node:zlib';
import { describe, it } from 'vitest';
import { loadContent } from '@ed/content';
import { bootstrap, saveGame } from '@ed/core';

describe('temporary current-save fixture generator', () => {
  it('prints a serializer-produced format-25 fixture', () => {
    const content = loadContent();
    const saved = saveGame(bootstrap(content, 1042, 1042));
    const payload = gzipSync(Buffer.from(JSON.stringify(saved), 'utf8')).toString('base64');
    console.log('CURRENT_SAVE_FIXTURE_GENERATED=' + payload);
  });
});
