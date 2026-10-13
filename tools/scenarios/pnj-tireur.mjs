/**
 * Étape 3 du SPEC §16, un tireur garde ses distances : le Mage piloté, seul avec le Guerrier (les autres tokens cachés), à 29 cases de lui, au-delà de la portée de
 * son Jaillissement arcanique), s'approche **jusqu'à sa portée normale en voyant sa cible** — pas au contact — puis tire.
 * Remet : réglages, pilote, positions et PV (filet du lanceur), combat.
 */
const NPC = "darsh-npc";
const pause = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "pnj-tireur — le Mage piloté s'approche à portée de tir, pas au contact, puis tire",

  async run(ctx) {
    const npc = async (fn, args={}) => (await ctx.call("call-module-api", { moduleId: NPC, fn, args, waitMs: 8000 })).result;
    const { tokens } = await ctx.scene();
    if ( !["Mage", "Guerrier"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Mage ou Guerrier absent : non applicable"); return; }
    const mage = await ctx.token("Mage");
    const guerrier = await ctx.token("Guerrier");
    for ( const [key, value] of [["level", "combat"], ["aiEnabled", true], ["autoEngage", false], ["autoEndTurn", true]] ) {
      const r = await npc("reglage", { key, value });
      ctx.restore(() => npc("reglage", { key, value: r.before }));
    }
    const before = await npc("pilote", { tokenId: mage.id });
    ctx.restore(() => npc("pilote", { tokenId: mage.id, mode: before.mode }));
    const hpM = await ctx.hp(mage), hpG = await ctx.hp(guerrier);
    ctx.restore(() => ctx.setHp(mage, hpM));
    ctx.restore(() => ctx.setHp(guerrier, hpG));
    await ctx.setHp(guerrier, 200);
    await npc("pilote", { tokenId: mage.id, mode: "on" });

    const grid = await ctx.gridSize();
    // Seuls les deux tokens du test restent visibles (les autres tokens de l'arène, cachés le temps du test, n'entrent ni dans la
    // vue ni dans le classement).
    for ( const t of tokens.filter(t => ![mage.id, guerrier.id].includes(t.id)) ) {
      const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: t.id });
      if ( data.hidden ) continue;
      await ctx.call("update-scene-object", { type: "Token", objectId: t.id, data: { hidden: true } });
      ctx.restore(() => ctx.call("update-scene-object", { type: "Token", objectId: t.id, data: { hidden: false } }));
    }
    // Le rectangle de la scène commence après sa marge (`padding`) : des positions dans la marge n'ont aucun chemin.
    const sceneInfo = await ctx.call("get-scene", {});
    const cellX = Math.ceil((sceneInfo.width * sceneInfo.padding) / grid), cellY = Math.ceil((sceneInfo.height * sceneInfo.padding) / grid);
    await ctx.call("move-token", { tokenId: mage.id, x: (cellX + 1) * grid, y: (cellY + 1) * grid, elevation: 0 });
    await ctx.call("move-token", { tokenId: guerrier.id, x: (cellX + 1) * grid, y: (cellY + 1 + 30) * grid, elevation: 0 });
    await pause(600);
    const start = await ctx.position(mage);
    const { plan, move } = await npc("plan", { tokenId: mage.id });
    ctx.log(`intention : ${JSON.stringify(plan).slice(0, 160)} ; déplacement : ${JSON.stringify(move).slice(0, 200)}`);
    const goesNear = (plan.type === "attack" && plan.mode === "long") || (move?.type === "move" && move.seeing);
    ctx.expect(goesNear, "hors de portée normale : il ira à portée de tir, en voyant sa cible");
    const targetId = move?.target ?? plan.target;
    const target = tokens.find(t => t.id === targetId);
    const reach = move?.reachCells ?? null;

    const since = await ctx.lastMessageId();
    await ctx.startCombat([mage, guerrier]);
    let traced = null;
    for ( let i = 0; i < 6 && !traced; i++ ) {
      const state = await ctx.combat();
      const combat = state.combat ?? state.combats?.[0] ?? state;
      if ( combat.combatants?.find(c => c.id === combat.currentCombatantId)?.tokenId !== mage.id ) { await ctx.nextTurn(); await pause(500); }
      for ( let w = 0; w < 60 && !traced; w++ ) {
        const messages = await ctx.call("list-chat-messages", { limit: 30, sinceId: since, flagScope: NPC }).catch(() => ({ messages: [] }));
        traced = (messages.messages ?? []).map(x => x.flags?.[NPC]?.trace).find(t => t?.token?.endsWith(mage.id)) ?? null;
        if ( !traced ) await pause(1000);
      }
    }
    ctx.expect(!!traced, "carte de trace du pilote laissée au MJ");
    if ( !traced ) return;
    ctx.log(traced.steps.map(s => s.type === "move" ? `approche de ${s.target}${s.dashed ? " (Sprint)" : ""} — ${s.arrived ? "arrivé" : "pas arrivé"}`
      : `${s.attack} (${s.mode}) sur ${s.target} — ${s.outcome}`).join(" ; ") + ` ; fin : ${traced.reason}`);
    const [first] = traced.steps;
    ctx.expect(first?.type === "move" && !first.dashed && first.arrived, "s'approche en marchant, sans Sprint, et arrive à portée");
    ctx.expect(traced.steps.some(s => s.type === "attack" && s.mode === "ranged"), "puis tire à portée normale");
    const m = await ctx.position(mage);
    const t = await ctx.position(guerrier);
    const apart = Math.max(Math.abs(m.x - t.x), Math.abs(m.y - t.y)) / grid - 1;
    const walked = Math.max(Math.abs(m.x - start.x), Math.abs(m.y - start.y)) / grid;
    ctx.expect(apart > 0 && (reach === null || apart + 1 <= reach), `garde ses distances : ${apart} case(s) de sa cible, portée ${reach ?? "?"} (a marché ${walked} case(s))`);
  }
};
