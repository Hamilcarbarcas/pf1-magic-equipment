// Use-time injection engine. Reads an item's *applied* abilities and injects their
// effects into the in-flight roll/card WITHOUT mutating the action's editable data.
//
// Damage-on-hit → pushed as additional parts at the `pf1PreDamageRoll` seam (additive,
// via a Foundry hook — never an OVERRIDE). The two ActionUse methods we augment
// (`addFootnotes`, `handleConditionals`) are wrapped through libWrapper (a required
// dependency) as additive WRAPPERs, so we coexist with other modules that wrap the
// same methods — notably ckl-roll-bonuses, which OVERRIDEs `handleConditionals`.

import { MODULE_ID, isSupported } from './config.mjs';
import { getAppliedAbilities } from './item-config.mjs';
import { getHandler } from './ability-handlers.mjs';
import { getAbility } from './data.mjs';
import { getSingleTargetActor } from './conditions.mjs';
import {
  collectBypass, hasBypass, writeSnapshot, bypassFootnotes, clearBypassGrants,
  patchApplyDamage as installApplyDamagePatches,
} from './bypass.mjs';

/* --------------------------------------------------------------------------
 * Transient ability grants — abilities handed to an action for the duration of a
 * single use by the roll-bonuses bridge (see roll-bonuses-bridge.mjs). Keyed by
 * the in-flight action; populated before the rolls, cleared at pf1PostActionUse.
 * ------------------------------------------------------------------------ */
const GRANTS = new Map();

/** Add granted ability keys for an action's current use. */
export function addGrant(action, keys) {
  if (!action || !keys?.length) return;
  let set = GRANTS.get(action);
  if (!set) GRANTS.set(action, (set = new Set()));
  for (const k of keys) set.add(k);
}

/**
 * Attack-dialog conditionals we injected onto a granted action for one use, keyed by
 * action (action -> [conditional id]). Applied abilities get their conditional written
 * to the item at Apply; a *granted* ability has no such write, so we add it live for
 * the use (see ensureDialogConditionals) and remove it here.
 */
const INJECTED_CONDITIONALS = new Map();

/** Clear an action's transient grants (call at the end of the use). */
export function clearGrants(action) {
  if (!action) return;
  GRANTS.delete(action);
  clearBypassGrants(action);
  ENABLED_CONDITIONALS.delete(action);
  const injected = INJECTED_CONDITIONALS.get(action);
  if (injected) {
    for (const id of injected) action.conditionals?.delete?.(id);
    INJECTED_CONDITIONALS.delete(action);
  }
}

/* Enabled attack-dialog conditionals for the in-flight use, keyed by action. Kept
 * as a fallback; the primary channel is a property stamped on `shared.rollData`
 * (see COND_KEY) which rides the deepClone into the damage hook and so is immune to
 * action-object identity or wrapper-ordering issues. */
const ENABLED_CONDITIONALS = new Map();

/**
 * Property key we stamp onto `shared.rollData` in the `handleConditionals` wrapper.
 * `pf1PreDamageRoll` receives a deepClone of `shared.rollData`, so the enabled
 * conditional IDs travel straight to the damage seam without a side-channel Map.
 */
const COND_KEY = '__pf1meConditionals';

/** Record which conditional IDs are enabled for this action's use. */
export function setEnabledConditionals(action, ids) {
  if (action) ENABLED_CONDITIONALS.set(action, new Set(ids ?? []));
}

/** The enabled conditional IDs for a damage-hook call: prefer the rollData channel. */
function enabledConditionalIds(action, rollData) {
  const stamped = rollData?.[COND_KEY];
  if (Array.isArray(stamped)) return new Set(stamped);
  return ENABLED_CONDITIONALS.get(action) ?? new Set();
}

/**
 * Build the ctx helper that tells a handler if a named conditional is toggled on,
 * given the set of enabled conditional IDs for this use.
 * @param {object} action the in-flight ItemAction.
 * @param {Set<string>|Iterable<string>} enabledIds enabled conditional IDs.
 */
function conditionalCheckerFor(action, enabledIds) {
  const enabled = enabledIds instanceof Set ? enabledIds : new Set(enabledIds ?? []);
  return (name) => {
    const conds = action?.conditionals;
    // `conditionals` is a Foundry Collection (extends Map): use `.find` (iterates
    // values) rather than for...of (which would yield [id, value] entries).
    const cond = conds?.find ? conds.find((c) => c?.name === name) : [...(conds ?? [])].find((c) => c?.name === name);
    const id = cond?.id ?? cond?._id;
    return id != null && enabled.has(id);
  };
}

