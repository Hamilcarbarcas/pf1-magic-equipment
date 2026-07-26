// DR bypass: make an attack count as having damage-reduction-defeating properties
// (materials, alignments, magic, epic) — or ignore DR outright — for a single use,
// without writing anything to the weapon.
//
// PF1 resolves DR when damage is APPLIED, not when it is rolled: `ApplyDamage`
// unions `this.materials` / `this.isMagic` into each damage instance's types and
// matches them against the defender's DR entries (apply-damage.mjs `_isReducedBy`).
// So "grant a bypass" means "add ids to that Set" — which is why this lives here and
// not in the damage engine.
//
// DR/— is a different animal: it has no types and always reduces, so the only way
// through is to deactivate the reduction entry itself (`_processReductions` skips
// inactive entries). That is what Smite Evil needs, and it is the same mutation
// Nevela's suite performs for its own item-flag bypass, so the two compose.
//
// Because a buff can easily be gone by the time the GM clicks "apply damage" (and
// because the auto-apply path re-enters with cloned options), the bypass is
// SNAPSHOTTED onto the chat message at use time and read back from there. This also
// matches the system's own TODO about caching attack data on the message.

import { MODULE_ID } from './config.mjs';
import { getHandler } from './ability-handlers.mjs';
import { getAbility } from './data.mjs';

/** Chat-message flag key holding the use-time snapshot. */
export const BYPASS_FLAG = 'bypass';

/** Ids handled specially rather than as plain material ids. */
const MAGIC_ID = 'magic';

/* --------------------------------------------------------------------------
 * Descriptor
 * ------------------------------------------------------------------------ */

/**
 * @typedef {object} BypassDescriptor
 * @property {string[]} materials  material / alignment / epic registry ids
 * @property {boolean}  magic      counts as magic
 * @property {boolean}  ignoreAll  ignore every DR entry (Smite Evil)
 * @property {boolean}  ignoreGeneric  ignore DR/— only
 * @property {string[]} sources    labels of what granted this, for the footnote
 */

/** A fresh, empty descriptor. */
export function emptyBypass() {
  return { materials: [], magic: false, ignoreAll: false, ignoreGeneric: false, sources: [] };
}

/** Whether a descriptor actually grants anything. */
export function hasBypass(b) {
  return !!b && (b.magic || b.ignoreAll || b.ignoreGeneric || b.materials?.length > 0);
}

/**
 * Coerce arbitrary input (handler return value, stored flag, script argument) into a
 * descriptor. Accepts `['coldIron']` shorthand as well as the full object.
 * @param {object|string[]|null} raw
 * @returns {BypassDescriptor}
 */
export function normalizeBypass(raw) {
  const out = emptyBypass();
  if (!raw) return out;
  if (Array.isArray(raw)) return mergeBypass(out, { materials: raw });
  return mergeBypass(out, raw);
}

/**
 * Merge a contribution into a descriptor, in place. `magic` is folded out of the
 * material list so it drives `isMagic` (which is what the dialog displays), and a
 * material's `treatedAs` alias is added alongside it exactly as the system does when
 * reading a weapon's real material.
 * @param {BypassDescriptor} target
 * @param {object} contribution
 * @returns {BypassDescriptor} target
 */
export function mergeBypass(target, contribution) {
  if (!contribution) return target;

  if (contribution.magic) target.magic = true;
  if (contribution.ignoreAll) target.ignoreAll = true;
  if (contribution.ignoreGeneric) target.ignoreGeneric = true;

  // A bare string is accepted as a single id (as setAbilities does); anything else
  // non-array is ignored rather than iterated — a stray string would otherwise be
  // walked character by character.
  const incoming = Array.isArray(contribution.materials)
    ? contribution.materials
    : typeof contribution.materials === 'string' ? [contribution.materials] : [];

  for (const raw of incoming) {
    const id = String(raw ?? '').trim();
    if (!id) continue;
    if (id === MAGIC_ID) { target.magic = true; continue; }
    if (!target.materials.includes(id)) target.materials.push(id);
    const alias = globalThis.pf1?.registry?.materials?.get(id)?.treatedAs;
    if (alias && !target.materials.includes(alias)) target.materials.push(alias);
  }

  for (const s of Array.isArray(contribution.sources) ? contribution.sources : []) {
    if (s && !target.sources.includes(s)) target.sources.push(s);
  }

  return target;
}

/* --------------------------------------------------------------------------
 * Selectable types (for the roll-bonuses picker and any script/macro)
 * ------------------------------------------------------------------------ */

