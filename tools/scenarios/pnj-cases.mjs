/**
 * Retours de l'utilisateur du 2026-10-14 sur l'IA hors combat :
 *  1. Deux PNJ menés entendent le même bruit : ils vont voir, sans finir sur la même case.
 *  2. Une créature à 0 PV perd son marqueur.
 *  3. L'IA coupée : plus aucun marqueur, les états d'alerte effacés.
 * Remet : réglages, pilotes, PV, états d'alerte, tokens cachés.
 */
const NPC = "darsh-npc";
const pause = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "pnj-cases — pas deux PNJ sur la même case ; marqueurs d'un mort et de l'IA coupée",

  async run(ctx) {
    const npc = async (fn, args={}) => (await ctx.call("call-module-api", { moduleId: NPC, fn, args, waitMs: 8000 })).result;
    const { tokens } = await ctx.scene();
    if ( !["Zombi", "Bandit", "Guerrier"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Zombi, Bandit ou Guerrier absent : non applicable"); return; }
    const zombi = await ctx.token("Zombi");
    const bandit = await ctx.token("Bandit");
    for ( const [key, value] of [["level", "patrols"], ["aiEnabled", true], ["autoEngage", false], ["barkMode", "off"]] ) {
      const r = await npc("reglage", { key, value });
      ctx.restore(() => npc("reglage", { key, value: r.before }));
    }
    for ( const t of [zombi, bandit] ) {
      const before = (await npc("pilote", { tokenId: t.id })).mode;
      ctx.restore(async () => { await npc("pilote", { tokenId: t.id, mode: before }); await npc("alerte", { tokenId: t.id, reset: true }); });
      await npc("pilote", { tokenId: t.id, mode: "on" });
      await npc("alerte", { tokenId: t.id, reset: true });
    }
    // Personne d'autre en vue (une alerte changerait la recherche en poursuite).
    for ( const t of tokens.filter(t => ![zombi.id, bandit.id].includes(t.id)) ) {
      const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: t.id });
      if ( data.hidden ) continue;
      await ctx.call("update-scene-object", { type: "Token", objectId: t.id, data: { hidden: true } });
      ctx.restore(() => ctx.call("update-scene-object", { type: "Token", objectId: t.id, data: { hidden: false } }));
    }
    const grid = await ctx.gridSize();
    const scene = await ctx.call("get-scene", {});
    const cx = Math.ceil((scene.width * scene.padding) / grid), cy = Math.ceil((scene.height * scene.padding) / grid);
    await ctx.call("move-token", { tokenId: zombi.id, x: (cx + 2) * grid, y: (cy + 2) * grid, elevation: 0 });
    await ctx.call("move-token", { tokenId: bandit.id, x: (cx + 2) * grid, y: (cy + 8) * grid, elevation: 0 });
    await pause(800);
    // Ce qu'ils ont vu avant que les autres soient cachés est oublié : ils partent du calme.
    for ( const t of [zombi, bandit] ) await npc("alerte", { tokenId: t.id, reset: true });
    await pause(1200);

    // 1. Le même bruit pour les deux.
    const noise = { x: (cx + 7.5) * grid, y: (cy + 5.5) * grid };
    await npc("doute", { tokenId: zombi.id, ...noise });
    await npc("doute", { tokenId: bandit.id, ...noise });
    const cell = p => `${Math.floor(p.x / grid)}.${Math.floor(p.y / grid)}`;
    // Ils vont voir (recherche), ne trouvent rien (confus) et rentrent : on retient où ils étaient en arrivant à la recherche.
    let same = false, near = false, a, b;
    const d = p => Math.hypot(p.x + (grid / 2) - noise.x, p.y + (grid / 2) - noise.y) / grid;
    for ( let s = 0; (s < 60) && !near; s++ ) {
      await pause(500);
      a = await ctx.position(zombi); b = await ctx.position(bandit);
      if ( cell(a) === cell(b) ) same = true;
      const za = await npc("alerte", { tokenId: zombi.id }), ba = await npc("alerte", { tokenId: bandit.id });
      near = (d(a) <= 3) && (d(b) <= 3) && !za.walking && !ba.walking;
    }
    ctx.expect(near, `les deux sont allés voir (Zombi ${cell(a)}, Bandit ${cell(b)})`);
    ctx.expect(!same && (cell(a) !== cell(b)), "jamais sur la même case");

    // 2. Un marqueur, puis 0 PV : plus de marqueur.
    await npc("alerte", { tokenId: zombi.id, reset: true });
    await npc("doute", { tokenId: zombi.id, x: noise.x - (grid * 4), y: noise.y });
    await npc("horloge");
    let glyph = null;
    for ( let s = 0; (s < 10) && !glyph; s++ ) { await pause(500); glyph = (await npc("marqueur", { tokenId: zombi.id })).glyph; }
    ctx.expect(!!glyph, `un marqueur au-dessus du Zombi (${glyph})`);
    const hp0 = await ctx.hp(zombi);
    ctx.restore(() => ctx.setHp(zombi, hp0));
    await ctx.setHp(zombi, 0);
    await pause(500);
    ctx.expect((await npc("marqueur", { tokenId: zombi.id })).glyph === null, "à 0 PV : plus de marqueur");
    await ctx.setHp(zombi, hp0);

    // 3. L'IA coupée : plus de marqueur, plus d'état d'alerte.
    await npc("doute", { tokenId: bandit.id, x: noise.x, y: noise.y - (grid * 3) });
    await npc("horloge");
    await pause(800);
    await npc("reglage", { key: "aiEnabled", value: false });
    await pause(1000);
    const flags = [await npc("alerte", { tokenId: zombi.id }), await npc("alerte", { tokenId: bandit.id })].map(s => s.flag);
    const glyphs = [(await npc("marqueur", { tokenId: zombi.id })).glyph, (await npc("marqueur", { tokenId: bandit.id })).glyph];
    ctx.expect(glyphs.every(g => g === null), `IA coupée : aucun marqueur (${JSON.stringify(glyphs)})`);
    ctx.expect(flags.every(f => !f), `IA coupée : états d'alerte effacés (${JSON.stringify(flags)})`);
  }
};
