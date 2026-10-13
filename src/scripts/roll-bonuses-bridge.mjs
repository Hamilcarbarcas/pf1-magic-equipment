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
import {
  addBypassGrant, bypassChoices, drOverrideChoices, erOverrideChoices,
  OVERRIDE_MODES, overrideKind, isBypassMode,
} from './bypass.mjs';
import { abilityPickerHtml, wireAbilityPicker } from './ability-picker.mjs';

export const RB_MODULE_ID = 'ckl-roll-bonuses';
/** PF1 boolean item flag that marks an item as carrying this bonus. */
export const RB_BONUS_FLAG = 'bonus_magic-equipment-abilities';
/** Module flag (under ckl-roll-bonuses) holding the configured ability rows. */
export const RB_ROWS_KEY = `${RB_BONUS_FLAG}-rows`;

/**
 * PF1 boolean item flag marking an item as a source of the Defense Bypass bonus. Still
 * `dr-bypass` from when it only handled DR, so existing items keep working.
 */
export const RB_BYPASS_FLAG = 'bonus_dr-bypass';
/** Module flag (under ckl-roll-bonuses) holding the Defense Bypass configuration. */
export const RB_BYPASS_KEY = `${RB_BYPASS_FLAG}-config`;

/**
 * The original Defense Bypass mode: count as materials / alignments / magic, or ignore DR
 * outright. Configs written before modes existed read as this.
 */
export const COUNT_AS = 'countAs';
const BYPASS_MODES = [COUNT_AS, ...OVERRIDE_MODES];
const MODE_LABELS = {
  [COUNT_AS]: 'Bypass DR as',
  drBypass: 'DR Bypass',
  drReduce: 'DR Reduction',
  erBypass: 'ER Bypass',
  erReduce: 'ER Reduction',
  hardnessBypass: 'Hardness Bypass',
  hardnessReduce: 'Hardness Reduction',
};

/** Type choices for an override mode; empty for hardness. */
function overrideTypeChoices(mode) {
  const kind = overrideKind(mode);
  return kind === 'dr' ? drOverrideChoices() : kind === 'er' ? erOverrideChoices() : [];
}

/**
 * Read the config on an item's Defense Bypass roll-bonus. Every mode's fields are kept, so
 * switching modes and back loses nothing.
 * @param {ItemPF} item
 * @returns {{ mode: string, types: string[], ignoreAll: boolean, ignoreGeneric: boolean,
 *   type: string, amount: string, max: string }}
 */
export function getRollBonusBypass(item) {
  const raw = item?.getFlag?.(RB_MODULE_ID, RB_BYPASS_KEY) ?? {};
  return {
    mode: BYPASS_MODES.includes(raw.mode) ? raw.mode : COUNT_AS,
    types: Array.isArray(raw.types) ? [...raw.types] : [],
    ignoreAll: raw.ignoreAll === true,
    ignoreGeneric: raw.ignoreGeneric === true,
    type: String(raw.type ?? ''),
    amount: String(raw.amount ?? ''),
    max: String(raw.max ?? ''),
  };
}

/**
 * Set (from a script/macro) the config on an item's Defense Bypass roll-bonus.
 * Ensures the item is flagged as a bonus source, then writes the config.
 *
 * Smite Evil, for example, is `{ ignoreAll: true }` on the smite buff — gate it to the
 * smitten creature with roll-bonuses' own conditional targeting. Adamantine-like hardness
 * penetration is `{ mode: 'hardnessBypass', max: '19' }`.
 * @param {ItemPF} item the bonus-carrying item (e.g. a buff).
 * @param {{ mode?: string, types?: string[], ignoreAll?: boolean, ignoreGeneric?: boolean,
 *   type?: string, amount?: string|number, max?: string|number }} config
 * @returns {Promise<object>} the normalized config written.
 */
