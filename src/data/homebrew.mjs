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

/**
 * Special materials registered into `pf1.registry.materials` at setup. Fields match
 * PF1's Material data model (see the system's `module/registry/materials.mjs`);
 * unknown fields are dropped by the model, so `homebrew` is tracked separately in
 * HOMEBREW_MATERIAL_IDS below rather than on the entry.
 *
 * TODO(Patrick): Kanthaal Steel's numbers are PLACEHOLDERS — price, hardness,
 * health and the armor/shield ACP/max-Dex effects all need the real values before
 * this is used on a real item. It is registered so the always-masterwork list and
 * the weapon/armor pickers have something to point at.
 */
export const HOMEBREW_MATERIALS = [
  {
    _id: 'kanthaalSteel',
    name: 'Kanthaal Steel',
    baseMaterial: ['steel'],
    masterwork: true,
    hardness: 10,
    healthPerInch: 30,
    price: {
      lightWeapon: 0,
      oneHandWeapon: 0,
      twoHandWeapon: 0,
      rangedOneHandWeapon: 0,
      rangedTwoHandWeapon: 0,
      lightArmor: 0,
      mediumArmor: 0,
      heavyArmor: 0,
      shield: 0,
    },
  },
];

/** Registry ids from HOMEBREW_MATERIALS, for the picker's homebrew filter. */
export const HOMEBREW_MATERIAL_IDS = new Set(HOMEBREW_MATERIALS.map((m) => m._id));

/**
 * Extra ability descriptors, merged into the bundled catalogs. Same shape as
 * `weapon-abilities.mjs` entries, plus `kind` naming which catalog they join and
 * the homebrew markers. Empty for now — this is the seam for adding table-specific
 * abilities without editing the auto-generated files.
 * @type {{ kind: 'weapon'|'armor'|'shield', key: string, name: string, bonus: number,
 *          priceMod: number, costType: 'bonus'|'fixed', homebrew: true }[]}
 */
export const HOMEBREW_ABILITIES = [];
