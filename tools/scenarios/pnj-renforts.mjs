/**
 * Étape 7 du SPEC §16, les renforts (§10.5) :
 *  1. Le Zombi piloté dans une **Réserve** (déclencheur : l'alarme, délai 1) est caché par le module dès la création de la région.
 *  2. En combat (Bandit contre Guerrier), l'alarme du groupe est donnée : un round plus tard, le Zombi est **révélé** et **rejoint le
 *     combat** avec son initiative ; la réserve est vidée (`once`).
 *  3. Une Réserve « le MJ les appelle » avec un acteur à créer (`spawn` 2) : « Faire venir » crée deux tokens dans la région, menés
 *     par l'IA, visibles ; la fiche de l'acteur n'est pas touchée.
 * Les autres tokens de l'arène sont cachés le temps du test. Remet : réglages, pilotes, groupes, régions, tokens créés, combats.
 */
const NPC = "darsh-npc";
const pause = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "pnj-renforts — une Réserve cachée arrive sur l'alarme et rejoint le combat ; une Réserve crée ses gardes",

  async run(ctx) {
    const npc = async (fn, args={}) => (await ctx.call("call-module-api", { moduleId: NPC, fn, args, waitMs: 8000 })).result;
    const { tokens, sceneId } = await ctx.scene();
    const KEEP = ["Zombi", "Guerrier", "Bandit"];
    if ( !KEEP.every(n => tokens.some(t => t.name === n)) ) { ctx.log(`${KEEP.join(", ")} : l'un manque, non applicable`); return; }
    const [zombi, guerrier, bandit] = await Promise.all(KEEP.map(n => ctx.token(n)));
    for ( const [key, value] of [["level", "combat"], ["aiEnabled", true], ["autoEngage", false], ["autoEndTurn", false], ["barkMode", "off"]] ) {
      const r = await npc("reglage", { key, value });
      ctx.restore(() => npc("reglage", { key, value: r.before }));
    }
    const grid = await ctx.gridSize();
    const setHidden = (t, hidden) => ctx.call("update-scene-object", { type: "Token", objectId: t.id, data: { hidden } });
    for ( const t of tokens.filter(t => !KEEP.includes(t.name)) ) {
      const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: t.id });
      if ( data.hidden ) continue;
      await setHidden(t, true);
      ctx.restore(() => setHidden(t, false));
    }
    ctx.restore(() => setHidden(zombi, false));
    ctx.restore(() => npc("alarme", { reset: true }));
    for ( const [t, mode] of [[zombi, "on"], [bandit, "off"]] ) {
      const before = await npc("pilote", { tokenId: t.id });
      ctx.restore(async () => {
        await npc("pilote", { tokenId: t.id, mode: before.mode });
        await npc("groupe", { tokenId: t.id, group: null });
        await npc("alerte", { tokenId: t.id, reset: true });
      });
      await npc("pilote", { tokenId: t.id, mode });
      await npc("groupe", { tokenId: t.id, group: "essai" });
    }
    const sceneInfo = await ctx.call("get-scene", {});
    const cx = Math.ceil((sceneInfo.width * sceneInfo.padding) / grid), cy = Math.ceil((sceneInfo.height * sceneInfo.padding) / grid);
    const put = (token, i, j) => ctx.call("move-token", { tokenId: token.id, x: (cx + i) * grid, y: (cy + j) * grid, elevation: 0 });
    const regions = [];
    ctx.restore(async () => { for ( const id of regions ) await ctx.call("delete-scene-object", { type: "Region", objectId: id }).catch(() => {}); });
    const reserve = async (name, i, j, w, h, system) => {
      const r = await ctx.call("create-region", { sceneId, name, color: "#3060c0",
        shapes: [{ type: "rectangle", x: (cx + i) * grid, y: (cy + j) * grid, width: w * grid, height: h * grid }],
        behaviors: [{ type: `${NPC}.reserve`, name, system }] });
      const id = r?.id ?? r?.regionId ?? r?.region?.id;
      regions.push(id);
      await pause(1200);
      return id;
    };
    const hiddenOf = async t => (await ctx.call("get-scene-object", { type: "Token", objectId: t.id })).data?.hidden === true;

    // 1. La réserve cache le Zombi.
    await put(zombi, 20, 2);
    await put(bandit, 4, 4);
    await put(guerrier, 5, 4);
    await setHidden(zombi, false);
    await pause(500);
    const north = await reserve("Porte nord (essai)", 19, 1, 3, 3, { trigger: "alarm", delay: 1, once: true, label: "porte nord" });
    let hid = false;
    for ( let s = 0; (s < 8) && !hid; s++ ) { await pause(500); hid = await hiddenOf(zombi); }
    ctx.expect(hid, "le Zombi de la réserve est caché");
    const st = await npc("reserve", { regionId: north });
    ctx.expect(st.members.includes("Zombi"), `il est membre de la réserve (${st.members.join(", ")})`);

    // 2. En combat, l'alarme : un round plus tard, il arrive.
    await ctx.startCombat([bandit, guerrier]);
    await pause(800);
    const alarm = await npc("alarme", { tokenId: bandit.id });
    ctx.expect(alarm?.reserves?.length === 1, `l'alarme met la réserve en route (${JSON.stringify(alarm?.reserves)})`);
    const waiting = await npc("reserve", { regionId: north });
    ctx.expect(!!waiting.pending?.round, `elle arrive en combat au round ${waiting.pending?.round}`);
    let arrived = false;
    for ( let n = 0; (n < 8) && !arrived; n++ ) {
      await ctx.nextTurn();
      await pause(1500);
      arrived = !(await hiddenOf(zombi));
    }
    ctx.expect(arrived, "le Zombi est révélé");
    let joined = null;
    for ( let w = 0; (w < 10) && !joined; w++ ) {
      const state = await ctx.combat();
      const combat = state.combat ?? state.combats?.[0] ?? state;
      joined = combat.combatants?.find(c => c.tokenId === zombi.id) ?? null;
      if ( !joined ) await pause(500);
    }
    ctx.expect(!!joined, "il rejoint le combat");
    ctx.expect(Number.isFinite(joined?.initiative), `avec son initiative (${joined?.initiative})`);
    const done = await npc("reserve", { regionId: north });
    ctx.expect(done.state?.fired && !done.left, "la réserve est vidée (une seule fois)");
    if ( ctx.ownCombat ) await ctx.call("end-combat", { combatId: ctx.ownCombat }).catch(() => {});
    await pause(800);

    // 3. Une réserve qui crée ses gardes depuis un acteur.
    await setHidden(zombi, true);
    const before = new Set(((await ctx.call("list-scene-objects", { types: ["Token"] })).objects?.Token ?? []).map(t => t.id));
    ctx.restore(async () => {
      const now = (await ctx.call("list-scene-objects", { types: ["Token"] })).objects?.Token ?? [];
      for ( const t of now.filter(t => !before.has(t.id)) ) await ctx.call("delete-scene-object", { type: "Token", objectId: t.id }).catch(() => {});
    });
    const barracks = await reserve("Caserne (essai)", 10, 10, 4, 4, { trigger: "manual", delay: 0, actor: `Actor.${zombi.actorId}`, spawn: 2, label: "caserne" });
    const called = await npc("reserve", { regionId: barracks, action: "appeler", now: true });
    ctx.expect(called.scheduled, "« Faire venir » : la caserne envoie ses gardes");
    let fresh = [];
    for ( let w = 0; (w < 10) && (fresh.length < 2); w++ ) {
      await pause(600);
      fresh = ((await ctx.call("list-scene-objects", { types: ["Token"] })).objects?.Token ?? []).filter(t => !before.has(t.id));
    }
    ctx.expect(fresh.length === 2, `deux tokens créés (${fresh.map(t => t.name).join(", ")})`);
    for ( const t of fresh ) {
      const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: t.id });
      const inside = (data.x >= (cx + 10) * grid) && (data.x < (cx + 14) * grid) && (data.y >= (cy + 10) * grid) && (data.y < (cy + 14) * grid);
      ctx.expect(inside && !data.hidden, `${t.name} : dans la caserne, visible (case ${Math.round(data.x / grid) - cx}, ${Math.round(data.y / grid) - cy}, caché : ${data.hidden})`);
      ctx.expect(data.flags?.[NPC]?.autopilot === "on", `${t.name} : mené par l'IA`);
    }
  }
};
