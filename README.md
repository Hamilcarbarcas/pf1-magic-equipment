# PF1 Magic Equipment

A backbone for turning a plain Pathfinder 1e weapon into a magic one — and later,
armor — from directly inside the item sheet.

> **Status:** early development. Weapons only for now; armor is a planned phase.
> See [DESIGN.md](DESIGN.md) for the full architecture.

## Requirements

- **[libWrapper](https://github.com/ruipin/fvtt-lib-wrapper)** (required) — used to
  augment PF1's attack pipeline safely alongside other modules.

## What it does

On a weapon's sheet you get an embedded **Magic Equipment** section (right where
the enhancement bonus lives) that lets you:

- **Link a base item** — drag an unmodified version of the weapon from a compendium
  onto the section. This is the pristine baseline everything is recomputed from, so
  applying repeatedly never compounds prices or weights.
- **Set the enhancement bonus** (+1 … +5).
- **Add special abilities** — a `+` button adds a row; each row narrows by category
  (+1…+5, Fixed cost, or All) and then picks the ability. Add as many as you like.
- **Choose a special material**.
- **Toggle masterwork** (force-checked when an enhancement, ability, or a
  masterwork-requiring material is present).
- See the running **cost**: the fully-inclusive total, the delta vs. what the item
  currently costs, and an itemized breakdown.

Hitting **Apply** recomputes and writes the weapon's real numbers — value,
unidentified price, weight, hit points, hardness, masterwork, material, and base
enhancement bonus. Ability *effects* are applied separately at use-time without
altering the weapon's editable fields (rolling out over time; unimplemented
abilities show a short footnote describing what they do).

## Optional: roll-bonuses integration

If [ckl-roll-bonuses](https://github.com/dmrickey/ckl-roll-bonuses) is installed,
you can also grant these abilities to a targeted weapon through its targeting
system — e.g. a buff that makes a weapon *axiomatic* while active. The mod is fully
functional without it.

Granted abilities reproduce the mod's *use-time* effects — bonus damage, attack/crit
bonuses, haste, damage-type changes, Merciful's "deal lethal" toggle, condition-on-hit
enrichers, and alignment-based **DR bypass** (a granted *holy* weapon counts as good
against DR, just like an applied one). The **actor-facing "while equipped" bonuses**
(Brawling, Courageous, …) still only exist when the ability is applied to the weapon,
because they're written to the item.

### DR Bypass bonus

A second bonus type, **DR Bypass**, is for effects that defeat damage reduction
*without* being a weapon property — Smite Evil, Align Weapon, Ki Strike, a bard's
*bane of the fey*, and so on. Tick the properties the attack should count as
(magic, epic, cold iron, silver, adamantine, or an alignment), or tick **Bypass ALL
damage reduction** for Smite Evil. There's also a **Bypass DR/—** option for the rare
effect that defeats untyped DR only.

It is not weapon-specific: because it's a roll-bonus, it works on unarmed strikes and
natural attacks too, and roll-bonuses' own targeting decides which attacks it applies
to (use a *conditional* target — e.g. the target's alignment — to restrict Smite to
the creature you smote).

The bypass is recorded on the attack card as a footnote ("Bypasses all damage
reduction (Smite Evil)") and stamped onto the chat message, then read back when
damage is applied — so it still works if the buff has ended, or been switched off,
between the roll and the GM clicking *apply damage*.

> Damage reduction is only calculated in the **apply-damage dialog**. If damage is
> applied without it (shift-click, or an automation module that skips it), PF1
> applies no DR at all and there is nothing to bypass.

## Scripting API

The module exposes a small API at
`game.modules.get("pf1-magic-equipment").api` for macros and script calls.

Enumerate abilities (for a selection dialog):

```js
const api = game.modules.get("pf1-magic-equipment").api;
api.listAbilities();          // -> [{ key, name, category }] (category: '1'…'5' | 'fixed')
api.getAbility("Flaming");    // -> one ability descriptor
```

Configure the roll-bonuses **Magic Equipment Abilities** bonus on an item from a
script — e.g. an "on create/use" script on a buff that lets the player pick an
ability and configures the bonus to it:

```js
const api = game.modules.get("pf1-magic-equipment").api;

// by ability key(s):
await api.rollBonus.setAbilities(item, ["Flaming"]);

// with parameters (e.g. Bane's designated foe):
await api.rollBonus.setAbilities(item, [{ key: "Bane", params: { creatureType: "undead" } }]);

// read back what's configured:
api.rollBonus.getAbilities(item);   // -> [{ category, key, params }]
```

`setAbilities` also ensures the item is flagged as a bonus source, so a plain buff
can be configured entirely from script. (The bonus still needs a roll-bonuses
*target* to decide which weapon/action it applies to — configure that on the buff.)

Configure the **DR Bypass** bonus the same way:

```js
const api = game.modules.get("pf1-magic-equipment").api;

// Smite Evil — ignore damage reduction entirely:
await api.rollBonus.setBypass(item, { ignoreAll: true });

// Align Weapon / Ki Strike — count as specific properties:
await api.rollBonus.setBypass(item, { types: ["good"] });
await api.rollBonus.setBypass(item, { types: ["magic", "coldIron"] });

api.rollBonus.getBypass(item);   // -> { types, ignoreAll, ignoreGeneric }
api.bypass.choices();            // -> [{ key, label, group }] every id setBypass accepts
```

## Credits

This mod is self-contained but builds on the work of others:

- **[pf1-auto-forge](https://github.com/mkahvi/fvtt-micro-modules)** — enhancement
  pricing/masterwork logic that inspired the recompute flow.
- **[pf1-magic-item-gen](https://github.com/Krisdyer/pf1-magic-item-gen)** — the
  weapon ability, special material, and cost data.

Their data has been adapted and bundled here with thanks.
