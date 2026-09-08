// Armor and shield ability implementations.
//
// The mechanism inverts relative to weapons (DESIGN.md §12.4): almost nothing here
// injects into a roll, because armour isn't used — it's worn. The two bulk seams
// are the ones the weapon side already has:
//
//   itemChanges(cfg) → [{ formula, target, type, flavor }]   a real PF1 Change
//   itemContextNotes(cfg) → [{ target, text }]               a situational reminder
//
// Both are written to the item on Apply and gathered natively by PF1 while the item
// is equipped, so no hook or wrapper is involved.
//
// Only abilities that map cleanly onto one of those two are implemented. The long
// tail — per-day activated powers, miss chances, DR, energy absorption, effects that
// fire when the wearer is *hit* — has no additive seam in PF1 and is deliberately
// left unimplemented: those abilities still price, name and catalogue correctly, and
// pick up handlers individually later. See DESIGN.md §12.4 buckets 2 and 3.

import { registerHandler } from './ability-handlers.mjs';

/* --------------------------------------------------------------------------
 * Declarative helpers
 * ------------------------------------------------------------------------ */

/** A flat, unconditional Change while the item is worn. */
const chg = (kind, key, target, formula, type, flavor) => ({
  kind,
  key,
  itemChanges: () => [{ formula: String(formula), target, type, flavor }],
});

/** A situational reminder on a specific roll. */
const anote = (kind, key, target, text) => ({
  kind,
  key,
  itemContextNotes: () => [{ target, text }],
});

/** The same handler registered against both the armor and the shield catalog. */
const both = (make) => [make('armor'), make('shield')];

/* --------------------------------------------------------------------------
 * Flat competence bonuses to a single skill — the cleanest bulk case.
 * ------------------------------------------------------------------------ */

const SKILL_BONUSES = [
  // [key, skill, bonus, label]
  ['Slick', 'esc', 5, 'Slick'],
  ['ImprovedSlick', 'esc', 10, 'Improved Slick'],
  ['GreaterSlick', 'esc', 15, 'Greater Slick'],
  ['Shadow', 'ste', 5, 'Shadow'],
  ['ImprovedShadow', 'ste', 10, 'Improved Shadow'],
  ['GreaterShadow', 'ste', 15, 'Greater Shadow'],
  ['Aquadynamic', 'swm', 5, 'Aquadynamic'],
  ['ImprovedAquadynamic', 'swm', 10, 'Improved Aquadynamic'],
  ['GreaterAquadynamic', 'swm', 15, 'Greater Aquadynamic'],
  ['Corsair', 'acr', 5, 'Corsair'],
  ['Jousting', 'rid', 5, 'Jousting'],
  ['Amorphous', 'esc', 5, 'Amorphous'],
].map(([key, skill, bonus, label]) => chg('armor', key, `skill.${skill}`, bonus, 'competence', label));

/* --------------------------------------------------------------------------
 * Other flat Changes.
 * ------------------------------------------------------------------------ */

const FLAT_CHANGES = [
  // Mind buttressing: +2 resistance on Will saves (the possession immunity is a note).
  chg('armor', 'MindButtressing', 'will', 2, 'resistance', 'Mind Buttressing'),
  // Arrow catching: a flat +1 deflection to AC against ranged attacks. PF1 has no
  // "vs ranged" AC target, so it lands on AC with the restriction as a note below.
  chg('shield', 'ArrowCatching', 'ac', 1, 'deflection', 'Arrow Catching'),
  // Rebounding: +2 enhancement to AC against thrown weapons — same caveat.
  chg('shield', 'Rebounding', 'ac', 2, 'enhancement', 'Rebounding'),
];

/* --------------------------------------------------------------------------
 * Armour check penalty waivers. PF1 applies one ACP per skill, so "this armour's
 * ACP doesn't apply to X" is modelled as a note rather than a Change — cancelling
 * it numerically would need the item's own ACP at Change-evaluation time, which
 * isn't available to a static formula.
 * ------------------------------------------------------------------------ */

const ACP_WAIVERS = [
  anote('armor', 'Creeping', 'skill', "Creeping — this armour's check penalty does not apply to Stealth checks."),
  anote('armor', 'Locksmith', 'skill', "Locksmith — this armour's check penalty does not apply to Disable Device checks."),
  anote('armor', 'Buoyantlight', 'skill', "Buoyant — this armour imposes no check penalty on Swim checks."),
  anote('armor', 'Buoyantmediumheavy', 'skill', "Buoyant — this armour imposes no check penalty on Swim checks."),
  anote('shield', 'Buoyantshield', 'skill', 'Buoyant — this shield imposes no check penalty on Swim checks.'),
];

/* --------------------------------------------------------------------------
 * Situational bonuses and defences that have a natural roll to hang off.
 * ------------------------------------------------------------------------ */