export async function setRollBonusBypass(item, config = {}) {
  if (!item) return null;
  const mode = config.mode ?? COUNT_AS;
  if (!BYPASS_MODES.includes(mode)) {
    console.error(`pf1-magic-equipment | setRollBonusBypass: unknown mode "${mode}".`);
    return null;
  }

  const known = new Set(bypassChoices().map((c) => c.key));
  const given = Array.isArray(config.types)
    ? config.types
    : typeof config.types === 'string' ? [config.types] : [];
  const types = given.filter((t) => {
    if (known.has(t)) return true;
    console.error(`pf1-magic-equipment | setRollBonusBypass: unknown bypass type "${t}".`);
    return false;
  });

  let type = String(config.type ?? '');
  const choices = overrideTypeChoices(mode);
  if (choices.length && !choices.some((c) => c.key === type)) {
    if (config.type !== undefined) console.error(`pf1-magic-equipment | setRollBonusBypass: unknown ${mode} type "${type}".`);
    type = choices[0].key;
  }

  const next = {
    mode,
    types,
    ignoreAll: config.ignoreAll === true,
    ignoreGeneric: config.ignoreGeneric === true,
    type,
    amount: String(config.amount ?? ''),
    max: String(config.max ?? ''),
  };

  if (item.addItemBooleanFlag && !item.hasItemBooleanFlag?.(RB_BYPASS_FLAG)) {
    await item.addItemBooleanFlag(RB_BYPASS_FLAG);
  }
  await item.setFlag(RB_MODULE_ID, RB_BYPASS_KEY, next);
  return next;
}

/**
 * An override mode's config as a grant, formulas resolved against the bonus's item. Null when
 * it grants nothing, or when a ceiling won't resolve: treating a broken ceiling as "no limit"
 * would bypass far more than intended.
 * @returns {import('./bypass.mjs').DefenseOverride|null}
 */
function resolveOverride(source, cfg) {
  const rollData = source?.getRollData?.() ?? {};
  const resolve = (formula) => {
    const roll = globalThis.pf1?.dice?.RollPF?.safeRollSync?.(formula, rollData);
    return roll && !roll.err && Number.isFinite(roll.total) ? roll.total : null;
  };

  const choices = overrideTypeChoices(cfg.mode);
  const type = choices.length ? (choices.some((c) => c.key === cfg.type) ? cfg.type : choices[0].key) : '';

  if (isBypassMode(cfg.mode)) {
    if (!cfg.max) return { mode: cfg.mode, type, amount: 0, max: null };
    const max = resolve(cfg.max);
    if (max === null) {
      console.error(`pf1-magic-equipment | Defense Bypass on "${source?.name}": maximum "${cfg.max}" did not resolve; not applied.`);
      return null;
    }
    return { mode: cfg.mode, type, amount: 0, max };
  }

  const amount = resolve(cfg.amount || '0') ?? 0;
  return amount > 0 ? { mode: cfg.mode, type, amount, max: null } : null;
}

/** A labeled row: `Label  [control]`. */
function pickerRow(text, control) {
  const row = document.createElement('div');
  row.classList.add('pf1me-bypass-row');
  const label = document.createElement('label');
  label.textContent = text;
  row.append(label, control);
  return row;
}

/** A `<select>` over `{key, label}` choices. */
function pickerSelect(choices, current, editable, action) {
  const select = document.createElement('select');
  select.dataset.action = action;
  select.disabled = !editable;
  for (const { key, label } of choices) {
    const option = document.createElement('option');
    option.value = key;
    option.textContent = label;
    option.selected = key === current;
    select.append(option);
  }
  return select;
}

/** A formula text input. `formula` gets Little Helper's live `= value` readout. */
function pickerFormula(value, placeholder, editable, action) {
  const input = document.createElement('input');
  input.type = 'text';
  input.classList.add('formula');
  input.value = value;
  input.placeholder = placeholder;
  input.disabled = !editable;
  input.dataset.action = action;
  return input;
}