function grantedAbilities(action) {
  const set = GRANTS.get(action);
  return set ? [...set].map((key) => ({ key, params: {} })) : [];
}

/** Item's persisted abilities plus any transient grants for this action's use. */
function activeAbilities(item, action) {
  return [...getAppliedAbilities(item), ...grantedAbilities(action)];
}

/**
 * The DR bypass this use grants (see bypass.mjs).
 *
 * Only *granted* abilities are consulted: an ability applied to the weapon has
 * already had its alignment written to `action.alignments` at Apply, which the system
 * reads natively — re-adding it here would only duplicate the footnote. Grants have
 * no such write, which is exactly the gap.
 *
 * Deliberately not weapon-gated: a roll-bonuses bypass grant must also cover unarmed
 * strikes and natural attacks (Smite Evil applies to those), which are `attack` items.
 * @param {ItemPF} item
 * @param {object} action
 */
function bypassForUse(item, action) {
  return collectBypass(grantedAbilities(action), {
    item, action, actor: item?.actor, target: getSingleTargetActor(),
  });
}

/**
 * `pf1PreDisplayActionUse(actionUse)` — the last hook before the chat message is
 * created. Snapshot the use's DR bypass onto the outgoing message, so apply-damage
 * still sees it if the granting buff has ended by the time the GM applies damage.
 */
export function onPreDisplayActionUse(actionUse) {
  const bypass = bypassForUse(actionUse?.item, actionUse?.action);
  if (hasBypass(bypass)) writeSnapshot(actionUse?.shared?.chatData, bypass);
}

/** Install the apply-damage wrappers that consume that snapshot. Call once at setup. */
export function patchApplyDamage() {
  installApplyDamagePatches(registerWrapper);
}

/**
 * The base weapon's damage type ids, gathered from the action's damage parts.
 * Used by contributions that add "untyped" damage which should instead match the
 * weapon (e.g. Holy's +2d6 on a slashing sword deals slashing). Falls back to
 * ['untyped'] if the action declares no typed damage.
 * @param {object} action
 * @returns {string[]}
 */
function baseDamageTypes(action) {
  const out = new Set();
  for (const p of action?.damage?.parts ?? []) {
    for (const id of p?.types ?? []) out.add(id);
  }
  return out.size ? [...out] : ['untyped'];
}

/**
 * `pf1PreDamageRoll(action, rollData, parts, changes)` — parts are
 * `{ base, extra[], damageType, type }`. On a critical hit PF1 rolls damage twice
 * (a normal roll and a crit-bonus roll) and this fires for both; `rollData.critMult`
 * is 1 on the normal roll and the weapon's multiplier (>1) on the crit-bonus roll.
 * Energy (nonCrit) damage is therefore added on the normal roll only, so it lands
 * exactly once and is not multiplied.
 */
