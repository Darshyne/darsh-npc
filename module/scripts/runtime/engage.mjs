/**
 * Engagement automatique (SPEC §10.3, demande de l'utilisateur du 2026-10-13) : le combat commence quand une créature du MJ **voit**
 * une créature qui lui est hostile, ou quand une créature est **attaquée**. Indépendant de l'IA : l'interrupteur « Combat
 * automatique » marche même IA coupée.
 *
 * Qui entre dans le combat (règle de l'utilisateur) : seulement les créatures concernées. Un PJ qui n'est vu par aucune créature
 * hostile **n'est pas en combat** ; il y est ajouté dès qu'une créature hostile le voit. Une créature du MJ entre quand elle voit un
 * ennemi (renforts). Certains PJ peuvent ainsi être en combat et d'autres non.
 *
 * Perception : la vision du moteur (`api.vision.canSee` : lumière, murs, vision dans le noir, brume, Invisible — donc Furtivité
 * réussie —, Aveuglé). Les observateurs sont les créatures du MJ (jamais un PJ : un PJ qui voit sans être vu n'engage rien). Le MJ
 * actif juge, sur la scène qu'il affiche (la vision demande le canevas).
 *
 * Le combat : créé s'il n'y en a pas sur la scène, les créatures ajoutées, l'initiative des PNJ tirée (jamais celle d'un PJ) ; les
 * joueurs lancent la leur ; le combat commence quand tout le monde en a une (le MJ peut aussi le commencer lui-même).
 */
import { MODULE_ID, loc, log, setting, escape } from "../shared.mjs";
import * as engine from "../adapter/engine.mjs";
import { hostile } from "../adapter/view.mjs";
import { haltAll } from "./pilot.mjs";
import { calmAll } from "./clock.mjs";
import { barkSpotted } from "./barks.mjs";

const isActiveGM = () => game.users.activeGM?.isSelf === true;
const OUT = ["dead", "unconscious", "incapacitated", "paralyzed", "petrified", "stunned"];

/** Un PJ : acteur `character`, ou token possédé par un joueur. */
export const isPlayerSide = token => (token?.actor?.type === "character") || !!token?.actor?.hasPlayerOwner;

/** La créature est-elle en état de participer (visible du MJ, debout, pas neutralisée) ? */
function able(token) {
  const actor = token?.actor;
  if ( !actor || token.hidden ) return false;
  if ( (actor.system?.attributes?.hp?.value ?? 1) <= 0 ) return false;
  return !OUT.some(s => actor.statuses?.has(s));
}

/** Le combat de cette scène (le premier, actif d'abord), ou null. */
function combatOf(scene) {
  const all = game.combats.filter(c => c.scene?.id === scene.id);
  return all.find(c => c.active) ?? all[0] ?? null;
}

/**
 * Les couples qui engagent : une créature du MJ, en état, qui voit une créature hostile. Rend les tokens à mettre en combat
 * et la cause lisible (premier couple).
 * @returns {{tokens: TokenDocument[], causes: {observer: string, target: string}[]}}
 */
export function engagementsOn(scene) {
  const tokens = new Map();
  const causes = [];
  const all = scene.tokens.filter(able);
  // §181 (décision de l'utilisateur, 2026-10-14) : deux créatures du MJ hostiles entre elles ne s'engagent que si un PJ est sur la scène.
  const playerHere = all.some(isPlayerSide);
  for ( const observer of all ) {
    if ( isPlayerSide(observer) ) continue;
    for ( const target of all ) {
      if ( (target === observer) || !hostile(observer, target) ) continue;
      if ( !playerHere && !isPlayerSide(target) ) continue;
      if ( engine.canSee(observer, target) !== true ) continue;
      tokens.set(observer.id, observer);
      tokens.set(target.id, target);
      causes.push({ observer: observer.name, target: target.name, observerId: observer.id });
    }
  }
  return { tokens: [...tokens.values()], causes };
}

/**
 * Mettre ces tokens en combat. Le combat est créé s'il le faut ; seuls ceux qui n'y sont pas sont ajoutés ; initiative tirée pour
 * les PNJ ajoutés ; les joueurs dont un PJ entre sont prévenus. Rend `{ combat, added }`.
 */
