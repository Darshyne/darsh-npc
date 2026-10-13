/**
 * DAS · Automated NPC (darsh-npc) — point d'entrée. Voir prive/SPEC.md.
 *
 * Requiert le moteur `dnd5e-combat` et ne passe que par son API publique (adapter/engine.mjs) ; le moteur ne connaît pas ce
 * module et tourne sans lui. Étape 1 (SPEC §16) : profil et vue d'un token, score des cibles. Étape 2 : le pilote — au tour d'un
 * token piloté, attaquer la meilleure cible déjà à portée, puis finir le tour (runtime/pilot.mjs).
 */
import { MODULE_ID, loc, log } from "./shared.mjs";
import { registerSettings, levelAtLeast as npcLevelAtLeast } from "./adapter/settings.mjs";
import * as engine from "./adapter/engine.mjs";
import { viewOf } from "./adapter/view.mjs";
import { profileFor } from "./runtime/profile.mjs";
import { register, unregister, registered } from "./runtime/registry.mjs";
import { scoreTargets } from "./core/targets.mjs";
import { validateView } from "./core/view.mjs";
import { registerPilot, planFor, playTurn, pilotOf, setPilot, refusal } from "./runtime/pilot.mjs";
import { registerEngage, check as checkEngagement, engagementsOn } from "./runtime/engage.mjs";
import { registerMorale, moraleOf, setMorale } from "./runtime/morale.mjs";
import { registerConfirm, answer as answerConfirm } from "./runtime/confirm.mjs";
import { registerMarkers } from "./ui/markers.mjs";
import { registerBarks, bark, lineFor } from "./runtime/barks.mjs";
import { registerBarksEditor } from "./ui/barks-editor.mjs";

/** Le token d'une scène affichée par son id, ou l'erreur qui dit pourquoi. */
function tokenOf(tokenId) {
  const token = canvas.scene?.tokens.get(tokenId);
  if ( !token ) throw new Error(`token ${tokenId} introuvable sur la scène affichée`);
  if ( !token.actor ) throw new Error(`token ${tokenId} sans acteur`);
  return token;
}

/** Les cibles classées d'un token, avec sa vue et son profil. */
function targetsOf(token) {
  const { facts, profile, enmities } = profileFor(token.actor, token);
  const view = viewOf(token);
  return { facts, profile, enmities, view, targets: scoreTargets(view, profile, enmities), problems: validateView(view) };
}

Hooks.once("init", () => {
  registerSettings();
  registerPilot();
  registerEngage();
  registerMorale();
  registerConfirm();
  registerMarkers();
  registerBarks();
  registerBarksEditor();
});

Hooks.once("setup", () => {
  // Les tables d'autres modules (SPEC §14.1) : `Hooks.callAll("darsh-npc.register", register)` — un module de campagne y
  // enregistre ses profils et ses haines, comme auprès du moteur.
  Hooks.callAll(`${MODULE_ID}.register`, register);
});

