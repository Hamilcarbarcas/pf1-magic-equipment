// Pure calculation: enhancement equivalent, fully-inclusive cost + breakdown,
// and the "easy-bucket" derived stats. No Foundry document writes happen here —
// callers feed in a base snapshot and the config, and get numbers back.

import { getAbility, enhBandCost, masterworkBaseCost, getMaterial } from './data.mjs';
import { MAX_ENH_EQUIVALENT } from './config.mjs';

/**
 * @typedef {object} BaseStats  Numbers taken from the linked base (unmodified) item.
 * @property {number} price     mundane base price (gp)
 * @property {number} weight    base weight (lb), before material adjustment
 * @property {number} hardness  base hardness
 * @property {number} hpBase    base hp (`system.hp.base`, pre-size/pre-enh)
 */

/** Map a weapon's handedness to the registry price keys to try, in order. */
function weaponPriceKeys(item) {
  switch (item?.system?.weaponSubtype) {
    case 'light': return ['lightWeapon'];
    case '2h': return ['twoHandWeapon'];
    case 'ranged': return ['rangedTwoHandWeapon', 'rangedOneHandWeapon', 'twoHandWeapon'];
    case '1h':
    default: return ['oneHandWeapon'];
  }
}

/** First non-zero flat material price among the candidate keys. */
function flatMaterialPrice(mat, keys) {
  for (const k of keys) {
    const v = mat?.price?.[k];
    if (v) return v;
  }
  return 0;
}

/** A material's price surcharge over the base (multiplier + flat + per-pound). */
function rawMaterialSurcharge(mat, basePrice, baseWeight, keys) {
  if (!mat) return 0;
  const flat = flatMaterialPrice(mat, keys);
  const mult = mat.price?.multiplier ?? 1;
  const perPound = mat.price?.perPound ?? 0;
  return basePrice * (mult - 1) + flat + perPound * baseWeight;
}

/**
 * Whether a material forces masterwork quality. Sourced from the material's own
 * registry flag, so both PF1's base materials and any registered by another mod
 * (e.g. astora-mod's homebrew) drive this correctly with no list to maintain.
 */
function materialForcesMasterwork(mat) {
  return !!(mat?.masterwork);
}

/**
 * Total enhancement equivalent (base enh + bonus-priced abilities) and the list
 * of flat-cost abilities.
 * @returns {{ totalEquivalent: number, fixed: object[] }}
 */
export function enhancementEquivalent(config) {
  let totalEquivalent = config.enh || 0;
  const fixed = [];
  for (const row of config.abilities ?? []) {
    const a = getAbility(row.key);
    if (!a) continue;
    if (a.costType === 'bonus') totalEquivalent += a.bonus || 0;
    else fixed.push(a);
  }
  return { totalEquivalent, fixed };
}

/**
 * Fully-inclusive cost + itemized breakdown + the effective masterwork state.
 * @param {{ item: object, base: BaseStats, config: object }} args
 */
export function computeCost({ item, base, config }) {
  const kind = 'weapon';
  const mwkBase = masterworkBaseCost(kind);
  const mat = getMaterial(config.materialKey);
  const basePrice = base.price || 0;
  const baseWeight = base.weight || 0;

  // --- masterwork state ---
  const forced = (config.enh > 0) || (config.abilities?.length > 0) || (mat && materialForcesMasterwork(mat));
  const effectiveMasterwork = forced ? true : !!config.masterwork;
  const mwkIncludedInMaterial = mat?.masterwork === true;
  const mwkLine = (effectiveMasterwork && !mwkIncludedInMaterial) ? mwkBase : 0;

  // --- material surcharge (beyond the non-mwk base price) ---
  const keys = weaponPriceKeys(item);
  let materialLine = 0;
  if (mat) {
    materialLine = rawMaterialSurcharge(mat, basePrice, baseWeight, keys);
    // "per pound" materials (e.g. darkwood) are priced on top of a masterwork
    // version, so fold the mwk surcharge into the material line.
    if ((mat.price?.perPound ?? 0) > 0 && mwkIncludedInMaterial) materialLine += mwkBase;
  }
  // Addon material (e.g. alchemical silver): a straight surcharge on top.
  const addonMat = getMaterial(config.addonKey);
  if (addonMat) materialLine += rawMaterialSurcharge(addonMat, basePrice, baseWeight, keys);

  // --- enhancement (single figure off the total equivalent) + fixed abilities ---
  const { totalEquivalent, fixed } = enhancementEquivalent(config);
  const band = enhBandCost(totalEquivalent, kind);
  const fixedCost = fixed.reduce((sum, a) => sum + (a.priceMod || 0), 0);
  const enchanting = (config.enh > 0) || (config.abilities?.length > 0);
  const enhSurcharge = enchanting ? (mat?.price?.enhancement?.weapon ?? 0) : 0;
  const enhancementLine = band + fixedCost + enhSurcharge;

  const total = basePrice + materialLine + mwkLine + enhancementLine;
  const currentPrice = item?.system?.price ?? 0;

  const warnings = [];
  if (totalEquivalent > MAX_ENH_EQUIVALENT) warnings.push('overEnh');

  return {
    total,
    delta: total - currentPrice,
    breakdown: {
      baseItem: basePrice,
      material: materialLine,
      masterwork: mwkLine,
      enhancement: enhancementLine,
    },
    effectiveMasterwork,
    totalEquivalent,
    warnings,
  };
}

/**
 * Build the item's magic name from its config, e.g. "+2 Flaming Cold Iron Dagger".
 * Order: enhancement, special abilities (by display output), material, base name.
 * Returns '' if there's nothing to build from (no base name).
 * @param {{ base: BaseStats, config: object }} args
 */
export function buildMagicName({ base, config }) {
  const baseName = base?.name?.trim();
  if (!baseName) return '';
  const parts = [];
  const enh = config.enh || 0;
  if (enh > 0) parts.push(`+${enh}`);
  for (const row of config.abilities ?? []) {
    const a = getAbility(row.key);
    if (a) parts.push(a.output || a.name);
  }
  const mat = getMaterial(config.materialKey);
  if (mat?.name) parts.push(mat.name);
  parts.push(baseName);
  return parts.join(' ').trim();
}

/**
 * The "easy-bucket" derived stats to write onto the weapon's native fields.
 * `system` auto-adds the enh mod to hardness/hp and size-scales hp, so we return
 * BASE values only.
 * @param {{ item: object, base: BaseStats, config: object }} args
 */
export function computeDerived({ item, base, config }) {
  const mat = getMaterial(config.materialKey);
  const addonMat = getMaterial(config.addonKey);
  const cost = computeCost({ item, base, config });

  const weightMult = (mat?.weight?.multiplier ?? 1) * (addonMat?.weight?.multiplier ?? 1);
  const weightBonusPerPound = (mat?.weight?.bonusPerPound ?? 0) + (addonMat?.weight?.bonusPerPound ?? 0);
  const weight = (base.weight || 0) * weightMult + (base.weight || 0) * weightBonusPerPound;

  const hardness = (mat && mat.hardness != null) ? mat.hardness : (base.hardness || 0);

  return {
    price: Math.max(0, Math.round(cost.total)),
    unidentifiedPrice: Math.max(0, Math.round(base.price || 0)),
    weight: Math.max(0, weight),
    hardness,
    hpBase: base.hpBase, // material hp effect deferred; enh/size applied by system
    masterwork: cost.effectiveMasterwork,
    enh: config.enh || 0,
    materialKey: config.materialKey || '',
    addonKey: config.addonKey || '',
    cost,
  };
}
