/**
 * Étape 2 du SPEC §16, Attaques multiples : le Mage (Monster Manual 2024 : Attaques multiples, trois Jaillissements arcaniques,
 * au contact ou à distance) piloté tire sur le Guerrier à quelques cases — le pilote enchaîne les attaques tant que le moteur en
 * accorde (`api.ui.multiattackLeft`), puis finit le tour.
 */
const NPC = "darsh-npc";
const pause = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "pnj-multi — le Mage piloté enchaîne ses Attaques multiples à distance",

  async run(ctx) {
    const npc = async (fn, args={}) => (await ctx.call("call-module-api", { moduleId: NPC, fn, args, waitMs: 8000 })).result;
    const { tokens } = await ctx.scene();
    if ( !["Mage", "Guerrier"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Mage ou Guerrier absent : non applicable"); return; }
    const mage = await ctx.token("Mage");
    const guerrier = await ctx.token("Guerrier");
    const level = await npc("reglage", { key: "level", value: "combat" });
    ctx.restore(() => npc("reglage", { key: "level", value: level.before }));
    const ai = await npc("reglage", { key: "aiEnabled", value: true });
    ctx.restore(() => npc("reglage", { key: "aiEnabled", value: ai.before }));
    const auto = await npc("reglage", { key: "autoEngage", value: false });
    ctx.restore(() => npc("reglage", { key: "autoEngage", value: auto.before }));
    const before = await npc("pilote", { tokenId: mage.id });
    ctx.restore(() => npc("pilote", { tokenId: mage.id, mode: before.mode }));
    const hpM = await ctx.hp(mage), hpG = await ctx.hp(guerrier);
    ctx.restore(() => ctx.setHp(mage, hpM));
    ctx.restore(() => ctx.setHp(guerrier, hpG));
    await ctx.setHp(guerrier, 200);

    // Le Guerrier à trois cases du Mage : à portée du Jaillissement, pas au contact.
    const m = await ctx.position(mage);
    const grid = await ctx.gridSize();
    await ctx.call("move-token", { tokenId: guerrier.id, x: m.x + 4 * grid, y: m.y, elevation: m.elevation });
    await pause(600);
    await npc("pilote", { tokenId: mage.id, mode: "on" });
    const { plan } = await npc("plan", { tokenId: mage.id });
    // La cible est celle du profil (un Mage rusé vise d'abord les lanceurs de sorts de la scène) : on vérifie l'arme et le mode.
    ctx.expect(plan.type === "attack" && plan.mode === "ranged", `intention : ${plan.type === "attack" ? `${plan.attack.name} (${plan.mode})` : plan.reason}`);

    const since = await ctx.lastMessageId();
    await ctx.startCombat([mage, guerrier]);
    let traced = null;
    for ( let i = 0; i < 6 && !traced; i++ ) {
      const state = await ctx.combat();
      const combat = state.combat ?? state.combats?.[0] ?? state;
      if ( combat.combatants?.find(c => c.id === combat.currentCombatantId)?.tokenId !== mage.id ) { await ctx.nextTurn(); await pause(500); }
      for ( let w = 0; w < 60 && !traced; w++ ) {
        const messages = await ctx.call("list-chat-messages", { limit: 30, sinceId: since, flagScope: NPC }).catch(() => ({ messages: [] }));
        traced = (messages.messages ?? []).map(x => x.flags?.[NPC]?.trace).find(t => t?.token?.endsWith(mage.id)) ?? null;
        if ( !traced ) await pause(1000);
      }
    }
    ctx.expect(!!traced, "carte de trace du pilote laissée au MJ");
    if ( !traced ) return;
    ctx.log(traced.steps.map(s => `${s.attack} (${s.mode}) sur ${s.target} — ${s.outcome}`).join(" ; ") || traced.reason);
    ctx.expect(traced.steps.length === 3, `trois attaques jouées (${traced.steps.length}), raison de fin : ${traced.reason}`);
    const dialogs = (await ctx.call("list-dialogs", {})).windows.filter(w => w.isDialog && /Mage/.test(w.title ?? ""));
    ctx.expect(!dialogs.length, `aucune fenêtre laissée au MJ (${dialogs.map(d => d.title).join(", ") || "aucune"})`);
  }
};
