// Catalog access: weapon abilities (bundled) and special materials (native PF1
// registry). Everything the UI/calc needs to enumerate and look up options.

import { WEAPON_ABILITIES } from '../data/weapon-abilities.mjs';
import { ENH_VALUES } from '../data/enh-values.mjs';

/** @typedef {import('../data/weapon-abilities.mjs').WEAPON_ABILITIES[number]} Ability */

const ABILITIES_BY_KEY = new Map(WEAPON_ABILITIES.map((a) => [a.key, a]));

/** All abilities (sorted by name at build time). */
export function allAbilities() {
  return WEAPON_ABILITIES;
}

/**
 * A lightweight catalog for scripts/macros building a selection UI: the ability
 * `key` (what you pass to the roll-bonus setter), display `name`, and `category`
 * (`'1'`…`'5'` for bonus-priced, `'fixed'` for flat-cost).
 * @returns {{ key: string, name: string, category: string }[]}
 */
export function listAbilities() {
  return WEAPON_ABILITIES.map((a) => ({
    key: a.key,
    name: a.name,
    category: a.costType === 'fixed' ? 'fixed' : String(a.bonus),
  }));
}

/** Look up one ability descriptor by key. */
export function getAbility(key) {
  return ABILITIES_BY_KEY.get(key) ?? null;
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

/** Abilities belonging to a category bucket. */
export function abilitiesInCategory(cat) {
  if (cat === 'all') return WEAPON_ABILITIES;
  if (cat === 'fixed') return WEAPON_ABILITIES.filter((a) => a.costType === 'fixed');
  const bonus = Number(cat);
  return WEAPON_ABILITIES.filter((a) => a.costType === 'bonus' && a.bonus === bonus);
}

/** The enhancement-value price band for a given total equivalent (weapon). */
export function enhBandCost(totalEquivalent, kind = 'weapon') {
  const table = ENH_VALUES.enhValues[kind] ?? ENH_VALUES.enhValues.weapon;
  if (totalEquivalent <= 0) return 0;
  const idx = Math.min(totalEquivalent, table.length) - 1;
  return table[idx] ?? table.at(-1);
}

export function masterworkBaseCost(kind = 'weapon') {
  return ENH_VALUES.masterworkCost[kind] ?? ENH_VALUES.masterworkCost.weapon;
}

/* --------------------------------------------------------------------------
 * Special materials — sourced from the native PF1 registry at runtime.
 * ------------------------------------------------------------------------ */

/** Get a registry Material by id, or null. */
export function getMaterial(key) {
  if (!key) return null;
  return globalThis.pf1?.registry?.materials?.get(key) ?? null;
}

/**
 * Materials selectable for a given weapon: the registry's own compatibility
 * check (`isAllowed`) decides. Excludes addon materials for now (v1 handles a
 * single "normal" material; addon support — e.g. alchemical silver — is a
 * follow-up). Returns [{ id, name }] sorted by name.
 */
export function materialsForItem(item) {
  const reg = globalThis.pf1?.registry?.materials;
  if (!reg) return [];
  const out = [];
  for (const mat of reg) {
    if (mat.addon) continue; // normal materials only; addons handled separately
    try {
      if (!mat.isAllowed(item)) continue;
    } catch (_e) {
      continue;
    }
    out.push({ id: mat.id, name: mat.name ?? mat.id });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/**
 * Addon materials selectable for a weapon (e.g. alchemical silver): addon entries
 * allowed for the item and compatible with the chosen normal material. Returns
 * [{ id, name }] sorted by name.
 */
export function addonMaterialsForItem(item, normalKey) {
  const reg = globalThis.pf1?.registry?.materials;
  if (!reg) return [];
  const out = [];
  for (const mat of reg) {
    if (!mat.addon) continue;
    try {
      if (!mat.isAllowed(item)) continue;
      if (normalKey && mat.isValidAddon && mat.isValidAddon(normalKey) === false) continue;
    } catch (_e) {
      continue;
    }
    out.push({ id: mat.id, name: mat.name ?? mat.id });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}
