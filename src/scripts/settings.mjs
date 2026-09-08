// GM-editable lists that drive parameter matching (rage detection, bane targets,
// …). Stored as comma-separated strings so they're editable in the standard module
// settings panel; parsed into arrays on read.

import { MODULE_ID, loc } from './config.mjs';
import { HUMANOID_SUBTYPES, OUTSIDER_SUBTYPES } from '../data/bane-subtypes.mjs';

export const SETTINGS = Object.freeze({
  rageBuffNames: 'rageBuffNames',
  rageBuffFlags: 'rageBuffFlags',
  baneCustomTypes: 'baneCustomTypes',
  baneHumanoidSubtypes: 'baneHumanoidSubtypes',
  baneOutsiderSubtypes: 'baneOutsiderSubtypes',
  masterworkMaterials: 'masterworkMaterials',
  showHomebrew: 'showHomebrew',
});

/**
 * Materials whose items are always masterwork. Additive to the registry's own
 * `masterwork` flag, so homebrew materials registered by another mod still work
 * without being listed here; entries are for materials the registry doesn't flag.
 */
const MASTERWORK_MATERIALS = [
  'Adamantine', 'Angelskin', 'Darkleaf', 'Darkwood', 'Dragonhide',
  'Fire-Forged Steel', 'Frost-Forged Steel', 'Greenwood', 'Horacalcum',
  'Kanthaal Steel', 'Mithral', 'Silversheen', 'Singing Steel', 'Sunsilver',
];

