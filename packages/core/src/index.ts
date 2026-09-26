export * from './rng.js';
export * from './genetics/loci.js';
export * from './genetics/meiosis.js';
export * from './genetics/expression.js';
export * from './people/store.js';
export * from './people/factory.js';
export * from './people/condition.js';
export * from './people/vitality.js';
export * from './people/heirlooms.js';
export * from './people/library.js';
export * from './people/papers.js';
export * from './people/bond.js';
export * from './people/careers.js';
export * from './people/names.js';
export * from './people/naming.js';
export * from './people/succession.js';
export * from './people/secrets.js';
export * from './people/minting.js';
export * from './people/branches.js';
export * from './people/relationships.js';
export * from './relationship-threads.js';
export * from './people/demography.js';
export * from './people/match.js';
export * from './people/panel.js';
export * from './people/rivals.js';
export * from './events/conditions.js';
export * from './events/slots.js';
export * from './events/selection.js';
export * from './events/effects.js';
export * from './events/influence.js';
export * from './events/checks.js';
export * from './events/frame.js';
export * from './events/availability.js';
export * from './events/scope.js';
export * from './events/reach.js';
export * from './events/deciders.js';
export * from './events/decisions.js';
export * from './events/arcs.js';
export * from './events/tales.js';
export * from './events/rites.js';
export * from './ages/scheduler.js';
export * from './land.js';
export * from './muster.js';
export * from './economy.js';
export * from './assize.js';
export * from './bearing.js';
export * from './advisers.js';
export * from './ascension.js';
export * from './cast.js';
export * from './table.js';
export * from './auction.js';
export * from './record.js';
export * from './run-library.js';
export * from './tools/testFamilies.js';
export * from './world.js';
export * from './year/report.js';
export * from './year/passage.js';
export * from './year/phases.js';
export * from './year/step.js';
export * from './sim.js';
export * from './save.js';
export * from './replay.js';
export * from './prologue.js';
export * from './campaign.js';
export * from './ending.js';
export * from './chapter.js';
export * from './session.js';
export * from './ambition.js';
export * from './testing.js';

/**
 * `corpus.js` and `tools/mutate.js` are NOT re-exported here, on purpose.
 *
 * Both are Node-only tooling — `corpus.js` reads and writes the cache with
 * `node:fs`/`node:crypto`/`node:zlib`, `tools/mutate.js` rewrites source files
 * on disk — and `export *` makes a module part of THIS package's module graph
 * whether or not anything actually calls into it: a barrel re-export forces
 * the module to load and evaluate to know what it exports. The client imports
 * `@ed/core` for the simulation and nothing else, so the moment either of
 * these joined the barrel, Vite pulled `node:crypto` into the browser bundle
 * and the whole app failed to mount — `Cannot access 'node:crypto.createHash'
 * in client code` — silently, since a dev server that throws on first paint
 * still says "ready" in the terminal.
 *
 * Their few consumers (`corpus-warm.ts`, `corpus.slow.test.ts`,
 * `record.slow.test.ts`) import the file directly instead of through here.
 */
