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
//
// Defense overrides (DR, ER, and hardness bypass and reduction) ride the same snapshot
// and edit each target's rows in the dialog directly. Their rules match pf1-defense-
// manager's Defense Override, which does the same thing from the defender's side.

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
 * @typedef {object} DefenseOverride
 * @property {string} mode    "drBypass" | "drReduce" | "erBypass" | "erReduce" | "hardnessBypass" | "hardnessReduce"
 * @property {string} type    DR or energy type id, ANY_TYPE, or GENERIC_DR; "" for hardness
 * @property {number} amount  reduction, already resolved
 * @property {number|null} max  bypass ceiling, already resolved; null is no limit
 */

/**
 * @typedef {object} BypassDescriptor
 * @property {string[]} materials  material / alignment / epic registry ids
 * @property {boolean}  magic      counts as magic
 * @property {boolean}  ignoreAll  ignore every DR entry (Smite Evil)
 * @property {boolean}  ignoreGeneric  ignore DR/— only
 * @property {DefenseOverride[]} overrides  bypasses and reductions of DR, ER, and hardness
 * @property {string[]} sources    labels of what granted this, for the footnote
 */

/** Override modes, shared with pf1-defense-manager's Defense Override. DESIGN.md §7d */
export const OVERRIDE_MODES = ['drBypass', 'drReduce', 'erBypass', 'erReduce', 'hardnessBypass', 'hardnessReduce'];

/** Override type matching every DR or ER entry. */
export const ANY_TYPE = '*';
/** Override type matching only untyped DR (DR/—). */
export const GENERIC_DR = '-';

/** "dr" | "er" | "hardness" */
export const overrideKind = (mode) => String(mode ?? '').replace(/(Bypass|Reduce)$/, '');
export const isBypassMode = (mode) => String(mode ?? '').endsWith('Bypass');

/** A fresh, empty descriptor. */
export function emptyBypass() {
  return { materials: [], magic: false, ignoreAll: false, ignoreGeneric: false, overrides: [], sources: [] };
}

/** Whether a descriptor actually grants anything. */
export function hasBypass(b) {
  return !!b && (b.magic || b.ignoreAll || b.ignoreGeneric || b.materials?.length > 0 || b.overrides?.length > 0);
}

