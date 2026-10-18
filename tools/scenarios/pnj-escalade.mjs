/**
 * Escalade, lot 4 (SPEC §19 ; moteur §196) : une cible perchée, sur la scène « Escalade » de `dnd-6` (mur vertical en x = 700, plafond
 * à 20 ft sur la moitié ouest ; Guerrier, Zombi et Paladin contre le mur).
 *  1. Le Guerrier marche au plafond (Pattes d'araignée, pieds à 15 ft). Le Zombi piloté, seul ennemi en vue : hors d'allonge, sans tir ni
 *     escalade — il garde sa position et rend la main (`tooHigh`), sans marche ni attaque refusée.
 *  2. Le Paladin en vue : le Zombi prend la cible qu'il peut atteindre (le Paladin), jamais le Guerrier.
 *  3. Un Rejeton vampirique (Moyen, Pattes d'araignée) piloté : il grimpe le long du mur jusqu'à l'allonge du Guerrier, puis frappe.
 *  4. Une Araignée géante (Grande : la tête à 10 ft) : le Guerrier à 15 ft est à son allonge depuis le sol — elle approche et mord, sans
 *     grimper pour rien.
 * Remet : réglages, pilote, plafond et effet du sort, positions, PV, tokens créés, combats (le filet du lanceur reprend le reste).
 */
const NPC = "darsh-npc";
const ENGINE = "dnd5e-combat";
const SPIDER_CLIMB = "Compendium.dnd-players-handbook.spells.phbsplSpiderClim";
const pause = ms => new Promise(r => setTimeout(r, ms));

