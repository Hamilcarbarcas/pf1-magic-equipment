// Per-item state: the live "draft" config (flags), the linked base item and its
// numeric fallback cache, and the Apply step that writes the easy-bucket stats to
// the weapon's native fields.

import { MODULE_ID, FLAGS, defaultConfig, loc, MERCIFUL_CONDITIONAL, itemKind } from './config.mjs';
import { computeDerived, buildMagicName } from './calc.mjs';
import { getHandler } from './ability-handlers.mjs';
import { getMaterial } from './data.mjs';

/** Read the merged config off an item (defaults ∪ stored). */
export function getConfig(item) {
  const stored = item?.getFlag(MODULE_ID, FLAGS.config) ?? {};
  const cfg = { ...defaultConfig(), ...stored };
  cfg.abilities = Array.isArray(cfg.abilities) ? cfg.abilities.map((r) => ({ ...r })) : [];
  return cfg;
}

/**
 * Merge a partial into the stored config. Arrays (abilities) are replaced
 * wholesale by Foundry's flag merge, which is what we want.
 */
export function setConfig(item, partial) {
  return item.setFlag(MODULE_ID, FLAGS.config, partial);
}

/** Pull the base stats we care about off a resolved item document. */
export function extractBaseStats(doc) {
  const sys = doc?.system ?? {};
  const h = sys.hardness;
  const hardness = (h && typeof h === 'object') ? (h.base ?? 0) : (h ?? 0);
  const stats = {
    price: sys.price ?? 0,
    weight: sys.weight?.value ?? 0,
    hardness,
    hpBase: sys.hp?.base ?? 10,
    name: doc?.name ?? '',
  };
  // Armor and shields carry four more numbers the material adjusts. `dex` is null
  // for unlimited max Dex, which must survive the round-trip as null.
  const kind = itemKind(doc);
  if (kind === 'armor' || kind === 'shield') {
    stats.armorValue = sys.armor?.value ?? 0;
    stats.maxDex = sys.armor?.dex ?? null;
    stats.acp = sys.armor?.acp ?? 0;
    stats.asf = sys.spellFailure ?? 0;
  }
  return stats;
}

/** Cache a numeric baseline so Apply survives the base item going missing. */
export function setBaseCache(item, stats) {
  return item.setFlag(MODULE_ID, FLAGS.baseCache, stats);
}

export function getBaseCache(item) {
  return item?.getFlag(MODULE_ID, FLAGS.baseCache) ?? null;
}

/**
 * The abilities that were live as of the last Apply (read by the engine), each as
 * `{ key, params }`. Tolerates the older string-only snapshot format.
 */
export function getAppliedAbilities(item) {
  const applied = item?.getFlag(MODULE_ID, FLAGS.applied);
  const arr = Array.isArray(applied?.abilities) ? applied.abilities : [];
  // `kind` was added when armor landed; snapshots written before that are weapons.
  const fallback = itemKind(item) ?? 'weapon';
  return arr
    .map((a) => (typeof a === 'string'
      ? { key: a, kind: fallback, params: {} }
      : { key: a?.key, kind: a?.kind ?? fallback, params: a?.params ?? {} }))
    .filter((a) => a.key);
}

/**
 * Link a base item by uuid (from a drop). Resolves it, stores the uuid, and
 * refreshes the fallback cache. Returns the resolved item's name, or null.
 */
export async function setBaseItem(item, uuid) {
  const doc = await fromUuid(uuid).catch(() => null);
  if (!doc || !(doc instanceof Item)) return null;
  const stats = extractBaseStats(doc);
  await setConfig(item, { baseUuid: uuid });
  await setBaseCache(item, stats);
  return stats.name;
}

/** Remove the base link and its cache. */
export async function clearBaseItem(item) {
  await setConfig(item, { baseUuid: '' });
  await item.unsetFlag(MODULE_ID, FLAGS.baseCache);
}

/**
 * Resolve the base stats for a recompute: prefer the live linked item, fall back
 * to the cached numbers. Returns null if neither is available.
 */
export async function resolveBase(item) {
  const cfg = getConfig(item);
  if (cfg.baseUuid) {
    const doc = await fromUuid(cfg.baseUuid).catch(() => null);
    if (doc instanceof Item) {
      const stats = extractBaseStats(doc);
      // opportunistically refresh the cache while we have the live doc
      setBaseCache(item, stats).catch(() => {});
      return stats;
    }
  }
  return getBaseCache(item);
}

