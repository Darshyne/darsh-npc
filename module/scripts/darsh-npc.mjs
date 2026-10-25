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
import { registerMarkers, glyphOf } from "./ui/markers.mjs";
import { registerBarks, bark, lineFor } from "./runtime/barks.mjs";
import { registerBarksEditor } from "./ui/barks-editor.mjs";
import { registerBehaviors } from "./adapter/behaviors.mjs";
import { registerClock, alertOf, hear, forget, memoryOf, tick as clockTick } from "./runtime/clock.mjs";
import { registerAssign, assign } from "./ui/assign.mjs";
import { registerFlags, raiseAlarm, resetAlarms, callReserve, resetReserve, reserveState, groupOf, onArrive } from "./runtime/flags.mjs";
import { registerReserveUI } from "./ui/reserve.mjs";
import { RESERVE_TYPE } from "./adapter/behaviors.mjs";
import { registerSchedules, refreshScene, scheduleInfo, setOwnSchedule, setGroupSchedule, sleepersOf, wakeUp } from "./runtime/schedule.mjs";
import { registerScheduleUI } from "./ui/schedule.mjs";

/** Le token d'une scène affichée par son id, ou l'erreur qui dit pourquoi. */
function tokenOf(tokenId) {
  const token = canvas.scene?.tokens.get(tokenId);
  if ( !token ) throw new Error(`token ${tokenId} introuvable sur la scène affichée`);
  if ( !token.actor ) throw new Error(`token ${tokenId} sans acteur`);
  return token;
}

