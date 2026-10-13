/**
 * Étape 4 du SPEC §16, le moral (§9.5) :
 *  1. Le Zombi (sans pensée) à 5 PV n'est pas soumis au moral : il attaque le Guerrier au contact.
 *  2. Un Bandit d'essai (copie du Bandit de l'arène, lâche : Désavantage) à un tiers de ses PV, le Guerrier au contact : test de
 *     moral ; à l'échec (le test est rejoué, nouveau combat, jusqu'à l'échec), il fuit — plus loin du Guerrier qu'avant, état
 *     « fuit ».
 *  3. Acculé dans un coin de la scène par le Guerrier, le Roublard et le Clerc : à l'échec, il se rend — disposition Neutre, état
 *     « rendu », ce qu'il tient lâché (Butin et commerce en fait un tas).
 *  4. Le Guerrier attaque le Bandit rendu (Q4) : il reprend sa disposition Hostile et redevient fuyard, sans nouveau test.
 * Les autres tokens de l'arène sont cachés le temps du test. Remet : réglages, pilote, positions, PV, tokens cachés, combats ; le
 * Bandit d'essai et les tas créés sont retirés.
 */
const NPC = "darsh-npc";
const pause = ms => new Promise(r => setTimeout(r, ms));
const BANDIT = "Bandit (moral, essai)";

