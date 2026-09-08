// Optional integration with ckl-roll-bonuses. Registers a bonus type that grants
// this mod's weapon abilities to whatever action roll-bonuses' targeting matches,
// for the duration of a use — e.g. a buff that makes a targeted weapon *axiomatic*
// while active. The abilities are fed into the SAME injection engine as the
// on-item abilities (engine.mjs); nothing is written to the weapon.
//
// roll-bonuses is never required: if it's absent, the `ready` hook never fires and
// this stays dormant. Pattern mirrors astora-mod's target-filter bonus.

import { getAbility } from './data.mjs';
import { addGrant } from './engine.mjs';
import { addBypassGrant, bypassChoices } from './bypass.mjs';
import { abilityPickerHtml, wireAbilityPicker } from './ability-picker.mjs';

export const RB_MODULE_ID = 'ckl-roll-bonuses';
/** PF1 boolean item flag that marks an item as carrying this bonus. */
export const RB_BONUS_FLAG = 'bonus_magic-equipment-abilities';
/** Module flag (under ckl-roll-bonuses) holding the configured ability rows. */
export const RB_ROWS_KEY = `${RB_BONUS_FLAG}-rows`;

/** PF1 boolean item flag marking an item as a source of the DR-bypass bonus. */
export const RB_BYPASS_FLAG = 'bonus_dr-bypass';
/** Module flag (under ckl-roll-bonuses) holding the DR-bypass configuration. */
export const RB_BYPASS_KEY = `${RB_BYPASS_FLAG}-config`;

/**
 * Read the DR bypass configured on an item's DR Bypass roll-bonus.
 * @param {ItemPF} item
 * @returns {{ types: string[], ignoreAll: boolean, ignoreGeneric: boolean }}
 */
export function getRollBonusBypass(item) {
  const raw = item?.getFlag?.(RB_MODULE_ID, RB_BYPASS_KEY) ?? {};
  return {
    types: Array.isArray(raw.types) ? [...raw.types] : [],
    ignoreAll: raw.ignoreAll === true,
    ignoreGeneric: raw.ignoreGeneric === true,
  };
}

/**
 * Set (from a script/macro) the DR bypass granted by an item's DR Bypass roll-bonus.
 * Ensures the item is flagged as a bonus source, then writes the config.
 *
 * Smite Evil, for example, is `{ ignoreAll: true }` on the smite buff — gate it to the
 * smitten creature with roll-bonuses' own conditional targeting.
 * @param {ItemPF} item the bonus-carrying item (e.g. a buff).
 * @param {{ types?: string[], ignoreAll?: boolean, ignoreGeneric?: boolean }} config
 * @returns {Promise<object>} the normalized config written.
 */
export async function setRollBonusBypass(item, config = {}) {
  if (!item) return null;
  const known = new Set(bypassChoices().map((c) => c.key));
  const given = Array.isArray(config.types)
    ? config.types
    : typeof config.types === 'string' ? [config.types] : [];
  const types = given.filter((t) => {
    if (known.has(t)) return true;
    console.error(`pf1-magic-equipment | setRollBonusBypass: unknown bypass type "${t}".`);
    return false;
  });
  const next = { types, ignoreAll: config.ignoreAll === true, ignoreGeneric: config.ignoreGeneric === true };

  if (item.addItemBooleanFlag && !item.hasItemBooleanFlag?.(RB_BYPASS_FLAG)) {
    await item.addItemBooleanFlag(RB_BYPASS_FLAG);
  }
  await item.setFlag(RB_MODULE_ID, RB_BYPASS_KEY, next);
  return next;
}

/** Build the DR-bypass picker as DOM (no HTML strings → nothing to escape). */
function bypassPickerNode(config, editable) {
  const root = document.createElement('div');
  root.classList.add('pf1me-bypass');

  const head = document.createElement('div');
  head.classList.add('pf1me-abilities-head');
  const label = document.createElement('label');
  label.textContent = 'Bypasses damage reduction as';
  head.append(label);
  root.append(head);

  const checkbox = (key, text, checked, action) => {
    const wrap = document.createElement('label');
    wrap.classList.add('pf1me-bypass-option');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = checked;
    input.disabled = !editable;
    input.dataset.action = action;
    input.dataset.key = key;
    wrap.append(input, document.createTextNode(` ${text}`));
    return wrap;
  };

  const grid = document.createElement('div');
  grid.classList.add('pf1me-bypass-grid');
  for (const choice of bypassChoices()) {
    grid.append(checkbox(choice.key, choice.label, config.types.includes(choice.key), 'bypass-type'));
  }
  root.append(grid);

  const special = document.createElement('div');
  special.classList.add('pf1me-bypass-grid');
  special.append(checkbox('ignoreGeneric', 'Bypass DR/— ', config.ignoreGeneric, 'bypass-generic'));
  special.append(checkbox('ignoreAll', 'Bypass ALL damage reduction', config.ignoreAll, 'bypass-all'));
  root.append(special);

  return root;
}

