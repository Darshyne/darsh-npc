/**
 * Étape 3 du SPEC §16 : le Zombi piloté (Vitesse 20 ft = 4 cases) s'approche du Guerrier par le chemin du moteur.
 *  1. Le Guerrier à 3 cases : le Zombi marche jusqu'au contact, puis attaque.
 *  2. Le Guerrier à 7 cases : son déplacement ne suffit pas — il Sprinte (l'Action y passe), arrive au contact, n'attaque pas.
 * Les autres tokens de l'arène cachés le temps du test, dans le coin haut-gauche de la scène (sans murs). Remet : réglages, pilote, positions et PV (filet du
 * lanceur), combats.
 */
const NPC = "darsh-npc";
const pause = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "pnj-approche — le Zombi piloté marche au contact puis frappe ; trop loin, il Sprinte",

  async run(ctx) {
    const npc = async (fn, args={}) => (await ctx.call("call-module-api", { moduleId: NPC, fn, args, waitMs: 8000 })).result;
    const { tokens } = await ctx.scene();
    if ( !["Zombi", "Guerrier"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Zombi ou Guerrier absent : non applicable"); return; }
    const zombi = await ctx.token("Zombi");
    const guerrier = await ctx.token("Guerrier");
    for ( const [key, value] of [["level", "combat"], ["aiEnabled", true], ["autoEngage", false], ["autoEndTurn", true]] ) {
      const r = await npc("reglage", { key, value });
      ctx.restore(() => npc("reglage", { key, value: r.before }));
    }
    const before = await npc("pilote", { tokenId: zombi.id });
    ctx.restore(() => npc("pilote", { tokenId: zombi.id, mode: before.mode }));
    const hpZ = await ctx.hp(zombi), hpG = await ctx.hp(guerrier);
    ctx.restore(() => ctx.setHp(zombi, hpZ));
    ctx.restore(() => ctx.setHp(guerrier, hpG));
    await ctx.setHp(zombi, 100);
    await ctx.setHp(guerrier, 100);
    await npc("pilote", { tokenId: zombi.id, mode: "on" });
    const grid = await ctx.gridSize();
    // Seuls les deux tokens du test restent visibles (les autres tokens de l'arène, cachés le temps du test, n'entrent ni dans la
    // vue ni dans le classement).
    for ( const t of tokens.filter(t => ![zombi.id, guerrier.id].includes(t.id)) ) {
      const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: t.id });
      if ( data.hidden ) continue;
      await ctx.call("update-scene-object", { type: "Token", objectId: t.id, data: { hidden: true } });
      ctx.restore(() => ctx.call("update-scene-object", { type: "Token", objectId: t.id, data: { hidden: false } }));
    }
    // Le rectangle de la scène commence après sa marge (`padding`) : des positions dans la marge n'ont aucun chemin.
    const sceneInfo = await ctx.call("get-scene", {});
    const cellX = Math.ceil((sceneInfo.width * sceneInfo.padding) / grid), cellY = Math.ceil((sceneInfo.height * sceneInfo.padding) / grid);
    const origin = { x: (cellX + 2) * grid, y: (cellY + 2) * grid };

    const turn = async gap => {
      await ctx.call("move-token", { tokenId: zombi.id, x: origin.x, y: origin.y, elevation: 0 });
      await ctx.call("move-token", { tokenId: guerrier.id, x: origin.x + (gap + 1) * grid, y: origin.y, elevation: 0 });
      await pause(600);
      const { plan, move } = await npc("plan", { tokenId: zombi.id });
      ctx.expect(plan.reason === "outOfReach" && move?.type === "move" && move.target === guerrier.id && move.reachCells === 1 && !move.seeing,
        `à ${gap} cases : personne à portée, il ira au contact du Guerrier (${JSON.stringify(move).slice(0, 140)})`);
      const since = await ctx.lastMessageId();
      await ctx.startCombat([zombi, guerrier]);
      let traced = null;
      for ( let i = 0; i < 6 && !traced; i++ ) {
        const state = await ctx.combat();
        const combat = state.combat ?? state.combats?.[0] ?? state;
        const current = combat.combatants?.find(c => c.id === combat.currentCombatantId)?.tokenId;
        if ( current !== zombi.id ) { await ctx.nextTurn(); await pause(500); }
        for ( let w = 0; w < 30 && !traced; w++ ) {
          const messages = await ctx.call("list-chat-messages", { limit: 30, sinceId: since, flagScope: NPC }).catch(() => ({ messages: [] }));
          traced = (messages.messages ?? []).map(m => m.flags?.[NPC]?.trace).find(t => t?.token?.endsWith(zombi.id)) ?? null;
          if ( !traced ) await pause(1000);
        }
      }
      const z = await ctx.position(zombi), g = await ctx.position(guerrier);
      const apart = Math.max(Math.abs(z.x - g.x), Math.abs(z.y - g.y)) / grid - 1;
      if ( ctx.ownCombat ) await ctx.call("end-combat", { combatId: ctx.ownCombat }).catch(() => {});
      await pause(500);
      return { traced, apart };
    };

    // 1. À 3 cases : marche, puis attaque.
    const near = await turn(3);
    ctx.expect(!!near.traced, "carte de trace du pilote (3 cases)");
    if ( near.traced ) {
      const [move, attack] = near.traced.steps;
      ctx.expect(move?.type === "move" && !move.dashed && move.arrived, `s'approche en marchant et arrive (${JSON.stringify(move)?.slice(0, 120)})`);
      ctx.expect(attack?.type === "attack" && attack.target === "Guerrier", `puis attaque : ${attack ? `${attack.attack} — ${attack.outcome}` : near.traced.reason}`);
    }
    ctx.expect(near.apart === 0, `au contact après son tour (écart ${near.apart} case(s))`);

    // 2. À 7 cases : Sprint, contact, pas d'attaque.
    const far = await turn(7);
    ctx.expect(!!far.traced, "carte de trace du pilote (7 cases)");
    if ( far.traced ) {
      const [move] = far.traced.steps;
      ctx.expect(move?.type === "move" && move.dashed, `Sprinte (${JSON.stringify(move)?.slice(0, 120)})`);
      ctx.expect(!far.traced.steps.some(s => s.type === "attack"), "pas d'attaque : l'Action est partie dans le Sprint");
    }
    ctx.expect(far.apart === 0, `au contact après son Sprint (écart ${far.apart} case(s))`);
  }
};
