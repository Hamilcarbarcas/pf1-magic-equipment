// The embedded "Magic Equipment" section on the weapon item sheet: build the DOM,
// inject it after the enhancement field, and wire live-persisting controls, the
// base-item drop zone, the cost readout, and the Apply button.

import { MODULE_ID, isSupported, loc, MAX_ENH_EQUIVALENT, itemKind, catalogKinds } from './config.mjs';
import { getMaterial, materialsForItem, addonMaterialsForItem } from './data.mjs';
import { getConfig, setConfig, setBaseItem, clearBaseItem, getBaseCache, applyToItem } from './item-config.mjs';
import { computeCost, computeAura } from './calc.mjs';
import { abilityPickerHtml, wireAbilityPicker } from './ability-picker.mjs';

const gp = new Intl.NumberFormat();
const gpSigned = new Intl.NumberFormat(undefined, { signDisplay: 'always' });
const gpStr = (n) => `${gp.format(Math.round(n || 0))} gp`;
const gpDelta = (n) => `${gpSigned.format(Math.round(n || 0))} gp`;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Render hook entry point. */
export function injectSection(app, html) {
  const root = html?.[0] ?? html;
  const item = app?.item ?? app?.document;
  if (!isSupported(item) || !root) return;

  // The enhancement field lives in a different place per kind; anchor to whichever
  // this sheet has so the section lands in the same relative spot on all three.
  const enhInput = root.querySelector('input[name="system.enh"], input[name="system.armor.enh"]');
  const anchor = enhInput?.closest('.form-group');
  if (!anchor) return; // enhancement field not present (unexpected) — bail quietly

  // Avoid double-injection on partial re-renders. Target our own item section
  // specifically — NOT the generic `.pf1me-section`, which the roll-bonuses bridge
  // picker also uses (removing that here would delete the RB picker each render).
  root.querySelector('.pf1me-item-section')?.remove();

  const editable = app.isEditable !== false;
  const section = buildSection(item, editable);
  anchor.after(section);
  wireEvents(section, item, app, editable);
}

/** Build the section element from the current config. */
function buildSection(item, editable) {
  const cfg = getConfig(item);
  const base = getBaseCache(item);
  const disabled = editable ? '' : 'disabled';
  const kind = itemKind(item) ?? 'weapon';

  const el = document.createElement('div');
  el.className = `pf1me-section pf1me-item-section pf1me-${kind}`;

  const materialOptions = materialOptionsHtml(item, cfg.materialKey);
  const addonOptions = addonOptionsHtml(item, cfg.materialKey, cfg.addonKey);

  const forced = isMasterworkForced(cfg);
  const mwkChecked = (forced || cfg.masterwork) ? 'checked' : '';
  const mwkDisabled = (forced || !editable) ? 'disabled' : '';

  el.innerHTML = `
    <h3 class="pf1me-header"><i class="fas fa-hammer"></i> ${esc(loc('PF1ME.Section.Title'))}</h3>

    <div class="pf1me-baseitem form-group">
      <label class="pf1me-rename" title="${esc(loc('PF1ME.Rename.Hint'))}">
        <input type="checkbox" data-action="rename" ${cfg.rename ? 'checked' : ''} ${disabled}/>
        ${esc(loc('PF1ME.Rename.Label'))}
      </label>
      <label class="pf1me-rename" title="${esc(loc('PF1ME.Aura.Hint'))}">
        <input type="checkbox" data-action="set-aura" ${cfg.setAura ? 'checked' : ''} ${disabled}/>
        ${esc(loc('PF1ME.Aura.Label'))}
      </label>
      <label class="pf1me-baselabel">${esc(loc('PF1ME.BaseItem.Label'))}</label>
      <div class="pf1me-drop ${cfg.baseUuid ? 'linked' : ''}" data-action="drop-hint">
        <span class="pf1me-basename">${cfg.baseUuid ? esc(base?.name || loc('PF1ME.BaseItem.Label')) : esc(loc('PF1ME.BaseItem.Drop'))}</span>
        ${cfg.baseUuid ? `<a class="pf1me-clear" data-action="clear-base" title="${esc(loc('PF1ME.BaseItem.Clear'))}"><i class="fas fa-times"></i></a>` : ''}
      </div>
    </div>

    <div class="pf1me-enh form-group">
      <label>${esc(loc(kind === 'weapon' ? 'PF1ME.Enh.Label' : 'PF1ME.Enh.LabelArmor'))}</label>
      <input type="number" class="pf1me-input" data-action="enh" min="0" max="10" step="1" value="${Number(cfg.enh) || 0}" ${disabled}/>
    </div>

    ${abilityPickerHtml(cfg.abilities, `item-${item.id}`, editable, catalogKinds(kind))}

    <div class="pf1me-material form-group">
      <label>${esc(loc('PF1ME.Material.Label'))}</label>
      <select class="pf1me-input" data-action="material" ${disabled}>${materialOptions}</select>
    </div>

    <div class="pf1me-addon form-group">
      <label>${esc(loc('PF1ME.Addon.Label'))}</label>
      <select class="pf1me-input" data-action="addon" ${disabled}>${addonOptions}</select>
    </div>

    <div class="pf1me-mwk form-group">
      <label>${esc(loc('PF1ME.Masterwork.Label'))}</label>
      <input type="checkbox" data-action="masterwork" ${mwkChecked} ${mwkDisabled}/>
    </div>

    ${costHtml(item, cfg, base)}
    ${kind === 'weapon' ? '' : shieldBashHintHtml(kind)}

    <div class="pf1me-actions">
      <button type="button" class="pf1me-apply" data-action="apply" ${disabled}>
        <i class="fas fa-check"></i> ${esc(loc('PF1ME.Apply'))}
      </button>
    </div>
  `;
  return el;
}


