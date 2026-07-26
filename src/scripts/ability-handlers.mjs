// Ability implementation registry. Each handler implements one ability's *effects*
// via an abstract contribution interface, so the engine (engine.mjs) owns the seam
// of how contributions reach the roll/card. Abilities without a handler fall back
// to a placeholder footnote.
//
// A handler is:
//   { key, conditional?, damage?(ctx) => DamageContribution[], footnote?(ctx) => string|null }
//   ctx = { item, action, actor, rollData, isCrit, target }  (target = single-target actor or null)
//   DamageContribution = { formula, types?, inheritType?, nonCrit?, onCrit? }
//     inheritType = true → use the weapon's own base damage type(s) instead of a
//       fixed type (for effects that add "untyped" damage, e.g. Holy, Merciful).
//     nonCrit (default) = energy-style damage NOT multiplied on a crit (rolled once,
//       on the non-critical damage roll).
//     onCrit = burst-style extra added on each crit-bonus firing; a flat "1d10"
//       totals (critMult - 1)d10 across a ×2/×3/×4 critical.
//   conditional = true marks damage that depends on the target (alignment, type…);
//     such damage is excluded from the static combat-tab column.
//   footnote(ctx) = a note to show on the card (e.g. a conditional ability that did
//     NOT apply this use). Returning null adds nothing.
//   bypass(ctx) = damage-reduction properties the attack counts as having, as
//     { materials?: string[], magic?: bool, ignoreAll?: bool, ignoreGeneric?: bool }
//     (see bypass.mjs). Only consulted for abilities GRANTED for a single use;
//     abilities applied to the weapon get this natively from Apply.
//
// This is intentionally small for now (damage-on-hit only). Attack mods,
// effective-enh, crit effects, and actor-facing bonuses plug in as additional
// contribution kinds on the same interface later.

import { alignmentOf, isRaging, creatureTypesOf, creatureSubtypesOf } from './conditions.mjs';
import { getBaneTypes, getBaneSubtypes } from './settings.mjs';
import { MERCIFUL_CONDITIONAL } from './config.mjs';

const HANDLERS = new Map();

/** Register (or override) a handler for its ability key. */
export function registerHandler(handler) {
  if (handler?.key) HANDLERS.set(handler.key, handler);
}

export function getHandler(key) {
  return HANDLERS.get(key) ?? null;
}

export function hasHandler(key) {
  return HANDLERS.has(key);
}

/* --------------------------------------------------------------------------
 * Built-in handlers — Phase 1: basic energy weapons (+1d6 of a type on hit).
 * ------------------------------------------------------------------------ */

/** Factory: a "+1dN <type> on hit, not multiplied on crit" ability. */
function energyOnHit(key, typeId, formula = '1d6') {
  return {
    key,
    damage: () => [{ formula, types: [typeId], nonCrit: true }],
  };
}

/**
 * Factory: a burst energy weapon. +1d6 of the type on every hit (not multiplied),
 * plus +1d10 on each crit-bonus firing (→ (critMult-1)d10 on a crit).
 */
function energyBurst(key, typeId) {
  return {
    key,
    damage: (ctx) => {
      const parts = [{ formula: '1d6', types: [typeId], nonCrit: true }];
      if (ctx.isCrit) parts.push({ formula: '1d10', types: [typeId], onCrit: true });
      return parts;
    },
  };
}

/** Factory: "+1d8 <type> on a confirmed crit" (no base damage). */
function critRider(key, typeId, formula = '1d8') {
  return {
    key,
    damage: (ctx) => (ctx.isCrit ? [{ formula, types: [typeId], onCrit: true }] : []),
  };
}

/**
 * Factory: an alignment weapon (+2d6 vs a target of the given axis). Auto-applies
 * only against a single verified target of the qualifying alignment; otherwise adds
 * nothing and surfaces a footnote so the GM knows the ability is present. The 2d6 is
 * treated as not multiplied on a crit (consistent with bane).
 * @param {string} key
 * @param {(a: object) => boolean} qualifies  predicate over parsed alignment
 * @param {string} vs  label fragment, e.g. "vs evil creatures"
 */
function alignmentWeapon(key, qualifies, vs, axis) {
  const applies = (ctx) => {
    const a = ctx.target ? alignmentOf(ctx.target) : null;
    return !!(a && qualifies(a));
  };
  return {
    key,
    conditional: true,
    damage: (ctx) => (applies(ctx) ? [{ formula: '2d6', inheritType: true, nonCrit: true }] : []),
    footnote: (ctx) => (applies(ctx) ? null : `${key} — +2d6 ${vs} (no verified target)`),
    // The weapon *is* aligned regardless of what it swings at, so the DR bypass is
    // unconditional (unlike the 2d6). Only consulted for granted abilities — Apply
    // writes `action.alignments` for abilities on the weapon itself.
    bypass: () => ({ materials: [axis] }),
  };
}

