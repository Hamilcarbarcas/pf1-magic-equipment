// Homebrew special materials, registered into the native PF1 registry so the rest
// of the mod (and the system's own material handling) consumes them exactly like a
// built-in one. Gated behind the homebrew setting.

import { MODULE_ID } from './config.mjs';
import { HOMEBREW_MATERIALS } from '../data/homebrew.mjs';

/**
 * Register our materials. The registry fires `pf1RegisterMaterials` with itself as
 * the argument while it builds itself; `register(namespace, id, value)` is the
 * base-registry API.
 *
 * Registration is UNCONDITIONAL — the homebrew setting is not consulted here, for
 * two reasons:
 *
 *  - PF1 constructs its registries from inside the `init` hook, and system listeners
 *    run before module ones, so our settings do not exist yet at this point.
 *    Reading one throws.
 *  - More importantly it would be wrong. The setting gates what can be *chosen*,
 *    never what already applies. A material missing from the registry would make an
 *    item that already uses it lose its price, hardness and weight silently.
 *
 * The picker filter lives in `data.materialVisible` instead, which is where the
 * "hidden but still working" behaviour belongs.
 */
export function registerMaterials() {
  Hooks.on('pf1RegisterMaterials', (registry) => {
    for (const mat of HOMEBREW_MATERIALS) {
      const { _id, ...rest } = mat;
      try {
        registry.register(MODULE_ID, _id, { _id, ...rest });
      } catch (e) {
        console.error(`${MODULE_ID} | failed to register material "${_id}"`, e);
      }
    }
  });
}