/** One-line reminder of the shield-bash rule the picker's two catalogs imply. */
function shieldBashHintHtml(kind) {
  if (kind !== 'shield') return '';
  return `<p class="notes pf1me-hint">${esc(loc('PF1ME.Shield.BashHint'))}</p>`;
}

function materialOptionsHtml(item, selected) {
  const opts = [`<option value="" ${!selected ? 'selected' : ''}>${esc(loc('PF1ME.Material.None'))}</option>`];
  for (const m of materialsForItem(item)) {
    const mark = m.homebrew ? ' ⚗' : '';
    opts.push(`<option value="${esc(m.id)}" ${m.id === selected ? 'selected' : ''}>${esc(m.name)}${mark}</option>`);
  }
  // If a previously-selected material is no longer "allowed" for this item, keep it visible.
  if (selected && !opts.some((o) => o.includes(`value="${selected}"`))) {
    const mat = getMaterial(selected);
    opts.push(`<option value="${esc(selected)}" selected>${esc(mat?.name || selected)}</option>`);
  }
  return opts.join('');
}

function addonOptionsHtml(item, normalKey, selected) {
  const opts = [`<option value="" ${!selected ? 'selected' : ''}>${esc(loc('PF1ME.Material.None'))}</option>`];
  for (const m of addonMaterialsForItem(item, normalKey)) {
    const mark = m.homebrew ? ' ⚗' : '';
    opts.push(`<option value="${esc(m.id)}" ${m.id === selected ? 'selected' : ''}>${esc(m.name)}${mark}</option>`);
  }
  if (selected && !opts.some((o) => o.includes(`value="${selected}"`))) {
    const mat = getMaterial(selected);
    opts.push(`<option value="${esc(selected)}" selected>${esc(mat?.name || selected)}</option>`);
  }
  return opts.join('');
}

function costHtml(item, cfg, base) {
  if (!base) {
    return `<div class="pf1me-cost pf1me-cost-empty"><em>${esc(loc('PF1ME.BaseItem.Drop'))}</em></div>`;
  }
  const c = computeCost({ item, base, config: cfg });
  const b = c.breakdown;
  const warn = c.warnings.includes('overEnh')
    ? `<div class="pf1me-warn"><i class="fas fa-triangle-exclamation"></i> ${esc(loc('PF1ME.Warn.OverEnh'))}</div>`
    : '';
  const deltaClass = c.delta > 0 ? 'up' : (c.delta < 0 ? 'down' : '');
  return `
    <div class="pf1me-cost">
      <div class="pf1me-cost-total">
        <span>${esc(loc('PF1ME.Cost.Total'))}</span>
        <strong>${gpStr(c.total)}</strong>
        <span class="pf1me-delta ${deltaClass}">${gpDelta(c.delta)}</span>
      </div>
      <div class="pf1me-cost-breakdown">
        <div><span>${esc(loc('PF1ME.Cost.BaseItem'))}</span><span>${gpStr(b.baseItem)}</span></div>
        ${b.material ? `<div><span>${esc(loc('PF1ME.Cost.Material'))}</span><span>${gpStr(b.material)}</span></div>` : ''}
        ${b.masterwork ? `<div><span>${esc(loc('PF1ME.Cost.Masterwork'))}</span><span>${gpStr(b.masterwork)}</span></div>` : ''}
        ${b.enhancement ? `<div><span>${esc(loc('PF1ME.Cost.Enhancement'))} (+${c.totalEquivalent})</span><span>${gpStr(b.enhancement)}</span></div>` : ''}
        ${auraRowHtml(item, cfg)}
      </div>
      ${warn}
    </div>`;
}

