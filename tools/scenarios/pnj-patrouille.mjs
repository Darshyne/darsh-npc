/**
 * Étape 6a du SPEC §16 : le temps réel hors combat (niveau « patrouilles », combat automatique coupé).
 *  1. Le Zombi affecté à une **patrouille** (région carrée, polygone de 4 sommets, pause 0) en fait le tour : au moins trois sommets
 *     visités. **Pause** : il ne bouge plus ; reprise : il repart.
 *  2. Le Guerrier apparaît dans sa vue : **alerte** (« ! »). Le Guerrier devient Invisible : le Zombi le perd, **cherche** à sa
 *     dernière position (œil), ne trouve rien (**confus**, « ? »), puis rentre et reprend sa patrouille (au calme).
 *  3. Le Bandit affecté à un **poste de garde** (orientation 90°) placé hors du poste : il y va et regarde vers la gauche.
 * Les autres tokens de l'arène sont cachés le temps du test. Remet : réglages, affectations, régions, positions, états, pause.
 */
const NPC = "darsh-npc";
const pause = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "pnj-patrouille — patrouille, pause, alerte, recherche, confusion, retour, poste de garde",

  async run(ctx) {
    const npc = async (fn, args={}) => (await ctx.call("call-module-api", { moduleId: NPC, fn, args, waitMs: 8000 })).result;
    const { tokens, sceneId } = await ctx.scene();
    if ( !["Zombi", "Guerrier", "Bandit"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Zombi, Guerrier ou Bandit absent : non applicable"); return; }
    const zombi = await ctx.token("Zombi");
    const guerrier = await ctx.token("Guerrier");
    const bandit = await ctx.token("Bandit");
    for ( const [key, value] of [["level", "patrols"], ["aiEnabled", true], ["autoEngage", false], ["barkMode", "off"]] ) {
      const r = await npc("reglage", { key, value });
      ctx.restore(() => npc("reglage", { key, value: r.before }));
    }
    ctx.restore(() => npc("pause", { paused: false }));
    for ( const t of [zombi, bandit] ) ctx.restore(async () => { await npc("affecter", { tokenId: t.id, regionId: null }); await npc("alerte", { tokenId: t.id, reset: true }); });
    ctx.restore(() => ctx.removeStatusEffects(guerrier, "invisible"));
    const grid = await ctx.gridSize();
    for ( const t of tokens.filter(t => ![zombi.id, guerrier.id, bandit.id].includes(t.id)) ) {
      const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: t.id });
      if ( data.hidden ) continue;
      await ctx.call("update-scene-object", { type: "Token", objectId: t.id, data: { hidden: true } });
      ctx.restore(() => ctx.call("update-scene-object", { type: "Token", objectId: t.id, data: { hidden: false } }));
    }
    const sceneInfo = await ctx.call("get-scene", {});
    const cx = Math.ceil((sceneInfo.width * sceneInfo.padding) / grid), cy = Math.ceil((sceneInfo.height * sceneInfo.padding) / grid);
    const at = (i, j) => ({ x: (cx + i + 0.5) * grid, y: (cy + j + 0.5) * grid });
    const put = (token, i, j) => ctx.call("move-token", { tokenId: token.id, x: (cx + i) * grid, y: (cy + j) * grid, elevation: 0 });
    const regions = [];
    ctx.restore(async () => { for ( const id of regions ) await ctx.call("delete-scene-object", { type: "Region", objectId: id }).catch(() => {}); });
    const centre = async token => { const p = await ctx.position(token); return { x: p.x + (grid / 2), y: p.y + (grid / 2) }; };
    const state = async token => (await npc("alerte", { tokenId: token.id })).state;

    // 1. Patrouille : un carré de 6 cases de côté. Le Guerrier caché par le MJ : le Zombi le verrait de loin (plein jour, sans murs).
    const hideGuerrier = hidden => ctx.call("update-scene-object", { type: "Token", objectId: guerrier.id, data: { hidden } });
    ctx.restore(() => hideGuerrier(false));
    await hideGuerrier(true);
    await put(guerrier, 25, 25);
    await put(bandit, 25, 26);
    const corners = [at(2, 2), at(8, 2), at(8, 8), at(2, 8)];
    const route = await ctx.call("create-region", { sceneId, name: "Patrouille (essai)", color: "#30a0ff",
      shapes: [{ type: "polygon", points: corners.flatMap(p => [p.x, p.y]) }],
      behaviors: [{ type: `${NPC}.patrol`, name: "Patrouille", system: { mode: "loop", pause: 0 } }] });
    const routeId = route?.id ?? route?.regionId ?? route?.region?.id;
    regions.push(routeId);
    await put(zombi, 2, 2);
    await npc("alerte", { tokenId: zombi.id, reset: true });
    await npc("affecter", { tokenId: zombi.id, regionId: routeId });
    const visited = new Set();
    for ( let s = 0; (s < 40) && (visited.size < 3); s++ ) {
      await pause(1000);
      const c = await centre(zombi);
      corners.forEach((p, i) => { if ( Math.hypot(p.x - c.x, p.y - c.y) <= grid ) visited.add(i); });
    }
    ctx.expect(visited.size >= 3, `patrouille : sommets visités ${[...visited].join(", ")}`);
    await npc("pause", { paused: true });
    await pause(1500);
    const frozen = await ctx.position(zombi);
    await pause(3000);
    const still = await ctx.position(zombi);
    ctx.expect((frozen.x === still.x) && (frozen.y === still.y), "en pause : immobile");
    await npc("pause", { paused: false });
    let moved = false;
    for ( let s = 0; (s < 15) && !moved; s++ ) { await pause(1000); const p = await ctx.position(zombi); moved = (p.x !== still.x) || (p.y !== still.y); }
    ctx.expect(moved, "reprise : il repart");

    // 2. Alerte, recherche, confusion, retour.
    const z = await centre(zombi);
    const gi = Math.round((z.x / grid) - cx - 0.5) + 3, gj = Math.round((z.y / grid) - cy - 0.5);
    await put(guerrier, gi, gj);
    await hideGuerrier(false);
    const seen = [];
    const watch = async (want, seconds) => {
      for ( let s = 0; s < seconds; s++ ) {
        const st = await state(zombi);
        if ( seen.at(-1) !== st ) seen.push(st);
        if ( want(st) ) return true;
        await pause(1000);
      }
      return false;
    };
    ctx.expect(await watch(s => s === "alert", 10), `le Guerrier en vue : alerte (${seen.join(" → ")})`);
    const flag = (await npc("alerte", { tokenId: zombi.id })).flag;
    ctx.expect(flag?.state === "alert", "le marqueur « ! » est posé (flag d'alerte)");
    await ctx.call("set-status", { tokenId: guerrier.id, statusId: "invisible", active: true });
    ctx.expect(await watch(s => s === "searching", 8), `Guerrier invisible : il cherche (${seen.join(" → ")})`);
    ctx.expect(await watch(s => s === "confused", 30), `rien trouvé : confus (${seen.join(" → ")})`);
    ctx.expect(await watch(s => s === "idle", 15), `puis au calme (${seen.join(" → ")})`);
    const back = await centre(zombi);
    let resumed = false;
    const visitedAfter = new Set();
    for ( let s = 0; (s < 30) && !resumed; s++ ) {
      await pause(1000);
      const c = await centre(zombi);
      corners.forEach((p, i) => { if ( Math.hypot(p.x - c.x, p.y - c.y) <= grid ) visitedAfter.add(i); });
      resumed = visitedAfter.size >= 1 && ((c.x !== back.x) || (c.y !== back.y));
    }
    ctx.expect(resumed, `il reprend sa patrouille (sommets ${[...visitedAfter].join(", ")})`);
    await npc("affecter", { tokenId: zombi.id, regionId: null });

    // 3. Poste de garde, orienté vers la gauche.
    await put(guerrier, 25, 25);
    const post = await ctx.call("create-region", { sceneId, name: "Poste (essai)", color: "#a0a030",
      shapes: [{ type: "rectangle", x: (cx + 14) * grid, y: (cy + 2) * grid, width: 3 * grid, height: 3 * grid }],
      behaviors: [{ type: `${NPC}.post`, name: "Poste", system: { facing: 90, wander: false } }] });
    const postId = post?.id ?? post?.regionId ?? post?.region?.id;
    regions.push(postId);
    await put(bandit, 10, 12);
    await npc("alerte", { tokenId: bandit.id, reset: true });
    await npc("affecter", { tokenId: bandit.id, regionId: postId });
    let inPost = false, facing = null;
    for ( let s = 0; (s < 30) && !(inPost && facing === 90); s++ ) {
      await pause(1000);
      const c = await centre(bandit);
      inPost = (c.x > (cx + 14) * grid) && (c.x < (cx + 17) * grid) && (c.y > (cy + 2) * grid) && (c.y < (cy + 5) * grid);
      facing = (await ctx.call("get-scene-object", { type: "Token", objectId: bandit.id })).data?.rotation ?? null;
    }
    ctx.expect(inPost, "le Bandit rejoint son poste");
    ctx.expect(facing === 90, `et regarde vers la gauche (rotation ${facing})`);
  }
};
