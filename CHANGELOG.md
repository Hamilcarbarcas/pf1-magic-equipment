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
- Same-type injected damage (Merciful, Holy/Unholy/Anarchic/Axiomatic, Bane) is now
  folded into the weapon's **base damage instance** as a modifier rather than shown as
  a separate same-type line — added only to the non-critical roll, so it still isn't
  multiplied on a crit.
- **libWrapper is now a required dependency.** The mod's hooks into PF1's attack
  pipeline are registered through libWrapper so it coexists with other modules that
  wrap the same methods. This fixes Merciful's "deal lethal" toggle having no effect
  when ckl-roll-bonuses was installed (roll-bonuses replaces the conditional-handling
  method, which bypassed the previous manual patch).
- Abilities granted through the **roll-bonuses** integration now also reproduce the
  use-time effects that on-item abilities get at Apply: **Merciful's "deal lethal"
  toggle** (injected onto the action for the use) and **condition-on-hit enrichers**
  (@Condition / @Bleed) on the attack's effect notes. (Actor-facing "while equipped"
  bonuses still require applying the ability to the item.)
- **Damage reduction bypass.** A new roll-bonuses bonus type, **DR Bypass**, lets a
  buff make attacks count as magic, epic, cold iron, silver, adamantine, or an
  alignment when the target's DR is checked — or ignore damage reduction outright
  (Smite Evil), or just DR/—. It isn't weapon-specific, so it covers unarmed strikes
  and natural attacks, and roll-bonuses' targeting decides which attacks it applies to.
  The bypass is snapshotted onto the attack's chat message, so it still applies if the
  granting buff ends before the GM applies damage, and it is summarised as a footnote
  on the card. Granted **Holy/Unholy/Anarchic/Axiomatic** now carry their alignment
  bypass too, closing the last gap between granted and applied alignment weapons.
  (DR is only calculated in the apply-damage dialog; damage applied without it has no
  DR to bypass.)
- **Caster level and aura are now set on Apply**, controlled by a new **Set aura**
  checkbox next to the renaming one (on by default). The caster level is the highest
  single contributor — three times the enhancement bonus, or any special ability's own
  caster level, whichever is greater — and the school follows whichever of those set
  it, with a plain enhancement bonus reading as transmutation. Where several abilities
  tie with different schools, the aura lists them all rather than picking one. Aura
  strength and the identify DC follow from the caster level automatically. The value
  is shown in the cost readout before you Apply.
- **Armor and shields are now supported** alongside weapons. The same embedded
  section appears on their sheets, with the full catalogs of armor (109) and shield
  (47) special abilities.
  - Apply writes the armor-specific native fields as well: AC bonus, enhancement
    bonus, maximum Dex bonus, armor check penalty and arcane spell failure, with the
    chosen material's adjustments folded in (mithral's −3 ACP, +2 max Dex, −10% ASF,
    half weight, and so on).
  - Armor and shield abilities are **passive bonuses while the item is worn**, so
    they're written to the item as native changes and context notes rather than
    injected into a roll. Implemented in this release: the Slick, Shadow and
    Aquadynamic lines, Corsair, Jousting, Amorphous, Mind Buttressing, Arrow
    Catching and Rebounding as real bonuses; Spell Resistance, Energy Resistance,
    Fortification, Ghost Touch, Poison Resistant, Defiant, Wild and around forty
    others as reminders on the relevant roll. Abilities without an implementation
    still price, name and catalogue correctly.
  - **Shields carry both catalogs.** A shield's ability picker offers shield
    abilities *and* weapon abilities, and weapon abilities apply to its shield bash
    through the same engine weapons use. The shield's enhancement bonus is an AC
    bonus and is deliberately not carried into the bash.
- **Homebrew content is now marked and gated.** An **Include homebrew content**
  setting (off by default) controls whether non-RAW abilities and materials appear
  in the pickers; anything already applied to an item keeps working regardless, and
  is flagged in the picker. Kanthaal Steel is included as a homebrew material —
  **its numbers are placeholders**.
- **Pricing fixes** (these affected weapons too):
  - Materials that list both a flat price and a per-pound price (mithral) no longer
    charge both. A mithral chain shirt priced at 16,650 gp instead of 4,000 gp.
  - Mixed enchantments are banded per pricing table and summed, rather than sharing
    a single band.
- **Fixed: roll-bonuses ability grants leaked when an attack was cancelled.**
  Cancelling the attack dialog (or running out of ammo or charges) left the granted
  abilities and any injected dialog toggle attached to the action, so the next attack
  could apply them again. Teardown now runs on every exit path.
- **Always-masterwork materials** are now a GM-editable setting, defaulting to
  Adamantine, Angelskin, Darkleaf, Darkwood, Dragonhide, Fire-Forged Steel,
  Frost-Forged Steel, Greenwood, Horacalcum, Kanthaal Steel, Mithral, Silversheen,
  Singing Steel, and Sunsilver. It's additive to the materials the system already
  flags, so homebrew materials registered with that flag still work unlisted.
- **Scripting API** at `game.modules.get("pf1-magic-equipment").api`:
  `listAbilities()`/`getAbility(key)` to enumerate the catalog,
  `rollBonus.setAbilities(item, keys)`/`rollBonus.getAbilities(item)` to configure the
  roll-bonuses "Magic Equipment Abilities" bonus from a macro or script call (e.g. a
  buff whose create/use script lets the player pick an ability), and
  `rollBonus.setBypass(item, config)`/`getBypass(item)` plus `bypass.choices()` for the
  DR Bypass bonus.

### Credits
- Enhancement/pricing logic adapted from **pf1-auto-forge**.
- Ability, material, and cost data adapted from **pf1-magic-item-gen**.
