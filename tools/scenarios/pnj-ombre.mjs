/**
 * Demande de l'utilisateur du 2026-10-14 : se déplacer dans l'ombre sans se cacher alerte quand même — les créatures qui l'entendent
 * vont voir ; on trouve un ennemi non caché sur une case adjacente ; caché et non repéré, on peut s'approcher à côté hors du cône.
 * Le Bandit (sans vision dans le noir), mené par l'IA, regarde vers le bas, dans une zone d'obscurité ; le Guerrier :
 *  1. non caché, marche dans le noir à 4 cases de lui, hors de vue : doute (il l'a entendu) ;
 *  2. non caché, sur une case adjacente dans son dos : trouvé (alerte) ;
 *  3. caché (règles BG3), sur la même case : rien.
 * Remet : réglages, pilote, états, positions, rotation, région, tokens cachés, Furtivité.
 */
const NPC = "darsh-npc";
const pause = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "pnj-ombre — entendu dans le noir, trouvé au contact, caché à côté hors du cône",

  async run(ctx) {
    const npc = async (fn, args={}) => (await ctx.call("call-module-api", { moduleId: NPC, fn, args, waitMs: 8000 })).result;
    const { tokens, sceneId } = await ctx.scene();
    if ( !["Bandit", "Guerrier"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Bandit ou Guerrier absent : non applicable"); return; }
    const bandit = await ctx.token("Bandit");
    const guerrier = await ctx.token("Guerrier");
    for ( const [key, value] of [["level", "patrols"], ["aiEnabled", true], ["autoEngage", false], ["barkMode", "off"], ["scanDefault", "none"]] ) {
      const r = await npc("reglage", { key, value });
      ctx.restore(() => npc("reglage", { key, value: r.before }));
    }
    for ( const [key, value] of [["visionCones", true], ["stealthRules", "bg3"]] ) {
      const r = await ctx.engine("setting", { key, value });
      ctx.restore(() => ctx.engine("setting", { key, value: r.before }));
    }
    for ( const t of tokens.filter(t => ![bandit.id, guerrier.id].includes(t.id)) ) {
      const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: t.id });
      if ( data.hidden ) continue;
      await ctx.call("update-scene-object", { type: "Token", objectId: t.id, data: { hidden: true } });
      ctx.restore(() => ctx.call("update-scene-object", { type: "Token", objectId: t.id, data: { hidden: false } }));
    }
    ctx.restore(() => ctx.engine("stealth", { op: "set", tokenId: guerrier.id, on: false }));
    const pilot = (await npc("pilote", { tokenId: bandit.id })).mode;
    ctx.restore(async () => { await npc("pilote", { tokenId: bandit.id, mode: pilot }); await npc("alerte", { tokenId: bandit.id, reset: true }); });
    const { data: b0 } = await ctx.call("get-scene-object", { type: "Token", objectId: bandit.id });
    ctx.restore(() => ctx.call("update-scene-object", { type: "Token", objectId: bandit.id, data: { rotation: b0.rotation ?? 0 } }));

    const grid = await ctx.gridSize();
    const scene = await ctx.call("get-scene", {});
    const cx = Math.ceil((scene.width * scene.padding) / grid), cy = Math.ceil((scene.height * scene.padding) / grid);
    const cell = (i, j) => [(cx + i) * grid, (cy + j) * grid];
    const region = await ctx.call("create-region", { sceneId, name: "Obscurité (essai)", color: "#000000",
      shapes: [{ type: "rectangle", x: (cx + 2) * grid, y: (cy + 2) * grid, width: grid * 12, height: grid * 12 }],
      behaviors: [{ type: "adjustDarknessLevel", name: "Obscurité", system: { mode: 0, modifier: 1 } }] });
    const regionId = region?.id ?? region?.regionId ?? region?.region?.id;
    ctx.restore(() => ctx.call("delete-scene-object", { type: "Region", objectId: regionId }).catch(() => {}));
    const put = async (token, [x, y]) => { await ctx.call("move-token", { tokenId: token.id, x, y, elevation: 0 }); await pause(600); };
    // Le Guerrier caché par le MJ pendant la mise en place (le Bandit ne doit rien voir avant le pas).
    await ctx.call("update-scene-object", { type: "Token", objectId: guerrier.id, data: { hidden: true } });
    ctx.restore(() => ctx.call("update-scene-object", { type: "Token", objectId: guerrier.id, data: { hidden: false } }));
    await put(bandit, cell(8, 8));
    await put(guerrier, cell(8, 5));
    await ctx.call("update-scene-object", { type: "Token", objectId: bandit.id, data: { rotation: 0 } });
    await npc("pilote", { tokenId: bandit.id, mode: "on" });
    await npc("alerte", { tokenId: bandit.id, reset: true });
    await pause(1500);
    const state = async () => (await npc("alerte", { tokenId: bandit.id })).state;
    const sees = async () => (await ctx.engine("sees", { observerId: bandit.id, targetId: guerrier.id })).sees;

    // 1. Non caché, il fait un pas dans le noir à 3 cases (dans le dos du Bandit) : entendu.
    await ctx.call("update-scene-object", { type: "Token", objectId: guerrier.id, data: { hidden: false } });
    ctx.expect((await sees()) === false, "dans le noir, le Bandit ne voit pas le Guerrier");
    ctx.expect((await state()) === "idle", "au calme avant le pas");
    await put(guerrier, cell(9, 5));
    let s = await state();
    for ( let i = 0; (i < 6) && !["suspicious", "searching", "alert"].includes(s); i++ ) { await pause(500); s = await state(); }
    ctx.expect(["suspicious", "searching"].includes(s), `il l'a entendu marcher : doute (${s})`);

    // 1 bis. Assourdi, il n'entend plus rien.
    await npc("pilote", { tokenId: bandit.id, mode: "off" });
    await put(bandit, cell(8, 8));
    await ctx.call("update-scene-object", { type: "Token", objectId: bandit.id, data: { rotation: 0 } });
    await npc("alerte", { tokenId: bandit.id, reset: true });
    await npc("pilote", { tokenId: bandit.id, mode: "on" });
    await ctx.call("set-status", { tokenId: bandit.id, statusId: "deafened", active: true });
    ctx.restore(() => ctx.removeStatusEffects(bandit, "deafened"));
    await npc("alerte", { tokenId: bandit.id, reset: true });
    await put(guerrier, cell(8, 5));
    await pause(2500);
    s = await state();
    ctx.expect(s === "idle", `Assourdi : il ne l'entend pas (${s})`);
    await ctx.removeStatusEffects(bandit, "deafened");
    await ctx.call("set-status", { tokenId: bandit.id, statusId: "deafened", active: false }).catch(() => {});

    // 2. Non caché, collé dans son dos : trouvé.
    await npc("alerte", { tokenId: bandit.id, reset: true });
    await put(bandit, cell(8, 8));
    await ctx.call("update-scene-object", { type: "Token", objectId: bandit.id, data: { rotation: 0 } });
    await npc("pilote", { tokenId: bandit.id, mode: "off" });
    await put(guerrier, cell(8, 7));
    await npc("alerte", { tokenId: bandit.id, reset: true });
    await npc("pilote", { tokenId: bandit.id, mode: "on" });
    s = await state();
    for ( let i = 0; (i < 8) && (s !== "alert"); i++ ) { await pause(500); s = await state(); }
    ctx.expect(s === "alert", `collé à lui, non caché : trouvé (${s})`);

    // 3. Caché (BG3, sans jet : personne ne le voit), même case : rien.
    await npc("pilote", { tokenId: bandit.id, mode: "off" });
    await npc("alerte", { tokenId: bandit.id, reset: true });
    await ctx.call("update-scene-object", { type: "Token", objectId: bandit.id, data: { rotation: 0 } });
    const hid = await ctx.engine("stealth", { op: "set", tokenId: guerrier.id, on: true });
    ctx.expect(hid.hidden === true, "le Guerrier se cache (personne ne le voit)");
    await npc("pilote", { tokenId: bandit.id, mode: "on" });
    await pause(4000);
    s = await state();
    ctx.expect(s === "idle", `caché, collé dans son dos hors du cône : rien (${s})`);
  }
};