export default {
  scene: "Escalade",
  name: "pnj-escalade — cible au plafond : le Zombi passe ou change de cible, un grimpeur grimpe et frappe, l'Araignée géante mord d'en bas",

  async run(ctx) {
    const npc = async (fn, args={}) => (await ctx.call("call-module-api", { moduleId: NPC, fn, args, waitMs: 8000 })).result;
    const packs = await ctx.call("list-compendiums", {}).catch(() => null);
    if ( !JSON.stringify(packs ?? "").includes("dnd-players-handbook.spells") ) { ctx.log("Manuel des joueurs absent : non applicable"); return; }
    const { tokens } = await ctx.scene();
    if ( !["Zombi", "Guerrier", "Paladin"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Zombi, Guerrier ou Paladin absent : non applicable"); return; }
    const zombi = await ctx.token("Zombi");
    const guerrier = await ctx.token("Guerrier");
    const paladin = await ctx.token("Paladin");
    for ( const [key, value] of [["level", "combat"], ["aiEnabled", true], ["autoEngage", false], ["autoEndTurn", true], ["morale", false]] ) {
      const r = await npc("reglage", { key, value }).catch(() => null);
      if ( r ) ctx.restore(() => npc("reglage", { key, value: r.before }));
    }
    const rules = await ctx.engine("setting", { key: "climbRules", value: "2024" });
    ctx.restore(() => ctx.engine("setting", { key: "climbRules", value: rules?.before ?? "2024" }));
    const home = await ctx.position(guerrier);
    for ( const t of [zombi, guerrier, paladin] ) {
      const hp = await ctx.hp(t);
      ctx.restore(() => ctx.setHp(t, hp));
      await ctx.setHp(t, 200);
    }
    const before = await npc("pilote", { tokenId: zombi.id });
    ctx.restore(() => npc("pilote", { tokenId: zombi.id, mode: before.mode }));
    // Le Guerrier rendu au sol, à l'endroit, sans le sort.
    ctx.restore(async () => {
      await ctx.call("update-scene-object", { type: "Token", objectId: guerrier.id, data: { movementAction: "walk", "texture.scaleY": 1,
        [`flags.${ENGINE}.climb`]: null, [`flags.${ENGINE}.ceilingFlip`]: null } }).catch(() => {});
      await ctx.call("move-token", { tokenId: guerrier.id, x: home.x, y: home.y, elevation: 0 }).catch(() => {});
      for ( const statusId of ["prone", "falling", "climbing", "ceiling"] ) await ctx.call("set-status", { tokenId: guerrier.id, statusId, active: false }).catch(() => {});
      await ctx.removeEffectsFrom(guerrier, "spider-climb");
    });
    // Les tokens posés par le scénario sont retirés.
    const created = [];
    ctx.restore(async () => { for ( const id of created ) await ctx.call("delete-scene-object", { type: "Token", objectId: id }).catch(() => {}); });
    const hide = async (token, hidden) => {
      const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: token.id });
      if ( data.hidden === hidden ) return;
      await ctx.call("update-scene-object", { type: "Token", objectId: token.id, data: { hidden } });
      ctx.restore(() => ctx.call("update-scene-object", { type: "Token", objectId: token.id, data: { hidden: data.hidden } }));
    };
    const place = async (actorId, x, y) => {
      await ctx.call("place-token", { actorId, x, y });
      await pause(1000);
      const all = (await ctx.call("list-scene-objects", { types: ["Token"] })).objects?.Token ?? [];
      const t = all.filter(t => (t.actorId === actorId) && !created.includes(t.id)).at(-1);
      created.push(t.id);
      // `place-token` pose le token sur le niveau de la scène active : on le met sur celui du Guerrier.
      const { data: g } = await ctx.call("get-scene-object", { type: "Token", objectId: guerrier.id });
      await ctx.call("update-scene-object", { type: "Token", objectId: t.id, data: { level: g.level, elevation: 0 } }).catch(() => {});
      return { id: t.id, actorId, name: t.name };
    };

    /** Un combat de ces tokens jusqu'à la carte de trace du token piloté ; rend la trace. Le combat est retiré. */
    const turnOf = async (pilot, others) => {
      const since = await ctx.lastMessageId();
      await ctx.startCombat([pilot, ...others]);
      let traced = null;
      for ( let i = 0; i < 6 && !traced; i++ ) {
        const state = await ctx.combat();
        const combat = state.combat ?? state.combats?.[0] ?? state;
        const current = combat.combatants?.find(c => c.id === combat.currentCombatantId)?.tokenId;
        if ( current !== pilot.id ) { await ctx.nextTurn(); await pause(500); }
        for ( let w = 0; w < 40 && !traced; w++ ) {
          const messages = await ctx.call("list-chat-messages", { limit: 30, sinceId: since, flagScope: NPC }).catch(() => ({ messages: [] }));
          traced = (messages.messages ?? []).map(m => m.flags?.[NPC]?.trace).find(t => t?.token?.endsWith(pilot.id)) ?? null;
          if ( !traced ) await pause(1000);
        }
      }
      if ( ctx.ownCombat ) await ctx.call("end-combat", { combatId: ctx.ownCombat }).catch(() => {});
      ctx.ownCombat = null;
      await pause(800);
      return traced;
    };
    const short = o => JSON.stringify(o)?.slice(0, 220);

    /** Le Guerrier debout, au sol chez lui, sous Pattes d'araignée, puis au plafond (pieds à 15 ft). */
    const spellId = await ctx.ensureItem(guerrier, SPIDER_CLIMB, { system: { method: "atwill" } });
    const hpG = await ctx.hp(guerrier);
    const perch = async () => {
      for ( const status of ["grappled", "prone", "unconscious", "incapacitated"] ) await ctx.removeStatusEffects(guerrier, status);
      await ctx.setHp(guerrier, 200);
      await ctx.call("update-scene-object", { type: "Token", objectId: guerrier.id, data: { movementAction: "walk", [`flags.${ENGINE}.climb`]: null } }).catch(() => {});
      await ctx.call("move-token", { tokenId: guerrier.id, x: home.x, y: home.y, elevation: 0 });
      await pause(800);
      if ( !(await ctx.engine("climbState", { tokenId: guerrier.id })).walksCeilings ) {
        await ctx.use({ tokenId: guerrier.id, itemId: spellId, targetTokenIds: [guerrier.id], collectMs: 1500 });
        await pause(800);
      }
      const up = await ctx.engine("climbCeiling", { tokenId: guerrier.id });
      await pause(1500);
      return up;
    };
    ctx.restore(() => ctx.setHp(guerrier, hpG));

    // 1. Le Guerrier au plafond ; le Zombi, seul ennemi en vue, ne peut rien.
    const up = await perch();
    if ( !ctx.expect(up.done && up.onCeiling && (up.after.elevation === home.elevation + 15), `le Guerrier marche au plafond (${up.after.elevation} ft)`) ) return;
    await hide(paladin, true);
    await npc("pilote", { tokenId: zombi.id, mode: "on" });
    let p = await npc("plan", { tokenId: zombi.id });
    const seen = p.enemies.find(e => e.name === "Guerrier");
    ctx.expect(seen && (seen.vertical >= 2) && (seen.distance >= 1), `vue du Zombi : le Guerrier à ${seen?.distance} case(s) en 3D, dont ${seen?.vertical} de vide (sur la carte : ${seen?.flat})`);
    ctx.expect((p.plan.reason === "outOfReach") && (p.move?.type === "yield") && (p.move.reason === "tooHigh"), `hors d'allonge, sans tir ni escalade : il garde sa position (${short(p.move)})`);
    const z0 = await ctx.position(zombi);
    let trace = await turnOf(zombi, [guerrier]);
    const z1 = await ctx.position(zombi);
    ctx.expect(!!trace && (trace.reason === "tooHigh") && !trace.steps.length, `carte de trace : rend la main « hors d'atteinte » sans rien jouer (${short(trace)})`);
    ctx.expect((z0.x === z1.x) && (z0.y === z1.y), `le Zombi n'a pas bougé (${z0.x},${z0.y} → ${z1.x},${z1.y})`);

    // 2. Le Paladin en vue : la cible qu'il peut atteindre.
    await hide(paladin, false);
    p = await npc("plan", { tokenId: zombi.id });
    const target = p.plan.type === "attack" ? p.plan.target : p.move?.target;
    ctx.expect(target === paladin.id, `le Paladin en vue : c'est lui qu'il vise (${short(p.plan.type === "attack" ? p.plan : p.move)})`);
    trace = await turnOf(zombi, [guerrier, paladin]);
    const hits = (trace?.steps ?? []).filter(s => s.type === "attack");
    ctx.expect(!!trace && hits.length && hits.every(s => s.target === "Paladin"), `il frappe le Paladin, pas le Guerrier (${short(trace?.steps)})`);
    await npc("pilote", { tokenId: zombi.id, mode: "off" });

    // 3. Un grimpeur Moyen (Pattes d'araignée) : il grimpe jusqu'à l'allonge, puis frappe.
    await ctx.call("move-token", { tokenId: zombi.id, x: 100, y: 800, elevation: 0 });
    await ctx.call("move-token", { tokenId: paladin.id, x: 100, y: 100, elevation: 0 });
    await hide(paladin, true);
    await hide(zombi, true);
    const listed = await ctx.call("list-actors", {});
    const actors = Array.isArray(listed) ? listed : (listed?.actors ?? []);
    const spawnActor = actors.find(a => a.name === "Vampire Spawn");
    if ( spawnActor ) {
      const spawn = await place(spawnActor.id, 300, 300);
      await npc("pilote", { tokenId: spawn.id, mode: "on" });
      p = await npc("plan", { tokenId: spawn.id });
      ctx.expect(p.self.climber && (p.move?.type === "climb") && (p.move.target === guerrier.id), `le Rejeton vampirique sait grimper : il ira chercher le Guerrier au plafond (${short(p.move)})`);
      const s0 = await ctx.position(spawn);
      trace = await turnOf(spawn, [guerrier]);
      const climbStep = (trace?.steps ?? []).find(s => s.type === "climb");
      const bites = (trace?.steps ?? []).filter(s => (s.type === "attack") && (s.target === "Guerrier"));
      const s1 = (await ctx.engine("climbState", { tokenId: spawn.id })).position;
      ctx.expect(!!climbStep && climbStep.arrived && (climbStep.climbed >= 1), `grimpe le long du mur jusqu'à l'allonge (${short(climbStep)})`);
      ctx.expect((s1.elevation > s0.elevation) && (s1.movementAction === "climb"), `au mur à ${s1.elevation} ft (${s1.movementAction})`);
      ctx.expect(bites.length >= 1, `puis frappe le Guerrier (${bites.map(b => `${b.attack} — ${b.outcome}`).join(" ; ") || short(trace)})`);
    }
    else ctx.log("Vampire Spawn absent du monde : partie 3 sautée");

    // 4. L'Araignée géante (Grande) : depuis le sol, le Guerrier perché est à son allonge — elle approche et mord sans grimper.
    const spiderActor = actors.find(a => a.name === "Giant Spider");
    if ( spiderActor ) {
      for ( const id of created.splice(0) ) await ctx.call("delete-scene-object", { type: "Token", objectId: id }).catch(() => {});
      // Le Rejeton l'a peut-être agrippé (le moteur fait tomber un grimpeur Agrippé), voire mis à 0 PV : on le remet au plafond.
      const g0 = await perch();
      if ( !ctx.expect(g0.onCeiling, `le Guerrier remis au plafond pour l'Araignée géante (${g0.after?.elevation} ft)`) ) return;
      const spider = await place(spiderActor.id, 200, 500);
      await npc("pilote", { tokenId: spider.id, mode: "on" });
      p = await npc("plan", { tokenId: spider.id });
      const g = p.enemies.find(e => e.name === "Guerrier");
      ctx.expect(p.self.climber && (g?.vertical ?? 9) <= 1 && (p.move?.type === "move"), `Araignée géante : le Guerrier à ${g?.vertical} case de vide, à son allonge depuis le sol — elle marche (${short(p.move)})`);
      trace = await turnOf(spider, [guerrier]);
      const bite = (trace?.steps ?? []).find(s => (s.type === "attack") && (s.target === "Guerrier"));
      ctx.expect(!(trace?.steps ?? []).some(s => s.type === "climb") && !!bite, `approche et mord sans grimper (${short(trace?.steps)})`);
    }
    else ctx.log("Giant Spider absente du monde : partie 4 sautée");
  }
};
