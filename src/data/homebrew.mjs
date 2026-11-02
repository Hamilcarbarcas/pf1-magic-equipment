// Homebrew and non-RAW content, kept in one file so a public release can ship
// without it. Everything here is gated behind the "Include homebrew content"
// setting: hidden from the pickers when off, but never stripped from an item that
// already has it applied.
//
// Marking convention, used by the catalogs and the sheet:
//   homebrew: true        — not in any published Paizo source, or a deliberate
//                           deviation from RAW.
//   homebrewNote: string  — one line saying what it is or how it differs, shown
//                           as a tooltip on the picker row.

import { ADAMANTINE_ARMOR_DR } from './material-traits.mjs';

/**
 * Special materials registered into `pf1.registry.materials` at setup. Fields match
 * PF1's Material data model (see the system's `module/registry/materials.mjs`);
 * unknown fields are dropped by the model, so `homebrew` is tracked separately in
 * HOMEBREW_MATERIAL_IDS below rather than on the entry, and rules the model can't
 * express go in HOMEBREW_MATERIAL_TRAITS.
 */
export const HOMEBREW_MATERIALS = [
  {
    // Mithral + adamantine + cold iron in one. No set price: items are written at 0 gp.
    // HP is +50% (healthMultiplier), inert until material → hp is built.
    _id: 'kanthaalSteel',
    name: 'Kanthaal Steel',
    baseMaterial: ['steel'],
    masterwork: true,
    hardness: 20,
    healthPerInch: 40,
    healthMultiplier: 1.5,
    armor: { acp: 3, maxDex: 2, asf: -10 },
    shield: { acp: 3, maxDex: 2, asf: -10 },
    weight: { multiplier: 0.5 },
  },
];

/** Registry ids from HOMEBREW_MATERIALS, for the picker's homebrew filter. */
export const HOMEBREW_MATERIAL_IDS = new Set(HOMEBREW_MATERIALS.map((m) => m._id));

/** Same shape as MATERIAL_TRAITS in `material-traits.mjs`. */
export const HOMEBREW_MATERIAL_TRAITS = {
  kanthaalSteel: {
    lighterCategory: true,
    armorDR: ADAMANTINE_ARMOR_DR,
    asfFloor: 5,
    countsAs: ['adamantine', 'coldIron', 'mithral'],
    intrinsicEnh: 1,
    enchantPerBonus: { weapon: 4000, armor: 2000 },
    fixedCostMultiplier: 1.5,
    priceless: true,
  },
};

/**
 * Extra ability descriptors, merged into the bundled catalogs. Same shape as
 * `weapon-abilities.mjs` entries, plus `kind` naming which catalog they join and
 * the homebrew markers. Empty for now — this is the seam for adding table-specific
 * abilities without editing the auto-generated files.
 * @type {{ kind: 'weapon'|'armor'|'shield', key: string, name: string, bonus: number,
 *          priceMod: number, costType: 'bonus'|'fixed', homebrew: true }[]}
 */
export const HOMEBREW_ABILITIES = [];
