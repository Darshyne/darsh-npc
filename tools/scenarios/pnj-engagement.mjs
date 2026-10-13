/**
 * Engagement automatique (SPEC §10.3, demande de l'utilisateur du 2026-10-13), IA coupée — l'engagement marche sans elle :
 *  1. Le Roublard est Invisible : allumer « Combat automatique » crée le combat avec ceux qu'une créature hostile voit — le Guerrier
 *     y est, pas le Roublard ; les PNJ ont leur initiative, les PJ non (les joueurs la lancent).
 *  2. Le Roublard redevient visible : il est ajouté au combat, tout seul.
 *  3. Combat retiré ; les autres créatures hostiles cachées par le MJ, le Zombi Aveuglé : personne ne voit personne, pas de combat.
 *     Le Guerrier attaque le Zombi : une créature attaquée s'en aperçoit — le combat se crée avec eux deux seulement.
 * Remet : réglages, états, tokens cachés, combats créés.
 */
const NPC = "darsh-npc";
const pause = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "pnj-engagement — combat automatique : qui voit entre, un PJ invisible reste dehors, une créature attaquée engage",

  async run(ctx) {
    const npc = async (fn, args={}) => (await ctx.call("call-module-api", { moduleId: NPC, fn, args, waitMs: 8000 })).result;
    const { tokens, sceneId } = await ctx.scene();
    if ( !["Zombi", "Guerrier", "Roublard"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Zombi, Guerrier ou Roublard absent : non applicable"); return; }
    // `get-combat` rend le combat actif lui-même, ou `{ combats: [] }` s'il n'y en a pas.
    const combats = async () => {
      const r = await ctx.call("get-combat", {});
      const list = r?.id ? [r] : (r?.combats ?? []);
      return list.filter(c => !c.sceneId || (c.sceneId === sceneId));
    };
    if ( (await combats()).length ) { ctx.log("un combat existe déjà sur la scène : non applicable"); return; }
    const zombi = await ctx.token("Zombi");
    const guerrier = await ctx.token("Guerrier");
    const roublard = await ctx.token("Roublard");

    const created = new Set();
    ctx.restore(async () => { for ( const id of created ) await ctx.call("end-combat", { combatId: id }).catch(() => {}); });
    const ai = await npc("reglage", { key: "aiEnabled", value: false });
    ctx.restore(() => npc("reglage", { key: "aiEnabled", value: ai.before }));
    const auto = await npc("reglage", { key: "autoEngage", value: false });
    ctx.restore(() => npc("reglage", { key: "autoEngage", value: auto.before }));
    ctx.restore(() => ctx.removeStatusEffects(roublard, "invisible"));
    ctx.restore(() => ctx.removeStatusEffects(zombi, "blinded"));

    const combatants = async () => {
      const list = await combats();
      for ( const c of list ) created.add(c.id);
      return list[0] ?? null;
    };
    const waitFor = async test => { for ( let i = 0; i < 20; i++ ) { const c = await combatants(); if ( c && test(c) ) return c; await pause(500); } return combatants(); };
    const names = c => (c?.combatants ?? []).map(x => x.name).filter(Boolean);

    // 1. Le Roublard invisible ; « Combat automatique » allumé.
    await ctx.call("set-status", { tokenId: roublard.id, statusId: "invisible", active: true });
    await pause(800);
    const seen = await npc("vus");
    ctx.expect(seen.tokens.includes("Guerrier") && !seen.tokens.includes("Roublard"), `vus : le Guerrier oui, le Roublard (invisible) non`);
    await npc("reglage", { key: "autoEngage", value: true });
    const first = await waitFor(c => names(c).includes("Guerrier"));
    ctx.expect(!!first, `combat créé par l'engagement (${names(first).length} combattants)`);
    if ( !first ) return;
    ctx.expect(names(first).includes("Zombi") && names(first).includes("Guerrier"), "le Zombi et le Guerrier y sont");
    ctx.expect(!names(first).includes("Roublard"), "le Roublard, que personne ne voit, n'y est pas");
    const byName = n => first.combatants.find(x => x.name === n);
    ctx.expect(Number.isFinite(byName("Zombi")?.initiative) && (byName("Guerrier")?.initiative ?? null) === null,
      `initiative : PNJ tirée (${byName("Zombi")?.initiative}), PJ laissée au joueur (${byName("Guerrier")?.initiative ?? "aucune"})`);

    // 2. Le Roublard redevient visible : il entre.
    await ctx.removeStatusEffects(roublard, "invisible");
    await ctx.call("set-status", { tokenId: roublard.id, statusId: "invisible", active: false }).catch(() => {});
    const second = await waitFor(c => names(c).includes("Roublard"));
    ctx.expect(names(second).includes("Roublard"), "le Roublard, de nouveau vu, rejoint le combat");

    // 3. Une créature attaquée engage.
    await npc("reglage", { key: "autoEngage", value: false });
    for ( const id of [...created] ) { await ctx.call("end-combat", { combatId: id }).catch(() => {}); created.delete(id); }
    await pause(800);
    const hostiles = tokens.filter(t => ["Mage", "Bandit", "Âme-en-peine", "Capteur invisible"].includes(t.name));
    for ( const t of hostiles ) {
      const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: t.id });
      if ( data.hidden ) continue;
      await ctx.call("update-scene-object", { type: "Token", objectId: t.id, data: { hidden: true } });
      ctx.restore(() => ctx.call("update-scene-object", { type: "Token", objectId: t.id, data: { hidden: false } }));
    }
    await ctx.call("set-status", { tokenId: zombi.id, statusId: "blinded", active: true });
    await pause(800);
    await npc("reglage", { key: "autoEngage", value: true });
    await pause(2500);
    ctx.expect(!(await combatants()), "personne ne voit personne : pas de combat");
    const hp0 = await ctx.hp(zombi);
    ctx.restore(() => ctx.setHp(zombi, hp0));
    await ctx.setHp(zombi, 100);
    const used = await ctx.use({ tokenId: guerrier.id, identifier: "greatsword", activityType: "attack", targetTokenIds: [zombi.id] })
      .catch(() => null) ?? await ctx.use({ tokenId: guerrier.id, activityType: "attack", targetTokenIds: [zombi.id] });
    if ( used?.usageMessageId ) await ctx.settle(used.usageMessageId).catch(() => null);
    const third = await waitFor(c => names(c).includes("Zombi"));
    ctx.expect(!!third && names(third).includes("Guerrier") && names(third).includes("Zombi"), `attaqué : combat créé avec ${names(third).join(", ") || "personne"}`);
    ctx.expect(names(third).length === 2, "seulement l'attaquant et sa cible");
  }
};
