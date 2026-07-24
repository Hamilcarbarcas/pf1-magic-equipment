// Module-wide constants, flag keys, and small shared helpers.

export const MODULE_ID = 'pf1-magic-equipment';

/** Item types this mod acts on. Weapons first; armor/shield added later. */
export const SUPPORTED_TYPES = Object.freeze(['weapon']);

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
export const MASTERWORK_COST = Object.freeze({ weapon: 300, armor: 150 });

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
    /** @type {{ key: string, category: string }[]} ordered ability rows. */
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
  };
}

/** Localize helper with a graceful fallback to the key. */
export function loc(key, data) {
  const g = globalThis.game;
  if (!g?.i18n) return key;
  return data ? g.i18n.format(key, data) : g.i18n.localize(key);
}

/** Whether this item is one we augment. */
export function isSupported(item) {
  return !!item && SUPPORTED_TYPES.includes(item.type);
}