/** A stored or granted override, coerced; null if it isn't one. */
function normalizeOverride(raw) {
  if (!raw || !OVERRIDE_MODES.includes(raw.mode)) return null;
  const max = raw.max === null || raw.max === undefined || raw.max === '' ? null : Number(raw.max);
  return {
    mode: raw.mode,
    type: String(raw.type ?? ''),
    amount: Math.max(0, Number(raw.amount) || 0),
    max: Number.isFinite(max) ? max : null,
  };
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

  for (const raw of Array.isArray(contribution.overrides) ? contribution.overrides : []) {
    const o = normalizeOverride(raw);
    if (!o) continue;
    const same = (x) => x.mode === o.mode && x.type === o.type && x.amount === o.amount && x.max === o.max;
    if (!target.overrides.some(same)) target.overrides.push(o);
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

/**
 * DR types an override can target: Any, DR/— only, then everything `bypassChoices` offers
 * plus the physical damage types (DR 5/bludgeoning).
 * @returns {{key: string, label: string}[]}
 */
export function drOverrideChoices() {
  const out = [
    { key: ANY_TYPE, label: 'Any' },
    { key: GENERIC_DR, label: 'DR/— only' },
    ...bypassChoices().map(({ key, label }) => ({ key, label })),
  ];
  for (const dt of globalThis.pf1?.registry?.damageTypes ?? []) {
    const key = dt.id ?? dt._id;
    if (key && dt.category === 'physical' && !out.some((o) => o.key === key)) out.push({ key, label: dt.name ?? key });
  }
  return out;
}

/** Energy types an override can target, with Any first. */
export function erOverrideChoices() {
  const out = [{ key: ANY_TYPE, label: 'Any' }];
  for (const dt of globalThis.pf1?.registry?.damageTypes ?? []) {
    const key = dt.id ?? dt._id;
    if (key && dt.category === 'energy') out.push({ key, label: dt.name ?? key });
  }
  return out;
}

/** Display label for a bypass id. */
function labelFor(id) {
  if (id === MAGIC_ID) return 'magic';
  if (id === ANY_TYPE) return 'any';
  if (id === GENERIC_DR) return '—';
  const dt = globalThis.pf1?.registry?.damageTypes?.get(id);
  if (dt) return (dt.name ?? id).toLowerCase();
  const mat = globalThis.pf1?.registry?.materials?.get(id);
  if (mat) return (mat.shortName || mat.name || id).toLowerCase();
  const align = globalThis.pf1?.config?.damageResistances?.[id];
  if (align) return (globalThis.game?.i18n?.localize(align) ?? id).toLowerCase();
  return id;
}

/* --------------------------------------------------------------------------
 * Transient grants (roll-bonuses "Defense Bypass" bonus)
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
    overrides: (bypass.overrides ?? []).map((o) => ({ ...o })),
    sources: [...bypass.sources],
  };
}

/** "DR/good", "DR/—", "DR", "fire resistance", "resistance", "hardness". */
function overrideSubject(o) {
  const kind = overrideKind(o.mode);
  if (kind === 'hardness') return 'hardness';
  if (kind === 'er') return o.type === ANY_TYPE ? 'energy resistance' : `${labelFor(o.type)} resistance`;
  return o.type === ANY_TYPE ? 'DR' : `DR/${labelFor(o.type)}`;
}

/** One footnote line for an override, without its source. */
function overrideNote(o) {
  const subject = overrideSubject(o);
  if (!isBypassMode(o.mode)) return `Reduces ${subject} by ${o.amount}`;
  return o.max === null ? `Ignores ${subject}` : `Ignores ${subject} of ${o.max} or less`;
}

/** Card footnotes describing what this attack bypasses. */
export function bypassFootnotes(bypass) {
  if (!hasBypass(bypass)) return [];
  const from = bypass.sources?.length ? ` (${bypass.sources.join(', ')})` : '';
  const overrideNotes = (bypass.overrides ?? []).map((o) => `${overrideNote(o)}${from}`);

  if (bypass.ignoreAll) return [`Bypasses all damage reduction${from}`, ...overrideNotes];

  const parts = [];
  if (bypass.magic) parts.push(labelFor(MAGIC_ID));
  for (const id of bypass.materials) parts.push(labelFor(id));

  const notes = [];
  if (parts.length) notes.push(`Counts as ${parts.join(', ')} for damage reduction${from}`);
  if (bypass.ignoreGeneric) notes.push(`Bypasses DR/—${parts.length ? '' : from}`);
  return [...notes, ...overrideNotes];
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
 * Highest ceiling and highest reduction per kind and type. Two sources granting the same
 * reduction don't add up: unlike the defender side, the attacker has no Stacks switch to
 * say they should.
 * @param {DefenseOverride[]} overrides
 */
function consolidate(overrides) {
  const empty = () => ({ dr: new Map(), er: new Map(), hardness: new Map() });
  const out = { bypass: empty(), reduce: empty() };
  for (const o of overrides ?? []) {
    const bypass = isBypassMode(o.mode);
    const bucket = (bypass ? out.bypass : out.reduce)[overrideKind(o.mode)];
    if (!bucket) continue;
    const value = bypass ? (o.max ?? Infinity) : o.amount;
    bucket.set(o.type, Math.max(bucket.get(o.type) ?? -Infinity, value));
  }
  return out;
}

function rowMatches(orig, row, type, kind) {
  if (type === ANY_TYPE) return true;
  if (kind === 'dr' && type === GENERIC_DR) return !!row.hasGeneric;
  return orig.typeIds.includes(type);
}

/**
 * One DR or ER row after the attacker's overrides, recomputed from the row's original state so
 * re-asserting is idempotent. Same rules as pf1-defense-manager's Defense Override: a bypass
 * drops a matched "or" or single-type row and narrows an "and" row to its other type, skipping
 * rows above its ceiling; reductions then lower what is left.
 * @returns {boolean} whether the row changed
 */
function overrideRow(row, kind, bypass, reduce) {
  if (row.custom) return false; // free text: nothing to match against
  if (!bypass.size && !reduce.size) return false;
  const orig = (row._pf1meOrig ??= {
    value: row.value,
    typeIds: [...(row.typeIds ?? [])].filter(Boolean),
  });

  let typeIds = orig.typeIds;
  let gone = false;
  for (const [type, max] of bypass) {
    if (orig.value > max || !rowMatches(orig, row, type, kind)) continue;
    if (kind === 'er' || type === ANY_TYPE || type === GENERIC_DR || typeIds.length < 2 || row.operator) {
      gone = true;
      break;
    }
    typeIds = typeIds.filter((t) => t !== type);
  }

  let value = orig.value;
  for (const [type, by] of reduce) if (rowMatches(orig, row, type, kind)) value -= by;

  const state = () => `${row.value}|${[...(row.typeIds ?? [])].join()}|${row.active}|${row.disabled}`;
  const before = state();
  row.value = Math.max(0, value);
  if (typeIds !== orig.typeIds) {
    row.typeIds = new Set(typeIds);
    row.types = [...typeIds];
  }
  if (gone) {
    row.active = false;
    row.disabled = true;
  }
  return before !== state();
}

/**
 * The target's hardness after the attacker's overrides. Only ever switches hardness off; a
 * reduction that leaves some standing keeps the GM's own toggle.
 * @returns {boolean} whether it changed
 */
function overrideHardness(target, bypass, reduce) {
  const h = target.hardness;
  if (!h || (!bypass.size && !reduce.size)) return false;
  const orig = (h._pf1meOrig ??= { effective: h.effective ?? 0 });
  if (!orig.effective) return false;

  const ceiling = bypass.size ? Math.max(...bypass.values()) : -Infinity;
  let effective = orig.effective <= ceiling ? 0 : orig.effective;
  if (effective) for (const by of reduce.values()) effective -= by;
  effective = Math.max(0, effective);

  if (effective === h.effective) return false;
  h.effective = effective;
  if (effective <= 0) {
    h.active = false;
    h.disabled = true;
  }
  return true;
}

/**
 * Apply the snapshot's DR, ER, and hardness overrides to every target, or just one.
 * @returns {object[]} the targets that changed
 */
function applyOverrides(app, b, only = null) {
  if (!b.overrides?.length) return [];
  const { bypass, reduce } = consolidate(b.overrides);
  const changed = [];
  for (const target of only ? [only] : [...(app.targets ?? [])]) {
    let hit = false;
    for (const row of target.dr ?? []) hit = overrideRow(row, 'dr', bypass.dr, reduce.dr) || hit;
    for (const row of target.eres ?? []) hit = overrideRow(row, 'er', bypass.er, reduce.er) || hit;
    hit = overrideHardness(target, bypass.hardness, reduce.hardness) || hit;
    if (hit) changed.push(target);
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
      if (b) {
        const ignored = applyIgnores(this, b);
        const overridden = applyOverrides(this, b);
        const refresh = ignored ? [...(this.targets ?? [])] : overridden;
        for (const target of refresh) this._refreshTarget(target.uuid);
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
        const ignored = applyIgnores(this, b);
        const overridden = target ? applyOverrides(this, b, target).length > 0 : false;
        if ((ignored || overridden) && target?.uuid) this._refreshTarget(target.uuid);
      }
    } catch (err) {
      console.error('pf1-magic-equipment | DR bypass (re-assert) failed', err);
    }
    return wrapped(target, ...rest);
  });
}