/**
 * Read the ability rows configured on an item's Magic Equipment roll-bonus.
 * @param {ItemPF} item
 * @returns {{ category: string, key: string, params: object }[]}
 */
export function getRollBonusAbilities(item) {
  const rows = item?.getFlag?.(RB_MODULE_ID, RB_ROWS_KEY);
  return Array.isArray(rows) ? rows : [];
}

/**
 * Set (from a script/macro) the abilities granted by an item's Magic Equipment
 * roll-bonus. Ensures the item is flagged as a bonus source, then writes the rows.
 * Accepts ability keys (strings) or `{ key, params, category? }` entries; unknown
 * keys are kept but warned about. Returns the normalized rows written.
 * @param {ItemPF} item the bonus-carrying item (e.g. a buff).
 * @param {(string | { key: string, params?: object, category?: string })[]} entries
 * @returns {Promise<object[]>}
 */
export async function setRollBonusAbilities(item, entries) {
  if (!item) return [];
  const rows = (Array.isArray(entries) ? entries : [entries])
    .map((e) => (typeof e === 'string' ? { key: e } : (e ?? {})))
    .filter((r) => r.key)
    .map((r) => {
      if (!getAbility(r.key)) console.error(`pf1-magic-equipment | setRollBonusAbilities: unknown ability key "${r.key}".`);
      return { category: r.category ?? 'all', key: r.key, params: r.params ?? {} };
    });

  // Ensure roll-bonuses treats this item as a source of the bonus.
  if (item.addItemBooleanFlag && !item.hasItemBooleanFlag?.(RB_BONUS_FLAG)) {
    await item.addItemBooleanFlag(RB_BONUS_FLAG);
  }
  await item.setFlag(RB_MODULE_ID, RB_ROWS_KEY, rows);
  return rows;
}

