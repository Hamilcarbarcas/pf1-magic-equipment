// Catalog access: special abilities (bundled, one catalog per equipment kind) and
// special materials (native PF1 registry). Everything the UI/calc needs to
// enumerate and look up options.
//
// Ability keys are NOT unique across kinds — Defiant, Ghost Touch and Impervious
// exist on all three, and the Fortification and Spell Resistance lines exist on
// both armor and shields at different prices. Every lookup therefore takes a kind,
// and anything that persists an ability records the kind alongside the key.

import { WEAPON_ABILITIES } from '../data/weapon-abilities.mjs';
import { ARMOR_ABILITIES } from '../data/armor-abilities.mjs';
import { SHIELD_ABILITIES } from '../data/shield-abilities.mjs';
import { ENH_VALUES } from '../data/enh-values.mjs';
import { HOMEBREW_ABILITIES, HOMEBREW_MATERIAL_IDS } from '../data/homebrew.mjs';
import { showHomebrew } from './settings.mjs';

/** @typedef {import('../data/weapon-abilities.mjs').WEAPON_ABILITIES[number]} Ability */

const CATALOGS = {
  weapon: [...WEAPON_ABILITIES],
  armor: [...ARMOR_ABILITIES],
  shield: [...SHIELD_ABILITIES],
};

// Fold in homebrew additions, tagging every entry with the kind it belongs to so a
// descriptor is self-describing once it leaves its catalog.
for (const kind of Object.keys(CATALOGS)) {
  for (const a of CATALOGS[kind]) a.kind = kind;
}
for (const a of HOMEBREW_ABILITIES) {
  const list = CATALOGS[a.kind];
  if (!list) continue;
  const idx = list.findIndex((x) => x.key === a.key);
  const entry = { ...a, homebrew: true };
  if (idx >= 0) list[idx] = { ...list[idx], ...entry }; // homebrew override of a RAW entry
  else list.push(entry);
}
for (const list of Object.values(CATALOGS)) list.sort((a, b) => a.name.localeCompare(b.name));

const BY_KEY = Object.fromEntries(
  Object.entries(CATALOGS).map(([kind, list]) => [kind, new Map(list.map((a) => [a.key, a]))]),
);

/** Every ability of a kind, including homebrew (unfiltered — for lookups, not pickers). */
export function allAbilities(kind = 'weapon') {
  return CATALOGS[kind] ?? [];
}

/** Look up one ability descriptor. Returns null for an unknown kind/key pair. */
export function getAbility(key, kind = 'weapon') {
  return BY_KEY[kind]?.get(key) ?? null;
}

/**
 * A lightweight catalog for scripts/macros building a selection UI: the ability
 * `key` (what you pass to the roll-bonus setter), display `name`, `kind`, and
 * `category` (`'1'`…`'5'` for bonus-priced, `'fixed'` for flat-cost).
 * @param {'weapon'|'armor'|'shield'} [kind] omit for every kind.
 */
export function listAbilities(kind) {
  const kinds = kind ? [kind] : Object.keys(CATALOGS);
  return kinds.flatMap((k) => CATALOGS[k].map((a) => ({
    key: a.key,
    name: a.name,
    kind: k,
    category: a.costType === 'fixed' ? 'fixed' : String(a.bonus),
    homebrew: a.homebrew === true,
  })));
}

/**
 * The category buckets the UI's first dropdown offers.
 * `+1`…`+5` map to bonus-priced abilities of that enhancement equivalent;
 * `fixed` is the flat-cost abilities; `all` is everything.
 */
export const CATEGORIES = Object.freeze(['all', '1', '2', '3', '4', '5', 'fixed']);

/** Human label for a category value. */
export function categoryLabel(cat, loc) {
  if (cat === 'all') return loc('PF1ME.Category.All');
  if (cat === 'fixed') return loc('PF1ME.Category.Fixed');
  return `+${cat}`;
}

/**
 * Abilities offered in a category bucket, for a picker. Homebrew entries are
 * omitted unless the setting allows them — the catalogs themselves stay complete,
 * so an ability already applied to an item still resolves.
 */
export function abilitiesInCategory(cat, kind = 'weapon') {
  const all = CATALOGS[kind] ?? [];
  const visible = showHomebrew() ? all : all.filter((a) => a.homebrew !== true);
  if (cat === 'all') return visible;
  if (cat === 'fixed') return visible.filter((a) => a.costType === 'fixed');
  const bonus = Number(cat);
  return visible.filter((a) => a.costType === 'bonus' && a.bonus === bonus);
}

/** The enhancement-value price band for a given total equivalent. */
export function enhBandCost(totalEquivalent, kind = 'weapon') {
  // Shields are priced off the armor table (RAW: shields use armor enhancement costs).
  const tableKey = kind === 'shield' ? 'armor' : kind;
  const table = ENH_VALUES.enhValues[tableKey] ?? ENH_VALUES.enhValues.weapon;
  if (totalEquivalent <= 0) return 0;
  const idx = Math.min(totalEquivalent, table.length) - 1;
  return table[idx] ?? table.at(-1);
}

export function masterworkBaseCost(kind = 'weapon') {
  const tableKey = kind === 'shield' ? 'armor' : kind;
  return ENH_VALUES.masterworkCost[tableKey] ?? ENH_VALUES.masterworkCost.weapon;
}

/* --------------------------------------------------------------------------
 * Special materials — sourced from the native PF1 registry at runtime.
 * ------------------------------------------------------------------------ */

/** Get a registry Material by id, or null. */
export function getMaterial(key) {
  if (!key) return null;
  return globalThis.pf1?.registry?.materials?.get(key) ?? null;
}

/** Whether a material is one of ours rather than the system's. */
export function isHomebrewMaterial(mat) {
  return HOMEBREW_MATERIAL_IDS.has(mat?.id ?? mat?._id ?? mat);
}

/** Shared visibility rule for both material selectors. */
function materialVisible(mat, item) {
  if (isHomebrewMaterial(mat) && !showHomebrew()) return false;
  try {
    return mat.isAllowed(item);
  } catch (_e) {
    return false;
  }
}

/**
 * Materials selectable for a given item: the registry's own compatibility check
 * (`isAllowed`) decides, which already understands armor and shields. Excludes
 * addon materials, which have their own selector. Returns [{ id, name, homebrew }]
 * sorted by name.
 */
export function materialsForItem(item) {
  const reg = globalThis.pf1?.registry?.materials;
  if (!reg) return [];
  const out = [];
  for (const mat of reg) {
    if (mat.addon) continue; // normal materials only; addons handled separately
    if (!materialVisible(mat, item)) continue;
    out.push({ id: mat.id, name: mat.name ?? mat.id, homebrew: isHomebrewMaterial(mat) });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/**
 * Addon materials selectable for an item (e.g. alchemical silver): addon entries
 * allowed for the item and compatible with the chosen normal material. Returns
 * [{ id, name, homebrew }] sorted by name.
 */
export function addonMaterialsForItem(item, normalKey) {
  const reg = globalThis.pf1?.registry?.materials;
  if (!reg) return [];
  const out = [];
  for (const mat of reg) {
    if (!mat.addon) continue;
    if (!materialVisible(mat, item)) continue;
    try {
      if (normalKey && mat.isValidAddon && mat.isValidAddon(normalKey) === false) continue;
    } catch (_e) {
      continue;
    }
    out.push({ id: mat.id, name: mat.name ?? mat.id, homebrew: isHomebrewMaterial(mat) });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}