Hooks.once("ready", () => {
  if ( !engine.active() ) {
    log.warn(loc("Moteur.Absent"));
    if ( game.user.isGM ) ui.notifications.warn(loc("Moteur.Absent"));
  } else if ( game.user.isGM && npcLevelAtLeast("combat") && !engine.levelAtLeast("assisted") ) {
    ui.notifications.warn(loc("Moteur.Niveau"));
  }

  game.modules.get(MODULE_ID).api = Object.freeze({
    version: game.modules.get(MODULE_ID).version,
    ai: Object.freeze({
      /** Le profil déduit d'un acteur (et de son token s'il est donné), avec ses couches : `{ facts, profile, enmities }`. */
      profile: (actor, token=null) => profileFor(actor, token),
      /** La vue courante d'un token : ce qu'il perçoit (SPEC §7). */
      view: token => viewOf(token),
      /** Les cibles classées d'un token (SPEC §8), sans rien jouer. */
      targets: token => targetsOf(token),
      /** L'intention que le pilote jouerait maintenant (sans rien exécuter) : `{ type: "attack", target, attack, mode, reasons }` | `{ type: "yield", reason }`. */
      plan: token => planFor(token).plan,
      /** Jouer le tour de ce token comme le pilote (MJ actif) : `{ steps, reason }`. */
      play: token => playTurn(token, game.combat?.combatants?.find(c => c.tokenId === token.id) ?? null),
      /** Le pilote d'un token : lire, ou poser (`on` | `off`). */
      autopilot: (token, mode) => (mode === undefined ? pilotOf(token) : setPilot(token, mode)),
      /** Une réplique maintenant (§11) : `moment` parmi spotted, engage, attack, hit, bloodied, kill, allyDown, leaderDown, flee, surrender, victory. */
      bark: (token, moment, { force=true }={}) => bark(token, moment, { force }),
      /** Engagement automatique (§10.3) : juger la scène affichée maintenant (mettre en combat qui voit un ennemi). */
      engage: () => checkEngagement(),
      /** Profils et haines d'un autre module, validés. */
      register,
      unregister,
      registered
    }),
    /**
     * Pour les vérifications par le connecteur (`call-module-api`, verrou « Outils de test » du monde) : un objet d'arguments,
     * des valeurs de retour sérialisables. MJ, scène affichée.
     */
    mcp: Object.freeze({
      etat: () => ({
        version: game.modules.get(MODULE_ID).version,
        moteur: { actif: engine.active(), version: game.modules.get("dnd5e-combat")?.version ?? null },
        niveau: game.settings.get(MODULE_ID, "level"),
        omniscient: game.settings.get(MODULE_ID, "omniscient"),
        enregistre: Object.fromEntries(Object.entries(registered()).map(([s, t]) => [s, { profiles: t.profiles.length, enmities: t.enmities.length }]))
      }),
      profil: ({ tokenId, actorId }={}) => {
        const token = tokenId ? tokenOf(tokenId) : null;
        const actor = token?.actor ?? game.actors.get(actorId);
        if ( !actor ) throw new Error(`acteur ${actorId} introuvable`);
        return profileFor(actor, token);
      },
      vue: ({ tokenId }={}) => {
        const view = viewOf(tokenOf(tokenId));
        return { ...view, problems: validateView(view) };
      },
      /** Lire ou poser un réglage du module (scénarios) : `{ key, before, now }`. */
      reglage: async ({ key, value }={}) => {
        if ( !game.settings.settings.has(`${MODULE_ID}.${key}`) ) throw new Error(`unknown setting: ${key}`);
        const before = game.settings.get(MODULE_ID, key);
        if ( value !== undefined ) await game.settings.set(MODULE_ID, key, value);
        return { key, before, now: game.settings.get(MODULE_ID, key) };
      },
      /** Qui verrait qui sur la scène affichée (sans rien engager) : `{ tokens: [noms], causes }`. */
      vus: () => {
        const { tokens, causes } = engagementsOn(canvas.scene);
        return { tokens: tokens.map(t => t.name), causes };
      },
      /** Juger la scène maintenant (comme après un déplacement) : `{ combat, added }`. */
      engager: async () => {
        const r = await checkEngagement();
        return r ? { combat: r.combat?.id ?? null, added: r.added.map(t => t.name) } : null;
      },
      plan: ({ tokenId }={}) => {
        const { plan, move, view } = planFor(tokenOf(tokenId));
        return { plan: plan.type === "attack" ? { ...plan, attack: { name: plan.attack.name, id: plan.attack.id, mode: plan.mode } } : plan,
          move: move?.type === "move" ? { ...move, attack: { name: move.attack.name, id: move.attack.id } } : move,
          enemies: view.enemies.map(e => ({ name: e.name, distance: e.distance, appearance: e.appearance })) };
      },
      /** Le chemin du moteur vers un token, sans bouger (§179) : `{ api, direct, sprint, movement }`. */
      chemin: ({ tokenId, targetId, reachCells=1, seeing=false }={}) => {
        const token = tokenOf(tokenId);
        const target = tokenOf(targetId);
        const movement = engine.movement(token);
        return {
          direct: engine.pathToward(token, target, { reachCells, seeing }),
          sprint: movement?.speed ? engine.pathToward(token, target, { reachCells, seeing, extra: movement.speed }) : null,
          movement
        };
      },
      /** L'état de moral d'un token dans le combat en cours ; `reset` : l'effacer (scénarios). */
      moral: async ({ tokenId, reset=false }={}) => {
        const token = tokenOf(tokenId);
        if ( reset ) await token.unsetFlag(MODULE_ID, "morale");
        return { ...moraleOf(token), disposition: token.disposition };
      },
      /** Répondre à une carte de confirmation (§12.2) comme un bouton : `choice` = play | skip | manual, `target` : id de token. */
      confirmer: ({ messageId, choice="play", target=null }={}) => ({ answered: answerConfirm(messageId, { choice, target }) }),
      /** Une réplique (§11) : `{ tokenId, moment, force, dry }` — `dry` : la ligne choisie sans parler. */
      repliquer: async ({ tokenId, moment, force=false, dry=false }={}) => {
        const token = tokenOf(tokenId);
        return dry ? lineFor(token, moment) : bark(token, moment, { force });
      },
      /** Les répliques propres à un token (flag `barks` : `{ moment: [lignes] }`), à lire ; `barks` : les poser ; `null` : les retirer. */
      repliquesToken: async ({ tokenId, barks }={}) => {
        const token = tokenOf(tokenId);
        if ( barks === null ) await token.unsetFlag(MODULE_ID, "barks");
        else if ( barks !== undefined ) await token.setFlag(MODULE_ID, "barks", barks);
        return token.getFlag(MODULE_ID, "barks") ?? null;
      },
      pilote: async ({ tokenId, mode }={}) => {
        const token = tokenOf(tokenId);
        return { mode: mode === undefined ? pilotOf(token) : await setPilot(token, mode), refus: refusal(token) };
      },
      jouer: async ({ tokenId }={}) => {
        const token = tokenOf(tokenId);
        return playTurn(token, game.combat?.combatants?.find(c => c.tokenId === token.id) ?? null);
      },
      cibles: ({ tokenId }={}) => {
        const { profile, targets, view, problems } = targetsOf(tokenOf(tokenId));
        return { band: profile.band, range: profile.range, courage: profile.courage, targets, meta: view.meta, problems };
      }
    })
  });
});
