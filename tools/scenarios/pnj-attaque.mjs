/**
 * Étape 2 du SPEC §16 : le Zombi piloté attaque le Guerrier qui est au contact, à son tour, puis le tour passe tout seul.
 *  - jamais un PJ : le pilote refuse le Guerrier ;
 *  - l'intention (sans rien jouer) vise le Guerrier, au contact ;
 *  - en combat, au tour du Zombi : une attaque jouée par le moteur, une carte de trace privée au MJ, le tour suivant.
 * Remet : niveau du module, pilote du Zombi, positions et PV (filet du lanceur), combat.
 */
const NPC = "darsh-npc";
const pause = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "pnj-attaque — le Zombi piloté attaque le Guerrier au contact, puis finit son tour",

  async run(ctx) {
    const npc = async (fn, args={}) => (await ctx.call("call-module-api", { moduleId: NPC, fn, args, waitMs: 8000 })).result;
    const { tokens } = await ctx.scene();
    if ( !["Zombi", "Guerrier"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Zombi ou Guerrier absent : non applicable"); return; }
    const zombi = await ctx.token("Zombi");
    const guerrier = await ctx.token("Guerrier");

    const level = await npc("reglage", { key: "level", value: "combat" });
    ctx.restore(() => npc("reglage", { key: "level", value: level.before }));
    const ai = await npc("reglage", { key: "aiEnabled", value: true });
    ctx.restore(() => npc("reglage", { key: "aiEnabled", value: ai.before }));
    const auto = await npc("reglage", { key: "autoEngage", value: false });
    ctx.restore(() => npc("reglage", { key: "autoEngage", value: auto.before }));
    const end = await npc("reglage", { key: "autoEndTurn", value: true });
    ctx.restore(() => npc("reglage", { key: "autoEndTurn", value: end.before }));
    const before = await npc("pilote", { tokenId: zombi.id });
    ctx.restore(() => npc("pilote", { tokenId: zombi.id, mode: before.mode }));
    const hpZ = await ctx.hp(zombi), hpG = await ctx.hp(guerrier);
    ctx.restore(() => ctx.setHp(zombi, hpZ));
    ctx.restore(() => ctx.setHp(guerrier, hpG));
    await ctx.setHp(zombi, 100);
    await ctx.setHp(guerrier, 100);

    // Au contact : le Guerrier juste à droite du Zombi.
    const z = await ctx.position(zombi);
    const grid = await ctx.gridSize();
    await ctx.call("move-token", { tokenId: guerrier.id, x: z.x + grid, y: z.y, elevation: z.elevation });
    await pause(600);

    // Jamais un PJ.
    const refused = await ctx.call("call-module-api", { moduleId: NPC, fn: "pilote", args: { tokenId: guerrier.id, mode: "on" }, waitMs: 8000 }).catch(err => ({ error: err.message }));
    ctx.expect(!!refused.error || refused.settled === false || /jamais|never/i.test(JSON.stringify(refused)), `le pilote refuse le Guerrier (PJ) (${JSON.stringify(refused).slice(0, 160)})`);

    // L'intention, sans rien jouer.
    await npc("pilote", { tokenId: zombi.id, mode: "on" });
    const { plan } = await npc("plan", { tokenId: zombi.id });
    ctx.expect(plan.type === "attack" && plan.target === guerrier.id, `intention : ${plan.type === "attack" ? `${plan.attack.name} sur le Guerrier (${plan.mode})` : plan.reason}`);

    // En combat : le tour du Zombi se joue seul.
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
    ctx.expect(!!traced, "carte de trace du pilote laissée au MJ");
    if ( !traced ) return;
    ctx.expect(traced.steps.length >= 1 && traced.steps[0].target === "Guerrier", `attaque jouée : ${traced.steps.map(s => `${s.attack} sur ${s.target} — ${s.outcome}`).join(" ; ") || traced.reason}`);
    await pause(2500);
    const state = await ctx.combat();
    const combat = state.combat ?? state.combats?.[0] ?? state;
    const current = combat.combatants?.find(c => c.id === combat.currentCombatantId)?.tokenId;
    ctx.expect(current !== zombi.id, "le tour est passé tout seul");
  }
};
