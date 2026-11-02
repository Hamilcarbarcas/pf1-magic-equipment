// Animated shields: the Animate action Apply adds, the buff using it puts on the wielder, and the
// cooldown after the animation ends. DESIGN.md §12.9.
//
// RAW: "As a move action, an animated shield can be loosed to defend its wielder on its own. For
// the following 4 rounds, the shield grants its bonus to the one who loosed it and then drops. …
// Once a shield has been retrieved, it cannot be animated again for at least 4 rounds."
//
// The buff carries PF1's boolean flag `animatedShield`. pf1-equipment-profiles reads that flag to
// count the shield as using no hand, and prompts re-grab / drop when it ends. Without that module
// the buff is a reminder with a timer.

import { MODULE_ID } from './config.mjs';

export const ANIMATED_FLAG = 'animatedShield';
/** Action flag value Apply marks the Animate action with (see item-config `itemActions`). */
export const ANIMATE_ABILITY = 'shield:Animated';
/** World time (seconds) before which the shield can't be animated again. */
const COOLDOWN_FLAG = 'animateCooldown';
const ROUNDS = 4;

const roundTime = () => CONFIG.time?.roundTime || 6;

/** The Animate action, as Apply adds it to a shield with the Animated ability. */
export function animateAction() {
  return {
    name: 'Animate',
    actionType: 'other',
    activation: { cost: 1, type: 'move', unchained: { cost: 1, type: 'action' } },
    duration: { units: 'round', value: String(ROUNDS) },
  };
}

const isAnimateUse = (actionUse) => actionUse?.action?.flags?.[MODULE_ID]?.ability === ANIMATE_ABILITY;
const animationsOf = (actor) => actor.items.filter((i) => i.type === 'buff' && i.flags?.[MODULE_ID]?.animatedBy);
const isAnimation = (item) => item?.type === 'buff' && !!item.flags?.[MODULE_ID]?.animatedBy;

/** Rounds left before `shield` can be animated again; 0 when it can. */
export function cooldownRounds(shield) {
  const until = Number(shield?.flags?.[MODULE_ID]?.[COOLDOWN_FLAG]) || 0;
  const left = until - game.time.worldTime;
  return left > 0 ? Math.ceil(left / roundTime()) : 0;
}

function buffData(shield) {
  return {
    type: 'buff',
    name: `Animated: ${shield.name}`,
    img: shield.img,
    system: {
      subType: 'item',
      active: true,
      duration: { value: String(ROUNDS), units: 'round', end: 'turnStart' },
      flags: { boolean: { [ANIMATED_FLAG]: true }, dictionary: {} },
      description: {
        value: `<p>${shield.name} defends on its own for 4 rounds, leaving its hand free. Its armor check penalty, arcane spell failure, and nonproficiency still apply. Grasping it with a free hand ends the animation. Once it ends, the shield can't be animated again for 4 rounds.</p>`,
      },
    },
    flags: { [MODULE_ID]: { animatedBy: shield.uuid } },
  };
}

/**
 * pf1PreActionUse: refuse Animate on an unequipped shield, one already animated, or one still
 * cooling down. Runs before PF1 spends charges or posts the card.
 */
export function onPreAnimateUse(actionUse) {
  if (!isAnimateUse(actionUse)) return;
  const shield = actionUse.item;
  const actor = actionUse.actor;
  if (!actor) return;
  let reason = null;
  if (shield.system?.equipped !== true) reason = `${shield.name} isn't equipped, so it can't be animated.`;
  else if (animationsOf(actor).some((b) => b.system.active)) reason = `${actor.name} already has an animated shield.`;
  else {
    const rounds = cooldownRounds(shield);
    if (rounds) reason = `${shield.name} can't be animated again for ${rounds} more round${rounds === 1 ? '' : 's'}.`;
  }
  if (!reason) return;
  ui.notifications.warn(reason);
  return false;
}

/** pf1PostActionUse: put the animation buff on the wielder. */
export async function onAnimateUse(actionUse) {
  if (!isAnimateUse(actionUse) || !actionUse.actor) return;
  const shield = actionUse.item;
  try {
    await actionUse.actor.createEmbeddedDocuments('Item', [buffData(shield)]);
  } catch (err) {
    console.error(`${MODULE_ID} | animating ${shield.name} failed`, err);
    ui.notifications.error(`Couldn't animate ${shield.name}. See the console.`);
  }
}

/** The animation ended (expired, or grasped by switching it off): start the shield's cooldown. */
async function startCooldown(buff) {
  const shield = fromUuidSync(buff.flags[MODULE_ID].animatedBy);
  if (!shield) return;
  await shield.setFlag(MODULE_ID, COOLDOWN_FLAG, game.time.worldTime + ROUNDS * roundTime());
}

/** updateItem: an animation switched off or expired starts the cooldown and is deleted. */
export async function onAnimationEnded(item, changes, _options, userId) {
  if (userId !== game.user.id || !isAnimation(item)) return;
  if (foundry.utils.getProperty(changes, 'system.active') !== false) return;
  try {
    await startCooldown(item);
    await item.delete();
  } catch (err) {
    console.error(`${MODULE_ID} | ending ${item.name} failed`, err);
  }
}

/** deleteItem: an animation deleted while still active ends there too. */
export async function onAnimationDeleted(item, _options, userId) {
  if (userId !== game.user.id || !isAnimation(item) || !item.system?.active) return;
  try {
    await startCooldown(item);
  } catch (err) {
    console.error(`${MODULE_ID} | ending ${item.name} failed`, err);
  }
}