function registerBridge(api) {
  const BaseBonus = api?.sources?.BaseBonus;
  if (!BaseBonus || !api.utils?.registerSource) {
    console.error('pf1-magic-equipment | roll-bonuses API not usable; bridge disabled.');
    return;
  }

  class MagicEquipmentBonus extends BaseBonus {
    /** @override */
    static get sourceKey() { return 'magic-equipment-abilities'; }

    /** @override */
    static get journal() { return ''; }

    /** @override */
    static get label() { return 'Magic Equipment Abilities'; }

    /** @override */
    static get tooltip() {
      return 'Grant pf1-magic-equipment weapon special abilities to the targeted weapon while this bonus applies. Injected at use-time only — nothing is written to the weapon.';
    }

    /** Flag key holding the configured ability rows. Matches RB_ROWS_KEY. */
    static get #rowsKey() { return `${this.key}-rows`; }

    /** The configured rows: [{ category, key, params }]. */
    static #rows(source) {
      return getRollBonusAbilities(source);
    }

    /** The distinct ability keys configured on this bonus. */
    static #abilityKeys(source) {
      const keys = [];
      for (const row of this.#rows(source)) if (row?.key && !keys.includes(row.key)) keys.push(row.key);
      return keys;
    }

    /** @override */
    static getHints(source) {
      const keys = this.#abilityKeys(source);
      if (!keys.length) return ['Magic Equipment: (none set)'];
      return [`Magic Equipment: ${keys.map((k) => getAbility(k)?.name ?? k).join(', ')}`];
    }

    /** @override */
    static showInputOnItemSheet({ html, isEditable, item }) {
      const rowsKey = this.#rowsKey;
      const child = document.createElement('div');
      // `pf1me-section` gives the picker its styling; `pf1me-rb-picker` distinguishes it
      // from the item sheet's own section, whose de-dup guard only removes
      // `.pf1me-item-section` (so this picker survives each render).
      child.classList.add('pf1me-section', 'pf1me-rb-picker');
      // A grant is injected into an attack, so only the weapon catalog applies here
      // regardless of what kind of item carries the buff.
      child.innerHTML = abilityPickerHtml(this.#rows(item), `rb-${item.id}`, isEditable, ['weapon']);

      // Place it in the roll-bonuses container on the sheet's Advanced tab, using
      // roll-bonuses' own helper — appending to the raw sheet root instead lands the
      // markup outside every tab (invisible) with no section header.
      const addNode = api.inputs?.addNodeToRollBonus;
      if (typeof addNode !== 'function') {
        console.error('pf1-magic-equipment | roll-bonuses addNodeToRollBonus helper missing; cannot render ability picker.');
        return;
      }
      addNode(html, child, item, isEditable, 'bonus');

      wireAbilityPicker(child, {
        editable: isEditable,
        kinds: ['weapon'],
        getAbilities: () => foundry.utils.deepClone(item.getFlag(RB_MODULE_ID, rowsKey) ?? []),
        setAbilities: (abilities) => item.setFlag(RB_MODULE_ID, rowsKey, abilities),
      });
    }

    /**
     * @override
     * Fires at the start of a use for every bonus whose targeting matches the
     * action. We grant the configured abilities to that action for this use.
     */
    static actionUseProcess(source, actionUse) {
      const keys = this.#abilityKeys(source);
      if (keys.length) addGrant(actionUse.action, keys);
    }
  }

  /**
   * Lets a buff make attacks count as bypassing damage reduction — the attack side of
   * DR, which roll-bonuses has no vocabulary for (its enhancement bonus is the only
   * thing that reaches DR today, and only by also adding to hit and damage).
   */
  class DrBypassBonus extends BaseBonus {
    /** @override */
    static get sourceKey() { return 'dr-bypass'; }

    /** @override */
    static get journal() { return ''; }

    /** @override */
    static get label() { return 'DR Bypass'; }

    /** @override */
    static get tooltip() {
      return 'Treat attacks as though they had these properties when the target\'s damage reduction is checked (or ignore DR entirely). Nothing is written to the weapon; the bypass is recorded on the attack card and read when damage is applied.';
    }

    /** @override */
    static getHints(source) {
      const cfg = getRollBonusBypass(source);
      if (cfg.ignoreAll) return ['Bypasses all DR'];
      const labels = bypassChoices().filter((c) => cfg.types.includes(c.key)).map((c) => c.label);
      if (cfg.ignoreGeneric) labels.push('DR/—');
      return labels.length ? [`Bypasses: ${labels.join(', ')}`] : ['DR Bypass: (none set)'];
    }

    /** @override */
    static showInputOnItemSheet({ html, isEditable, item }) {
      const child = document.createElement('div');
      // Per-feature de-dup class: a shared one would strip the other picker on
      // re-render (see the weapon sheet's own section).
      child.classList.add('pf1me-section', 'pf1me-rb-bypass');
      child.append(bypassPickerNode(getRollBonusBypass(item), isEditable));

      const addNode = api.inputs?.addNodeToRollBonus;
      if (typeof addNode !== 'function') {
        console.error('pf1-magic-equipment | roll-bonuses addNodeToRollBonus helper missing; cannot render DR bypass picker.');
        return;
      }
      addNode(html, child, item, isEditable, 'bonus');

      if (!isEditable) return;
      child.addEventListener('change', async (ev) => {
        const input = ev.target.closest('[data-action]');
        if (!input || !child.contains(input)) return;
        const cfg = getRollBonusBypass(item);

        if (input.dataset.action === 'bypass-type') {
          const key = input.dataset.key;
          cfg.types = input.checked ? [...new Set([...cfg.types, key])] : cfg.types.filter((t) => t !== key);
        } else if (input.dataset.action === 'bypass-generic') {
          cfg.ignoreGeneric = input.checked;
        } else if (input.dataset.action === 'bypass-all') {
          cfg.ignoreAll = input.checked;
        } else return;

        await item.setFlag(RB_MODULE_ID, RB_BYPASS_KEY, cfg);
      });
    }

    /**
     * @override
     * Fires at the start of a use for every bonus whose targeting matches. The grant
     * is snapshotted onto the chat card by the engine at `pf1PreDisplayActionUse`.
     */
    static actionUseProcess(source, actionUse) {
      const cfg = getRollBonusBypass(source);
      if (!cfg.types.length && !cfg.ignoreAll && !cfg.ignoreGeneric) return;
      addBypassGrant(actionUse.action, {
        materials: cfg.types,
        ignoreAll: cfg.ignoreAll,
        ignoreGeneric: cfg.ignoreGeneric,
        sources: [source?.name].filter(Boolean),
      });
    }
  }

  for (const bonus of [MagicEquipmentBonus, DrBypassBonus]) {
    try {
      api.utils.registerSource(bonus);
      bonus.init?.();
    } catch (err) {
      console.error(`pf1-magic-equipment | roll-bonuses bridge registration failed for ${bonus.name}:`, err);
    }
  }
}

Hooks.once(`${RB_MODULE_ID}.ready`, registerBridge);
