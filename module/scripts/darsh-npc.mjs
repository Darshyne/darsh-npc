/**
 * DAS · Automated NPC (darsh-npc) — point d'entrée. Voir prive/SPEC.md.
 *
 * Requiert le moteur `dnd5e-combat` et ne passe que par son API publique (adapter/engine.mjs) ; le moteur ne connaît pas ce
 * module et tourne sans lui. Étape 1 (SPEC §16) : lecture seule — profil et vue d'un token, score des cibles — sans aucune action.
 */
import { MODULE_ID, loc, log } from "./shared.mjs";
import { registerSettings, levelAtLeast as npcLevelAtLeast } from "./adapter/settings.mjs";
import * as engine from "./adapter/engine.mjs";
import { viewOf } from "./adapter/view.mjs";
import { profileFor } from "./runtime/profile.mjs";
import { register, unregister, registered } from "./runtime/registry.mjs";
import { scoreTargets } from "./core/targets.mjs";
import { validateView } from "./core/view.mjs";

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
      cibles: ({ tokenId }={}) => {
        const { profile, targets, view, problems } = targetsOf(tokenOf(tokenId));
        return { band: profile.band, range: profile.range, courage: profile.courage, targets, meta: view.meta, problems };
      }
    })
  });
});
