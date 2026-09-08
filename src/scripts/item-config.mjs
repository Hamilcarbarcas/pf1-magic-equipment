// Per-item state: the live "draft" config (flags), the linked base item and its
// numeric fallback cache, and the Apply step that writes the easy-bucket stats to
// the weapon's native fields.

import { MODULE_ID, FLAGS, defaultConfig, loc, MERCIFUL_CONDITIONAL, itemKind } from './config.mjs';
import { computeDerived, buildMagicName } from './calc.mjs';
import { getHandler } from './ability-handlers.mjs';

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
      material: { normal: { value: d.materialKey }, addon: d.addonKey ? [d.addonKey] : [] },
    },
    flags: { [MODULE_ID]: { [FLAGS.applied]: { abilities: appliedAbilities } } },
  };

  // The enhancement bonus lives in a different place per kind. For a shield it is
  // an AC bonus only: it is deliberately NOT carried into the bash attack, which
  // needs its own weapon enchantment (see config.catalogKinds).
  if (kind === 'weapon') {
    update.system.enh = d.enh > 0 ? d.enh : null;
  } else {
    update.system.armor = { enh: d.enh, value: d.armorValue, dex: d.maxDex, acp: d.acp };
    update.system.spellFailure = d.asf;
  }

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

  // Effect-note enrichers (condition-on-hit) and desired boolean flags from handlers.
  const newEffectNotes = [];
  const desiredFlags = [];
  for (const { key, kind: k } of weaponRows) {
    const h = getHandler(key, k);
    if (h?.effectNote) {
      const t = typeof h.effectNote === 'function' ? h.effectNote() : h.effectNote;
      if (t) newEffectNotes.push(t);
    }
    if (h?.booleanFlag) desiredFlags.push(h.booleanFlag);
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
