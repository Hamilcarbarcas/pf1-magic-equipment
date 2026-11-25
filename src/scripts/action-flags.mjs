/**
 * PF1 v11's ItemAction has no `flags` field, and core's schema cleaning deletes
 * any key a model doesn't define, so the Animate action's
 * `flags.pf1-magic-equipment.ability` would vanish without one. Other modules
 * (astora-mod, Advanced Templates) add the same field; the guard lets any number
 * of them register it. It must run at `init`, before the schema is first built.
 */
Hooks.once('init', () => {
  libWrapper.register('pf1-magic-equipment', 'pf1.components.ItemAction.defineSchema', function (wrapped, ...args) {
    const schema = wrapped(...args);
    schema.flags ??= new foundry.data.fields.ObjectField({ required: false, initial: {} });
    return schema;
  }, 'WRAPPER');
});