export function onPreDamageRoll(action, rollData, parts) {
  const item = action?.item;
  if (!isSupported(item) || !Array.isArray(parts)) return;

  const applied = activeAbilities(item, action);
  if (!applied.length) return;

  // On a critical hit PF1 rolls the damage-bonus (critMult - 1) times, each firing
  // this hook (rollData.critMult > 1); the base non-crit roll fires once with
  // critMult == 1.
  const isCrit = (rollData?.critMult ?? 1) > 1;
  const base = {
    item, action, actor: item.actor, rollData, isCrit,
    target: getSingleTargetActor(),
    isConditionalEnabled: conditionalCheckerFor(action, enabledConditionalIds(action, rollData)),
  };

  for (const { key, params } of applied) {
    const handler = getHandler(key);
    if (!handler?.damage) continue;
    const label = getAbility(key)?.name ?? key;
    for (const c of handler.damage({ ...base, params }) ?? []) {
      if (!c?.formula) continue;
      const damageType = c.inheritType ? baseDamageTypes(action) : (c.types ?? ['untyped']);
      // Flavor label so the card shows the source, e.g. "1d6[Flaming]".
      const formula = (c.label ?? label) ? `${c.formula}[${c.label ?? label}]` : c.formula;
      const part = { base: formula, extra: [], damageType };

      if (c.onCrit) {
        // Burst-style: added on each crit-bonus firing, so a flat "1d10" here
        // totals (critMult - 1)d10 across the crit. Skipped on the normal roll.
        if (!isCrit) continue;
        part.type = 'crit';
      } else if (c.multiplied) {
        // Enhancement-style: added on every firing (once on the normal roll, once
        // per crit-bonus firing), so a +2 totals (critMult × 2) on a crit.
        part.type = isCrit ? 'crit' : 'normal';
      } else {
        // Energy-style (default): added once, on the non-crit roll, not multiplied.
        if (isCrit) continue;
        if (c.inheritType && parts[0]) {
          // Same damage type as the weapon (e.g. Merciful, Holy, Bane): fold into the
          // base damage instance as a modifier (parts[0].extra) instead of a separate
          // same-type line. It's added only on the normal roll — never the crit-bonus
          // roll — so it isn't multiplied, and it shares parts[0]'s damageType (plus
          // any augment like Merciful's nonlethal, applied below).
          (parts[0].extra ??= []).push(formula);
          continue;
        }
        part.type = 'nonCrit';
      }
      parts.push(part);
    }
  }

  // Type augmentation (e.g. Merciful adds 'nonlethal' to every damage part). Applied
  // after all contributions so it covers the weapon's own damage too.
  const augment = new Set();
  for (const { key, params } of applied) {
    const handler = getHandler(key);
    for (const t of handler?.augmentTypes?.({ ...base, params }) ?? []) augment.add(t);
  }
  if (augment.size) {
    for (const p of parts) {
      const cur = new Set(p.damageType instanceof Set ? [...p.damageType] : (Array.isArray(p.damageType) ? p.damageType : []));
      for (const t of augment) cur.add(t);
      p.damageType = [...cur];
    }
  }
}

/**
 * `pf1PreAttackRoll(action, config, rollData, rollOptions, parts, changes)` — inject
 * attack bonuses (formula strings like "2[Bane]") and crit-range changes from applied
 * abilities. `rollOptions.critical` is the threat-range low bound.
 */
export function onPreAttackRoll(action, config, rollData, rollOptions, parts) {
  const item = action?.item;
  if (!isSupported(item)) return;

  const applied = activeAbilities(item, action);
  if (!applied.length) return;

  const base = { item, action, actor: item.actor, rollData, target: getSingleTargetActor() };

  for (const { key, params } of applied) {
    const handler = getHandler(key);
    const ctx = { ...base, params };

    if (handler?.attack && Array.isArray(parts)) {
      for (const b of handler.attack(ctx) ?? []) {
        if (!b?.value) continue;
        parts.push(`${b.value}[${b.flavor ?? key}]`);
      }
    }

    // Crit-range change (Keen): given the current low bound, return the new one.
    if (handler?.critRange && rollOptions && typeof rollOptions.critical === 'number') {
      const next = handler.critRange(rollOptions.critical, ctx);
      if (Number.isFinite(next)) rollOptions.critical = Math.max(2, Math.min(20, next));
    }
  }
}

/**
 * Add attack-dialog conditionals that a *granted* ability needs (e.g. Merciful's
 * "deal lethal" toggle). Applied abilities have this written to the action at Apply;
 * a grant has no such write, so we inject a live conditional onto the action's
 * collection before the dialog reads it. The injected entry is removed at clearGrants
 * (and would be dropped by the next data prep anyway, since it isn't in _source).
 * @param {object} action the in-flight ItemAction.
 */
function ensureDialogConditionals(action) {
  const conds = action?.conditionals;
  const CondCls = globalThis.pf1?.components?.ItemConditional;
  if (!conds?.set || !CondCls) return;
  for (const { key } of grantedAbilities(action)) {
    const name = getHandler(key)?.dialogConditional;
    if (!name) continue;
    // Skip if an equivalent conditional is already present (applied + granted).
    const exists = conds.find ? conds.find((c) => c?.name === name) : null;
    if (exists) continue;
    const cond = new CondCls(
      { _id: foundry.utils.randomID(), name, default: false, modifiers: [] },
      { parent: action, strict: false },
    );
    conds.set(cond.id, cond);
    let ids = INJECTED_CONDITIONALS.get(action);
    if (!ids) INJECTED_CONDITIONALS.set(action, (ids = []));
    ids.push(cond.id);
  }
}

/**
 * `pf1CreateActionUse(actionUse)` — runs before the attack dialog. Inject any
 * grant-only dialog conditionals, then set system use-options requested by active
 * abilities (e.g. Speed enables haste).
 */