/** Caster level + aura school, shown alongside the cost so it's visible pre-Apply. */
function auraRowHtml(item, cfg) {
  if (!cfg.setAura) return '';
  const a = computeAura({ config: cfg, kind: itemKind(item) ?? 'weapon' });
  if (!a.cl && !a.school) return '';
  const school = a.custom ? a.school : schoolName(a.school);
  return `<div><span>${esc(loc('PF1ME.Aura.Readout'))}</span><span>${esc(
    school ? `CL ${a.cl} · ${school}` : `CL ${a.cl}`,
  )}</span></div>`;
}

/** Localized name for a `pf1.config.spellSchools` key, or '' when unset. */
function schoolName(key) {
  if (!key) return '';
  const entry = globalThis.pf1?.config?.spellSchools?.[key];
  return entry ? loc(entry) : key;
}

function isMasterworkForced(cfg) {
  return (Number(cfg.enh) || 0) > 0 || (cfg.abilities?.length > 0) || !!cfg.materialKey;
}

/** Attach event listeners to a freshly-built section. */
function wireEvents(section, item, app, editable) {
  if (!editable) return;

  const rerenderViaFlag = (partial) => setConfig(item, partial); // triggers sheet re-render

  // --- base item drop zone ---
  const drop = section.querySelector('.pf1me-drop');
  if (drop) {
    drop.addEventListener('dragover', (ev) => { ev.preventDefault(); drop.classList.add('dragover'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('dragover'));
    drop.addEventListener('drop', async (ev) => {
      ev.preventDefault();
      drop.classList.remove('dragover');
      const data = foundry.applications?.ux?.TextEditor?.implementation?.getDragEventData?.(ev)
        ?? globalThis.TextEditor?.getDragEventData?.(ev);
      if (!data || data.type !== 'Item' || !data.uuid) return;
      const name = await setBaseItem(item, data.uuid);
      if (!name) globalThis.ui?.notifications?.warn(loc('PF1ME.BaseItem.Missing'));
    });
  }

  // --- delegated click actions ---
  section.addEventListener('click', async (ev) => {
    const target = ev.target.closest('[data-action]');
    if (!target || !section.contains(target)) return;
    const action = target.dataset.action;

    if (action === 'clear-base') { ev.preventDefault(); await clearBaseItem(item); return; }

    if (action === 'apply') {
      ev.preventDefault();
      target.disabled = true;
      const ok = await applyToItem(item);
      if (ok) globalThis.ui?.notifications?.info(`${item.name}: ${loc('PF1ME.Apply')} ✓`);
      // sheet will re-render from the item update; nothing else to do
      return;
    }
  });

  // --- change actions (commit-on-change, so typing doesn't thrash re-renders) ---
  section.addEventListener('change', async (ev) => {
    const target = ev.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;

    if (action === 'enh') {
      let v = Math.max(0, Math.floor(Number(target.value) || 0));
      await rerenderViaFlag({ enh: v });
      return;
    }

    if (action === 'material') { await rerenderViaFlag({ materialKey: target.value || '' }); return; }

    if (action === 'addon') { await rerenderViaFlag({ addonKey: target.value || '' }); return; }

    if (action === 'masterwork') { await rerenderViaFlag({ masterwork: !!target.checked }); return; }

    if (action === 'rename') { await rerenderViaFlag({ rename: !!target.checked }); return; }

    if (action === 'set-aura') { await rerenderViaFlag({ setAura: !!target.checked }); return; }
  });

  // The ability list is the shared picker; it persists via setConfig (which
  // re-renders the section).
  const picker = section.querySelector('.pf1me-abilities');
  if (picker) {
    wireAbilityPicker(picker, {
      editable,
      kinds: catalogKinds(itemKind(item) ?? 'weapon'),
      getAbilities: () => getConfig(item).abilities,
      setAbilities: (abilities) => setConfig(item, { abilities }),
    });
  }
}
