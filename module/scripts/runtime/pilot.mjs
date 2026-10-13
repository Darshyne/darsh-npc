/**
 * Le pilote (SPEC §9.1, étape 2 du §16) : au tour d'un token piloté, chez le MJ actif, attaquer la meilleure cible **déjà à
 * portée** autant de fois que le moteur l'accorde (Attaques multiples, Attaque supplémentaire), puis finir le tour ; sinon rendre
 * la main au MJ. Une carte de trace, privée au MJ, dit ce qui a été joué et pourquoi. Pas de déplacement à cette étape.
 *
 * Le pilote d'un token : flag de token `flags["darsh-npc"].autopilot` = `on` | `off` (absent : le défaut du monde, réglage
 * `pilotDefault`, `off` — Q12). Jamais un PJ, un token possédé par un joueur ou un token Secret, vérifié à chaque tour (§13).
 */
import { MODULE_ID, loc, log, setting, escape } from "../shared.mjs";
import { levelAtLeast } from "../adapter/settings.mjs";
import * as engine from "../adapter/engine.mjs";
import { attacksOf, viewOf } from "../adapter/view.mjs";
import { factsOf } from "../adapter/sheet.mjs";
import { profileFor } from "./profile.mjs";
import { planAttack } from "../core/plan.mjs";

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const isActiveGM = () => game.users.activeGM?.isSelf === true;
/** États qui empêchent d'agir (PHB 2024 : Neutralisé et ceux qui l'entraînent). */
const OUT = ["dead", "unconscious", "incapacitated", "paralyzed", "petrified", "stunned"];
/** Garde-fou : au-delà, le tour est rendu au MJ (SPEC §13 : budget de temps). */
const MAX_ATTACKS = 8;

/** Le token peut-il être piloté du tout ? Rend null, ou la raison du refus (clé de traduction). */
export function refusal(token) {
  const actor = token?.actor;
  if ( !actor ) return "SansActeur";
  if ( actor.type === "character" ) return "PJ";
  if ( actor.hasPlayerOwner ) return "Joueur";
  if ( token.disposition === CONST.TOKEN_DISPOSITIONS.SECRET ) return "Secret";
  return null;
}

/** Le pilote de ce token : `on` | `off`. */
export function pilotOf(token) {
  const own = token?.getFlag?.(MODULE_ID, "autopilot");
  if ( own === "on" || own === "off" ) return own;
  if ( setting("pilotDefault") === "hostile" ) return (token?.disposition === CONST.TOKEN_DISPOSITIONS.HOSTILE) ? "on" : "off";
  return "off";
}

/** Poser le pilote d'un token (flag de token : rien sur la fiche). */
export async function setPilot(token, mode) {
  if ( !["on", "off"].includes(mode) ) throw new Error(`autopilot: "${mode}" is not on/off`);
  const why = refusal(token);
  if ( (mode === "on") && why ) throw new Error(loc(`Pilote.Refus.${why}`, { name: token.name }));
  await token.setFlag(MODULE_ID, "autopilot", mode);
  return mode;
}

/** Les conditions de monde pour piloter : l'IA allumée (barre d'outils), le niveau du module, moteur actif et au moins « Assisté ». */
function worldReady() {
  return setting("aiEnabled") && levelAtLeast("combat") && engine.active() && engine.levelAtLeast("assisted");
}

/** L'intention que le pilote jouerait maintenant pour ce token (sans rien exécuter). */
export function planFor(token, { allowed=null }={}) {
  const facts = factsOf(token.actor);
  const { profile, enmities } = profileFor(token.actor, token);
  const view = viewOf(token);
  return { plan: planAttack(view, profile, enmities, attacksOf(token, facts), { allowed }), view, profile };
}

/** Les items encore jouables ce tour : ceux des Attaques multiples ouvertes, ou tous (null) si l'action Attaquer en accorde encore. */
function allowedNow(token, combatant) {
  const multi = engine.multiattackLeft(token.actor);
  if ( multi ) {
    const ids = new Set(multi.left.map(uuid => uuid.split(".").at(-1)));
    return ids.size ? ids : new Set();
  }
  const budget = combatant ? engine.budget(combatant) : null;
  if ( !budget ) return null;
  return budget.action ? null : new Set();
}

