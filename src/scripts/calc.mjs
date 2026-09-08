// Pure calculation: enhancement equivalent, fully-inclusive cost + breakdown,
// and the "easy-bucket" derived stats. No Foundry document writes happen here —
// callers feed in a base snapshot and the config, and get numbers back.

import { getAbility, enhBandCost, masterworkBaseCost, getMaterial } from './data.mjs';
import { MAX_ENH_EQUIVALENT, itemKind, loc } from './config.mjs';
import { isListedMasterworkMaterial } from './settings.mjs';

/**
 * @typedef {object} BaseStats  Numbers taken from the linked base (unmodified) item.
 * @property {number} price     mundane base price (gp)
 * @property {number} weight    base weight (lb), before material adjustment
 * @property {number} hardness  base hardness
 * @property {number} hpBase    base hp (`system.hp.base`, pre-size/pre-enh)
 * @property {number} [armorValue] armor/shield AC bonus (`system.armor.value`)
 * @property {number} [maxDex]  max Dex bonus (`system.armor.dex`), null = unlimited
 * @property {number} [acp]     armor check penalty (`system.armor.acp`)
 * @property {number} [asf]     arcane spell failure % (`system.spellFailure`)
 */

/**
 * The registry price keys to try for an item, in order. Weapons key off handedness,
 * armor off its weight category, shields off buckler-vs-not.
 */