/** +2 effective enhancement (attack + damage), gated on the wielder raging. */
const Furious = {
  key: 'Furious',
  conditional: true,
  attack: (ctx) => (isRaging(ctx.actor) ? [{ value: 2, flavor: 'Furious' }] : []),
  damage: (ctx) => (isRaging(ctx.actor) ? [{ formula: '2', inheritType: true, multiplied: true }] : []),
  footnote: (ctx) => (isRaging(ctx.actor) ? null : 'Furious — +2 enhancement while raging'),
};

/** Bane: vs a designated creature type (+ subtype for humanoid/outsider). */
const BANE_SUBTYPED = new Set(['humanoid', 'outsider']);

function baneApplies(ctx) {
  const typeKey = ctx.params?.creatureType;
  const subtype = ctx.params?.subtype;
  if (!typeKey || !ctx.target) return false;
  if (!creatureTypesOf(ctx.target).has(typeKey)) return false;
  if (BANE_SUBTYPED.has(typeKey) && subtype) {
    if (!creatureSubtypesOf(ctx.target).has(String(subtype).toLowerCase())) return false;
  }
  return true;
}

function baneLabel(ctx) {
  const typeKey = ctx.params?.creatureType;
  const typeLabel = getBaneTypes().find((t) => t.key === typeKey)?.label ?? typeKey ?? '(unset)';
  const subtype = ctx.params?.subtype;
  return BANE_SUBTYPED.has(typeKey) && subtype ? `${typeLabel} (${subtype})` : typeLabel;
}

const Bane = {
  key: 'Bane',
  conditional: true,
  // Params depend on the current selection: humanoid/outsider add a subtype control.
  params: (rowParams) => {
    const specs = [{ key: 'creatureType', label: 'Designated foe', options: () => getBaneTypes() }];
    const ct = rowParams?.creatureType;
    if (BANE_SUBTYPED.has(ct)) {
      specs.push({ key: 'subtype', label: 'Subtype', options: () => getBaneSubtypes(ct) });
    }
    return specs;
  },
  attack: (ctx) => (baneApplies(ctx) ? [{ value: 2, flavor: 'Bane' }] : []),
  damage: (ctx) => (baneApplies(ctx)
    ? [{ formula: '2', inheritType: true, multiplied: true }, { formula: '2d6', inheritType: true, nonCrit: true }]
    : []),
  footnote: (ctx) => (baneApplies(ctx) ? null
    : `Bane — +2 & +2d6 vs ${baneLabel(ctx)}${ctx.target ? '' : ' (no verified target)'}`),
};

/**
 * Keen: double the weapon's threat range. `current` is the low bound (e.g. 19 for
 * 19–20); doubling the range width gives 2·current − 21. Note: does not attempt to
 * detect Improved Critical / keen edge (which don't stack) — applying both would
 * over-widen the range.
 */
const Keen = {
  key: 'Keen',
  critRange: (current) => 2 * current - 21,
};

/**
 * Merciful: all of the weapon's damage becomes nonlethal and it deals +1d6, unless
 * the wielder toggles the "deal lethal" conditional in the attack dialog (which
 * suppresses both). The nonlethal type is added to every damage part via
 * augmentTypes; the +1d6 is nonlethal too.
 */
const Merciful = {
  key: 'Merciful',
  conditional: true,
  // When granted (not applied), the engine injects this dialog toggle onto the action
  // for the use so the "deal lethal" opt-out is available like it is on an applied item.
  dialogConditional: MERCIFUL_CONDITIONAL,
  augmentTypes: (ctx) => (ctx.isConditionalEnabled?.(MERCIFUL_CONDITIONAL) ? null : ['nonlethal']),
  // +1d6 inherits the weapon's damage type; augmentTypes then adds 'nonlethal' to it
  // (and to the weapon's own damage) so it reads e.g. "1d6 slashing, nonlethal".
  damage: (ctx) => (ctx.isConditionalEnabled?.(MERCIFUL_CONDITIONAL)
    ? []
    : [{ formula: '1d6', inheritType: true, nonCrit: true }]),
  footnote: (ctx) => (ctx.isConditionalEnabled?.(MERCIFUL_CONDITIONAL)
    ? 'Merciful suppressed — dealing lethal damage (no bonus).'
    : null),
};

