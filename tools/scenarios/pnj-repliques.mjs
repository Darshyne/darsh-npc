/**
 * Étape 5 du SPEC §16, les répliques (§11) — réglages : chat en personnage, fréquence « toujours », langue française.
 *  1. Le choix des lignes, sans parler : le Zombi (sans esprit) fait un geste ; le Bandit (qui parle) une réplique de brute, en anglais
 *     quand la langue l'est ; les lignes du token passent avant tout ; la surcouche du monde avant les génériques.
 *  2. Parler : un message en personnage, marqué ; le silence entre deux répliques ; répliques coupées : rien.
 *  3. En combat (Bandit piloté, Guerrier au contact, les autres tokens cachés) : réplique au début du combat et en attaquant ; touché
 *     par le Guerrier, il parle.
 * Remet : réglages, flags du Bandit, pilote, positions, PV, tokens cachés, combats.
 */
const NPC = "darsh-npc";
const pause = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "pnj-repliques — gestes et répliques, lignes du token et du monde, silence, en combat",

  async run(ctx) {
    const npc = async (fn, args={}) => (await ctx.call("call-module-api", { moduleId: NPC, fn, args, waitMs: 8000 })).result;
    const { tokens } = await ctx.scene();
    if ( !["Zombi", "Bandit", "Guerrier"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Zombi, Bandit ou Guerrier absent : non applicable"); return; }
    const zombi = await ctx.token("Zombi");
    const bandit = await ctx.token("Bandit");
    const guerrier = await ctx.token("Guerrier");
    const set = async (key, value) => { const r = await npc("reglage", { key, value }); return r.before; };
    const settings = [["level", "combat"], ["aiEnabled", true], ["autoEngage", false], ["autoEndTurn", true], ["morale", false],
      ["barkMode", "chat"], ["barkFrequency", "always"], ["barkCooldown", 0], ["barkLanguage", "fr"], ["barks", {}]];
    for ( const [key, value] of settings ) { const before = await set(key, value); ctx.restore(() => set(key, before)); }
    const ownBefore = await npc("repliquesToken", { tokenId: bandit.id });
    ctx.restore(() => npc("repliquesToken", { tokenId: bandit.id, barks: ownBefore ?? null }));
    const pilot = await npc("pilote", { tokenId: bandit.id });
    ctx.restore(() => npc("pilote", { tokenId: bandit.id, mode: pilot.mode }));

    // 1. Le choix des lignes.
    const z = await npc("repliquer", { tokenId: zombi.id, moment: "hit", dry: true });
    ctx.expect(z?.emote && (z.family === "mindless"), `Zombi : un geste de créature sans esprit (« ${z?.text} »)`);
    const b = await npc("repliquer", { tokenId: bandit.id, moment: "attack", dry: true });
    ctx.expect(!b?.emote && (b?.family === "brute") && (b.lang === "fr"), `Bandit : réplique de brute en français (« ${b?.text} »)`);
    await set("barkLanguage", "en");
    const en = await npc("repliquer", { tokenId: bandit.id, moment: "attack", dry: true });
    ctx.expect(en?.lang === "en", `en anglais quand la langue l'est (« ${en?.text} »)`);
    await set("barkLanguage", "fr");
    await npc("repliquesToken", { tokenId: bandit.id, barks: { attack: ["Pour la guilde !"] } });
    const own = await npc("repliquer", { tokenId: bandit.id, moment: "attack", dry: true });
    ctx.expect(own?.text === "Pour la guilde !" && own.source === "token", `les lignes du token d'abord (« ${own?.text} »)`);
    await npc("repliquesToken", { tokenId: bandit.id, barks: null });
    await set("barks", { "type:humanoid": { victory: { fr: ["Le monde a gagné !"] } } });
    const world = await npc("repliquer", { tokenId: bandit.id, moment: "victory", dry: true });
    ctx.expect(world?.text === "Le monde a gagné !", `puis la surcouche du monde (« ${world?.text} »)`);
    await set("barks", {});

    // 2. Parler, le silence, répliques coupées.
    const since = await ctx.lastMessageId();
    const said = await npc("repliquer", { tokenId: bandit.id, moment: "hit" });
    await pause(800);
    const barks = async from => ((await ctx.call("list-chat-messages", { limit: 40, sinceId: from, flagScope: NPC }).catch(() => ({ messages: [] }))).messages ?? [])
      .filter(m => m.flags?.[NPC]?.bark);
    const first = await barks(since);
    ctx.expect(!said.refused && first.some(m => m.flags[NPC].bark.moment === "hit" && m.text === said.text), `message en personnage du Bandit (« ${said.text ?? `${said.refused} ${said.why ?? ""}`} »)`);
    await set("barkCooldown", 30);
    const again = await npc("repliquer", { tokenId: bandit.id, moment: "hit" });
    ctx.expect(again.refused === "quiet", `silence de 30 s : pas de seconde réplique (${again.refused ?? again.text})`);
    await set("barkCooldown", 0);
    await set("barkMode", "off");
    const off = await npc("repliquer", { tokenId: bandit.id, moment: "hit" });
    ctx.expect(off.refused === "off", `répliques coupées : rien (${off.refused ?? off.text})`);
    await set("barkMode", "chat");

    // 3. En combat.
    const grid = await ctx.gridSize();
    for ( const t of tokens.filter(t => ![bandit.id, guerrier.id].includes(t.id)) ) {
      const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: t.id });
      if ( data.hidden ) continue;
      await ctx.call("update-scene-object", { type: "Token", objectId: t.id, data: { hidden: true } });
      ctx.restore(() => ctx.call("update-scene-object", { type: "Token", objectId: t.id, data: { hidden: false } }));
    }
    const sceneInfo = await ctx.call("get-scene", {});
    const cx = Math.ceil((sceneInfo.width * sceneInfo.padding) / grid), cy = Math.ceil((sceneInfo.height * sceneInfo.padding) / grid);
    for ( const t of [bandit, guerrier] ) { const hp = await ctx.hp(t); ctx.restore(() => ctx.setHp(t, hp)); await ctx.setHp(t, 100); }
    // Le moteur borne les PV à leur maximum : 100 PV d'un Bandit à 11 PV max ne survivent pas à une épée à deux mains. Maximum relevé
    // le temps du test (token non lié : son delta ; lié : la fiche).
    const { data: bd } = await ctx.call("get-scene-object", { type: "Token", objectId: bandit.id });
    const maxPath = "system.attributes.hp.max";
    if ( bd.actorLink ) {
      const actor = await ctx.call("get-actor", { actorId: bandit.actorId });
      const max0 = actor.system?.attributes?.hp?.max ?? null;
      if ( max0 !== null ) ctx.restore(() => ctx.call("update-actor", { actorId: bandit.actorId, actorData: { [maxPath]: max0 } }));
      await ctx.call("update-actor", { actorId: bandit.actorId, actorData: { [maxPath]: 200 } });
    } else {
      // Sans maximum propre au token, on retire la clé (écrire `null` donnerait 0 PV max : un Bandit « à terre »).
      const max0 = bd.delta?.system?.attributes?.hp?.max;
      ctx.restore(() => ctx.call("update-scene-object", { type: "Token", objectId: bandit.id,
        data: (max0 === undefined) || (max0 === null) ? { "delta.system.attributes.hp.-=max": null } : { [`delta.${maxPath}`]: max0 } }));
      await ctx.call("update-scene-object", { type: "Token", objectId: bandit.id, data: { [`delta.${maxPath}`]: 200 } });
    }
    await ctx.setHp(bandit, 200);
    await ctx.call("move-token", { tokenId: bandit.id, x: (cx + 3) * grid, y: (cy + 3) * grid, elevation: 0 });
    await ctx.call("move-token", { tokenId: guerrier.id, x: (cx + 4) * grid, y: (cy + 3) * grid, elevation: 0 });
    await npc("pilote", { tokenId: bandit.id, mode: "on" });
    await pause(600);
    const fight = await ctx.lastMessageId();
    await ctx.startCombat([bandit, guerrier]);
    let traced = null;
    for ( let i = 0; (i < 6) && !traced; i++ ) {
      const state = await ctx.combat();
      const combat = state.combat ?? state.combats?.[0] ?? state;
      if ( combat.combatants?.find(c => c.id === combat.currentCombatantId)?.tokenId !== bandit.id ) { await ctx.nextTurn(); await pause(500); }
      for ( let w = 0; (w < 40) && !traced; w++ ) {
        const msgs = (await ctx.call("list-chat-messages", { limit: 40, sinceId: fight, flagScope: NPC }).catch(() => ({ messages: [] }))).messages ?? [];
        traced = msgs.map(m => m.flags?.[NPC]?.trace).find(t => t?.token?.endsWith(bandit.id)) ?? null;
        if ( !traced ) await pause(1000);
      }
    }
    const moments = (await barks(fight)).filter(m => m.flags[NPC].bark.token.endsWith(bandit.id)).map(m => m.flags[NPC].bark.moment);
    ctx.expect(moments.includes("engage"), `au début du combat (${moments.join(", ")})`);
    ctx.expect(moments.includes("attack"), `en attaquant (${moments.join(", ")})`);
    // Le Guerrier le touche : il parle (jusqu'à ce que l'attaque touche).
    let hitSaid = false;
    for ( let n = 0; (n < 5) && !hitSaid; n++ ) {
      const from = await ctx.lastMessageId();
      const used = await ctx.use({ tokenId: guerrier.id, identifier: "greatsword", activityType: "attack", targetTokenIds: [bandit.id] })
        .catch(() => null) ?? await ctx.use({ tokenId: guerrier.id, activityType: "attack", targetTokenIds: [bandit.id] });
      if ( used?.usageMessageId ) await ctx.settle(used.usageMessageId).catch(() => null);
      await pause(1500);
      hitSaid = (await barks(from)).some(m => m.flags[NPC].bark.token.endsWith(bandit.id) && ["hit", "bloodied"].includes(m.flags[NPC].bark.moment));
    }
    ctx.expect(hitSaid, "touché par le Guerrier, il parle");
    if ( ctx.ownCombat ) await ctx.call("end-combat", { combatId: ctx.ownCombat }).catch(() => {});
  }
};