/** Build the Defense Bypass picker as DOM (no HTML strings → nothing to escape). */
function bypassPickerNode(config, editable) {
  const root = document.createElement('div');
  root.classList.add('pf1me-bypass');

  const modes = BYPASS_MODES.map((key) => ({ key, label: MODE_LABELS[key] }));
  root.append(pickerRow('Mode', pickerSelect(modes, config.mode, editable, 'bypass-mode')));

  if (config.mode !== COUNT_AS) {
    const choices = overrideTypeChoices(config.mode);
    if (choices.length) {
      const label = overrideKind(config.mode) === 'dr' ? 'DR type' : 'Energy type';
      root.append(pickerRow(label, pickerSelect(choices, config.type || choices[0].key, editable, 'bypass-target')));
    }
    if (isBypassMode(config.mode)) {
      root.append(pickerRow('Maximum', pickerFormula(config.max, 'No limit', editable, 'bypass-max')));
    } else {
      root.append(pickerRow('Amount', pickerFormula(config.amount, '0', editable, 'bypass-amount')));
    }
    return root;
  }

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
 * Whether a row's "only if" formula passes, resolved against the bonus's own item. An
 * empty condition always passes; one that won't resolve fails, so a typo withholds the
 * ability instead of granting it unconditionally.
 */
function rowConditionPasses(source, row) {
  const formula = String(row?.condition ?? '').trim();
  if (!formula) return true;
  const roll = globalThis.pf1?.dice?.RollPF?.safeRollSync?.(formula, source?.getRollData?.() ?? {});
  if (!roll || roll.err || !Number.isFinite(roll.total)) {
    const name = getAbility(row.key)?.name ?? row.key;
    console.error(`pf1-magic-equipment | Weapon Abilities on "${source?.name}": condition "${formula}" for ${name} did not resolve; not applied.`, roll?.err);
    ui.notifications?.warn(`${source?.name}: condition for ${name} did not resolve; ability not applied.`);
    return false;
  }
  return roll.total !== 0;
}

/**
 * Read the ability rows configured on an item's Magic Equipment roll-bonus.
 * @param {ItemPF} item
 * @returns {{ category: string, key: string, params: object, condition?: string }[]}
 */
export function getRollBonusAbilities(item) {
  const rows = item?.getFlag?.(RB_MODULE_ID, RB_ROWS_KEY);
  return Array.isArray(rows) ? rows : [];
}

/**
 * Set (from a script/macro) the abilities granted by an item's Magic Equipment
 * roll-bonus. Ensures the item is flagged as a bonus source, then writes the rows.
 * Accepts ability keys (strings) or `{ key, params, category?, condition? }` entries;
 * unknown keys are kept but warned about. `condition` is a formula resolved against the
 * bonus's item at use time; the ability applies only when it is nonzero. Returns the
 * normalized rows written.
 * @param {ItemPF} item the bonus-carrying item (e.g. a buff).
 * @param {(string | { key: string, params?: object, category?: string, condition?: string })[]} entries
 * @returns {Promise<object[]>}
 */
export async function setRollBonusAbilities(item, entries) {
  if (!item) return [];
  const rows = (Array.isArray(entries) ? entries : [entries])
    .map((e) => (typeof e === 'string' ? { key: e } : (e ?? {})))
    .filter((r) => r.key)
    .map((r) => {
      if (!getAbility(r.key)) console.error(`pf1-magic-equipment | setRollBonusAbilities: unknown ability key "${r.key}".`);
      const condition = String(r.condition ?? '').trim();
      return { category: r.category ?? 'all', key: r.key, params: r.params ?? {}, ...(condition ? { condition } : {}) };
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
    static get label() { return 'Weapon Abilities (magic equipment)'; }

    /** @override */
    static get tooltip() {
      return 'Grant pf1-magic-equipment weapon special abilities to the targeted weapon while this bonus applies, each optionally gated by its own formula. Injected at use-time only; nothing is written to the weapon.';
    }

    /** Flag key holding the configured ability rows. Matches RB_ROWS_KEY. */
    static get #rowsKey() { return `${this.key}-rows`; }

    /** The configured rows that name an ability: [{ category, key, params, condition? }]. */
    static #rows(source) {
      return getRollBonusAbilities(source).filter((row) => row?.key);
    }

    /** @override */
    static getHints(source) {
      const rows = this.#rows(source);
      if (!rows.length) return ['Magic Equipment: (none set)'];
      const names = rows.map((row) => {
        const name = getAbility(row.key)?.name ?? row.key;
        return row.condition ? `${name} (conditional)` : name;
      });
      return [`Magic Equipment: ${names.join(', ')}`];
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
      child.innerHTML = abilityPickerHtml(getRollBonusAbilities(item), `rb-${item.id}`, isEditable, ['weapon'], { conditions: true });

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
     * action. Grants each configured ability whose condition passes, with its params.
     */
    static actionUseProcess(source, actionUse) {
      const granted = this.#rows(source)
        .filter((row) => rowConditionPasses(source, row))
        .map((row) => ({ key: row.key, params: row.params ?? {} }));
      if (granted.length) addGrant(actionUse.action, granted);
    }
  }

  /**
   * Lets a buff weaken the defenses its attacks meet: the attack side of DR, ER, and
   * hardness, which roll-bonuses has no vocabulary for (its enhancement bonus is the only
   * thing that reaches DR today, and only by also adding to hit and damage).
   *
   * The source key stays `dr-bypass` from when it only handled DR, so existing items keep
   * working. DESIGN.md §7d
   */
  class DefenseBypassBonus extends BaseBonus {
    /** @override */
    static get sourceKey() { return 'dr-bypass'; }

    /** @override */
    static get journal() { return ''; }

    /** @override */
    static get label() { return 'Defense Bypass (magic equipment)'; }

    /** @override */
    static get tooltip() {
      return 'Weaken the defenses this attack meets: count as a material or alignment for DR, ignore DR, energy resistance, or hardness (up to a maximum), or reduce them by an amount. Nothing is written to the weapon; it is recorded on the attack card and read when damage is applied.';
    }

    /** @override */
    static getHints(source) {
      const cfg = getRollBonusBypass(source);
      if (cfg.mode !== COUNT_AS) {
        const choices = overrideTypeChoices(cfg.mode);
        const typeLabel = choices.find((c) => c.key === cfg.type)?.label ?? choices[0]?.label;
        const head = typeLabel ? `${MODE_LABELS[cfg.mode]} (${typeLabel})` : MODE_LABELS[cfg.mode];
        if (isBypassMode(cfg.mode)) return [cfg.max.trim() ? `${head}: up to ${cfg.max}` : head];
        return [`${head}: ${cfg.amount.trim() || 0}`];
      }
      if (cfg.ignoreAll) return ['Bypasses all DR'];
      const labels = bypassChoices().filter((c) => cfg.types.includes(c.key)).map((c) => c.label);
      if (cfg.ignoreGeneric) labels.push('DR/—');
      return labels.length ? [`Bypasses: ${labels.join(', ')}`] : ['Defense Bypass: (none set)'];
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
        console.error('pf1-magic-equipment | roll-bonuses addNodeToRollBonus helper missing; cannot render Defense Bypass picker.');
        return;
      }
      addNode(html, child, item, isEditable, 'bonus');

      if (!isEditable) return;
      child.addEventListener('change', async (ev) => {
        const input = ev.target.closest('[data-action]');
        if (!input || !child.contains(input)) return;
        const cfg = getRollBonusBypass(item);

        switch (input.dataset.action) {
          case 'bypass-type': {
            const key = input.dataset.key;
            cfg.types = input.checked ? [...new Set([...cfg.types, key])] : cfg.types.filter((t) => t !== key);
            break;
          }
          case 'bypass-generic':
            cfg.ignoreGeneric = input.checked;
            break;
          case 'bypass-all':
            cfg.ignoreAll = input.checked;
            break;
          case 'bypass-mode': {
            cfg.mode = input.value;
            // Keep the type only if the new mode offers it (DR and ER lists differ).
            const choices = overrideTypeChoices(cfg.mode);
            if (!choices.some((c) => c.key === cfg.type)) cfg.type = choices[0]?.key ?? '';
            break;
          }
          case 'bypass-target':
            cfg.type = input.value;
            break;
          case 'bypass-amount':
            cfg.amount = input.value.trim();
            break;
          case 'bypass-max':
            cfg.max = input.value.trim();
            break;
          default:
            return;
        }

        // The sheet re-renders on the flag write, which redraws the picker for a new mode.
        await item.setFlag(RB_MODULE_ID, RB_BYPASS_KEY, cfg);
      });
    }

    /**
     * @override
     * Fires at the start of a use for every bonus whose targeting matches. The grant
     * is snapshotted onto the chat card by the engine at `pf1PreDisplayActionUse`.
     * Formulas resolve here, against the bonus's own item, so the card carries numbers.
     */
    static actionUseProcess(source, actionUse) {
      const cfg = getRollBonusBypass(source);
      if (cfg.mode !== COUNT_AS) {
        const override = resolveOverride(source, cfg);
        if (override) addBypassGrant(actionUse.action, { overrides: [override], sources: [source?.name].filter(Boolean) });
        return;
      }
      if (!cfg.types.length && !cfg.ignoreAll && !cfg.ignoreGeneric) return;
      addBypassGrant(actionUse.action, {
        materials: cfg.types,
        ignoreAll: cfg.ignoreAll,
        ignoreGeneric: cfg.ignoreGeneric,
        sources: [source?.name].filter(Boolean),
      });
    }
  }

  for (const bonus of [MagicEquipmentBonus, DefenseBypassBonus]) {
    try {
      api.utils.registerSource(bonus);
      bonus.init?.();
    } catch (err) {
      console.error(`pf1-magic-equipment | roll-bonuses bridge registration failed for ${bonus.name}:`, err);
    }
  }
}

Hooks.once(`${RB_MODULE_ID}.ready`, registerBridge);
