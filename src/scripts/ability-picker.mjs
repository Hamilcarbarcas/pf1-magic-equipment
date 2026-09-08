// Reusable ability-list editor: category dropdown + autocomplete ability input +
// dependent parameter controls + add/remove. Used both by the weapon sheet section
// and the roll-bonuses bonus input, each supplying its own get/set for the array of
// `{ category, key, params }` rows.

import { loc } from './config.mjs';
import { CATEGORIES, categoryLabel, abilitiesInCategory, getAbility } from './data.mjs';
import { getHandler } from './ability-handlers.mjs';

/**
 * A row's category dropdown is the cross product of the catalogs the item can draw
 * from and the price buckets, so one control picks both. Option values are
 * `kind:category`; a shield offers two optgroups (shield, then weapon — for its bash).
 */
function categoryOptionsHtml(kinds, row) {
  const selKind = row.kind ?? kinds[0];
  const selCat = row.category ?? 'all';
  const group = (kind) => {
    const opts = CATEGORIES
      .map((c) => `<option value="${kind}:${c}" ${(kind === selKind && c === selCat) ? 'selected' : ''}>${esc(categoryLabel(c, loc))}</option>`)
      .join('');
    return kinds.length === 1
      ? opts
      : `<optgroup label="${esc(loc(`PF1ME.Kind.${kind}`))}">${opts}</optgroup>`;
  };
  return kinds.map(group).join('');
}

const gp = new Intl.NumberFormat();
const gpStr = (n) => `${gp.format(Math.round(n || 0))} gp`;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** HTML for a single ability row. `uid` disambiguates datalist ids across pickers. */
function abilityRowHtml(row, index, uid, disabled, kinds) {
  const cat = row.category ?? 'all';
  const kind = row.kind ?? kinds[0];
  const catOpts = categoryOptionsHtml(kinds, row);

  const listId = `pf1me-abils-${uid}-${index}`;
  const dataOpts = abilitiesInCategory(cat, kind).map((a) => {
    const tag = a.costType === 'fixed' ? `${gpStr(a.priceMod)}` : `+${a.bonus}`;
    return `<option value="${esc(a.name)}" label="${esc(tag)}"></option>`;
  }).join('');
  const ability = getAbility(row.key, kind);
  const selName = ability?.name ?? '';
  // Homebrew entries stay selectable once applied even if the setting is later
  // turned off, so mark them rather than silently dropping them.
  const hb = ability?.homebrew
    ? `<i class="fas fa-flask pf1me-homebrew" title="${esc(loc('PF1ME.Homebrew.Marker'))}"></i>`
    : '';

  const paramSpec = getHandler(row.key, kind)?.params;
  const specs = (typeof paramSpec === 'function' ? paramSpec(row.params ?? {}) : paramSpec) ?? [];
  const paramHtml = specs.map((spec) => {
    const cur = row.params?.[spec.key] ?? '';
    const opts = (spec.options?.() ?? [])
      .map((o) => `<option value="${esc(o.key)}" ${o.key === cur ? 'selected' : ''}>${esc(o.label)}</option>`)
      .join('');
    return `<select class="pf1me-input pf1me-param" data-action="ability-param" data-param="${esc(spec.key)}" ${disabled}>
        <option value="">${esc(spec.label)}…</option>${opts}
      </select>`;
  }).join('');

  return `
    <div class="pf1me-ability-row" data-index="${index}">
      <select class="pf1me-input pf1me-cat" data-action="ability-category" ${disabled}>${catOpts}</select>
      <input class="pf1me-input pf1me-abil" data-action="ability-key" list="${listId}"
             value="${esc(selName)}" placeholder="${esc(loc('PF1ME.Abilities.PickAbility'))}"
             autocomplete="off" ${disabled}/>
      <datalist id="${listId}">${dataOpts}</datalist>
      ${hb}
      ${paramHtml}
      <a class="pf1me-remove" data-action="remove-ability" title="${esc(loc('PF1ME.Abilities.Remove'))}"><i class="fas fa-times"></i></a>
    </div>`;
}

/**
 * The full picker markup: a labelled header with add button, then the rows.
 * @param {string[]} kinds the ability catalogs this item may draw from (see
 *   `config.catalogKinds`); the first is the default for a new row.
 */
export function abilityPickerHtml(abilities, uid, editable, kinds = ['weapon']) {
  const disabled = editable ? '' : 'disabled';
  const rows = (abilities ?? []).map((row, i) => abilityRowHtml(row, i, uid, disabled, kinds)).join('');
  return `
    <div class="pf1me-abilities" data-uid="${esc(uid)}">
      <div class="pf1me-abilities-head">
        <label>${esc(loc('PF1ME.Abilities.Label'))}</label>
        <a class="pf1me-add" data-action="add-ability" title="${esc(loc('PF1ME.Abilities.Add'))}"><i class="fas fa-plus"></i></a>
      </div>
      <div class="pf1me-ability-list">${rows}</div>
    </div>`;
}

/**
 * Wire a picker's events on a container element. `getAbilities()` returns the
 * current array; `setAbilities(next)` persists it (and is expected to trigger a
 * re-render that rebuilds the picker).
 * @param {HTMLElement} root element containing the picker (delegates from here).
 * @param {{ getAbilities: () => object[], setAbilities: (a: object[]) => any, editable: boolean }} io
 */
export function wireAbilityPicker(root, { getAbilities, setAbilities, editable, kinds = ['weapon'] }) {
  if (!editable || !root) return;

  const rowIndex = (target) => Number(target.closest('.pf1me-ability-row')?.dataset.index);

  root.addEventListener('click', async (ev) => {
    const target = ev.target.closest('[data-action]');
    if (!target || !root.contains(target)) return;
    const action = target.dataset.action;

    if (action === 'add-ability') {
      ev.preventDefault();
      const abilities = getAbilities();
      abilities.push({ kind: kinds[0], category: 'all', key: '', params: {} });
      await setAbilities(abilities);
    } else if (action === 'remove-ability') {
      ev.preventDefault();
      const idx = rowIndex(target);
      const abilities = getAbilities();
      if (Number.isInteger(idx)) { abilities.splice(idx, 1); await setAbilities(abilities); }
    }
  });

  root.addEventListener('change', async (ev) => {
    const target = ev.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    const idx = rowIndex(target);
    const abilities = getAbilities();
    if (!abilities[idx]) return;

    if (action === 'ability-category') {
      // Value is `kind:category` — one control picks both, so changing either
      // resets the row's ability (the key may not exist in the new catalog).
      const [kind, category] = String(target.value).split(':');
      abilities[idx] = { kind, category, key: '', params: {} };
      await setAbilities(abilities);
    } else if (action === 'ability-key') {
      const row = abilities[idx];
      const val = String(target.value ?? '').trim().toLowerCase();
      const match = abilitiesInCategory(row.category ?? 'all', row.kind ?? kinds[0])
        .find((a) => a.name.toLowerCase() === val);
      row.key = match?.key ?? '';
      row.params = {};
      await setAbilities(abilities);
    } else if (action === 'ability-param') {
      const pkey = target.dataset.param;
      const params = { ...(abilities[idx].params ?? {}) };
      if (target.value) params[pkey] = target.value; else delete params[pkey];
      abilities[idx].params = params;
      await setAbilities(abilities);
    }
  });
}
