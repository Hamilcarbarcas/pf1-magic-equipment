# Changelog

## Unreleased

### Added
- Initial scaffold of the Magic Equipment mod (weapons first; armor planned).
- Embedded **Magic Equipment** section on the weapon item sheet: set the base
  enhancement bonus, add special abilities (category-filtered picker), choose a
  special material, toggle masterwork, and link a base (unmodified) item.
- **Apply** recomputes the "easy" numbers from the linked base item — value,
  unidentified price, weight, hit points, hardness, masterwork, material, and base
  enhancement — and writes them to the weapon's native fields.
- **Optional renaming** (top-row checkbox, on by default): on Apply, rename the
  item to reflect its magic properties (e.g. "+2 Flaming Dagger") and set the
  unidentified name to the base item's name if it doesn't already have one.
- Live **cost readout**: fully-inclusive total, delta vs. the item's current cost,
  and an itemized breakdown.
- Self-contained catalog of weapon special abilities, special materials, and
  enhancement-value tables (see credits below).
- **Use-time effect engine (Phase 1):** applied abilities inject their effects
  when the weapon is used, without altering the action's editable fields.
  - Basic energy abilities — **Flaming, Frost, Shock, Corrosive** — add +1d6 of
    their type on a hit (rolled once, not multiplied on a critical).
  - Burst energy abilities — **Flaming Burst, Icy Burst, Shocking Burst,
    Corrosive Burst** — as above, plus extra energy on a confirmed critical scaled
    to the weapon's multiplier ((critMult − 1)d10).
  - **Thundering** — +1d8 sonic on a confirmed critical.
  - Alignment abilities — **Holy, Unholy, Anarchic, Axiomatic** — +2d6 against a
    single verified target of the opposed alignment; when there's no unambiguous
    qualifying target, nothing is added and a footnote notes the ability instead.
    On Apply they also mark the weapon as good/evil/chaotic/lawful (for DR bypass).
  - **Furious** — +2 effective enhancement (attack and damage) while the wielder is
    raging (detected via configurable buff names/flags).
  - **Bane** — pick a designated creature type; +2 enhancement and +2d6 against a
    verified target of that type. Humanoid/Outsider add a subtype selector; the
    subtype lists are GM-editable in settings.
  - **Keen** — doubles the weapon's threat range.
  - **Merciful** — all of the weapon's damage becomes nonlethal and it deals an
    extra 1d6, with a "deal lethal" toggle added to the attack dialog that suppresses
    both for that attack.
  - Injected damage that would be untyped now inherits the weapon's base damage
    type(s) (e.g. Holy on a longsword deals slashing).
  - Abilities can now carry **parameters** (e.g. Bane's foe), chosen via an extra
    control on the ability row.
- **Autocomplete** ability picker (type-ahead) in place of the dropdown.
- **Settings**: GM-editable lists for rage-buff names/flags (used by rage-gated
  abilities) and extra bane creature types.
- **Material add-ons** (e.g. alchemical silver): a second selector for add-on
  materials, filtered to those compatible with the chosen base material, with their
  cost and weight folded into the totals and written to the weapon's native
  `material.addon`.
  - Condition-on-hit abilities — **Ominous, Cruel, Bewildering, Wounding** — add a
    clickable condition enricher (`@Condition[…]`, or `@Bleed` via pf1-bleed-effects
    when installed) to the attack's effect notes.
  - **Speed** enables the system's haste attack option (an extra attack).
  - **Fortuitous** sets a `fortuitous` boolean item flag for personal automation use.
  - **Actor-facing abilities** — Brawling (a native +enh CMB change), and Courageous,
    Countering, Dueling, Repositioning, Leveraging, Jurist, Menacing, Benevolent,
    Valiant, Nimble Shot, Deceptive, Huntsman as targeted context notes on the wielder
    (written to the weapon, active while equipped).
  - **Condition-on-hit sweep** — Dazzling, Dazzling Radiance, Exhausting, Fervent,
    Heretical, Patriotic, Treasonous, Peaceful, Glitterwake, Pitfall, Anchoring,
    Debilitating, Distracting, Greater Distracting, Legbreaker, Limning, Phase Locking,
    Skewering, Plummeting, Silencing — clickable condition enrichers / reminders on the
    attack's effect notes.
  - Injected on-hit damage now also shows in the **combat-tab damage column**.
  - Any applied ability without an implementation yet adds a short **placeholder
    footnote** to the attack card describing that it's present.
  - Extensible handler registry exposed at
    `game.modules.get("pf1-magic-equipment").api.abilities` so effects can be
    added or overridden.
- **Optional ckl-roll-bonuses integration:** a "Magic Equipment Abilities" bonus
  type that grants weapon abilities to whatever roll-bonuses' targeting matches, for
  the duration of a use — e.g. a buff that makes a targeted weapon *axiomatic* while
  active. Uses the same autocomplete ability picker as the weapon sheet. Fed through
  the same engine; nothing is written to the weapon. Dormant if roll-bonuses isn't
  installed.
- Injected damage is now **labelled** with its source (e.g. `1d6[Flaming]`), and
  otherwise-untyped added damage (Merciful's 1d6, alignment dice) matches the
  weapon's own damage type.
- **libWrapper is now a required dependency.** The mod's hooks into PF1's attack
  pipeline are registered through libWrapper so it coexists with other modules that
  wrap the same methods. This fixes Merciful's "deal lethal" toggle having no effect
  when ckl-roll-bonuses was installed (roll-bonuses replaces the conditional-handling
  method, which bypassed the previous manual patch).
- Abilities granted through the **roll-bonuses** integration now also reproduce the
  use-time effects that on-item abilities get at Apply: **Merciful's "deal lethal"
  toggle** (injected onto the action for the use) and **condition-on-hit enrichers**
  (@Condition / @Bleed) on the attack's effect notes. (Alignment-based DR bypass and
  actor-facing "while equipped" bonuses still require applying the ability to the item.)
- **Scripting API** at `game.modules.get("pf1-magic-equipment").api`:
  `listAbilities()`/`getAbility(key)` to enumerate the catalog, and
  `rollBonus.setAbilities(item, keys)`/`rollBonus.getAbilities(item)` to configure the
  roll-bonuses "Magic Equipment Abilities" bonus from a macro or script call (e.g. a
  buff whose create/use script lets the player pick an ability).

### Credits
- Enhancement/pricing logic adapted from **pf1-auto-forge**.
- Ability, material, and cost data adapted from **pf1-magic-item-gen**.