function materialPriceKeys(item) {
  switch (itemKind(item)) {
    case 'armor':
      switch (item?.system?.equipmentSubtype) {
        case 'mediumArmor': return ['mediumArmor'];
        case 'heavyArmor': return ['heavyArmor'];
        case 'lightArmor':
        default: return ['lightArmor'];
      }
    case 'shield':
      // Bucklers have their own (cheaper) entry on some materials; fall back to the
      // generic shield price when a material doesn't distinguish them.
      return item?.system?.equipmentSubtype === 'buckler' ? ['buckler', 'shield'] : ['shield'];
    case 'weapon':
    default:
      switch (item?.system?.weaponSubtype) {
        case 'light': return ['lightWeapon'];
        case '2h': return ['twoHandWeapon'];
        case 'ranged': return ['rangedTwoHandWeapon', 'rangedOneHandWeapon', 'twoHandWeapon'];
        case '1h':
        default: return ['oneHandWeapon'];
      }
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

/**
 * A material's price surcharge over the base (multiplier + flat OR per-pound).
 *
 * `perPound` is the fallback for item kinds the material doesn't price explicitly —
 * mithral lists 500 gp/lb *and* flat armor/shield prices, and the registry marks the
 * per-pound figure "non-armor/shield only". So a matched flat key wins outright;
 * charging both would price a mithral chain shirt at four times RAW.
 */
function rawMaterialSurcharge(mat, basePrice, baseWeight, keys) {
  if (!mat) return 0;
  const flat = flatMaterialPrice(mat, keys);
  const mult = mat.price?.multiplier ?? 1;
  const perPound = flat ? 0 : (mat.price?.perPound ?? 0);
  return basePrice * (mult - 1) + flat + perPound * baseWeight;
}

/** Whether a material prices this item kind per pound (darkwood) rather than flat. */
function usesPerPound(mat, keys) {
  return !flatMaterialPrice(mat, keys) && (mat?.price?.perPound ?? 0) > 0;
}

/**
 * Whether a material forces masterwork quality: the material's own registry flag
 * (so PF1's base materials and any registered by another mod work with no list to
 * maintain) OR the GM-editable list, which covers materials the registry doesn't
 * flag. Distinct from `mat.masterwork` used as a *price* test below — that one asks
 * whether the material's price already includes the masterwork surcharge.
 */
function materialForcesMasterwork(mat) {
  return !!(mat?.masterwork) || isListedMasterworkMaterial(mat);
}

/**
 * A material's armor/shield stat effects, from the registry's own `armor`/`shield`
 * blocks (`acp`, `maxDex`, `asf`). Entries disagree on the sign of `acp` — mithral
 * records `acp: 3` for a 3-point *reduction* while others use negatives — so the
 * magnitude is taken and always applied as a reduction, which is what every
 * published material actually does.
 */
function materialArmorEffects(mat, kind) {
  const block = kind === 'shield' ? (mat?.shield ?? mat?.armor) : mat?.armor;
  if (!block) return { acp: 0, maxDex: 0, asf: 0 };
  return {
    acp: -Math.abs(block.acp ?? 0),
    maxDex: Math.abs(block.maxDex ?? 0),
    asf: -Math.abs(block.asf ?? 0),
  };
}

/**
 * Total enhancement equivalent (base enh + bonus-priced abilities) and the list
 * of flat-cost abilities. Rows carry their own kind, because a shield's rows can
 * come from either the shield or the weapon catalog.
 */
export function enhancementEquivalent(config, kind = 'weapon') {
  // A shield's weapon-catalog abilities enchant it *as a weapon* and are priced on
  // the weapon table, separately from its shield abilities and AC enhancement. The
  // shield's AC bonus is not a weapon bonus, so the weapon band starts from zero.
  const byTable = { [kind === 'shield' ? 'armor' : kind]: config.enh || 0 };
  const fixed = [];
  for (const row of config.abilities ?? []) {
    const rowKind = row.kind ?? kind;
    const a = getAbility(row.key, rowKind);
    if (!a) continue;
    if (a.costType !== 'bonus') { fixed.push(a); continue; }
    const table = rowKind === 'weapon' ? 'weapon' : 'armor';
    byTable[table] = (byTable[table] ?? 0) + (a.bonus || 0);
  }
  // The reported total is the largest single band — what the "+N" readout and the
  // over-enhancement warning are about.
  const totalEquivalent = Math.max(0, ...Object.values(byTable));
  return { totalEquivalent, byTable, fixed };
}

/**
 * Fully-inclusive cost + itemized breakdown + the effective masterwork state.
 * @param {{ item: object, base: BaseStats, config: object }} args
 */
export function computeCost({ item, base, config }) {
  const kind = itemKind(item) ?? 'weapon';
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
  const keys = materialPriceKeys(item);
  let materialLine = 0;
  if (mat) {
    materialLine = rawMaterialSurcharge(mat, basePrice, baseWeight, keys);
    // "per pound" materials (e.g. darkwood) are priced on top of a masterwork
    // version, so fold the mwk surcharge into the material line.
    if (usesPerPound(mat, keys) && mwkIncludedInMaterial) materialLine += mwkBase;
  }
  // Addon material (e.g. alchemical silver): a straight surcharge on top.
  const addonMat = getMaterial(config.addonKey);
  if (addonMat) materialLine += rawMaterialSurcharge(addonMat, basePrice, baseWeight, keys);

  // --- enhancement (one band per pricing table) + fixed abilities ---
  const { totalEquivalent, byTable, fixed } = enhancementEquivalent(config, kind);
  const band = Object.entries(byTable)
    .reduce((sum, [table, eq]) => sum + enhBandCost(eq, table), 0);
  const fixedCost = fixed.reduce((sum, a) => sum + (a.priceMod || 0), 0);
  const enchanting = (config.enh > 0) || (config.abilities?.length > 0);
  // The registry only carries an enchanting surcharge for weapons (cold iron's
  // +2,000 gp); armor and shields have no equivalent entry.
  const enhSurcharge = (enchanting && kind === 'weapon') ? (mat?.price?.enhancement?.weapon ?? 0) : 0;
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

/* --------------------------------------------------------------------------
 * Caster level & aura
 * ------------------------------------------------------------------------ */

/** Caster level contributed by a plain enhancement bonus: 3 × the bonus, per RAW. */
const CL_PER_ENH = 3;

/**
 * The school a plain enhancement bonus reads as — *greater magic weapon* and
 * *magic vestment* are both transmutation.
 */
const ENH_SCHOOL = 'trs';

/** `misc` is a real key in `pf1.config.spellSchools`, but it names no school. */
const NO_SCHOOL = new Set(['', 'misc']);

/** Localized school name for a `pf1.config.spellSchools` key. */
function schoolLabel(key) {
  const entry = globalThis.pf1?.config?.spellSchools?.[key];
  return entry ? loc(entry) : key;
}

/**
 * The item's caster level and aura school.
 *
 * CL is the highest single contributor — 3 × the base enhancement bonus, or any
 * special ability's own caster level, whichever is greater. Special abilities are
 * NOT summed and the total enhancement equivalent is not used: each ability carries
 * its own prerequisite, and the item's caster level is the largest of them.
 *
 * The school follows the contributor that set the caster level. When several
 * contributors tie at the top with different schools there is no single right
 * answer, so the aura is written as PF1's free-text `custom` form listing them
 * ("Transmutation, Evocation") rather than silently picking one.
 *
 * `auraStrength` and the identify DC are derived by the system from `cl`, so
 * neither is written here.
 *
 * @param {{ config: object, kind: string }} args
 * @returns {{ cl: number, school: string, custom: boolean }}
 */
export function computeAura({ config, kind = 'weapon' }) {
  const contributors = [];
  const enh = config.enh || 0;
  if (enh > 0) contributors.push({ cl: enh * CL_PER_ENH, school: ENH_SCHOOL });

  let sawSchoolless = false;
  for (const row of config.abilities ?? []) {
    const a = getAbility(row.key, row.kind ?? kind);
    if (!a) continue;
    const school = NO_SCHOOL.has(a.aura ?? '') ? '' : a.aura;
    if (!school) sawSchoolless = true;
    contributors.push({ cl: a.cl || 0, school });
  }

  if (!contributors.length) return { cl: 0, school: '', custom: false };

  const cl = Math.max(0, ...contributors.map((c) => c.cl));
  const top = [...new Set(contributors.filter((c) => c.cl === cl && c.school).map((c) => c.school))];

  // Nothing at the top names a school: fall back to `misc` if anything at all was
  // school-less, otherwise leave the aura blank.
  if (!top.length) return { cl, school: sawSchoolless ? 'misc' : '', custom: false };
  if (top.length === 1) return { cl, school: top[0], custom: false };
  return { cl, school: top.map(schoolLabel).join(', '), custom: true };
}

/**
 * Build the item's magic name from its config, e.g. "+2 Flaming Cold Iron Dagger".
 * Order: enhancement, special abilities (by display output), material, base name.
 * Returns '' if there's nothing to build from (no base name).
 * @param {{ base: BaseStats, config: object, kind: string }} args
 */
export function buildMagicName({ base, config, kind = 'weapon' }) {
  const baseName = base?.name?.trim();
  if (!baseName) return '';
  const parts = [];
  const enh = config.enh || 0;
  if (enh > 0) parts.push(`+${enh}`);
  for (const row of config.abilities ?? []) {
    const a = getAbility(row.key, row.kind ?? kind);
    if (a) parts.push(a.output || a.name);
  }
  const mat = getMaterial(config.materialKey);
  if (mat?.name) parts.push(mat.name);
  parts.push(baseName);
  return parts.join(' ').trim();
}

/**
 * The "easy-bucket" derived stats to write onto the item's native fields.
 * `system` auto-adds the enh mod to hardness/hp and size-scales hp, so we return
 * BASE values only. Armor and shields additionally get the material's ACP, max-Dex
 * and spell-failure adjustments folded into their base numbers.
 * @param {{ item: object, base: BaseStats, config: object }} args
 */
export function computeDerived({ item, base, config }) {
  const kind = itemKind(item) ?? 'weapon';
  const mat = getMaterial(config.materialKey);
  const addonMat = getMaterial(config.addonKey);
  const cost = computeCost({ item, base, config });

  const weightMult = (mat?.weight?.multiplier ?? 1) * (addonMat?.weight?.multiplier ?? 1);
  const weightBonusPerPound = (mat?.weight?.bonusPerPound ?? 0) + (addonMat?.weight?.bonusPerPound ?? 0);
  const weight = (base.weight || 0) * weightMult + (base.weight || 0) * weightBonusPerPound;

  const hardness = (mat && mat.hardness != null) ? mat.hardness : (base.hardness || 0);

  const derived = {
    kind,
    aura: computeAura({ config, kind }),
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

  if (kind === 'armor' || kind === 'shield') {
    const eff = materialArmorEffects(mat, kind);
    const addonEff = materialArmorEffects(addonMat, kind);
    // ACP is a penalty stored as a positive number in PF1, so a reduction floors at 0.
    derived.acp = Math.max(0, (base.acp || 0) + eff.acp + addonEff.acp);
    derived.armorValue = base.armorValue || 0;
    derived.maxDex = base.maxDex == null
      ? null
      : base.maxDex + eff.maxDex + addonEff.maxDex;
    derived.asf = Math.max(0, (base.asf || 0) + eff.asf + addonEff.asf);
  }

  return derived;
}
