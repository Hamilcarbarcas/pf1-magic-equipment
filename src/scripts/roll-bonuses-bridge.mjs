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
import { abilityPickerHtml, wireAbilityPicker } from './ability-picker.mjs';

export const RB_MODULE_ID = 'ckl-roll-bonuses';
/** PF1 boolean item flag that marks an item as carrying this bonus. */
export const RB_BONUS_FLAG = 'bonus_magic-equipment-abilities';
/** Module flag (under ckl-roll-bonuses) holding the configured ability rows. */
export const RB_ROWS_KEY = `${RB_BONUS_FLAG}-rows`;

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
      // from the weapon sheet's own section, whose de-dup guard only removes
      // `.pf1me-weapon-section` (so this picker survives each render).
      child.classList.add('pf1me-section', 'pf1me-rb-picker');
      child.innerHTML = abilityPickerHtml(this.#rows(item), `rb-${item.id}`, isEditable);

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

  try {
    api.utils.registerSource(MagicEquipmentBonus);
    MagicEquipmentBonus.init?.();
  } catch (err) {
    console.error('pf1-magic-equipment | roll-bonuses bridge registration failed:', err);
  }
}

Hooks.once(`${RB_MODULE_ID}.ready`, registerBridge);