/** Split a comma/newline-separated setting into a clean list. */
function parseList(str) {
  return String(str ?? '')
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function registerSettings() {
  const g = globalThis.game;

  g.settings.register(MODULE_ID, SETTINGS.rageBuffNames, {
    name: 'PF1ME.Settings.RageBuffNames',
    hint: 'PF1ME.Settings.RageBuffNamesHint',
    scope: 'world',
    config: true,
    type: String,
    default: 'Rage, Inspired Rage',
  });

  g.settings.register(MODULE_ID, SETTINGS.rageBuffFlags, {
    name: 'PF1ME.Settings.RageBuffFlags',
    hint: 'PF1ME.Settings.RageBuffFlagsHint',
    scope: 'world',
    config: true,
    type: String,
    default: 'Rage',
  });

  g.settings.register(MODULE_ID, SETTINGS.baneCustomTypes, {
    name: 'PF1ME.Settings.BaneCustomTypes',
    hint: 'PF1ME.Settings.BaneCustomTypesHint',
    scope: 'world',
    config: true,
    type: String,
    default: '',
  });

  g.settings.register(MODULE_ID, SETTINGS.baneHumanoidSubtypes, {
    name: 'PF1ME.Settings.BaneHumanoidSubtypes',
    hint: 'PF1ME.Settings.BaneHumanoidSubtypesHint',
    scope: 'world',
    config: true,
    type: String,
    default: HUMANOID_SUBTYPES.join(', '),
  });

  g.settings.register(MODULE_ID, SETTINGS.baneOutsiderSubtypes, {
    name: 'PF1ME.Settings.BaneOutsiderSubtypes',
    hint: 'PF1ME.Settings.BaneOutsiderSubtypesHint',
    scope: 'world',
    config: true,
    type: String,
    default: OUTSIDER_SUBTYPES.join(', '),
  });

  g.settings.register(MODULE_ID, SETTINGS.masterworkMaterials, {
    name: 'PF1ME.Settings.MasterworkMaterials',
    hint: 'PF1ME.Settings.MasterworkMaterialsHint',
    scope: 'world',
    config: true,
    type: String,
    default: MASTERWORK_MATERIALS.join(', '),
    onChange: () => { masterworkCache = null; },
  });

  // Off by default so a public release ships RAW-only. Content marked `homebrew`
  // is hidden from the pickers when off, but anything already applied to an item
  // keeps working — turning this off must never silently change a character.
  g.settings.register(MODULE_ID, SETTINGS.showHomebrew, {
    name: 'PF1ME.Settings.ShowHomebrew',
    hint: 'PF1ME.Settings.ShowHomebrewHint',
    scope: 'world',
    config: true,
    type: Boolean,
    default: false,
    onChange: () => { homebrewCache = null; },
  });

  registered = true;
}

/**
 * Read one of our settings, tolerating being called before `init` has registered
 * them. PF1 builds its registries from inside the `init` hook and system listeners
 * run before module ones, so anything reachable from `pf1Register*` can be asked for
 * a setting that does not exist yet; `game.settings.get` throws in that window.
 */
function readSetting(key) {
  try {
    return globalThis.game?.settings?.get(MODULE_ID, key);
  } catch (_e) {
    return undefined; // not registered yet — callers fall back to their default
  }
}

/**
 * Set once `registerSettings` has run. The memoized getters below must not cache a
 * pre-registration fallback, or an early call would freeze the wrong answer in for
 * the rest of the session.
 */
let registered = false;

const read = (key) => parseList(readSetting(key));
const readBool = (key) => readSetting(key) === true;

/** Buff names that count as "raging" (case-insensitive match). */
export function getRageBuffNames() {
  return read(SETTINGS.rageBuffNames);
}

/** Boolean item-flag names on a buff that count as "raging". */
export function getRageBuffFlags() {
  return read(SETTINGS.rageBuffFlags);
}

/**
 * The bane creature-type options: PF1's built-in creature types plus any custom
 * ones added in settings. Returns [{ key, label }].
 */
export function getBaneTypes() {
  const builtin = globalThis.pf1?.config?.creatureTypes ?? {};
  const out = Object.keys(builtin).map((key) => ({ key, label: loc(builtin[key]) }));
  for (const custom of read(SETTINGS.baneCustomTypes)) {
    if (!out.some((t) => t.key === custom)) out.push({ key: custom, label: custom });
  }
  return out;
}

/**
 * Subtype options for a bane creature type that requires one (humanoid, outsider).
 * Returns [{ key, label }]; empty for types that don't take a subtype.
 */
export function getBaneSubtypes(typeKey) {
  let list = [];
  if (typeKey === 'humanoid') list = read(SETTINGS.baneHumanoidSubtypes);
  else if (typeKey === 'outsider') list = read(SETTINGS.baneOutsiderSubtypes);
  return list.map((s) => ({ key: s, label: s }));
}

/* --------------------------------------------------------------------------
 * Homebrew / non-RAW content gate
 * ------------------------------------------------------------------------ */

// Cached: consulted while building every picker row. Invalidated by onChange.
let homebrewCache = null;

/**
 * Whether homebrew and non-RAW content is offered in the pickers. Never gates what
 * already applies to an item.
 */
export function showHomebrew() {
  if (!registered) return readBool(SETTINGS.showHomebrew);
  homebrewCache ??= readBool(SETTINGS.showHomebrew);
  return homebrewCache;
}

/* --------------------------------------------------------------------------
 * Always-masterwork materials
 * ------------------------------------------------------------------------ */

/** Lowercase alphanumerics only, so "Fire-Forged Steel" matches "fireForgedSteel". */
const normalize = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

// Cached: the cost readout recomputes on every keystroke and settings.get is a
// linear scan over every Setting document. Invalidated by the setting's onChange.
let masterworkCache = null;

/**
 * Whether the GM's list names this material as always-masterwork. Matched against
 * the registry id and the localized name, tolerating punctuation and a listed name
 * that's a prefix of the id ("Darkleaf" → `darkleafCloth`).
 * @param {object} mat a `pf1.registry.materials` entry.
 */
export function isListedMasterworkMaterial(mat) {
  if (!mat) return false;
  let names = masterworkCache;
  if (!names) {
    names = new Set(read(SETTINGS.masterworkMaterials).map(normalize));
    if (registered) masterworkCache = names; // only memoize a post-registration read
  }
  if (!names.size) return false;
  for (const candidate of [mat.id, mat._id, mat.name].filter(Boolean).map(normalize)) {
    if (names.has(candidate)) return true;
    for (const entry of names) {
      if (entry.length >= 4 && candidate.startsWith(entry)) return true;
    }
  }
  return false;
}
