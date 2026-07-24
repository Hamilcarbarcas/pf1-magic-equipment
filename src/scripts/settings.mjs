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
});

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
}

const read = (key) => parseList(globalThis.game?.settings?.get(MODULE_ID, key));

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