/** Le résultat lisible d'une résolution sur sa cible. */
function outcomeOf(resolution, targetUuid) {
  if ( !resolution ) return loc("Pilote.Trace.SansReponse");
  const t = (resolution.targets ?? []).find(x => x.token === targetUuid) ?? resolution.targets?.[0];
  if ( resolution.step === "undone" ) return loc("Pilote.Trace.Annule");
  if ( t?.hit === false || resolution.step === "missed" ) return loc("Pilote.Trace.Rate");
  return loc("Pilote.Trace.Touche", { damage: t?.damage?.applied ?? 0 });
}

/**
 * Jouer le tour de ce token, tel que le pilote le fait. Rend `{ steps, reason }` : les attaques jouées, et pourquoi le tour
 * s'arrête (`done` | une raison de rendre la main).
 */
export async function playTurn(token, combatant=null) {
  const steps = [];
  const actor = token.actor;
  if ( OUT.some(s => actor?.statuses?.has(s)) ) return { steps, reason: "incapacitated" };
  if ( engine.turnStopped(token) ) return { steps, reason: "ordered" };
  if ( engine.targetingPending() ) return { steps, reason: "targeting" };
  const started = Date.now();
  let first = true;
  while ( steps.length < MAX_ATTACKS ) {
    if ( game.paused ) return { steps, reason: "paused" };
    if ( (Date.now() - started) > (setting("turnTimeout") * 1000) ) return { steps, reason: "timeout" };
    if ( refusal(token) ) return { steps, reason: "refused" };
    const allowed = first ? null : allowedNow(token, combatant);
    if ( allowed && !allowed.size ) break;
    const { plan } = planFor(token, { allowed });
    if ( plan.type !== "attack" ) return { steps, reason: first ? plan.reason : "done" };
    const target = token.parent.tokens.get(plan.target);
    const activity = await fromUuid(plan.attack.id);
    if ( !target || !activity ) return { steps, reason: "noAttack" };
    const attackMode = (plan.attack.thrown && (plan.mode !== "melee")) ? "thrown" : null;
    const done = engine.resolutionOf(activity.uuid);
    const used = await engine.attackWith(activity, target, { attackMode });
    if ( !used ) return { steps, reason: "refusedByEngine" };
    const resolution = await done;
    steps.push({ target: target.name, attack: plan.attack.name, mode: plan.mode, reasons: plan.reasons, outcome: outcomeOf(resolution, target.uuid) });
    await token.setFlag(MODULE_ID, "lastTarget", target.id);
    first = false;
    if ( !combatant ) break;   // hors combat : une attaque, pour essayer
    await sleep(400);
  }
  return { steps, reason: "done" };
}

/** La carte de trace, privée aux MJ (SPEC §9.1-5, §12). */
async function trace(token, { steps, reason }) {
  const lines = steps.map(s => `<li>${loc("Pilote.Trace.Attaque", {
    attack: escape(s.attack), target: escape(s.target), outcome: escape(s.outcome),
    reasons: s.reasons?.length ? s.reasons.map(r => loc(`Raison.${r}`)).join(", ") : "—"
  })}</li>`).join("");
  const end = (reason === "done") ? "" : `<p class="dnpc-yield">${escape(loc(`Pilote.Rend.${reason}`))}</p>`;
  await ChatMessage.create({
    content: `<div class="dnpc-trace"><h4><i class="fa-solid fa-brain"></i> ${escape(token.name)}</h4>${lines ? `<ul>${lines}</ul>` : ""}${end}</div>`,
    whisper: ChatMessage.getWhisperRecipients("GM").map(u => u.id),
    speaker: { alias: loc("Pilote.Nom") },
    flags: { [MODULE_ID]: { trace: { token: token.uuid, steps, reason } } }
  });
}

const playing = new Set();

