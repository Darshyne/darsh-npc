/**
 * Étape 9 bis du SPEC §16 : les horaires (§10.6), sur l'horloge du monde (`advanceTime` du moteur), au niveau « patrouilles ».
 *  1. **Rattrapage** : le Zombi (horaire propre : dort de 6 h à 18 h au dortoir, tient le poste de 18 h à 6 h) et le Bandit (horaire de
 *     son groupe : poste de 6 h à 18 h, absent la nuit). Un saut à 12 h : le Zombi est posé au dortoir, endormi (💤), le Bandit au poste.
 *     Un saut à 19 h : le Zombi est au poste, éveillé ; le Bandit est caché.
 *  2. **Relève** : à 17 h 50 (saut), puis quinze minutes de plus d'un coup (pas un saut) : le Zombi **marche** du dortoir au poste ; le
 *     Bandit, absent sans région de sortie, est caché tout de suite.
 *  3. **Réveil au bruit** : à 12 h, le Zombi dort ; le Guerrier fait un pas à deux cases : toujours endormi aussitôt (réveil 6 s), puis
 *     réveillé et en doute (ou en alerte) peu après.
 *  4. **Réveil par l'alarme** : endormi de nouveau, l'alarme du groupe (donnée par le Bandit) le réveille, puis il marche vers elle.
 * Les autres tokens de l'arène sont cachés. Remet : réglages, horaires, flags, régions, heure du monde, tokens cachés.
 */