export async function engage(scene, tokens, causes=[]) {
  let combat = combatOf(scene);
  const inCombat = new Set(combat?.combatants.map(c => c.tokenId) ?? []);
  const fresh = tokens.filter(t => !inCombat.has(t.id));
  if ( !fresh.length ) return { combat, added: [] };
  const created = !combat;
  if ( created ) {
    combat = await CONFIG.Combat.documentClass.create({ scene: scene.id, active: true, [`flags.${MODULE_ID}.engaged`]: true });
  }
  const docs = await combat.createEmbeddedDocuments("Combatant", fresh.map(t => ({
    tokenId: t.id, sceneId: scene.id, actorId: t.actorId, hidden: t.hidden
  })));
  const npcs = docs.filter(c => !isPlayerSide(c.token)).map(c => c.id);
  if ( npcs.length ) await combat.rollInitiative(npcs, { updateTurn: false });
  const players = fresh.filter(isPlayerSide);
  await announce(combat, fresh, players, causes, created);
  // Repérés : ceux qui ont vu parlent (au plus deux), avant le début du combat.
  const observers = [...new Set(causes.map(c => c.observerId).filter(Boolean))].map(id => scene.tokens.get(id)).filter(t => t && fresh.includes(t));
  barkSpotted(observers);
  // Le « ! » au-dessus de ceux qui ont vu (ui/markers.mjs : visible le temps que le combat commence).
  for ( const o of observers ) await o.setFlag(MODULE_ID, "alert", { state: "alert", at: Date.now() }).catch(() => {});
  await maybeStart(combat);
  log.info(`engagement: ${fresh.map(t => t.name).join(", ")} ${created ? "start a combat" : "join the combat"}`);
  return { combat, added: fresh };
}

/** Une carte privée au MJ (qui a vu qui), et une aux joueurs dont un PJ entre en combat. */
async function announce(combat, fresh, players, causes, created) {
  const seen = causes.slice(0, 6).map(c => `<li>${escape(loc("Engagement.AVu", { observer: c.observer, target: c.target }))}</li>`).join("");
  await ChatMessage.create({
    content: `<div class="dnpc-trace"><h4><i class="fa-solid fa-swords"></i> ${escape(loc(created ? "Engagement.Commence" : "Engagement.Rejoint"))}</h4>`
      + `${seen ? `<ul>${seen}</ul>` : ""}<p>${escape(loc("Engagement.Entrent", { names: fresh.map(t => t.name).join(", ") }))}</p></div>`,
    whisper: ChatMessage.getWhisperRecipients("GM").map(u => u.id),
    speaker: { alias: loc("Engagement.Nom") },
    flags: { [MODULE_ID]: { engagement: { combat: combat.id, added: fresh.map(t => t.id), causes } } }
  });
  for ( const token of players ) {
    const owners = game.users.filter(u => !u.isGM && token.actor?.testUserPermission(u, "OWNER")).map(u => u.id);
    if ( !owners.length ) continue;
    await ChatMessage.create({
      content: `<p><i class="fa-solid fa-eye"></i> ${escape(loc("Engagement.Repere", { name: token.name }))}</p>`,
      whisper: owners, speaker: { alias: loc("Engagement.Nom") }
    });
  }
}

/** Commencer le combat engagé quand chaque combattant a son initiative. */
async function maybeStart(combat) {
  if ( !combat || combat.started || !combat.getFlag(MODULE_ID, "engaged") ) return;
  if ( combat.combatants.some(c => c.initiative === null) ) return;
  await combat.startCombat();
}

/* -------------------------------------------- */
/*  Déclencheurs                                 */
/* -------------------------------------------- */

const timers = new Map();

/** Relire la scène peu après un changement (les mouvements arrivent par paquets). */
function schedule(scene) {
  if ( !scene || !isActiveGM() || !setting("autoEngage") ) return;
  clearTimeout(timers.get(scene.id));
  timers.set(scene.id, setTimeout(() => { timers.delete(scene.id); check(scene); }, 350));
}

/** Juger la scène affichée : engager ce qui doit l'être. */
export async function check(scene=canvas.scene) {
  if ( !scene || (scene !== canvas.scene) || !isActiveGM() || !setting("autoEngage") || !engine.active() ) return null;
  const { tokens, causes } = engagementsOn(scene);
  if ( !tokens.length ) return null;
  try { return await engage(scene, tokens, causes); }
  catch(err) { log.error("engagement failed", err); return null; }
}

