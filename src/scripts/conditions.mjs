// Shared predicates for conditional abilities: resolving the current single target,
// its alignment / creature types, and whether the wielder is "raging". Used by both
// the damage seam and the footnote seam so they stay consistent within a use.

import { getRageBuffNames, getRageBuffFlags } from './settings.mjs';

/**
 * The actor of the currently-targeted token, but only when there is exactly one
 * target (an unambiguous, verifiable defender). Null otherwise — callers treat
 * null as "not a verified legal target" and fall back to a footnote.
 * @returns {Actor|null}
 */
export function getSingleTargetActor() {
  const targets = globalThis.game?.user?.targets;
  if (!targets || targets.size !== 1) return null;
  return targets.values().next().value?.actor ?? null;
}

/** Parsed alignment ({ lawful, evil, chaotic, good, neutral }) of an actor, or null. */
export function alignmentOf(actor) {
  const code = actor?.system?.details?.alignment;
  if (!code) return null;
  return globalThis.pf1?.utils?.parseAlignment?.(code) ?? null;
}

/** Set of PF1 creature-type keys for an actor (e.g. "dragon"). */
export function creatureTypesOf(actor) {
  const std = actor?.system?.traits?.creatureTypes?.standard;
  if (std instanceof Set) return std;
  if (Array.isArray(std)) return new Set(std);
  return new Set();
}

/** Lower-cased set of an actor's creature subtypes (e.g. "human", "aquatic"). */
export function creatureSubtypesOf(actor) {
  const std = actor?.system?.traits?.creatureSubtypes?.standard;
  const iter = std instanceof Set || Array.isArray(std) ? std : [];
  return new Set([...iter].map((s) => String(s).toLowerCase()));
}

/**
 * Whether the wielder counts as raging: any active buff whose name is in the
 * configured rage-name list, or any active buff carrying a configured boolean flag.
 * Both lists are GM-editable in settings.
 * @param {Actor} actor
 * @returns {boolean}
 */
export function isRaging(actor) {
  if (!actor) return false;
  const names = getRageBuffNames().map((n) => n.toLowerCase());
  const flags = getRageBuffFlags();

  for (const item of actor.items ?? []) {
    if (item.type !== 'buff' || !item.isActive) continue;
    if (names.includes(item.name?.toLowerCase())) return true;
    const bool = item.system?.flags?.boolean;
    if (bool) for (const f of flags) if (bool[f]) return true;
  }

  // Aggregated boolean flags (active items only) as a fallback.
  const bmap = actor.itemFlags?.boolean;
  if (bmap) for (const f of flags) if (bmap[f]) return true;

  return false;
}
