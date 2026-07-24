// Entry point: register the item-sheet injection and expose a small API.

import { MODULE_ID } from './config.mjs';
import { injectSection } from './sheet.mjs';
import { getConfig, setConfig, setBaseItem, clearBaseItem, resolveBase, applyToItem } from './item-config.mjs';
import { onPreDamageRoll, onPreAttackRoll, onCreateActionUse, patchActionUse, patchDamageDisplay, clearGrants } from './engine.mjs';
import { registerHandler, getHandler, hasHandler } from './ability-handlers.mjs';
import { listAbilities, getAbility } from './data.mjs';
import { registerSettings } from './settings.mjs';
// registers the ckl-roll-bonuses.ready hook (no-op if absent); also exports the
// script-facing roll-bonus helpers used by the API below.
import { getRollBonusAbilities, setRollBonusAbilities } from './roll-bonuses-bridge.mjs';

// Settings (GM-editable match lists)
Hooks.once('init', registerSettings);

// UI
Hooks.on('renderItemSheet', injectSection);

// Use-time injection engine
Hooks.on('pf1PreDamageRoll', onPreDamageRoll);
Hooks.on('pf1PreAttackRoll', onPreAttackRoll);
Hooks.on('pf1CreateActionUse', onCreateActionUse);
// Release transient roll-bonuses grants once a use finishes.
Hooks.on('pf1PostActionUse', (actionUse) => clearGrants(actionUse?.action));
// Wrap PF1 methods once its namespace exists: placeholder footnotes on the attack
// card, and injected damage in the combat-tab damage column.
Hooks.once('setup', () => {
  patchActionUse();
  patchDamageDisplay();
});

Hooks.once('ready', () => {
  const mod = globalThis.game?.modules?.get(MODULE_ID);
  if (mod) {
    mod.api = {
      getConfig, setConfig, setBaseItem, clearBaseItem, resolveBase, applyToItem,
      // catalog access for scripts/macros building a selection UI
      listAbilities, getAbility,
      // configure the roll-bonuses "Magic Equipment Abilities" bonus from a script:
      //   const api = game.modules.get('pf1-magic-equipment').api;
      //   await api.rollBonus.setAbilities(buff, ['Flaming']);            // by key
      //   await api.rollBonus.setAbilities(buff, [{ key: 'Bane', params: { creatureType: 'undead' } }]);
      rollBonus: { getAbilities: getRollBonusAbilities, setAbilities: setRollBonusAbilities },
      // let other mods implement/override ability effects
      abilities: { registerHandler, getHandler, hasHandler },
    };
  }
});