/** Une attaque résolue : l'attaquant et ses cibles hostiles entrent en combat (une créature attaquée s'en aperçoit). */
async function onResolution(resolution) {
  if ( !isActiveGM() || !setting("autoEngage") || !resolution?.plan?.attack ) return;
  const scene = canvas.scene;
  if ( !scene ) return;
  const source = fromUuidSync(resolution.source ?? "", { strict: false });
  const attacker = source?.isToken ? source.token : source?.getActiveTokens?.(false, true)?.find(t => t.parent === scene);
  if ( !attacker || (attacker.parent !== scene) ) return;
  const targets = (resolution.targets ?? []).map(t => fromUuidSync(t.token ?? "", { strict: false }))
    .filter(t => t && (t.parent === scene) && hostile(attacker, t));
  if ( !targets.length ) return;
  const tokens = [attacker, ...targets].filter(able);
  await engage(scene, tokens, targets.map(t => ({ observer: t.name, target: attacker.name }))).catch(err => log.error("engagement failed", err));
}

const MOVED = ["x", "y", "elevation", "hidden", "level"];

export function registerEngage() {
  game.settings.register(MODULE_ID, "aiEnabled", {
    name: "DNPC.Reglage.IA.Nom", hint: "DNPC.Reglage.IA.Indic", scope: "world", config: true, type: Boolean, default: false,
    onChange: on => {
      ui.controls?.render();
      // Allumer l'IA alors que le niveau du module est « Arrêt » : elle passe au niveau « Combat », sinon l'interrupteur ne ferait rien.
      if ( on && game.user.isGM && (setting("level") === "off") ) game.settings.set(MODULE_ID, "level", "combat");
      // Coupée (bouton ou Ctrl+Alt+N, §13) : les cartes de confirmation tranchées, tous les MJ prévenus.
      if ( !on ) { haltAll(); if ( game.user.isGM ) ui.notifications.info(loc("Pilote.Coupe")); }
      // Coupée : les témoins de comportement disparaissent, et le MJ actif efface les états d'alerte (rallumée, tout repart du calme).
      if ( !on && isActiveGM() ) calmAll().catch(err => log.error("alert states not cleared", err));
      Hooks.callAll(`${MODULE_ID}.aiToggled`, on);
    }
  });
  game.settings.register(MODULE_ID, "autoEngage", {
    name: "DNPC.Reglage.Engagement.Nom", hint: "DNPC.Reglage.Engagement.Indic", scope: "world", config: true, type: Boolean, default: false,
    onChange: on => { ui.controls?.render(); if ( on ) schedule(canvas.scene); }
  });

  // Les deux interrupteurs de la barre d'outils (groupe Tokens), MJ seulement.
  Hooks.on("getSceneControlButtons", controls => {
    const tokens = controls.tokens;
    if ( !tokens?.tools || !game.user.isGM ) return;
    const toggle = (name, key, icon, order) => {
      tokens.tools[name] = {
        name, order, icon, title: `DNPC.Outil.${key}`, toggle: true, visible: true, active: !!setting(key === "IA" ? "aiEnabled" : "autoEngage"),
        onChange: (event, active) => game.settings.set(MODULE_ID, key === "IA" ? "aiEnabled" : "autoEngage", !!active)
      };
    };
    const last = Math.max(0, ...Object.values(tokens.tools).map(t => t.order ?? 0));
    toggle("dnpc-ai", "IA", "fa-solid fa-brain", last + 1);
    toggle("dnpc-engage", "Engagement", "fa-solid fa-swords", last + 2);
  });

  Hooks.on("updateToken", (token, changes) => { if ( MOVED.some(k => k in changes) ) schedule(token.parent); });
  Hooks.on("createToken", token => schedule(token.parent));
  // Un état qui change ce qu'on voit (Invisible posé ou retiré, Aveuglé…) : relire.
  const onEffect = effect => {
    const actor = effect.parent?.documentName === "Actor" ? effect.parent : null;
    const token = actor?.isToken ? actor.token : actor?.getActiveTokens?.(false, true)?.[0];
    if ( token?.parent ) schedule(token.parent);
  };
  Hooks.on("createActiveEffect", onEffect);
  Hooks.on("deleteActiveEffect", onEffect);
  Hooks.on("updateActiveEffect", onEffect);
  Hooks.on("canvasReady", () => schedule(canvas.scene));
  Hooks.on("updateCombatant", combatant => { if ( isActiveGM() ) maybeStart(combatant.combat).catch(() => {}); });
  engine.onResolution(resolution => { onResolution(resolution); });
}