/**
 * libWrapper WRAPPER for `ItemPF#_preCreate`. PF1 gives every Change a new id when an
 * item lands on an actor; re-key `applied.changeIds` by position (PF1 keeps the order)
 * so a later apply on the actor still finds and replaces the Changes it added.
 */
export async function remapAppliedChangeIds(wrapped, ...args) {
  const before = (this._source.system?.changes ?? []).map((c) => c._id);
  const result = await wrapped(...args);
  const ids = this._source.flags?.[MODULE_ID]?.[FLAGS.applied]?.changeIds;
  const after = (this._source.system?.changes ?? []).map((c) => c._id);
  if (Array.isArray(ids) && ids.length && before.length === after.length) {
    const moved = new Map(before.map((id, i) => [id, after[i]]));
    this.updateSource({ [`flags.${MODULE_ID}.${FLAGS.applied}.changeIds`]: ids.map((id) => moved.get(id) ?? id) });
  }
  return result;
}

const DEFENSE_MANAGER_ID = 'pf1-defense-manager';
/** Marks the defense-manager entry we own, so a re-apply replaces only ours. */
const ARMOR_DR_MARK = 'pf1meMaterial';

/**
 * Material armor DR (adamantine, Kanthaal) as a pf1-defense-manager DR/– entry on the
 * armor; that module folds it into the actor's DR while the armor is worn. Written even
 * if that module is off, where it's an inert flag. See DESIGN §13.4.
 */
function writeArmorDR(item, update, d) {
  // Read the raw source: getFlag throws for a module scope that isn't active.
  const raw = item._source?.flags?.[DEFENSE_MANAGER_ID]?.defenses;
  let defs = [];
  if (typeof raw === 'string') {
    try { defs = JSON.parse(raw); } catch { defs = []; }
  } else if (raw) {
    defs = Array.isArray(raw) ? [...raw] : Object.values(raw);
  }
  const kept = defs.filter((e) => !e?.[ARMOR_DR_MARK]);
  if (!(d.armorDR > 0) && kept.length === defs.length) return;
  if (d.armorDR > 0) {
    const name = loc('PF1ME.Material.ArmorDR', { material: getMaterial(d.materialKey)?.name ?? '' });
    kept.push({
      name, enabled: true, category: 'dr', amount: String(d.armorDR), types: ['', ''],
      operator: true, stacking: false, [ARMOR_DR_MARK]: true,
    });
  }
  // Stored as a JSON string, as pf1-defense-manager does, to dodge Foundry's deep merge.
  update.flags[DEFENSE_MANAGER_ID] = { defenses: JSON.stringify(kept) };
}

/**
 * Apply the config: recompute the easy-bucket from the base and write the
 * weapon's native fields. Ability *effects* (the hard bucket) are handled
 * elsewhere at use-time and are intentionally not touched here.
 */