export function onCreateActionUse(actionUse) {
  const item = actionUse?.item;
  if (!isSupported(item)) return;
  const action = actionUse.action;

  ensureDialogConditionals(action);

  const useOptions = actionUse.shared?.useOptions;
  if (useOptions) {
    for (const { key } of activeAbilities(item, action)) {
      const opt = getHandler(key)?.useOption;
      if (opt) useOptions[opt] = true;
    }
  }
}

/**
 * Append a short placeholder footnote for each applied ability that has no
 * mechanical handler yet, so the card shows the weapon carries the ability even
 * before it's implemented. Called from a wrapper on `ActionUse.addFootnotes`,
 * which runs after the base footnotes are built but before they're enriched into
 * the card HTML (so a late display hook is too late).
 * @param {object} actionUse the in-flight ActionUse.
 */
function appendFootnotes(actionUse) {
  const item = actionUse?.item;
  if (!isSupported(item)) return;

  const applied = activeAbilities(item, actionUse.action);
  if (!applied.length) return;

  const footnotes = actionUse.shared?.templateData?.footnotes;
  if (!Array.isArray(footnotes)) return;

  const base = {
    item, action: actionUse.action, actor: item.actor, target: getSingleTargetActor(),
    isConditionalEnabled: conditionalCheckerFor(actionUse.action, actionUse.shared?.conditionals),
  };
  const seen = new Set();
  for (const { key, params } of applied) {
    const handler = getHandler(key);
    if (handler?.footnote) {
      // Conditional ability: footnote only when it did not auto-apply. (Per instance,
      // since params may differ between two rows of the same ability.)
      const text = handler.footnote({ ...base, params });
      if (text) footnotes.push({ text });
    } else if (!handler && !seen.has(key)) {
      // Unimplemented ability: one placeholder so the card shows it's present.
      seen.add(key);
      const a = getAbility(key);
      if (a) footnotes.push({ text: a.summary || a.name });
    }
  }
}

/**
 * Append a footnote describing what this attack bypasses ("Counts as cold iron, good
 * for damage reduction"), so the players see the effect the GM's apply-damage dialog
 * will act on. Not weapon-gated, for the same reason `bypassForUse` isn't.
 * @param {object} actionUse the in-flight ActionUse.
 */
function appendBypassFootnotes(actionUse) {
  const footnotes = actionUse?.shared?.templateData?.footnotes;
  if (!Array.isArray(footnotes)) return;

  for (const text of bypassFootnotes(bypassForUse(actionUse.item, actionUse.action))) {
    footnotes.push({ text });
  }
}

/**
 * Append the effect-note enrichers (e.g. @Condition[…], @Bleed[…]) of *granted*
 * abilities to a ChatAttack, then re-enrich. Applied abilities have these written to
 * the action at Apply (so PF1 already picks them up); grants don't, so we add them
 * here. Called from a wrapper on `ChatAttack.addEffectNotes`.
 * @param {object} chatAttack the in-flight ChatAttack.
 */
async function injectGrantedEffectNotes(chatAttack) {
  const action = chatAttack?.action;
  const item = action?.item;
  if (!isSupported(item)) return;

  const extra = [];
  for (const { key } of grantedAbilities(action)) {
    const note = getHandler(key)?.effectNote;
    const text = typeof note === 'function' ? note() : note;
    if (text) extra.push(text);
  }
  if (!extra.length) return;

  if (!Array.isArray(chatAttack.effectNotes)) chatAttack.effectNotes = [];
  chatAttack.effectNotes.push(...extra.map((text) => ({ text })));
  await chatAttack.setEffectNotesHTML();
}

/**
 * The non-crit damage formulas our applied abilities contribute, for the
 * at-a-glance combat-tab column. Reuses the same handlers as the live roll (with
 * isCrit=false) so the column stays consistent with what actually rolls.
 *
 * The column has no specific target and no interactive conditional toggles, so each
 * handler self-reports what it would add "by default": always-on damage (energy,
 * Merciful's 1d6) shows; target-gated damage (Bane, Holy) returns nothing because
 * there is no target; state-gated damage (Furious's +2) shows only while the state
 * is currently satisfied. Crit-only riders (burst dice) are excluded from the base
 * column. Formulas are unlabelled — flavor brackets don't render in this column.
 * @param {object} action the action whose item we read.
 * @returns {string[]}
 */