/* --------------------------------------------------------------------------
 * Note/flag/option handlers — abilities whose effect is a clickable condition
 * enricher on the attack's effect notes (written to the action on Apply), a boolean
 * item flag, or a use-time system option, rather than injected damage.
 * ------------------------------------------------------------------------ */

// Condition-on-hit abilities: a clickable @Condition[...] enricher on the effect notes.
const Ominous = {
  key: 'Ominous',
  effectNote: 'Ominous — on a confirmed critical hit the target is @Condition[shaken] for 1 minute (DC 13 Will negates; +1 min per crit multiplier over ×2).',
};
const Cruel = {
  key: 'Cruel',
  effectNote: 'Cruel — a struck creature that is already frightened, shaken, or panicked becomes @Condition[sickened] for 1 round.',
};
const Bewildering = {
  key: 'Bewildering',
  effectNote: 'Bewildering — 3/day, a struck enemy can be made @Condition[confused] for 1d6 rounds (DC 17 Will each round to end).',
};
// Wounding: uses pf1-bleed-effects' @Bleed enricher when present, else @Condition[bleed].
const Wounding = {
  key: 'Wounding',
  effectNote: () => (globalThis.game?.modules?.get('pf1-bleed-effects')?.active
    ? 'Wounding — a hit inflicts @Bleed[1]{bleed 1}.'
    : 'Wounding — a hit inflicts @Condition[bleed] (bleed 1).'),
};

// Fortuitous: no vanilla mechanic; exposes a boolean item flag for personal use
// (e.g. counting the extra attack of opportunity).
const Fortuitous = { key: 'Fortuitous', booleanFlag: 'fortuitous' };

// Speed: grants an extra attack — auto-enable the system's haste attack option.
const Speed = { key: 'Speed', useOption: 'haste' };

/* --------------------------------------------------------------------------
 * Actor-facing abilities (bonuses on the wielder while the weapon is equipped).
 * Implemented as item-level changes (flat, unconditional bonuses to a whole target)
 * and context notes (conditional/situational bonuses — descriptive reminders on the
 * relevant roll). Both are written to the weapon on Apply and gathered natively.
 *   itemChanges(cfg) → [{ formula, target, type, flavor }]
 *   itemContextNotes(cfg) → [{ target, text }]      cfg = { enh, config }
 * ------------------------------------------------------------------------ */

// Flat, unconditional bonus → a real change.
const Brawling = {
  key: 'Brawling',
  itemChanges: (cfg) => [{ formula: String(cfg.enh || 0), target: 'cmb', type: 'enh', flavor: 'Brawling' }],
};

// Conditional/situational bonuses → descriptive context notes on the relevant roll.
const note = (key, target, text) => ({ key, itemContextNotes: (cfg) => [{ target, text: text(cfg) }] });

const Courageous = note('Courageous', 'will',
  (c) => `Courageous — +${c.enh} morale on saves vs fear (other fear-morale bonuses increased by half, min 1).`);
const Countering = note('Countering', 'cmd',
  () => `Countering — +2 CMD vs disarm/sunder against this weapon; on a failed attempt, riposte the same maneuver.`);
const Dueling = note('Dueling', 'init',
  () => `Dueling — +4 enhancement on initiative if drawn and in hand; +2 disarm/feint and to CMD vs disarm.`);
const Repositioning = note('Repositioning', 'cmb',
  () => `Repositioning — +2 enhancement on reposition combat maneuvers.`);
const Leveraging = note('Leveraging', 'cmb',
  (c) => `Leveraging — enhancement (${c.enh}) doubled on bull rush/drag/reposition/trip; +${c.enh} CMD vs those.`);
const Jurist = note('Jurist', 'cmd',
  () => `Jurist — while your judgment is active: +1 Perception & CMD (rising to +3 over 3 rounds).`);
const Menacing = note('Menacing', 'attack',
  () => `Menacing — allies flanking a foe you're adjacent to gain +2 flanking (even if you aren't flanking).`);
const Benevolent = note('Benevolent', 'attack',
  (c) => `Benevolent — increase your Aid Another attack bonus by +${c.enh}.`);
const Valiant = note('Valiant', 'attack',
  () => `Valiant — bonuses when used against the target of your cavalier challenge.`);
const NimbleShot = note('NimbleShot', 'attack',
  () => `Nimble Shot — this ranged weapon doesn't provoke attacks of opportunity.`);
const Deceptive = note('Deceptive', 'skill.blf',
  (c) => `Deceptive — +${c.enh} on Bluff checks to feint; feint as an immediate action on a confirmed crit.`);