/**
 * Every id that can meaningfully be granted, as `{ key, label, group }`. Built from
 * the live registries so homebrew materials registered via `pf1RegisterMaterials`
 * appear automatically.
 * @returns {{key: string, label: string, group: string}[]}
 */
export function bypassChoices() {
  const out = [{ key: MAGIC_ID, label: 'Magic', group: 'special' }];

  const alignments = globalThis.pf1?.config?.damageResistances ?? {};
  for (const [key, label] of Object.entries(alignments)) {
    out.push({ key, label: globalThis.game?.i18n?.localize(label) ?? key, group: 'alignment' });
  }

  const materials = globalThis.pf1?.registry?.materials;
  if (materials) {
    for (const mat of materials) {
      const key = mat.id ?? mat._id;
      // `dr` marks materials that defeat damage reduction; `treatedAs` entries are
      // aliases of another material and are added implicitly when it is granted.
      if (!key || !mat.dr || mat.treatedAs) continue;
      if (out.some((o) => o.key === key)) continue;
      out.push({ key, label: mat.shortName || mat.name || key, group: 'material' });
    }
  }

  return out;
}

/** Display label for a bypass id. */
function labelFor(id) {
  if (id === MAGIC_ID) return 'magic';
  const mat = globalThis.pf1?.registry?.materials?.get(id);
  if (mat) return (mat.shortName || mat.name || id).toLowerCase();
  const align = globalThis.pf1?.config?.damageResistances?.[id];
  if (align) return (globalThis.game?.i18n?.localize(align) ?? id).toLowerCase();
  return id;
}

/* --------------------------------------------------------------------------
 * Transient grants (roll-bonuses "DR Bypass" bonus)
 * ------------------------------------------------------------------------ */

/** action -> descriptor, populated at the start of a use and cleared at the end. */
const GRANTS = new Map();

/** Add a bypass contribution to an action's current use. */
export function addBypassGrant(action, contribution) {
  if (!action || !contribution) return;
  let d = GRANTS.get(action);
  if (!d) GRANTS.set(action, (d = emptyBypass()));
  mergeBypass(d, contribution);
}

/** The bypass granted to an action for this use, or null. */
export function grantedBypass(action) {
  return GRANTS.get(action) ?? null;
}

/** Release an action's transient bypass grants. */
export function clearBypassGrants(action) {
  if (action) GRANTS.delete(action);
}

/* --------------------------------------------------------------------------
 * Collection
 * ------------------------------------------------------------------------ */

/**
 * The full bypass for a use: every active ability's `bypass(ctx)` contribution plus
 * anything granted by the roll-bonuses bonus.
 * @param {{key: string, params: object}[]} abilities  active abilities (applied + granted)
 * @param {object} ctx  handler context ({ item, action, actor, target, … })
 * @returns {BypassDescriptor}
 */
export function collectBypass(abilities, ctx) {
  const out = emptyBypass();

  for (const { key, params } of abilities ?? []) {
    const handler = getHandler(key);
    if (!handler?.bypass) continue;
    const contribution = handler.bypass({ ...ctx, params });
    if (!contribution) continue;
    mergeBypass(out, contribution);
    if (hasBypass(normalizeBypass(contribution))) {
      const label = getAbility(key)?.name ?? key;
      if (!out.sources.includes(label)) out.sources.push(label);
    }
  }

  mergeBypass(out, grantedBypass(ctx?.action));

  return out;
}

/* --------------------------------------------------------------------------
 * Snapshot onto the chat message
 * ------------------------------------------------------------------------ */

/**
 * Stamp the descriptor onto the outgoing chat message.
 *
 * Written with a DOTTED key, matching how PF1 itself sets `flags.core.canPopout` on
 * `shared.chatData`: assigning a nested `flags` object here would clobber that entry
 * when the create data is expanded.
 * @param {object} chatData  `actionUse.shared.chatData`
 * @param {BypassDescriptor} bypass
 */
export function writeSnapshot(chatData, bypass) {
  if (!chatData || !hasBypass(bypass)) return;
  chatData[`flags.${MODULE_ID}.${BYPASS_FLAG}`] = {
    materials: [...bypass.materials],
    magic: !!bypass.magic,
    ignoreAll: !!bypass.ignoreAll,
    ignoreGeneric: !!bypass.ignoreGeneric,
    sources: [...bypass.sources],
  };
}