const NOTES = [
  ...both((k) => anote(k, 'PoisonResistant', 'allSavingThrows', 'Poison Resistant — +3 resistance on saves against poison.')),
  ...both((k) => anote(k, 'SpellResistance13', 'sr', 'Spell Resistance 13 while worn.')),
  ...both((k) => anote(k, 'SpellResistance15', 'sr', 'Spell Resistance 15 while worn.')),
  ...both((k) => anote(k, 'SpellResistance17', 'sr', 'Spell Resistance 17 while worn.')),
  ...both((k) => anote(k, 'SpellResistance19', 'sr', 'Spell Resistance 19 while worn.')),
  ...both((k) => anote(k, 'EnergyResistance', 'defense', 'Energy Resistance — absorbs the first 10 points of damage per attack from the chosen energy type.')),
  ...both((k) => anote(k, 'ImprovedEnergyResistance', 'defense', 'Improved Energy Resistance — absorbs the first 20 points of damage per attack from the chosen energy type.')),
  ...both((k) => anote(k, 'GreaterEnergyResistance', 'defense', 'Greater Energy Resistance — absorbs the first 30 points of damage per attack from the chosen energy type.')),
  ...both((k) => anote(k, 'Fortificationlight', 'defense', 'Light Fortification — 25% chance to negate a critical hit or sneak attack.')),
  ...both((k) => anote(k, 'Fortificationmoderate', 'defense', 'Moderate Fortification — 50% chance to negate a critical hit or sneak attack.')),
  ...both((k) => anote(k, 'Fortificationheavy', 'defense', 'Heavy Fortification — 75% chance to negate a critical hit or sneak attack.')),
  ...both((k) => anote(k, 'GhostTouch', 'ac', 'Ghost Touch — the armour and enhancement bonus apply against incorporeal touch attacks.')),
  ...both((k) => anote(k, 'Impervious', 'misc', 'Impervious — double the enhancement bonus to hardness and hit points.')),
  ...both((k) => anote(k, 'Mirrored', 'ac', 'Mirrored — can be used as a mirror; aids against gaze attacks and creatures that rely on sight.')),
  ...both((k) => anote(k, 'Wild', 'ac', 'Wild — the armour bonus continues to apply while the wearer is in a wild-shape form.')),
  ...both((k) => anote(k, 'Defiant', 'ac', 'Defiant — +2 (rising with the enhancement bonus) against the designated creature type.')),
  anote('armor', 'Amorphous', 'cmd', 'Amorphous — +5 competence to CMD against grapple.'),
  anote('armor', 'MentalFocus', 'concentration', 'Mental Focus — +2 enhancement on concentration checks.'),
  anote('armor', 'MindButtressing', 'will', 'Mind Buttressing — immune to possession and mental control.'),
  anote('armor', 'Brawling', 'attack', 'Brawling — +2 on unarmed attack and damage rolls, including grapple checks.'),
  anote('armor', 'Spiritbonded', 'allSavingThrows', 'Spirit Bonded — +1 on saves against psychic spells and effects from incorporeal creatures.'),
  anote('armor', 'Bolstering', 'allSavingThrows', 'Bolstering — +2 competence on saves against a creature you have damaged this round.'),
  anote('armor', 'Trapwarding', 'ref', 'Trapwarding — luck bonus on saves and AC against traps.'),
  anote('armor', 'Cushioned', 'misc', 'Cushioned — falling damage is reduced as if the distance were 20 ft less.'),
  anote('armor', 'Restful', 'misc', 'Restful — 2 hours of rest suffice, and sleeping in the armour causes no fatigue.'),
  anote('armor', 'Comfort', 'misc', 'Comfort — remains comfortable regardless of conditions; sheds dirt and sweat.'),
  anote('armor', 'Glamered', 'misc', 'Glamered — on command, appears as ordinary clothing while retaining its properties.'),
  anote('armor', 'Burdenless', 'misc', "Burdenless — the wearer's load is treated as lighter for encumbrance."),
  anote('armor', 'Trackless', 'skill', 'Trackless — Survival checks to track the wearer take a −5 penalty.'),
  anote('shield', 'ArrowCatching', 'ac', 'Arrow Catching — ranged attacks aimed at nearby allies are redirected to the wielder.'),
  anote('shield', 'ArrowDeflection', 'ac', 'Arrow Deflection — once per round, deflect a ranged attack as though by Deflect Arrows.'),
  anote('shield', 'Rebounding', 'ac', 'Rebounding — the +2 applies against thrown weapons; the shield can be thrown and returns.'),
  anote('shield', 'Guarding', 'ac', "Guarding — transfer some or all of the shield's enhancement bonus to an adjacent ally's AC."),
  anote('shield', 'GreaterGuarding', 'ac', "Greater Guarding — as Guarding, but any number of adjacent allies gain the shield's bonus."),
  anote('shield', 'Assiduous', 'ac', 'Assiduous — extra AC while fighting defensively or taking total defence.'),
  anote('shield', 'Animated', 'ac', 'Animated — as a move action, the shield defends on its own for 4 rounds, leaving the hand free.'),
  anote('shield', 'Bashing', 'attack', 'Bashing — a shield bash deals damage as a weapon two size categories larger.'),
  anote('shield', 'Ramming', 'attack', 'Ramming — bonuses on shield bashes and bull rush attempts made with the shield.'),
  anote('shield', 'Mastering', 'attack', 'Mastering — apply your highest weapon-training bonus to attacks with this shield.'),
  anote('shield', 'Heraldric', 'misc', "Heraldic — counts as a banner for a cavalier's banner ability."),
  ...both((k) => anote(k, 'Fitting', 'misc', 'Fitting — resizes itself to any creature that picks it up.')),
];

const BUILTINS = [...SKILL_BONUSES, ...FLAT_CHANGES, ...ACP_WAIVERS, ...NOTES];

for (const h of BUILTINS) registerHandler(h);