/** Le comportement Réserve d'une région (document, ou id sur la scène affichée), ou celui donné. */
function reserveBehavior(region) {
  if ( region?.documentName === "RegionBehavior" ) return region;
  const doc = (typeof region === "string") ? canvas.scene?.regions.get(region) : region;
  const behavior = doc?.behaviors?.find(b => b.type === RESERVE_TYPE);
  if ( !behavior ) throw new Error(`no reserve behavior on region ${doc?.id ?? region}`);
  return behavior;
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
  registerBehaviors();
  registerClock();
  registerFlags();
  registerAssign();
  registerReserveUI();
  registerSchedules();
  registerScheduleUI();
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
      /** L'état d'alerte hors combat d'un token (§4 : idle, suspicious, alert, searching, confused). */
      alertState: token => alertOf(token),
      /**
       * Donner l'alerte (§14.1). `alert(token, { x, y })` : un doute (« un bruit là ») — il se tourne, puis va voir.
       * `alert(token, { group, position })` : l'alarme du groupe (« la cloche sonne ») — tout le groupe du token (ou `group`) sur sa scène
       * passe en alerte vers `position` (sinon la dernière position connue), et les réserves qui attendent l'alarme partent.
       */
      alert: (token, arg={}) => (Number.isFinite(arg?.x) && Number.isFinite(arg?.y) && !arg.position && !arg.group)
        ? hear(token, arg)
        : raiseAlarm(token.parent, token, arg?.position ?? null, { group: arg?.group ?? null, cause: "api", force: true }),
      /** Faire venir une réserve (id de région ou comportement) : après son délai, ou tout de suite (`now`). */
      reinforce: (region, { now=false }={}) => callReserve(reserveBehavior(region), { now }),
      /** Le groupe d'un token pour les alertes (§4) : flag `group`, sinon faction du moteur, sinon disposition. */
      group: token => groupOf(token),
      /** Affecter un token à une patrouille ou un poste (id de région), ou le retirer (null). */
      assign: (token, regionId) => assign(token, regionId),
      /**
       * Les horaires (§10.6). `schedule(token)` : ce que dit son horaire (sources, créneau en cours) ; `schedule(token, slots)` : poser
       * son horaire propre (`[{ from: "22:00", to: "06:00", activity, region, wake }]`, null : le retirer).
       */
      schedule: (token, slots) => (slots === undefined ? scheduleInfo(token) : setOwnSchedule(token, slots)),
      /** L'horaire d'un groupe sur une scène (null : le retirer). */
      groupSchedule: (scene, group, slots) => setGroupSchedule(scene, group, slots),
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
          move: ["move", "climb"].includes(move?.type) ? { ...move, attack: { name: move.attack.name, id: move.attack.id } } : move,
          enemies: view.enemies.map(e => ({ name: e.name, distance: e.distance, vertical: e.vertical ?? 0, flat: e.flat ?? e.distance, appearance: e.appearance })),
          self: { climber: !!view.self.climber, climbing: !!view.self.climbing, onCeiling: !!view.self.onCeiling } };
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
      moral: async ({ tokenId, reset=false, state }={}) => {
        const token = tokenOf(tokenId);
        if ( reset ) { await token.unsetFlag(MODULE_ID, "morale"); await engine.setStance(token, null); }
        // `state: "fleeing"` : un fuyard tout fait (scénarios de l'étape 7, sans rejouer le test jusqu'à l'échec).
        if ( state !== undefined ) await setMorale(token, { state, calm: 0 });
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
      /** Affecter à une patrouille ou un poste (`regionId`), ou retirer (`regionId: null`). */
      affecter: async ({ tokenId, regionId=null }={}) => assign(tokenOf(tokenId), regionId),
      /** L'état d'alerte hors combat ; `reset` : l'oublier (mémoire et flag). */
      alerte: async ({ tokenId, reset=false }={}) => {
        const token = tokenOf(tokenId);
        if ( reset ) await forget(token);
        return { ...alertOf(token), flag: token.getFlag(MODULE_ID, "alert") ?? null, memory: memoryOf(token) };
      },
      /** Le marqueur affiché au-dessus du token (texte), ou null. */
      marqueur: ({ tokenId }={}) => ({ glyph: glyphOf(tokenOf(tokenId).object)?.text ?? null }),
      /** L'alarme du groupe de ce token (étape 7), vers `x`, `y` (sinon la dernière position connue). */
      alarme: async ({ tokenId, x, y, group=null, reset=false }={}) => {
        // `reset` : oublier les alarmes récentes de la scène (une alarme ne resonne pas avant une minute) et les positions connues.
        if ( reset ) { resetAlarms(canvas.scene); if ( !tokenId ) return { reset: true }; }
        const token = tokenOf(tokenId);
        const position = Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
        return raiseAlarm(canvas.scene, token, position, { group, cause: "api", force: true });
      },
      /** Le groupe d'un token ; `group` : le poser (flag de token), `null` : le retirer. */
      groupe: async ({ tokenId, group }={}) => {
        const token = tokenOf(tokenId);
        if ( group === null ) await token.unsetFlag(MODULE_ID, "group");
        else if ( group !== undefined ) await token.setFlag(MODULE_ID, "group", String(group));
        return { group: groupOf(token) };
      },
      /** Une réserve (`regionId`) : `action` = etat | appeler | remettre ; `now` : sans délai. */
      reserve: async ({ regionId, action="etat", now=false }={}) => {
        const behavior = reserveBehavior(regionId);
        if ( action === "appeler" ) return { scheduled: callReserve(behavior, { now }), ...reserveState(behavior) };
        if ( action === "remettre" ) await resetReserve(behavior);
        return reserveState(behavior);
      },
      /** Ce qui arrive à ce token là où il est (refuge-sortie, réserve appelée, alarme) : `{ event }`. */
      arrivee: async ({ tokenId }={}) => ({ event: await onArrive(tokenOf(tokenId)) }),
      /** Les drapeaux de la scène affichée et le `avoid` du moteur sur leurs régions. */
      drapeaux: () => canvas.scene.regions.filter(r => r.behaviors.some(b => b.type.startsWith(`${MODULE_ID}.`))).map(r => ({
        id: r.id, name: r.name, behaviors: r.behaviors.map(b => ({ type: b.type, kind: b.system?.kind ?? null, disabled: b.disabled })),
        avoid: r.getFlag("dnd5e-combat", "avoid") === true
      })),
      /** Un doute pour ce token (un bruit en `x`, `y`). */
      doute: ({ tokenId, x, y }={}) => { hear(tokenOf(tokenId), { x, y }); return { heard: { x, y } }; },
      /** Mettre le jeu en pause ou l'en sortir (scénarios du temps réel). */
      pause: async ({ paused=true }={}) => { game.togglePause(!!paused, { broadcast: true }); return { paused: game.paused }; },
      /**
       * Horaires (§10.6) : `{ tokenId }` lit ; `slots` pose l'horaire du token (null : le retire) ; `group` + `groupSlots` pose celui
       * d'un groupe de la scène ; `refresh` relit la scène (`delta` : un saut d'horloge en secondes, pour le rattrapage ; `force` : même
       * sans changement de créneau).
       */
      horaire: async ({ tokenId, slots, group, groupSlots, refresh=false, delta=null, force=false, clear=false }={}) => {
        if ( group !== undefined ) await setGroupSchedule(canvas.scene, group, groupSlots ?? null);
        const token = tokenId ? tokenOf(tokenId) : null;
        // `clear` : tout ce que les horaires ont posé sur le token (créneau, sommeil, caché par l'horaire), et sa mémoire.
        if ( token && clear ) {
          if ( token.getFlag(MODULE_ID, "scheduleHidden") ) await token.update({ hidden: false });
          await token.update(Object.fromEntries(["schedule", "slot", "asleep", "scheduleHidden"].map(k => [`flags.${MODULE_ID}.-=${k}`, null])));
          await forget(token);
        }
        if ( token && (slots !== undefined) ) await setOwnSchedule(token, slots);
        const changed = refresh ? await refreshScene(canvas.scene, { delta, force }) : [];
        return { changed, info: token ? scheduleInfo(token) : null, sleepers: sleepersOf(), worldTime: game.time.worldTime };
      },
      /** Réveiller un dormeur tout de suite (scénarios). */
      reveiller: async ({ tokenId }={}) => { await wakeUp(tokenOf(tokenId), { cause: "api" }); return { ok: true }; },
      /** Un pas d'horloge tout de suite (sans attendre la seconde). */
      horloge: async () => { await clockTick(); return { ticked: true }; },
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
