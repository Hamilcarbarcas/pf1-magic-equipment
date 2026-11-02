// "Treated as one category lighter" (mithral, Kanthaal): worn armor of such a material
// reports one category lighter, minimum light, to everything that reads the actor's
// worn-armor type – speed reduction, run multiplier, @armor.type. Proficiency reads the
// item's own subtype and is untouched. Live from the material, so it needs no Apply.
// See DESIGN §13.3.

import { materialTraits } from './data.mjs';

/** Equipment subtype → the category one lighter, as a `pf1.config.armorTypes` key. */
const LIGHTER = { lightArmor: 'light', mediumArmor: 'light', heavyArmor: 'medium' };

/**
 * libWrapper WRAPPER for `ItemEquipmentPF#applyEquippedEffects`. The original raises
 * `actor.equipment.armor.type` to this armor's real category; when the material
 * lightens it, redo that step from the pre-call value with the lighter category.
 */
export function lightenArmorCategory(wrapped, ...args) {
  const worn = this.actor?.equipment?.armor;
  const before = worn ? { type: worn.type, id: worn.id } : null;
  const result = wrapped(...args);
  try {
    if (!before || this.subType !== 'armor' || !this.isActive) return result;
    if (!materialTraits(this.normalMaterial).lighterCategory) return result;
    const types = globalThis.pf1?.config?.armorTypes;
    const lighter = types?.[LIGHTER[this.system?.equipmentSubtype]];
    if (lighter == null) return result;
    if (lighter > before.type) {
      worn.type = lighter;
      worn.id = this.id;
    } else {
      // Something else worn is at least as heavy; it keeps the slot.
      worn.type = before.type;
      worn.id = before.id;
    }
  } catch (err) {
    console.error('pf1-magic-equipment | armor category adjustment failed', err);
  }
  return result;
}
