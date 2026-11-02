// Material rules that PF1's Material data model has no field for, keyed by registry
// id. The model drops unknown fields, so these live here instead of on the registry
// entry. Homebrew materials add their own through HOMEBREW_MATERIAL_TRAITS.

/**
 * @typedef {object} MaterialTraits
 * @property {boolean} [lighterCategory]  armor counts one category lighter for
 *   movement and other limits (minimum light); proficiency still uses the real one
 * @property {{ lightArmor: number, mediumArmor: number, heavyArmor: number }} [armorDR]
 *   DR/– by the armor's actual category; armor only, never shields
 * @property {number} [asfFloor]  the material's spell-failure reduction stops at this %
 * @property {string[]} [countsAs]  weapons count as these materials for DR and hardness
 * @property {number} [intrinsicEnh]  weapons get this enhancement bonus to attack and
 *   damage; it doesn't make them magic and doesn't stack with other enhancement
 * @property {{ weapon: number, armor: number }} [enchantPerBonus]  extra gp per point of
 *   enhancement equivalent, by pricing table
 * @property {number} [fixedCostMultiplier]  multiplier on fixed-cost abilities
 * @property {boolean} [priceless]  the item's price is written as 0
 */

/** Adamantine armor's DR/– (also used by Kanthaal Steel). */
export const ADAMANTINE_ARMOR_DR = Object.freeze({ lightArmor: 1, mediumArmor: 2, heavyArmor: 3 });

/** @type {Record<string, MaterialTraits>} */
export const MATERIAL_TRAITS = {
  mithral: { lighterCategory: true },
  adamantine: { armorDR: ADAMANTINE_ARMOR_DR },
};
