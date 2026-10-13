/**
 * Étape 4 du SPEC §16 : le mode « confirmer » (§12.2), la reprise de main (§12.3), l'arrêt (§13). Le Zombi piloté en `confirm`, le
 * Guerrier au contact, le Roublard à deux cases :
 *  1. La carte montre l'intention (le Guerrier, au contact) et un bouton par ennemi ; le MJ choisit le Roublard : le Zombi va vers lui
 *     et l'attaque.
 *  2. « Je joue » : rien n'est joué, le tour reste au MJ (pas de fin de tour automatique).
 *  3. Pendant que la carte attend, le MJ déplace le Zombi : le pilote se retire (la carte est tranchée « Le MJ joue »).
 *  4. Pendant que la carte attend, l'IA est coupée (bouton ou Ctrl+Alt+N) : la carte est tranchée, rien n'est joué.
 * Les autres tokens de l'arène cachés le temps du test. Remet : réglages, pilote, positions, PV, tokens cachés, combats.
 */
const NPC = "darsh-npc";
const pause = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "pnj-confirmer — carte d'intention, autre cible, « Je joue », reprise de main, arrêt",

  async run(ctx) {
    const npc = async (fn, args={}) => (await ctx.call("call-module-api", { moduleId: NPC, fn, args, waitMs: 8000 })).result;
    const { tokens } = await ctx.scene();
    if ( !["Zombi", "Guerrier", "Roublard"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Zombi, Guerrier ou Roublard absent : non applicable"); return; }
    const zombi = await ctx.token("Zombi");
    const guerrier = await ctx.token("Guerrier");
    const roublard = await ctx.token("Roublard");
    for ( const [key, value] of [["level", "combat"], ["aiEnabled", true], ["autoEngage", false], ["autoEndTurn", true], ["confirmDelay", 0]] ) {
      const r = await npc("reglage", { key, value });
      ctx.restore(() => npc("reglage", { key, value: r.before }));
    }
    const before = await npc("pilote", { tokenId: zombi.id });
    ctx.restore(() => npc("pilote", { tokenId: zombi.id, mode: before.mode }));
    for ( const t of [zombi, guerrier, roublard] ) { const hp = await ctx.hp(t); ctx.restore(() => ctx.setHp(t, hp)); await ctx.setHp(t, 100); }
    const grid = await ctx.gridSize();
    for ( const t of tokens.filter(t => ![zombi.id, guerrier.id, roublard.id].includes(t.id)) ) {
      const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: t.id });
      if ( data.hidden ) continue;
      await ctx.call("update-scene-object", { type: "Token", objectId: t.id, data: { hidden: true } });
      ctx.restore(() => ctx.call("update-scene-object", { type: "Token", objectId: t.id, data: { hidden: false } }));
    }
    const sceneInfo = await ctx.call("get-scene", {});
    const cx = Math.ceil((sceneInfo.width * sceneInfo.padding) / grid), cy = Math.ceil((sceneInfo.height * sceneInfo.padding) / grid);
    const put = (token, i, j) => ctx.call("move-token", { tokenId: token.id, x: (cx + i) * grid, y: (cy + j) * grid, elevation: 0 });
    await npc("pilote", { tokenId: zombi.id, mode: "confirm" });

    const messages = async since => (await ctx.call("list-chat-messages", { limit: 30, sinceId: since, flagScope: NPC }).catch(() => ({ messages: [] }))).messages ?? [];
    const flagged = async (since, key) => (await messages(since)).filter(m => m.flags?.[NPC]?.[key]?.token?.endsWith(zombi.id));
    /** Un combat jusqu'à la carte de confirmation du Zombi ; rend `{ since, card }`. */
    const toCard = async () => {
      await put(zombi, 3, 3);
      await put(guerrier, 4, 3);
      await put(roublard, 3, 6);
      await pause(600);
      const since = await ctx.lastMessageId();
      await ctx.startCombat([zombi, guerrier, roublard]);
      let card = null;
      for ( let i = 0; (i < 6) && !card; i++ ) {
        const state = await ctx.combat();
        const combat = state.combat ?? state.combats?.[0] ?? state;
        if ( combat.combatants?.find(c => c.id === combat.currentCombatantId)?.tokenId !== zombi.id ) { await ctx.nextTurn(); await pause(500); }
        for ( let w = 0; (w < 15) && !card; w++ ) { card = (await flagged(since, "confirm"))[0] ?? null; if ( !card ) await pause(700); }
      }
      return { since, card };
    };
    const current = async () => {
      const state = await ctx.combat();
      const combat = state.combat ?? state.combats?.[0] ?? state;
      return combat.combatants?.find(c => c.id === combat.currentCombatantId)?.tokenId ?? null;
    };
    const endCombat = async () => { if ( ctx.ownCombat ) await ctx.call("end-combat", { combatId: ctx.ownCombat }).catch(() => {}); await pause(800); };
    const cardNow = async (since, id) => (await messages(since)).find(m => m.id === id);

    // 1. Autre cible.
    let { since, card } = await toCard();
    ctx.expect(!!card, "carte de confirmation au MJ");
    if ( !card ) return;
    // Le connecteur rend le texte de la carte, sans balises : l'intention, puis les boutons (un par ennemi perçu).
    ctx.expect(/Guerrier/.test(card.text ?? "") && /Roublard/.test(card.text ?? ""), `l'intention vise le Guerrier ; un bouton pour le Roublard (${card.text})`);
    await npc("confirmer", { messageId: card.id, choice: "play", target: roublard.id });
    let traced = null;
    for ( let w = 0; (w < 40) && !traced; w++ ) { traced = (await flagged(since, "trace"))[0]?.flags?.[NPC]?.trace ?? null; if ( !traced ) await pause(1000); }
    ctx.expect(traced?.steps.some(s => (s.type === "attack") && (s.target === "Roublard")),
      `le Zombi attaque le Roublard : ${traced?.steps.map(s => (s.type === "attack") ? `${s.attack} sur ${s.target}` : s.type).join(" ; ")}`);
    await endCombat();

    // 2. « Je joue ».
    ({ since, card } = await toCard());
    await npc("confirmer", { messageId: card.id, choice: "manual" });
    await pause(3000);
    ctx.expect(!(await flagged(since, "trace")).length, "« Je joue » : aucune trace, rien de joué");
    ctx.expect((await current()) === zombi.id, "le tour reste au Zombi (au MJ)");
    await endCombat();

    // 3. Reprise de main : le MJ déplace le Zombi pendant que la carte attend.
    ({ since, card } = await toCard());
    await ctx.call("move-token", { tokenId: zombi.id, x: (cx + 3) * grid, y: (cy + 4) * grid, elevation: 0 });
    await pause(2500);
    ctx.expect(!/Roublard/.test((await cardNow(since, card.id))?.text ?? "Roublard"), "la carte est tranchée par le geste du MJ");
    ctx.expect(!(await flagged(since, "trace")).length && ((await current()) === zombi.id), "rien de joué, le tour reste au MJ");
    await endCombat();

    // 4. L'IA coupée pendant que la carte attend.
    ({ since, card } = await toCard());
    await npc("reglage", { key: "aiEnabled", value: false });
    await pause(2500);
    ctx.expect(!/Roublard/.test((await cardNow(since, card.id))?.text ?? "Roublard"), "IA coupée : la carte est tranchée");
    ctx.expect(!(await flagged(since, "trace")).length, "IA coupée : rien de joué");
    await npc("reglage", { key: "aiEnabled", value: true });
    await endCombat();
  }
};
