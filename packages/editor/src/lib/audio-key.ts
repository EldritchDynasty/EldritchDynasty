import type { InjectionKey } from 'vue';
import type { Sound } from '../../../client/src/lib/sound';

/**
 * One `Sound` for the whole app, handed down rather than imported.
 *
 * Two audio engines is two drones, and the second one is inaudible in the
 * sense that matters: you can hear it, but nothing on screen says where it
 * came from. `App.vue` owns the instance and provides it; everything else
 * takes it, and a view that is rendered without a provider (a test, a
 * storybook, the shell's smoke check) gets `null` and stays silent.
 */
export const SOUND: InjectionKey<Sound | null> = Symbol('ed.sound');
