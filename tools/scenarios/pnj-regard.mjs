/**
 * Regarder autour de soi (demande de l'utilisateur du 2026-10-14) : un Bandit mené par l'IA, au calme et immobile, tourne la tête de
 * temps en temps autour de sa direction de référence (balayage « largement », ±90°) et y revient ; le cône du moteur suit sa rotation.
 * Remet : réglages, pilote, rotation, état d'alerte, tokens cachés.
 */
const NPC = "darsh-npc";
const pause = ms => new Promise(r => setTimeout(r, ms));
const gap = (a, b) => Math.abs((((a - b) % 360) + 540) % 360 - 180);

export default {
  name: "pnj-regard — au repos, un PNJ regarde autour de lui et revient",

  async run(ctx) {
    const npc = async (fn, args={}) => (await ctx.call("call-module-api", { moduleId: NPC, fn, args, waitMs: 8000 })).result;
    const { tokens } = await ctx.scene();
    if ( !tokens.some(t => t.name === "Bandit") ) { ctx.log("Bandit absent : non applicable"); return; }
    const bandit = await ctx.token("Bandit");
    for ( const [key, value] of [["level", "patrols"], ["aiEnabled", true], ["autoEngage", false], ["barkMode", "off"], ["scanDefault", "wide"]] ) {
      const r = await npc("reglage", { key, value });
      ctx.restore(() => npc("reglage", { key, value: r.before }));
    }
    const cones = await ctx.engine("setting", { key: "visionCones", value: true });
    ctx.restore(() => ctx.engine("setting", { key: "visionCones", value: cones.before }));
    for ( const t of tokens.filter(t => t.id !== bandit.id) ) {
      const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: t.id });
      if ( data.hidden ) continue;
      await ctx.call("update-scene-object", { type: "Token", objectId: t.id, data: { hidden: true } });
      ctx.restore(() => ctx.call("update-scene-object", { type: "Token", objectId: t.id, data: { hidden: false } }));
    }
    const { data: b0 } = await ctx.call("get-scene-object", { type: "Token", objectId: bandit.id });
    ctx.restore(() => ctx.call("update-scene-object", { type: "Token", objectId: bandit.id, data: { rotation: b0.rotation ?? 0 } }));
    const pilot = (await npc("pilote", { tokenId: bandit.id })).mode;
    ctx.restore(async () => { await npc("pilote", { tokenId: bandit.id, mode: pilot }); await npc("alerte", { tokenId: bandit.id, reset: true }); });
    await ctx.call("update-scene-object", { type: "Token", objectId: bandit.id, data: { rotation: 90 } });
    await npc("pilote", { tokenId: bandit.id, mode: "on" });
    await npc("alerte", { tokenId: bandit.id, reset: true });

    const seen = [];
    let cone = null;
    for ( let s = 0; s < 45; s++ ) {
      await pause(1000);
      const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: bandit.id });
      const rot = data.rotation ?? 0;
      if ( seen.at(-1) !== rot ) seen.push(rot);
      if ( (rot !== 90) && !cone ) cone = (await ctx.engine("sees", { observerId: bandit.id, targetId: bandit.id })).cone;
      if ( seen.length >= 3 && (seen.at(-1) === 90) ) break;
    }
    ctx.log(`rotations : ${seen.join(" → ")}`);
    const aside = seen.filter(r => r !== 90);
    ctx.expect(aside.length >= 1, "il a regardé ailleurs");
    ctx.expect(aside.every(r => (gap(r, 90) >= 44) && (gap(r, 90) <= 91)), "dans l'amplitude (entre 45° et 90° de sa direction)");
    ctx.expect(seen.at(-1) === 90, "puis il revient à sa direction (90°)");
    ctx.expect(cone && aside.includes(cone.rotation), `le cône du moteur suit (${JSON.stringify(cone)})`);
  }
};