function displayDamageFormulas(action) {
  const item = action?.item;
  if (!isSupported(item)) return [];
  const applied = getAppliedAbilities(item);
  if (!applied.length) return [];

  const base = {
    item, action, actor: item.actor, rollData: {}, isCrit: false,
    target: null, isConditionalEnabled: () => false,
  };
  const out = [];
  for (const { key, params } of applied) {
    const handler = getHandler(key);
    if (!handler?.damage) continue;
    for (const c of handler.damage({ ...base, params }) ?? []) {
      if (c?.onCrit || !c?.formula) continue; // crit-only riders stay out of the base column
      out.push(c.formula);
    }
  }
  return out;
}

/**
 * Wrap `pf1.utils.formula.actionDamage` so injected damage shows in the combat-tab
 * damage column. Additive (appends to the string the original produced) — no
 * reimplementation of the formula builder. Call once at `setup`.
 */
export function patchDamageDisplay() {
  if (typeof globalThis.pf1?.utils?.formula?.actionDamage !== 'function') {
    console.error('pf1-magic-equipment | pf1.utils.formula.actionDamage not found; combat-tab damage display disabled.');
    return;
  }
  registerWrapper('pf1.utils.formula.actionDamage', function (wrapped, action, ...rest) {
    const base = wrapped(action, ...rest);
    try {
      const extra = displayDamageFormulas(action);
      if (extra.length && base && base !== 'NaN') return `${base} + ${extra.join(' + ')}`;
    } catch (err) {
      console.error('pf1-magic-equipment | combat-tab damage display failed', err);
    }
    return base;
  });
}

/**
 * Wrap the two `ActionUse` methods we hook into. Call once at `setup`.
 *  - `addFootnotes`: append our placeholder/conditional footnotes before enrichment.
 *  - `handleConditionals`: capture which attack-dialog conditionals are enabled so
 *    conditional-toggle abilities (e.g. Merciful's "deal lethal") can read them at the
 *    damage seam. ckl-roll-bonuses registers a libWrapper OVERRIDE on this method, so
 *    we must wrap via libWrapper (a WRAPPER stacks around the override and still runs);
 *    a manual prototype patch would be dead code.
 */
export function patchActionUse() {
  if (!globalThis.pf1?.actionUse?.ActionUse?.prototype?.addFootnotes) {
    console.error('pf1-magic-equipment | ActionUse.addFootnotes not found; footnotes disabled.');
    return;
  }

  registerWrapper('pf1.actionUse.ActionUse.prototype.addFootnotes', async function (wrapped, ...args) {
    const result = await wrapped(...args);
    try {
      appendFootnotes(this);
      appendBypassFootnotes(this);
    } catch (err) {
      console.error('pf1-magic-equipment | footnote injection failed', err);
    }
    return result;
  });

  // handleConditionals runs after the dialog resolves conditionals (populating
  // shared.conditionals) and before the damage rolls. Stamp the enabled IDs onto
  // shared.rollData, which pf1PreDamageRoll receives as a deepClone.
  registerWrapper('pf1.actionUse.ActionUse.prototype.handleConditionals', async function (wrapped, ...args) {
    const result = await wrapped(...args);
    try {
      const ids = [...(this.shared?.conditionals ?? [])];
      if (this.shared?.rollData) this.shared.rollData[COND_KEY] = ids;
      setEnabledConditionals(this.action, ids);
    } catch (err) {
      console.error('pf1-magic-equipment | conditional capture failed', err);
    }
    return result;
  });

  // ChatAttack.addEffectNotes builds a card's effect notes from the action/item; a
  // granted ability's effect-note enrichers aren't on the action, so append them here.
  if (globalThis.pf1?.actionUse?.ChatAttack?.prototype?.addEffectNotes) {
    registerWrapper('pf1.actionUse.ChatAttack.prototype.addEffectNotes', async function (wrapped, ...args) {
      const result = await wrapped(...args);
      try {
        await injectGrantedEffectNotes(this);
      } catch (err) {
        console.error('pf1-magic-equipment | granted effect-note injection failed', err);
      }
      return result;
    });
  }
}

/** Register an additive libWrapper WRAPPER, logging (not throwing) on failure. */
function registerWrapper(path, fn) {
  const lw = globalThis.libWrapper;
  if (!lw?.register) {
    console.error(`pf1-magic-equipment | libWrapper not available; "${path}" wrapper not installed.`);
    return;
  }
  try {
    lw.register(MODULE_ID, path, fn, 'WRAPPER');
  } catch (err) {
    console.error(`pf1-magic-equipment | libWrapper registration failed for "${path}"`, err);
  }
}
