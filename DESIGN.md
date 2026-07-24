# pf1-magic-equipment — Design

A backbone for applying magic properties (enhancement bonus, special abilities,
special materials) to Pathfinder 1e weapons — and later armor — inside FoundryVTT.

**Status:** design / pre-implementation. Weapons first; armor is a later phase.

## 1. Goal & scope

From an item's sheet, a GM can:

- Set the weapon's **base enhancement bonus** (+1…+5).
- Add one or more **special abilities**, both bonus-priced (e.g. *flaming*, +1
  equivalent) and fixed-cost (e.g. *resizing*, flat gp).
- Choose a **special material**.
- Link a **base (unmodified) item** from a compendium, used as the pristine
  baseline for all recomputation.
- See the running **enhancement cost** of the item (the cost of enchantment
  only — excluding the base item's own price and any material cost).
- **Apply** everything: recompute the real numbers (value, weight, unidentified
  price, hp, hardness, masterwork, material, base enh) and materialize the
  ability effects.

Effects that can't yet be mechanically implemented degrade gracefully to a short
footnote on the action describing what the ability *would* do.

Everything is **self-contained**. This mod fully replaces `pf1-auto-forge` and
`pf1-magic-item-gen`; their data is copied in (with credit — see §10), and there
is **no runtime dependency** on either, nor a hard dependency on
`ckl-roll-bonuses` (see §7).

## 2. UI — embedded on the item sheet

Not a standalone window. We inject a section into the item sheet on
`renderItemSheet`, placed right after the enhancement (`system.enh`) form-group —
the same slot `pf1-auto-forge` used. (PF1 v11 item sheets pass jQuery; grab the
raw element via `(app, [html]) => …`.)

The section contains:

- **Base item link** — a drop target (drag a compendium item onto it) plus a
  clear/relink control. Shows the linked item's name; the link is a UUID.
- **Enhancement bonus** — numeric select/input, +0…+5.
- **Special abilities** — a list of rows, each row = two dropdowns:
  1. *Category filter*: `+1 … +5`, `Fixed cost`, `All`.
  2. *Ability*: the abilities in the chosen category (`All` = everything).
  A `+` button adds a row; each row has a remove control. Multiple abilities,
  including duplicates where rules allow, are supported.
- **Material** — a select of special materials valid for weapons.
- **Masterwork** — a checkbox. Force-checked (and disabled) whenever the config
  requires it: any enhancement/ability, and most materials (a per-material
  "requires masterwork" flag drives this; list TBD from Patrick). Otherwise
  freely togglable.
- **Cost** readout — live, fully-inclusive total plus a delta vs. the item's
  current cost, with an itemized breakdown (§8).
- **Apply** button.

**Soft validation (inform, never block):** abilities incompatible with the
current weapon (melee-only on a ranged weapon, whip-only, etc.) and selections
that exceed the caps (base ≤ +5, base + ability equivalents ≤ +10) are **greyed
out / flagged with a warning**, but remain selectable so a GM can override.

## 3. State model — config (live) vs. applied (on Apply)

Because the sheet re-renders on every change, selections cannot live in the DOM.
Two layers, both stored in this module's flag namespace on the item:

- **Config flags (draft, live).** Every control change writes immediately —
  chosen enh, each ability row, material, base link. Cheap, no recompute. Closing
  and reopening the sheet preserves an in-progress build. Nothing here touches the
  weapon's real fields.
- **Applied state (on Apply).** The button reads the config, recomputes from the
  base (§4), writes the **real** system fields (§5), and materializes the
  **effect flags** the injection engine reads at use-time (§6).

Apply is **idempotent**: it always recomputes `base + current config`, so
re-applying after an edit never compounds deltas.

Implementation note: `setFlag`-per-change re-renders the sheet. On render we
re-read config and rebuild the section; text inputs are debounced and focus/scroll
is preserved so the section doesn't collapse mid-edit.

## 4. Base item link & recomputation

The drag-and-dropped compendium item is the **pristine baseline**. On Apply we
`fromUuid(baseLink)`, read the base stats, and compute the final numbers from
`base + config`. We never store prior *modified* states — only the link.

**Resilience cache.** At drop time we also capture a tiny numeric baseline —
`price, weight, hardness, hp.max, base material` (~5 fields) — into a flag beside
the link. Apply prefers the live base item but falls back to this cache if the
base can't be resolved (compendium renamed/uninstalled, base item edited/deleted).
This is a cache of the *base's* numbers, not a history of the modified item, and
it removes a whole class of "Apply suddenly broke" failures. If the base is
resolvable neither live nor from cache, Apply surfaces a clear "re-link the base
item" error.

## 5. The "easy" bucket — written to real system fields on Apply

Computed from `base + config` and written to the weapon's actual fields, so the
core PF1 system consumes them natively:

- **Base enhancement bonus** → `system.enh`.
- **Value / price** → base price + enhancement cost + material cost + masterwork.
- **Unidentified price** → **base item price only** — deliberately excludes
  masterwork, enhancement, and material costs.
- **Weight** → base weight adjusted by material (e.g. mithral halving).
- **Hit points / hardness** → base adjusted by material and enhancement.
- **Masterwork** → the section's masterwork checkbox, force-set when any
  enhancement/ability is present or the chosen material requires it (per-material
  flag), otherwise the GM's free choice.
- **Material** → native PF1 material fields (also drives DR bypass).
- **Alignment traits** (holy = good-aligned, etc.) → native weapon alignment
  fields (also drives DR bypass).

**Principle:** anything the core system already consumes (material, alignment, enh)
is fed through **native fields**; we do not build a parallel DR layer. Materials
exist in this mod only to automate their price/weight/hardness/hp effects that the
base system doesn't compute.

## 6. The "hard" bucket — ability effects via flags + a use-time engine

Ability *mechanics* never mutate the weapon's user-editable action fields. They
are stored as effect data in our flags and injected at use-time by a **standalone
injection engine** we own (no dependency on roll-bonuses for this).

### 6.1 Ability descriptor

Copied/derived from `pf1-magic-item-gen`'s catalog. Per ability:

```
{
  key,                 // stable id
  name, output,        // display / short label
  bonus,               // enh equivalent (0 for fixed-cost)
  priceMod,            // gp for fixed-cost; sentinel for bonus-priced
  cl, aura,            // flavor
  restrictions,        // melee/ranged/weapon-type compatibility (for grey-out)
  summary,             // one-line footnote text (see §9)
  apply?(context),     // optional handler → returns effect contributions
}
```

### 6.2 Handler interface (keeps §7 open)

`apply(context)` receives a normalized context — wielder actor, action, targets,
roll data — and **returns effect contributions** (damage parts, attack mods,
effective-enh delta, notes). It does **not** know how contributions reach the
roll; that's the engine's single seam. This abstraction is what lets an individual
ability later delegate to roll-bonuses (when present) or use a native/footnote
fallback, per ability, without any global dependency.

### 6.3 Effect taxonomy & build order

1. **Bonus damage on hit** — flaming, frost, corrosive, holy, … → damage
   injection. **Implemented first** (highest value, cleanest mapping).
2. **Conditional effective-enh** — bane / furious (+2 vs a subset or while
   raging), incl. their bonus damage.
3. **Crit range / on-crit effects** — keen, "on crit …" abilities.
4. **Actor-facing bonuses** — courageous (saves vs fear), brawling (CMB),
   dueling (initiative/CMD). Trickiest; the roll-bonuses-vs-native call (§7) lands
   here.
5. **Flavor / action-economy** — glamered, called, resizing. No roll effect →
   footnote only, permanently.
6. **DR bypass** — material + alignment → native fields (§5), no injection.

Everything past bucket 1 ships as **footnote-only placeholders** until
implemented, per §9.

### 6.4 Injection seam — largely solved by prior work

The seam for injecting attack/damage without mutating the action is already
mapped (see the `reference-rollbonuses-damage-injection` memory — how roll-bonuses
does exactly this). The recipe we'll follow, since our config already lives in
item flags (§3):

- **To roll the effect:** convert the flag → a `pf1.components.ItemConditional`
  (`target:'damage', subTarget:'allDamage'`) and inject it at the `pf1PreDamageRoll`
  hook, **or** push an `ItemChange` (target `damage`) into `action.damageSources`.
  Both are **additive** — no libWrapper `OVERRIDE`, so they survive PF1 updates.
- **To show it in the item/damage tooltip breakdown:** the `ItemChange` /
  `damageSources` route surfaces it for free.
- **To show the bold combat-tab damage-column number:** the only fragile part —
  requires fully replacing `pf1.utils.formula.actionDamage` (deep-clone the action,
  append the modifiers, build the string). We treat this as **optional polish**, not
  a v1 requirement; skip it initially to avoid the OVERRIDE maintenance cost.

So the remaining spike is narrow: confirm the `pf1PreDamageRoll` +
`ItemConditional` path against `foundryvtt-pathfinder1-v11.x` for a weapon-attack
action, and confirm effective-enh (bucket 2) and crit-range (bucket 3) have
equally additive seams (likely `ItemChange` / `pf1PreActionUse`-style hooks). Read
internals against the v11.x source, not the newer system folder.

## 7. roll-bonuses integration — optional, two roles

`ckl-roll-bonuses` is **never required**. If absent, everything above still works.
Its integration has two distinct roles:

- **A. Targeting bridge (planned now).** Register a bonus source
  (`Hooks.once('ckl-roll-bonuses.ready')` → `api.utils.registerSource(class extends
  api.sources.BaseBonus)`, per astora's `roll-bonus-target-filter.mjs`). Its config
  is a **list of ability keys** (with add-multiple support). When the bonus applies
  to a targeted item/action, it feeds those keys into the **same** injection engine.
  This is how a temporary grant works — e.g. a buff that gives a weapon *axiomatic*
  for 10 minutes — with no hard-coded temporary bonus and no mutation of
  price/weight/enh.

- **B. Complex-ability delegation (deferred to bucket 4).** *Open question, not
  decided.* Whether specific actor-facing abilities delegate their conditional
  logic to roll-bonuses (when present) or use native PF1 Changes/notes. The §6.2
  handler abstraction keeps both paths open; current lean is **opportunistic
  delegation with a native/footnote fallback**, not a hard dependency — motivated by
  keeping this mod standalone, avoiding coupling to roll-bonuses' churning API, and
  avoiding its separate flag namespace fighting our config→Apply model.

## 8. Cost readout

Live and **fully inclusive** — the total value the item will have once applied —
plus a **delta** and an **itemized breakdown**.

- **Total** = base item + masterwork + material + enchantment cost. The
  enchantment cost is a *single* figure derived from the **total enhancement
  equivalent** (base enh + bonus-priced abilities) via the pricing band, **plus**
  each fixed-cost ability's flat gp.
- **Delta** = `Total − current item cost`. "Current" is read directly off the
  item's present `system.price`; no prior state is stored.
- **Breakdown** (itemized, bonus points): base item cost, material cost,
  masterwork cost, enhancement cost (the combined enh + bonus-ability figure, one
  line), and each fixed-cost ability on its own line. Note the enh + bonus-ability
  cost is inherently one line because it's priced off the *total* equivalent, not
  per ability.

Data comes from the copied auto-forge enh value tables and the magic-item-gen
ability/material costs. (Contrast with §5: this is the identified *value*; the
**unidentified** price is base-item-only.)

## 9. Placeholder footnotes

Any ability without an `apply` handler (or explicitly footnote-only, bucket 5) adds
a short note to the action stating its effect — a quick one-line `summary`, not the
full rules text. The full `desc` is retained for tooltips/the picker. Footnotes are
transient (regenerated from config), matching the "temporary presentation" intent.

## 10. Housekeeping

- **Self-contained data.** Ability, material, and enh-value tables are copied into
  this mod's own data files. Credit `pf1-auto-forge` and `pf1-magic-item-gen` in the
  README and in a header comment on each copied data file.
- **Scaffolding** follows the standard convention: `CHANGELOG.md` is the source of
  truth for release notes; `module.json` version/download are `0.0.0` placeholders
  set by the tag-triggered release workflow (never hand-edited); README documents
  user-facing controls.
- **App framework:** the embedded sheet section is plain injected DOM; any auxiliary
  popups use ApplicationV2 with a `classes` entry so module CSS applies.

## 11. Open items to resolve during build

- [ ] Confirm the (largely-mapped) injection seam (§6.4): verify the
      `pf1PreDamageRoll` + `ItemConditional` path on a v11.x weapon attack, and
      find additive seams for effective-enh and crit-range.
- [x] Confirm the exact native PF1 v11 material API — using `pf1.registry.materials`
      (per-handedness price, hardness, health/weight multipliers, `masterwork`,
      `isAllowed`). Addon materials (alchemical silver) deferred; v1 handles one
      "normal" material via `system.material.normal.value`.
- [ ] Get from Patrick the list of materials that force masterwork. For now every
      material force-checks masterwork (`materialForcesMasterwork` in calc.mjs);
      the rules-accurate value is preserved on the registry entry (`mat.masterwork`).
- [ ] Decide, per ability, the bucket-4 roll-bonuses delegation vs native call (§7B).
- [ ] Author short `summary` lines for footnote fallbacks as abilities are added.

---

*Credits: enhancement/pricing logic adapted from `pf1-auto-forge`; ability,
material, and cost data adapted from `pf1-magic-item-gen`.*