const Huntsman = note('Huntsman', 'skill.sur',
  (c) => `Huntsman — +${c.enh} Survival to track creatures this weapon damaged in the past day (+1d6 vs them).`);

/* --------------------------------------------------------------------------
 * Condition-on-hit sweep: a clickable @Condition[...] enricher (for base system
 * conditions) or a descriptive reminder on the attack's effect notes. Text is a
 * concise summary, not full rules.
 * ------------------------------------------------------------------------ */
const effnote = (key, text) => ({ key, effectNote: text });

const ConditionOnHit = [
  effnote('DazzlingRadiance', 'Dazzling Radiance — on a Dazzling Display, creatures within 15 ft: DC 17 Fort or @Condition[blinded] 2 rd then @Condition[dazzled] 1d4 rd (success = @Condition[dazzled] only).'),
  effnote('Exhausting', 'Exhausting — a hit can leave the target @Condition[fatigued] (or @Condition[exhausted] if already fatigued).'),
  effnote('Fervent', 'Fervent — on a hit vs a flat-footed target of a different religion: DC 13 Will or @Condition[shaken] for 1 minute.'),
  effnote('Heretical', 'Heretical — a struck member of the opposed religion must save or be @Condition[shaken].'),
  effnote('Patriotic', 'Patriotic — on a hit vs a flat-footed target of a different nationality: DC 13 Will or @Condition[shaken] for 1 minute.'),
  effnote('Treasonous', 'Treasonous — a struck member of the opposed nationality must save or be @Condition[shaken].'),
  effnote('Peaceful', 'Peaceful — a creature taking nonlethal damage from this weapon is @Condition[shaken] for 1 round.'),
  effnote('Glitterwake', 'Glitterwake — 3/day, the struck area glitters; creatures are outlined and may be @Condition[blinded] (save negates).'),
  effnote('Pitfall', 'Pitfall — on a hit you may attempt to knock the target @Condition[prone].'),
  effnote('Anchoring', 'Anchoring — on a hit the target cannot move from its space or teleport for 1 round (Will negates).'),
  effnote('Debilitating', 'Debilitating — a hit vs a foe denied its Dex to AC imposes −1 to attack or AC (your choice) for 1 round.'),
  effnote('Distracting', 'Distracting — struck creatures take +5 DC on concentration checks for 1 minute.'),
  effnote('GreaterDistracting', 'Greater Distracting — as Distracting (+5 concentration DC), and can affect creatures already under a Distracting effect.'),
  effnote('Legbreaker', "Legbreaker — a hit reduces the target's base land speed by 10 ft for 1d4 rounds (stacks)."),
  effnote('Limning', 'Limning — a hit on a magically concealed creature outlines it in faerie fire for 1 round.'),
  effnote('PhaseLocking', 'Phase Locking — a creature damaged is affected as by dimensional anchor for 1 round.'),
  effnote('Skewering', 'Skewering — on a hit you may skewer and pin the target in place (see ability).'),
  effnote('Plummeting', 'Plummeting — a flying creature hit must save or fall.'),
  effnote('Silencing', 'Silencing — after a hit, the target may be affected as by silence (see ability).'),
];

const BUILTINS = [
  Furious,
  Bane,
  Keen,
  Merciful,
  Ominous,
  Cruel,
  Bewildering,
  Wounding,
  Fortuitous,
  Speed,
  Brawling,
  Courageous,
  Countering,
  Dueling,
  Repositioning,
  Leveraging,
  Jurist,
  Menacing,
  Benevolent,
  Valiant,
  NimbleShot,
  Deceptive,
  Huntsman,
  energyOnHit('Flaming', 'fire'),
  energyOnHit('Frost', 'cold'),
  energyOnHit('Shock', 'electric'),
  energyOnHit('Corrosive', 'acid'),
  energyBurst('FlamingBurst', 'fire'),
  energyBurst('IcyBurst', 'cold'),
  energyBurst('ShockingBurst', 'electric'),
  energyBurst('CorrosiveBurst', 'acid'),
  critRider('Thundering', 'sonic'),
  alignmentWeapon('Holy', (a) => a.evil, 'vs evil creatures', 'good'),
  alignmentWeapon('Unholy', (a) => a.good, 'vs good creatures', 'evil'),
  alignmentWeapon('Anarchic', (a) => a.lawful, 'vs lawful creatures', 'chaotic'),
  alignmentWeapon('Axiomatic', (a) => a.chaotic, 'vs chaotic creatures', 'lawful'),
  ...ConditionOnHit,
];

for (const h of BUILTINS) registerHandler(h);