export default {
  name: "pnj-moral — le Zombi ne flanche pas ; le Bandit fuit, se rend acculé, reprend le combat attaqué",

  async run(ctx) {
    const npc = async (fn, args={}) => (await ctx.call("call-module-api", { moduleId: NPC, fn, args, waitMs: 8000 })).result;
    const { tokens } = await ctx.scene();
    const KEEP = ["Zombi", "Guerrier", "Roublard", "Clerc", "Bandit"];
    if ( !KEEP.every(n => tokens.some(t => t.name === n)) ) { ctx.log(`${KEEP.join(", ")} : l'un manque, non applicable`); return; }
    const zombi = await ctx.token("Zombi");
    const guerrier = await ctx.token("Guerrier");
    const roublard = await ctx.token("Roublard");
    const clerc = await ctx.token("Clerc");
    const banditModel = tokens.find(t => t.name === "Bandit");
    for ( const [key, value] of [["level", "combat"], ["aiEnabled", true], ["autoEngage", false], ["autoEndTurn", true], ["morale", true], ["confirmDelay", 0]] ) {
      const r = await npc("reglage", { key, value });
      ctx.restore(() => npc("reglage", { key, value: r.before }));
    }
    const grid = await ctx.gridSize();
    // Seuls les tokens du test restent visibles.
    for ( const t of tokens.filter(t => !["Zombi", "Guerrier", "Roublard", "Clerc"].includes(t.name)) ) {
      const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: t.id });
      if ( data.hidden ) continue;
      await ctx.call("update-scene-object", { type: "Token", objectId: t.id, data: { hidden: true } });
      ctx.restore(() => ctx.call("update-scene-object", { type: "Token", objectId: t.id, data: { hidden: false } }));
    }
    const sceneInfo = await ctx.call("get-scene", {});
    const cx = Math.ceil((sceneInfo.width * sceneInfo.padding) / grid), cy = Math.ceil((sceneInfo.height * sceneInfo.padding) / grid);
    const put = (token, i, j) => ctx.call("move-token", { tokenId: token.id, x: (cx + i) * grid, y: (cy + j) * grid, elevation: 0 });
    for ( const t of [zombi, guerrier, roublard, clerc] ) { const hp = await ctx.hp(t); ctx.restore(() => ctx.setHp(t, hp)); }
    // Les PJ loin du coin tant qu'ils ne servent pas.
    await put(roublard, 20, 20);
    await put(clerc, 21, 20);

    // Les tas que le Bandit lâchera : relevés et retirés à la fin.
    const KINDS = ["Region", "Tile"];
    const objects = async () => (await ctx.call("list-scene-objects", { types: KINDS })).objects ?? {};
    const before = await objects();
    const known = Object.fromEntries(KINDS.map(k => [k, new Set((before[k] ?? []).map(o => o.id))]));
    ctx.restore(async () => {
      const now = await objects();
      for ( const kind of KINDS ) {
        for ( const o of (now[kind] ?? []).filter(o => !known[kind].has(o.id)) ) await ctx.call("delete-scene-object", { type: kind, objectId: o.id }).catch(() => {});
      }
    });

    /** Un combat de ces tokens, jusqu'à la carte de trace du token piloté ; rend la trace. Le combat est retiré. */
    const turnOf = async (token, others) => {
      const since = await ctx.lastMessageId();
      await ctx.startCombat([token, ...others]);
      let traced = null;
      for ( let i = 0; (i < 6) && !traced; i++ ) {
        const state = await ctx.combat();
        const combat = state.combat ?? state.combats?.[0] ?? state;
        if ( combat.combatants?.find(c => c.id === combat.currentCombatantId)?.tokenId !== token.id ) { await ctx.nextTurn(); await pause(500); }
        for ( let w = 0; (w < 40) && !traced; w++ ) {
          const messages = await ctx.call("list-chat-messages", { limit: 30, sinceId: since, flagScope: NPC }).catch(() => ({ messages: [] }));
          traced = (messages.messages ?? []).map(m => m.flags?.[NPC]?.trace).find(t => t?.token?.endsWith(token.id)) ?? null;
          if ( !traced ) await pause(1000);
        }
      }
      return traced;
    };
    const endCombat = async () => { if ( ctx.ownCombat ) await ctx.call("end-combat", { combatId: ctx.ownCombat }).catch(() => {}); await pause(800); };
    const gap = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) / grid - 1;

    // 1. Le Zombi, sans pensée.
    const zPilot = await npc("pilote", { tokenId: zombi.id });
    ctx.restore(() => npc("pilote", { tokenId: zombi.id, mode: zPilot.mode }));
    await npc("pilote", { tokenId: zombi.id, mode: "on" });
    await put(zombi, 2, 2);
    await put(guerrier, 3, 2);
    await ctx.setHp(zombi, 5);
    await ctx.setHp(guerrier, 200);
    await npc("moral", { tokenId: zombi.id, reset: true });
    await pause(600);
    const zTrace = await turnOf(zombi, [guerrier]);
    ctx.expect(!!zTrace, "Zombi : carte de trace");
    ctx.expect(zTrace && !zTrace.steps.some(s => s.type === "morale"), "Zombi : pas de test de moral (sans pensée)");
    ctx.expect(zTrace?.steps.some(s => s.type === "attack"), `Zombi : il attaque (${zTrace?.reason})`);
    await endCombat();
    await npc("pilote", { tokenId: zombi.id, mode: zPilot.mode });
    await put(zombi, 20, 22);

    // 2. Un Bandit d'essai, lié, marqué pour être retiré par Butin et commerce.
    const model = await ctx.call("get-actor", { actorId: banditModel.actorId });
    const { id, folderId, ...data } = model;
    const items = (data.items ?? []).map(({ _id, ...rest }) => rest);
    const created = await ctx.call("create-actor", { actorData: { ...data, items, name: BANDIT,
      prototypeToken: { actorLink: true, name: BANDIT, disposition: -1 }, flags: { ...(data.flags ?? {}), "darsh-loot": { test: true } } } });
    const actorId = created?.id ?? created?.actor?.id;
    ctx.restore(async () => { await ctx.call("call-module-api", { moduleId: "darsh-loot", fn: "removeTestActors", args: {} }).catch(err => ctx.log(`Bandit d'essai non retiré : ${err.message}`)); });
    await ctx.call("place-token", { actorId, x: (cx + 8) * grid, y: (cy + 2) * grid });
    await pause(1000);
    const bt = ((await ctx.call("list-scene-objects", { types: ["Token"] })).objects?.Token ?? []).find(t => t.name === BANDIT);
    const bandit = { id: bt.id, actorId, name: BANDIT };
    await npc("pilote", { tokenId: bandit.id, mode: "on" });

    // Le test rejoué jusqu'à un échec (lâche : Désavantage, ~70 % d'échec par essai).
    const untilBroken = async (setup, check) => {
      for ( let n = 1; n <= 6; n++ ) {
        await setup();
        await npc("moral", { tokenId: bandit.id, reset: true });
        await ctx.setHp(bandit, 3);
        await pause(600);
        const traced = await turnOf(bandit, [guerrier, roublard, clerc]);
        const test = traced?.steps.find(s => s.type === "morale");
        ctx.log(`essai ${n} : ${test ? `moral ${test.total} contre DD ${test.dc} — ${test.success ? "tient" : "cède"}` : "pas de test"} ; fin : ${traced?.reason}`);
        if ( test && !test.success ) return check(traced);
        if ( test?.success ) ctx.expect(traced.steps.some(s => s.type === "attack") || traced.reason !== "fleeing", `essai ${n} : le moral tient, il se bat`);
        await endCombat();
      }
      ctx.expect(false, "aucun échec de moral en six essais");
      return null;
    };

    await untilBroken(async () => {
      await put({ id: bandit.id }, 8, 2);
      await put(guerrier, 9, 2);
      await put(roublard, 20, 20);
      await put(clerc, 21, 20);
    }, async traced => {
      const flee = traced.steps.find(s => s.type === "flee");
      ctx.expect(!!flee, `il fuit (${JSON.stringify(flee)})`);
      const b = await ctx.position({ id: bandit.id }), g = await ctx.position(guerrier);
      ctx.expect(gap(b, g) > 0, `plus au contact du Guerrier (${gap(b, g)} case(s))`);
      const state = await npc("moral", { tokenId: bandit.id });
      ctx.expect(state.state === "fleeing", `état « ${state.state} »`);
      await endCombat();
    });

    // 3. Acculé dans le coin : il se rend.
    await untilBroken(async () => {
      await put({ id: bandit.id }, 0, 0);
      await put(guerrier, 1, 0);
      await put(roublard, 0, 1);
      await put(clerc, 1, 1);
    }, async traced => {
      const gave = traced.steps.find(s => s.type === "surrender");
      ctx.expect(!!gave, `il se rend (${JSON.stringify(gave)}) ; fin : ${traced.reason}`);
      const state = await npc("moral", { tokenId: bandit.id });
      ctx.expect(state.state === "surrendered" && state.disposition === 0, `rendu, Neutre (${state.state}, disposition ${state.disposition})`);
      // 4. Attaqué alors qu'il s'est rendu (combat fini : l'attaque du Guerrier hors de son tour ne demande rien) : il reprend sa
      // disposition et fuit s'il le peut.
      await endCombat();
      const kept = await npc("moral", { tokenId: bandit.id });
      ctx.expect(kept.state === "surrendered", `le combat fini, il reste rendu (${kept.state})`);
      await ctx.setHp(bandit, 100);
      const used = await ctx.use({ tokenId: guerrier.id, identifier: "greatsword", activityType: "attack", targetTokenIds: [bandit.id] })
        .catch(() => null) ?? await ctx.use({ tokenId: guerrier.id, activityType: "attack", targetTokenIds: [bandit.id] });
      if ( used?.usageMessageId ) await ctx.settle(used.usageMessageId).catch(() => null);
      await pause(1500);
      const after = await npc("moral", { tokenId: bandit.id });
      ctx.expect(after.state === "fleeing" && after.fromSurrender && after.disposition === -1, `attaqué : ${after.state}, disposition ${after.disposition}`);
    });
  }
};
