/**
 * Étape 7 du SPEC §16, les drapeaux (§10.2) :
 *  1. **Interdit** : le comportement pose `avoid` du moteur sur sa région (retiré avec lui) ; le Zombi qui va voir un bruit de l'autre
 *     côté contourne la bande interdite au lieu de la traverser.
 *  2. **Alarme** : le Bandit, dans la région Alarme, voit le Guerrier : il donne l'alerte ; le Mage, au bout de la scène et aveuglé (il
 *     ne voit rien par lui-même), passe en alerte et marche vers la dernière position connue.
 *  3. **Refuge** (sortie) : en combat, le Bandit fuyard (moral cassé) court au refuge et quitte la scène — token caché, pas supprimé.
 *  4. **Poste de tir** : en combat, le Mage piloté gagne le poste de tir d'où il voit le Guerrier, puis tire.
 * Les autres tokens de l'arène sont cachés le temps du test. Remet : réglages, pilotes, groupes, états, régions, positions, tokens cachés.
 */
const NPC = "darsh-npc";
const pause = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "pnj-drapeaux — Interdit contourné, Alarme donnée au groupe, Refuge-sortie, Poste de tir",

  async run(ctx) {
    const npc = async (fn, args={}) => (await ctx.call("call-module-api", { moduleId: NPC, fn, args, waitMs: 8000 })).result;
    const { tokens, sceneId } = await ctx.scene();
    const KEEP = ["Zombi", "Guerrier", "Bandit", "Mage"];
    if ( !KEEP.every(n => tokens.some(t => t.name === n)) ) { ctx.log(`${KEEP.join(", ")} : l'un manque, non applicable`); return; }
    const [zombi, guerrier, bandit, mage] = await Promise.all(KEEP.map(n => ctx.token(n)));
    for ( const [key, value] of [["level", "combat"], ["aiEnabled", true], ["autoEngage", false], ["autoEndTurn", true], ["morale", true],
      ["barkMode", "off"], ["scanDefault", "none"], ["confirmDelay", 0]] ) {
      const r = await npc("reglage", { key, value });
      ctx.restore(() => npc("reglage", { key, value: r.before }));
    }
    ctx.restore(() => ctx.removeStatusEffects(mage, "blinded"));
    // Tout le monde caché d'abord : allumée, l'IA verrait le Guerrier avant que le test commence (une alerte gardée en mémoire).
    const hideKeep = hidden => Promise.all(KEEP.map(n => ctx.call("update-scene-object", { type: "Token", objectId: tokens.find(t => t.name === n).id, data: { hidden } })));
    ctx.restore(() => hideKeep(false));
    await hideKeep(true);
    ctx.restore(() => npc("alarme", { reset: true }));
    for ( const t of [zombi, bandit, mage] ) {
      const before = await npc("pilote", { tokenId: t.id });
      ctx.restore(async () => {
        await npc("pilote", { tokenId: t.id, mode: before.mode });
        await npc("groupe", { tokenId: t.id, group: null });
        await npc("alerte", { tokenId: t.id, reset: true });
        await npc("moral", { tokenId: t.id, reset: true });
      });
      await npc("pilote", { tokenId: t.id, mode: "on" });
      await npc("groupe", { tokenId: t.id, group: "essai" });
      await npc("alerte", { tokenId: t.id, reset: true });
    }
    const grid = await ctx.gridSize();
    const setHidden = (t, hidden) => ctx.call("update-scene-object", { type: "Token", objectId: t.id, data: { hidden } });
    for ( const t of tokens.filter(t => !KEEP.includes(t.name)) ) {
      const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: t.id });
      if ( data.hidden ) continue;
      await setHidden(t, true);
      ctx.restore(() => setHidden(t, false));
    }
    // Ceux qui ne servent pas à une partie sont cachés (une créature cachée n'existe pour aucune règle de l'IA).
    for ( const t of [zombi, bandit, mage, guerrier] ) ctx.restore(() => setHidden(t, false));
    const only = async (...shown) => { for ( const t of [zombi, bandit, mage, guerrier] ) await setHidden(t, !shown.includes(t)); await pause(400); };
    const sceneInfo = await ctx.call("get-scene", {});
    const cx = Math.ceil((sceneInfo.width * sceneInfo.padding) / grid), cy = Math.ceil((sceneInfo.height * sceneInfo.padding) / grid);
    const at = (i, j) => ({ x: (cx + i + 0.5) * grid, y: (cy + j + 0.5) * grid });
    const put = (token, i, j) => ctx.call("move-token", { tokenId: token.id, x: (cx + i) * grid, y: (cy + j) * grid, elevation: 0 });
    const cellOf = async token => { const p = await ctx.position(token); return { i: Math.round(p.x / grid) - cx, j: Math.round(p.y / grid) - cy }; };
    const regions = [];
    ctx.restore(async () => { for ( const id of regions ) await ctx.call("delete-scene-object", { type: "Region", objectId: id }).catch(() => {}); });
    const region = async (name, i, j, w, h, system) => {
      const r = await ctx.call("create-region", { sceneId, name, color: "#c03030",
        shapes: [{ type: "rectangle", x: (cx + i) * grid, y: (cy + j) * grid, width: w * grid, height: h * grid }],
        behaviors: [{ type: `${NPC}.flag`, name, system }] });
      const id = r?.id ?? r?.regionId ?? r?.region?.id;
      regions.push(id);
      await pause(800);
      return id;
    };
    const drop = async id => { await ctx.call("delete-scene-object", { type: "Region", objectId: id }); regions.splice(regions.indexOf(id), 1); await pause(600); };
    await only(zombi);

    // 1. Interdit : une bande de 4 × 5 cases entre le Zombi et le bruit.
    await npc("reglage", { key: "level", value: "patrols" });
    const band = await region("Interdit (essai)", 5, 8, 4, 5, { kind: "forbidden" });
    const flags = await npc("drapeaux");
    ctx.expect(flags.find(f => f.id === band)?.avoid === true, "Interdit : le moteur évite la région (avoid posé)");
    await put(zombi, 1, 10);
    await npc("alerte", { tokenId: zombi.id, reset: true });
    await pause(500);
    const noise = at(13, 10);
    await npc("doute", { tokenId: zombi.id, ...noise });
    let crossed = false, arrivedNear = false;
    for ( let s = 0; (s < 80) && !arrivedNear; s++ ) {
      await pause(400);
      const c = await cellOf(zombi);
      if ( (c.i >= 5) && (c.i <= 8) && (c.j >= 8) && (c.j <= 12) ) crossed = true;
      arrivedNear = (Math.abs(c.i - 13) <= 1) && (Math.abs(c.j - 10) <= 1);
    }
    ctx.expect(arrivedNear, "le Zombi arrive au bruit");
    ctx.expect(!crossed, "sans traverser la bande interdite");
    await drop(band);
    const after = await npc("drapeaux");
    ctx.expect(!after.some(f => f.id === band), "le drapeau retiré, sa région aussi");
    await npc("alerte", { tokenId: zombi.id, reset: true });

    // 2. Alarme : le Bandit dans la région, le Mage loin et aveuglé.
    await npc("alerte", { tokenId: bandit.id, reset: true });
    await npc("alerte", { tokenId: mage.id, reset: true });
    await npc("alarme", { reset: true });
    await put(bandit, 2, 2);
    await put(mage, 24, 14);
    await ctx.call("set-status", { tokenId: mage.id, statusId: "blinded", active: true });
    const alarm = await region("Alarme (essai)", 1, 1, 4, 4, { kind: "alarm" });
    await only(bandit, mage);
    await pause(1500);
    const mageStart = await cellOf(mage);
    await put(guerrier, 7, 2);
    await only(bandit, mage, guerrier);
    let banditAlert = false, mageAlert = false;
    const mageSeen = [];
    for ( let s = 0; (s < 40) && !(banditAlert && mageAlert); s++ ) {
      await pause(400);
      banditAlert ||= (await npc("alerte", { tokenId: bandit.id })).state === "alert";
      const st = (await npc("alerte", { tokenId: mage.id })).state;
      if ( mageSeen.at(-1) !== st ) mageSeen.push(st);
      mageAlert ||= ["alert", "searching"].includes(st);
    }
    ctx.expect(banditAlert, "le Bandit voit le Guerrier : alerte");
    ctx.expect(mageAlert, `l'alarme : le Mage aveuglé passe en alerte (${mageSeen.join(" → ")})`);
    if ( !mageAlert ) ctx.log(`mémoire du Mage : ${JSON.stringify((await npc("alerte", { tokenId: mage.id })).memory)}`);
    let closer = 0;
    const track = [];
    for ( let s = 0; (s < 12) && (closer < 3); s++ ) {
      await pause(1000);
      const c = await cellOf(mage);
      const st = (await npc("alerte", { tokenId: mage.id })).state;
      track.push(`${c.i},${c.j} ${st}`);
      closer = Math.max(Math.abs(mageStart.i - 7), Math.abs(mageStart.j - 2)) - Math.max(Math.abs(c.i - 7), Math.abs(c.j - 2));
    }
    ctx.expect(closer >= 3, `et marche vers la dernière position connue (${closer} case(s) de gagnées ; ${track.join(" | ")})`);
    await ctx.removeStatusEffects(mage, "blinded");
    await drop(alarm);
    for ( const t of [bandit, mage] ) await npc("alerte", { tokenId: t.id, reset: true });
    await npc("reglage", { key: "level", value: "combat" });

    // 3. Refuge-sortie : le Bandit fuyard.
    await only(bandit, guerrier);
    const refuge = await region("Refuge (essai)", 13, 1, 4, 3, { kind: "refuge", exit: true });
    await put(bandit, 8, 2);
    await put(guerrier, 9, 2);
    await pause(600);
    const traceOf = async (token, since) => {
      for ( let w = 0; w < 40; w++ ) {
        const messages = await ctx.call("list-chat-messages", { limit: 30, sinceId: since, flagScope: NPC }).catch(() => ({ messages: [] }));
        const traced = (messages.messages ?? []).map(m => m.flags?.[NPC]?.trace).find(t => t?.token?.endsWith(token.id));
        if ( traced ) return traced;
        await pause(1000);
      }
      return null;
    };
    const turnOf = async (token, others, before=null) => {
      const since = await ctx.lastMessageId();
      await ctx.startCombat([token, ...others]);
      await pause(600);
      if ( before ) await before();
      for ( let i = 0; i < 6; i++ ) {
        const state = await ctx.combat();
        const combat = state.combat ?? state.combats?.[0] ?? state;
        if ( combat.combatants?.find(c => c.id === combat.currentCombatantId)?.tokenId === token.id ) break;
        await ctx.nextTurn();
        await pause(500);
      }
      return traceOf(token, since);
    };
    const endCombat = async () => { if ( ctx.ownCombat ) await ctx.call("end-combat", { combatId: ctx.ownCombat }).catch(() => {}); await pause(800); };
    const fled = await turnOf(bandit, [guerrier], () => npc("moral", { tokenId: bandit.id, state: "fleeing" }));
    const step = fled?.steps?.find(s => s.type === "flee");
    ctx.expect(step?.goal === "refuge", `il fuit vers le refuge (${JSON.stringify(step)})`);
    ctx.expect(step?.event === "exit", "et quitte la scène");
    const { data: bData } = await ctx.call("get-scene-object", { type: "Token", objectId: bandit.id });
    ctx.expect(bData?.hidden === true, "son token est caché, pas supprimé");
    await endCombat();
    await setHidden(bandit, false);
    await npc("moral", { tokenId: bandit.id, reset: true });
    await drop(refuge);
    await only(mage, guerrier);

    // 4. Poste de tir : le Mage se poste, puis tire.
    const vantage = await region("Poste de tir (essai)", 4, 16, 2, 2, { kind: "vantage" });
    await put(mage, 2, 12);
    await put(guerrier, 12, 12);
    await ctx.setHp(guerrier, 200);
    await pause(600);
    const shot = await turnOf(mage, [guerrier]);
    const posted = shot?.steps?.find(s => s.type === "vantage");
    ctx.expect(!!posted, `il gagne le poste de tir (${JSON.stringify(shot?.steps?.map(s => s.type))}, ${shot?.reason})`);
    const m = await cellOf(mage);
    ctx.expect((m.i >= 4) && (m.i <= 5) && (m.j >= 16) && (m.j <= 17), `il y est (case ${m.i}, ${m.j})`);
    ctx.expect(shot?.steps?.some(s => s.type === "attack"), "puis il tire");
    await endCombat();
    await drop(vantage);
  }
};