export async function applyToItem(item) {
  const base = await resolveBase(item);
  if (!base) {
    globalThis.ui?.notifications?.warn(loc('PF1ME.BaseItem.Missing'));
    return false;
  }
  const config = getConfig(item);
  const kind = itemKind(item) ?? 'weapon';
  const d = computeDerived({ item, base, config });

  // Materialize the "applied" ability set the use-time engine reads. Draft edits
  // don't affect combat until this snapshot is written. Each entry carries its
  // catalog kind and its parameters (e.g. Bane's designated creature type).
  const appliedAbilities = (config.abilities ?? [])
    .filter((r) => r.key)
    .map((r) => ({ key: r.key, kind: r.kind ?? kind, params: r.params ?? {} }));

  const update = {
    system: {
      price: d.price,
      masterwork: d.masterwork,
      weight: { value: d.weight },
      hardness: d.hardness,
      hp: { base: d.hpBase },
      unidentified: { price: d.unidentifiedPrice },
    },
    flags: { [MODULE_ID]: { [FLAGS.applied]: { abilities: appliedAbilities } } },
  };
  const material = { normal: { value: d.materialKey }, addon: d.addonKey ? [d.addonKey] : [] };

  // The enhancement bonus lives in a different place per kind. For a shield it is
  // an AC bonus only: it is deliberately NOT carried into the bash attack, which
  // needs its own weapon enchantment (see config.catalogKinds).
  if (kind === 'weapon') {
    update.system.enh = d.enh > 0 ? d.enh : null;
    update.system.material = material;
  } else {
    // Armor and shields keep their material under `system.armor`. Earlier versions
    // wrote `system.material`, which PF1's getter falls back to; drop that stray copy.
    update.system.armor = { enh: d.enh, value: d.armorValue, dex: d.maxDex, acp: d.acp, material };
    update.system.spellFailure = d.asf;
    if (item._source?.system?.material !== undefined) update.system['-=material'] = null;
  }

  writeArmorDR(item, update, d);

  // Native writes onto the item's actions — weapons, and a shield's bash action,
  // which picks up weapon-catalog abilities:
  //  - DR alignment (Holy/Unholy/Anarchic/Axiomatic → good/evil/chaotic/lawful);
  //    weapons have no item-level alignment field. null = inherit, true = aligned.
  //  - Merciful's "deal lethal" conditional, which must live on the action to show
  //    as a toggle in the attack dialog.
  // We only rewrite the actions array when one of these is present now or was set by
  // a previous Apply (so removal clears cleanly). All three are weapon-catalog
  // abilities, so only weapon-kind rows are consulted.
  const weaponRows = appliedAbilities.filter((a) => a.kind === 'weapon');
  const ALIGN_MAP = { Holy: 'good', Unholy: 'evil', Anarchic: 'chaotic', Axiomatic: 'lawful' };
  const newAxes = [];
  for (const { key } of weaponRows) {
    const ax = ALIGN_MAP[key];
    if (ax && !newAxes.includes(ax)) newAxes.push(ax);
  }
  const prevApplied = item.getFlag(MODULE_ID, FLAGS.applied) ?? {};
  const prevAxes = prevApplied.alignedAxes ?? [];
  const wantMerciful = weaponRows.some((a) => a.key === 'Merciful');
  const prevMerciful = prevApplied.merciful === true;

  // Effect-note enrichers (condition-on-hit) from weapon handlers; boolean flags from any
  // handler (Fortuitous on a weapon, Wild on armour or a shield).
  const newEffectNotes = [];
  const desiredFlags = [];
  for (const { key, kind: k } of weaponRows) {
    const h = getHandler(key, k);
    if (h?.effectNote) {
      const t = typeof h.effectNote === 'function' ? h.effectNote() : h.effectNote;
      if (t) newEffectNotes.push(t);
    }
  }
  for (const { key, kind: k } of appliedAbilities) {
    const flag = getHandler(key, k)?.booleanFlag;
    if (flag && !desiredFlags.includes(flag)) desiredFlags.push(flag);
  }
  const prevEffectNotes = prevApplied.effectNotes ?? [];

  if (newAxes.length || prevAxes.length || wantMerciful || prevMerciful || newEffectNotes.length || prevEffectNotes.length) {
    const align = { lawful: null, chaotic: null, good: null, evil: null };
    for (const ax of newAxes) align[ax] = true;
    const actions = item.toObject().system?.actions ?? [];
    for (const a of actions) {
      a.alignments = { ...(a.alignments ?? {}), ...align };
      a.conditionals = (a.conditionals ?? []).filter((c) => c.name !== MERCIFUL_CONDITIONAL);
      if (wantMerciful) {
        a.conditionals.push({ _id: foundry.utils.randomID(), name: MERCIFUL_CONDITIONAL, default: false, modifiers: [] });
      }
      a.notes ??= {};
      a.notes.effect = (a.notes.effect ?? []).filter((n) => !prevEffectNotes.includes(n));
      for (const n of newEffectNotes) if (!a.notes.effect.includes(n)) a.notes.effect.push(n);
    }
    if (actions.length) update.system.actions = actions;
  }
  update.flags[MODULE_ID][FLAGS.applied].alignedAxes = newAxes;
  update.flags[MODULE_ID][FLAGS.applied].merciful = wantMerciful;
  update.flags[MODULE_ID][FLAGS.applied].effectNotes = newEffectNotes;
  update.flags[MODULE_ID][FLAGS.applied].booleanFlags = desiredFlags;

  // Actor-facing abilities: item-level changes + context notes (gathered while the
  // item is equipped). This is the primary mechanism for armor and shields, where
  // almost every ability is a passive worn bonus rather than a use-time injection.
  // Tracked by id/text so a re-apply removes our old ones without disturbing any
  // the GM added by hand.
  const cfg = { enh: d.enh, config, kind };
  const newChanges = [];
  const newContextNotes = [];
  for (const { key, kind: k } of appliedAbilities) {
    const h = getHandler(key, k);
    for (const ch of h?.itemChanges?.(cfg) ?? []) {
      newChanges.push({ _id: foundry.utils.randomID(), operator: 'add', priority: 0, value: 0, ...ch });
    }
    for (const n of h?.itemContextNotes?.(cfg) ?? []) newContextNotes.push({ ...n });
  }
  const prevChangeIds = prevApplied.changeIds ?? [];
  const prevNoteTexts = prevApplied.contextNoteTexts ?? [];
  if (newChanges.length || prevChangeIds.length) {
    const existing = (item.toObject().system?.changes ?? []).filter((c) => !prevChangeIds.includes(c._id));
    update.system.changes = [...existing, ...newChanges];
  }
  if (newContextNotes.length || prevNoteTexts.length) {
    const existing = (item.toObject().system?.contextNotes ?? []).filter((n) => !prevNoteTexts.includes(n.text));
    update.system.contextNotes = [...existing, ...newContextNotes];
  }
  update.flags[MODULE_ID][FLAGS.applied].changeIds = newChanges.map((c) => c._id);

  // Actions an ability adds (Animated's Animate, §12.9). Each is marked with the ability's
  // `kind:key` in its own flags, so a re-apply keeps the existing action (and its id, and any
  // edits to it), adds a missing one, and removes one whose ability is gone. Hand-made actions
  // carry no mark and are never touched.
  const wantActions = new Map();
  for (const { key, kind: k } of appliedAbilities) {
    const [data] = getHandler(key, k)?.itemActions?.(cfg) ?? [];
    if (data) wantActions.set(`${k}:${key}`, data);
  }
  const markOf = (a) => a?.flags?.[MODULE_ID]?.ability ?? null;
  const currentActions = update.system.actions ?? item.toObject().system?.actions ?? [];
  if (wantActions.size || currentActions.some(markOf)) {
    const actions = currentActions.filter((a) => !markOf(a) || wantActions.has(markOf(a)));
    for (const [mark, data] of wantActions) {
      if (actions.some((a) => markOf(a) === mark)) continue;
      actions.push({ ...data, _id: foundry.utils.randomID(16), flags: { ...(data.flags ?? {}), [MODULE_ID]: { ability: mark } } });
    }
    update.system.actions = actions;
  }
  update.flags[MODULE_ID][FLAGS.applied].contextNoteTexts = newContextNotes.map((n) => n.text);

  // Optional caster level + aura. Both are recomputed from scratch, so removing the
  // last magic property clears them back to mundane. `auraStrength` and the identify
  // DC are derived by the system from `cl` and are deliberately not written.
  if (config.setAura) {
    update.system.cl = d.aura.cl;
    update.system.aura = { school: d.aura.school, custom: d.aura.custom };
  }

  // Optional renaming: set the identified name to reflect the magic properties,
  // and give the unidentified item the base name (only if it has none yet).
  if (config.rename) {
    const magicName = buildMagicName({ base, config, kind });
    if (magicName) update.name = magicName;
    if (!item.system?.unidentified?.name && base.name) {
      update.system.unidentified.name = base.name;
    }
  }

  await item.update(update);

  // Sync PF1 boolean item flags (e.g. Fortuitous) — a separate update path.
  const prevFlags = prevApplied.booleanFlags ?? [];
  for (const flag of new Set([...desiredFlags, ...prevFlags])) {
    const want = desiredFlags.includes(flag);
    if (want && !item.hasItemBooleanFlag(flag)) await item.addItemBooleanFlag(flag);
    else if (!want && item.hasItemBooleanFlag(flag)) await item.removeItemBooleanFlag(flag);
  }

  // Keep the draft's masterwork flag in sync with what was actually applied,
  // so reopening the section shows the real state.
  if (config.masterwork !== d.masterwork) {
    await setConfig(item, { masterwork: d.masterwork }).catch(() => {});
  }
  return true;
}
