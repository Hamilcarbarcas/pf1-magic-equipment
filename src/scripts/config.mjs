// Module-wide constants, flag keys, and small shared helpers.

export const MODULE_ID = 'pf1-magic-equipment';

/**
 * The three equipment kinds we augment. A kind decides which ability catalog,
 * price table, masterwork cost and native fields apply — see DESIGN.md §12.
 */
export const KINDS = Object.freeze(['weapon', 'armor', 'shield']);

/** Flag keys under this module's namespace on an item. */
export const FLAGS = Object.freeze({
  /** The live "draft" config (see defaultConfig). */
  config: 'config',
  /** Numeric baseline captured from the linked base item, used as a fallback
   *  when the base item can't be resolved at Apply time. */
  baseCache: 'baseCache',
  /** Snapshot written on Apply: the ability effects that are actually "live" and
   *  read by the use-time injection engine. Separate from the draft config so an
   *  unapplied edit never changes combat behavior. */
  applied: 'applied',
});

/** Base masterwork surcharge (gp) by item kind. From pf1-auto-forge defaults. */
export const MASTERWORK_COST = Object.freeze({ weapon: 300, armor: 150, shield: 150 });

/** Hard cap on total enhancement equivalent (base enh + bonus-priced abilities). */
export const MAX_ENH_EQUIVALENT = 10;

/** Name of the attack-dialog conditional that suppresses Merciful (deals lethal). */
export const MERCIFUL_CONDITIONAL = 'Deal lethal (Merciful)';

/** A fresh, fully-defaulted config object. */
export function defaultConfig() {
  return {
    /** @type {string} UUID of the linked base (unmodified) item. */
    baseUuid: '',
    /** @type {number} base enhancement bonus, 0–5. */
    enh: 0,
    /** @type {{ kind: string, key: string, category: string, params: object }[]}
     *  ordered ability rows. `kind` names the catalog the key belongs to — a shield
     *  can carry both shield and weapon abilities, and keys collide across catalogs
     *  (Defiant, Ghost Touch, Impervious, …), so a row is only meaningful with it. */
    abilities: [],
    /** @type {string} pf1.registry.materials id (normal material), '' for none. */
    materialKey: '',
    /** @type {string} pf1.registry.materials id (addon material, e.g. alchemical silver), '' for none. */
    addonKey: '',
    /** @type {boolean} the GM's explicit masterwork choice (may be force-set true). */
    masterwork: false,
    /** @type {boolean} on Apply, rename the item to reflect its magic properties
     *  and set the unidentified name to the base item's name. */
    rename: true,
    /** @type {boolean} on Apply, recompute the caster level and aura school from
     *  the enhancement bonus and the abilities' own prerequisites. */
    setAura: true,
  };
}

/** Localize helper with a graceful fallback to the key. */
export function loc(key, data) {
  const g = globalThis.game;
  if (!g?.i18n) return key;
  return data ? g.i18n.format(key, data) : g.i18n.localize(key);
}

/**
 * Which equipment kind an item is, or null if we don't augment it. `equipment`
 * also covers rings, wondrous items and clothing, so the subType check matters.
 * @returns {'weapon'|'armor'|'shield'|null}
 */
export function itemKind(item) {
  if (!item) return null;
  if (item.type === 'weapon') return 'weapon';
  if (item.type !== 'equipment') return null;
  const sub = item.system?.subType;
  if (sub === 'armor') return 'armor';
  if (sub === 'shield') return 'shield';
  return null;
}

/** Whether this item is one we augment. */
export function isSupported(item) {
  return itemKind(item) !== null;
}

/**
 * The ability catalogs an item of this kind may draw from, in display order. A
 * shield can be enchanted as both a shield and a weapon (for its bash), so it
 * offers both; its bash picks up the weapon abilities at use time. The shield's
 * enhancement bonus is AC-only and is never injected into the bash attack — that
 * needs its own enchantment and is deliberately not modelled.
 */
export function catalogKinds(kind) {
  return kind === 'shield' ? ['shield', 'weapon'] : [kind];
}