/** Au changement de tour : le MJ actif joue le tour d'un token piloté. */
async function onTurnChange(combat, prior, current) {
  if ( !isActiveGM() || !combat?.started || !worldReady() ) return;
  const combatant = combat.combatants.get(current?.combatantId);
  const token = combatant?.token;
  if ( !token || (pilotOf(token) !== "on") || refusal(token) ) return;
  const key = `${combat.id}.${current.round}.${current.turn}`;
  if ( playing.has(key) ) return;
  playing.add(key);
  try {
    // Le moteur remet le budget à neuf par une écriture asynchrone et publie son début de tour : on le laisse finir.
    await sleep(setting("turnDelay"));
    const result = await playTurn(token, combatant);
    log.info(`${token.name}: ${result.steps.length} attack(s), ${result.reason}`);
    await trace(token, result);
    const still = (combat.combatant?.id === combatant.id) && combat.started;
    if ( still && setting("autoEndTurn") && ["done", "outOfReach", "noEnemy", "noAttack", "incapacitated", "ordered"].includes(result.reason) ) {
      await sleep(setting("turnDelay"));
      if ( combat.combatant?.id === combatant.id ) await combat.nextTurn();
    }
  } catch(err) {
    log.error(`${token.name}: turn failed`, err);
    ui.notifications.warn(loc("Pilote.Erreur", { name: token.name, error: err.message }));
  } finally {
    playing.delete(key);
  }
}

/** Le bouton du HUD du token (MJ) : pilote marche / arrêt. */
function onTokenHUD(hud, html) {
  if ( !game.user.isGM ) return;
  const token = hud.document;
  if ( !token || refusal(token) ) return;
  const root = html instanceof HTMLElement ? html : html?.[0];
  const column = root?.querySelector(".col.left");
  if ( !column ) return;
  const on = pilotOf(token) === "on";
  const button = document.createElement("button");
  button.type = "button";
  button.className = `control-icon dnpc-pilot${on ? " active" : ""}`;
  button.dataset.tooltip = loc(on ? "Pilote.HUD.Arreter" : "Pilote.HUD.Lancer");
  button.innerHTML = `<i class="fa-solid fa-brain"></i>`;
  button.addEventListener("click", async ev => {
    ev.preventDefault();
    ev.stopPropagation();
    await setPilot(token, on ? "off" : "on").catch(err => ui.notifications.warn(err.message));
    hud.render();
  });
  column.append(button);
}

export function registerPilot() {
  game.settings.register(MODULE_ID, "pilotDefault", {
    name: "DNPC.Reglage.PiloteDefaut.Nom", hint: "DNPC.Reglage.PiloteDefaut.Indic", scope: "world", config: true, type: String,
    choices: { off: "DNPC.Reglage.PiloteDefaut.off", hostile: "DNPC.Reglage.PiloteDefaut.hostile" }, default: "off"
  });
  game.settings.register(MODULE_ID, "autoEndTurn", {
    name: "DNPC.Reglage.FinDeTour.Nom", hint: "DNPC.Reglage.FinDeTour.Indic", scope: "world", config: true, type: Boolean, default: true
  });
  game.settings.register(MODULE_ID, "turnDelay", {
    name: "DNPC.Reglage.Delai.Nom", hint: "DNPC.Reglage.Delai.Indic", scope: "world", config: true, type: Number,
    range: { min: 200, max: 3000, step: 100 }, default: 800
  });
  game.settings.register(MODULE_ID, "turnTimeout", {
    name: "DNPC.Reglage.Temps.Nom", hint: "DNPC.Reglage.Temps.Indic", scope: "world", config: true, type: Number,
    range: { min: 15, max: 120, step: 5 }, default: 45
  });
  Hooks.on("combatTurnChange", (combat, prior, current) => { onTurnChange(combat, prior, current); });
  // Le premier tour d'un combat ne passe pas par combatTurnChange (cœur V14 : `Combat#startCombat` → hook `combatStart`).
  Hooks.on("combatStart", combat => {
    onTurnChange(combat, null, { combatantId: combat.combatant?.id, round: combat.round, turn: combat.turn });
  });
  Hooks.on("renderTokenHUD", onTokenHUD);
}