/** Card footnotes describing what this attack bypasses. */
export function bypassFootnotes(bypass) {
  if (!hasBypass(bypass)) return [];
  const from = bypass.sources?.length ? ` (${bypass.sources.join(', ')})` : '';

  if (bypass.ignoreAll) return [`Bypasses all damage reduction${from}`];

  const parts = [];
  if (bypass.magic) parts.push(labelFor(MAGIC_ID));
  for (const id of bypass.materials) parts.push(labelFor(id));

  const notes = [];
  if (parts.length) notes.push(`Counts as ${parts.join(', ')} for damage reduction${from}`);
  if (bypass.ignoreGeneric) notes.push(`Bypasses DR/—${parts.length ? '' : from}`);
  return notes;
}

/* --------------------------------------------------------------------------
 * Apply-damage injection
 * ------------------------------------------------------------------------ */

/** Read the snapshot off the message an ApplyDamage app was opened for. */
function snapshotFor(app) {
  const message = app?.options?.message ?? app?.extraOptions?.message;
  const raw = message?.getFlag?.(MODULE_ID, BYPASS_FLAG) ?? message?.flags?.[MODULE_ID]?.[BYPASS_FLAG];
  if (!raw) return null;
  const b = normalizeBypass(raw);
  return hasBypass(b) ? b : null;
}

/**
 * Add the granted types to the app's attacker-side sets. Doing this inside
 * `_evaluateAttack` (rather than later) means `_prepareTargets` sees them when it
 * decides which DR entries default to active, and the GM's context tags list them.
 * @param {object} app  ApplyDamage instance
 * @param {BypassDescriptor} b
 */
function applyTypeTags(app, b) {
  if (b.magic) app.isMagic = true;
  for (const id of b.materials) {
    app.materials?.add(id);
    // Hardness penetration is tracked separately from the material set.
    if (id === app.constructor?.ADAMANTINE_ID) app.adamantine = true;
  }
}

/**
 * Deactivate the DR entries this attack ignores outright. Mirrors how the reduction
 * is switched off in the dialog, so `_processReductions` skips it.
 * @param {object} app  ApplyDamage instance
 * @param {BypassDescriptor} b
 * @returns {boolean} whether anything changed
 */
function applyIgnores(app, b) {
  if (!b.ignoreAll && !b.ignoreGeneric) return false;

  let changed = false;
  for (const target of [...(app.targets ?? [])]) {
    for (const entry of target.dr ?? []) {
      if (!b.ignoreAll && !entry.hasGeneric) continue;
      if (entry.active === false && entry.disabled === true) continue;
      entry.active = false;
      entry.disabled = true;
      changed = true;
    }
  }
  return changed;
}

/**
 * Install the apply-time wrappers. Called once at `setup`.
 *
 * Three seams, all additive:
 *  - `_evaluateAttack` — add the type tags while the app is still deciding defaults.
 *  - `_prepareTargets` — switch off ignored DR entries (targets exist by then).
 *  - `_getTargetDamageOptions` — re-assert both, idempotently, immediately before the
 *    reduction is handed off. This is what makes the feature survive modules that
 *    rebuild the app's state after construction: Nevela's suite clears `materials`
 *    and rebuilds `target.dr` from scratch when its damage-type priority list is
 *    configured (it no-ops when that list is empty).
 * @param {(path: string, fn: Function) => void} registerWrapper
 */
export function patchApplyDamage(registerWrapper) {
  if (!globalThis.pf1?.applications?.ApplyDamage?.prototype) {
    console.error('pf1-magic-equipment | pf1.applications.ApplyDamage not found; DR bypass disabled.');
    return;
  }

  registerWrapper('pf1.applications.ApplyDamage.prototype._evaluateAttack', function (wrapped, ...args) {
    const result = wrapped(...args);
    try {
      const b = snapshotFor(this);
      if (b) applyTypeTags(this, b);
    } catch (err) {
      console.error('pf1-magic-equipment | DR bypass (type tags) failed', err);
    }
    return result;
  });

  registerWrapper('pf1.applications.ApplyDamage.prototype._prepareTargets', function (wrapped, ...args) {
    const result = wrapped(...args);
    try {
      const b = snapshotFor(this);
      if (b && applyIgnores(this, b)) {
        for (const target of [...(this.targets ?? [])]) this._refreshTarget(target.uuid);
      }
    } catch (err) {
      console.error('pf1-magic-equipment | DR bypass (ignore) failed', err);
    }
    return result;
  });

  registerWrapper('pf1.applications.ApplyDamage.prototype._getTargetDamageOptions', function (wrapped, target, ...rest) {
    try {
      const b = snapshotFor(this);
      if (b) {
        applyTypeTags(this, b);
        if (applyIgnores(this, b) && target?.uuid) this._refreshTarget(target.uuid);
      }
    } catch (err) {
      console.error('pf1-magic-equipment | DR bypass (re-assert) failed', err);
    }
    return wrapped(target, ...rest);
  });
}