const NPC = "darsh-npc";
const GROUP = "horaire-essai";
const pause = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "pnj-horaires — rattrapage, relève, sommeil, réveil au bruit et à l'alarme",

  async run(ctx) {
    const npc = async (fn, args={}) => (await ctx.call("call-module-api", { moduleId: NPC, fn, args, waitMs: 8000 })).result;
    const { tokens, sceneId } = await ctx.scene();
    if ( !["Zombi", "Guerrier", "Bandit"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Zombi, Guerrier ou Bandit absent : non applicable"); return; }
    const zombi = await ctx.token("Zombi");
    const guerrier = await ctx.token("Guerrier");
    const bandit = await ctx.token("Bandit");
    for ( const [key, value] of [["level", "patrols"], ["aiEnabled", true], ["autoEngage", false], ["barkMode", "off"], ["scanDefault", "none"]] ) {
      const r = await npc("reglage", { key, value });
      ctx.restore(() => npc("reglage", { key, value: r.before }));
    }
    const start = await npc("horaire", {});
    const advance = async seconds => { await ctx.engine("advanceTime", { seconds }); await pause(600); };
    ctx.restore(async () => {
      const now = (await npc("horaire", {})).worldTime;
      if ( now !== start.worldTime ) await ctx.engine("advanceTime", { seconds: start.worldTime - now });
    });
    ctx.restore(async () => {
      await npc("horaire", { group: GROUP, groupSlots: null });
      for ( const t of [zombi, bandit] ) {
        await npc("horaire", { tokenId: t.id, clear: true });
        await npc("groupe", { tokenId: t.id, group: null });
        await npc("alerte", { tokenId: t.id, reset: true });
      }
      await npc("alarme", { reset: true });
    });
    const grid = await ctx.gridSize();
    for ( const t of tokens.filter(t => ![zombi.id, guerrier.id, bandit.id].includes(t.id)) ) {
      const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: t.id });
      if ( data.hidden ) continue;
      await ctx.call("update-scene-object", { type: "Token", objectId: t.id, data: { hidden: true } });
      ctx.restore(() => ctx.call("update-scene-object", { type: "Token", objectId: t.id, data: { hidden: false } }));
    }
    const hideGuerrier = hidden => ctx.call("update-scene-object", { type: "Token", objectId: guerrier.id, data: { hidden } });
    ctx.restore(() => hideGuerrier(false));
    await hideGuerrier(true);
    const sceneInfo = await ctx.call("get-scene", {});
    const cx = Math.ceil((sceneInfo.width * sceneInfo.padding) / grid), cy = Math.ceil((sceneInfo.height * sceneInfo.padding) / grid);
    const put = (token, i, j) => ctx.call("move-token", { tokenId: token.id, x: (cx + i) * grid, y: (cy + j) * grid, elevation: 0 });
    const cellOf = async token => { const p = await ctx.position(token); return { i: Math.round(p.x / grid) - cx, j: Math.round(p.y / grid) - cy }; };
    const inBox = (c, i0, j0, n) => (c.i >= i0) && (c.i < i0 + n) && (c.j >= j0) && (c.j < j0 + n);
    const regions = [];
    ctx.restore(async () => { for ( const id of regions ) await ctx.call("delete-scene-object", { type: "Region", objectId: id }).catch(() => {}); });
    const region = async (name, i, j, behaviors=[]) => {
      const r = await ctx.call("create-region", { sceneId, name, color: "#8060c0",
        shapes: [{ type: "rectangle", x: (cx + i) * grid, y: (cy + j) * grid, width: 3 * grid, height: 3 * grid }], behaviors });
      const id = r?.id ?? r?.regionId ?? r?.region?.id;
      regions.push(id);
      return id;
    };
    const dortoir = await region("Dortoir (essai)", 2, 2);
    const poste = await region("Poste (essai)", 14, 2, [{ type: `${NPC}.post`, name: "Poste", system: { wander: false } }]);
    const hidden = async token => (await ctx.call("get-scene-object", { type: "Token", objectId: token.id })).data?.hidden === true;
    const info = async token => (await npc("horaire", { tokenId: token.id })).info;
    // Aller à une heure du jour (saut), depuis l'heure courante.
    const goTo = async hour => {
      const { info: i } = await npc("horaire", { tokenId: zombi.id });
      let delta = ((hour * 60) - i.minute) * 60;
      if ( delta <= 0 ) delta += i.dayMinutes * 60;
      await advance(delta);
    };

    await put(zombi, 8, 10);
    await put(bandit, 9, 10);
    await put(guerrier, 25, 25);
    for ( const t of [zombi, bandit] ) { await npc("horaire", { tokenId: t.id, clear: true }); await npc("alerte", { tokenId: t.id, reset: true }); }
    await npc("groupe", { tokenId: zombi.id, group: GROUP });
    await npc("groupe", { tokenId: bandit.id, group: GROUP });
    await npc("horaire", { tokenId: zombi.id, slots: [
      { from: "06:00", to: "18:00", activity: "sleep", region: dortoir },
      { from: "18:00", to: "06:00", activity: "post", region: poste }
    ] });
    await npc("horaire", { group: GROUP, groupSlots: [
      { from: "06:00", to: "18:00", activity: "post", region: poste },
      { from: "18:00", to: "06:00", activity: "off" }
    ] });

    // 1. Rattrapage.
    await goTo(12);
    let z = await info(zombi);
    ctx.expect(z.slot?.activity === "sleep", `12 h : créneau du Zombi = sommeil (${z.slot?.key})`);
    ctx.expect(inBox(await cellOf(zombi), 2, 2, 3), `12 h : le Zombi est posé au dortoir (${JSON.stringify(await cellOf(zombi))})`);
    ctx.expect(z.asleep, "12 h : il dort (rattrapage)");
    ctx.expect((await npc("marqueur", { tokenId: zombi.id })).glyph === "💤", "le marqueur 💤 est affiché");
    const b = await info(bandit);
    ctx.expect((b.slot?.activity === "post") && (b.slot?.source === "group"), `12 h : le Bandit suit l'horaire du groupe (${b.slot?.key})`);
    ctx.expect(inBox(await cellOf(bandit), 14, 2, 3), "12 h : le Bandit est au poste");
    await goTo(19);
    z = await info(zombi);
    ctx.expect((z.slot?.activity === "post") && !z.asleep, `19 h : le Zombi tient le poste, éveillé (${z.slot?.key})`);
    ctx.expect(inBox(await cellOf(zombi), 14, 2, 3), "19 h : le Zombi est posé au poste");
    ctx.expect(await hidden(bandit), "19 h : le Bandit est parti (caché)");

    // 2. Relève : un saut à 17 h 50, puis quinze minutes d'un coup.
    await goTo(17);
    await advance(50 * 60);
    ctx.expect((await info(zombi)).asleep && inBox(await cellOf(zombi), 2, 2, 3), "17 h 50 : le Zombi dort au dortoir");
    ctx.expect(!(await hidden(bandit)) && inBox(await cellOf(bandit), 14, 2, 3), "17 h 50 : le Bandit est revenu au poste");
    await put(bandit, 18, 6);   // hors du poste : le Zombi aura sa place
    await advance(15 * 60);
    z = await info(zombi);
    ctx.expect((z.slot?.activity === "post") && !z.asleep, `18 h 05 : relève, le Zombi est réveillé (${z.slot?.key})`);
    const right = await cellOf(zombi);
    ctx.expect(!inBox(right, 14, 2, 3), `pas de téléportation : il est encore loin du poste (${JSON.stringify(right)})`);
    ctx.expect(await hidden(bandit), "18 h 05 : le Bandit, absent sans région, est caché aussitôt");
    let arrived = false;
    for ( let s = 0; (s < 30) && !arrived; s++ ) { await pause(1000); arrived = inBox(await cellOf(zombi), 14, 2, 3); }
    ctx.expect(arrived, "il marche jusqu'au poste");

    // 3. Réveil au bruit.
    await goTo(12);
    ctx.expect((await info(zombi)).asleep, "12 h : il dort de nouveau");
    const zc = await cellOf(zombi);
    await put(guerrier, zc.i + 4, zc.j);
    await hideGuerrier(false);
    await put(guerrier, zc.i + 2, zc.j);
    await pause(1500);
    const early = await npc("horaire", {});
    ctx.expect((await info(zombi)).asleep && early.sleepers.some(s => (s.id === zombi.id) && s.wake), "un pas à deux cases : réveil programmé, il dort encore");
    let woke = false, state = null;
    for ( let s = 0; (s < 12) && !woke; s++ ) {
      await pause(1000);
      woke = !(await info(zombi)).asleep;
      state = (await npc("alerte", { tokenId: zombi.id })).state;
    }
    ctx.expect(woke, "il se réveille après son délai");
    for ( let s = 0; (s < 5) && (state === "idle"); s++ ) { await pause(1000); state = (await npc("alerte", { tokenId: zombi.id })).state; }
    ctx.expect(["suspicious", "alert", "searching"].includes(state), `réveillé, il s'inquiète (${state})`);

    // 4. Réveil par l'alarme du groupe.
    await hideGuerrier(true);
    await put(guerrier, 25, 25);
    await npc("alerte", { tokenId: zombi.id, reset: true });
    await npc("horaire", { tokenId: zombi.id, refresh: true, delta: 99999, force: true });
    ctx.expect((await info(zombi)).asleep, "rendormi (rattrapage)");
    const before = await cellOf(zombi);
    const alarm = await npc("alarme", { tokenId: bandit.id, x: (cx + 20.5) * grid, y: (cy + 12.5) * grid });
    ctx.expect(alarm?.alerted?.includes("Zombi"), `l'alarme du groupe le touche (${JSON.stringify(alarm)})`);
    let up = false;
    for ( let s = 0; (s < 12) && !up; s++ ) { await pause(1000); up = !(await info(zombi)).asleep; }
    ctx.expect(up, "l'alarme le réveille");
    let moved = false;
    for ( let s = 0; (s < 10) && !moved; s++ ) { await pause(1000); const c = await cellOf(zombi); moved = (c.i !== before.i) || (c.j !== before.j); }
    ctx.expect(moved, "il marche vers l'alarme");
  }
};
