import { z } from 'zod';

/**
 * ZOD PARSES WITHOUT GENERATING CODE.
 *
 * Zod 4 can compile each object schema into a generated function with
 * `new Function`. Measured on this content (#2497) it buys nothing we can
 * see: about 80 ms to parse the whole bundle and under a millisecond per save,
 * compiled or not. What it does cost is an eval probe that a strict
 * Content-Security-Policy reports as a violation even though Zod catches the
 * throw (the editor's build ships `script-src 'self'`), and generated code in
 * every host that opens a save. With it off, every host parses the same way
 * under any policy.
 *
 * `index.ts` imports this module first, so it runs before anything parses.
 */
z.config({ jitless: true });
