/**
 * Le pilote (SPEC §9.1, étapes 2 et 3 du §16) : au tour d'un token piloté, chez le MJ actif, attaquer la meilleure cible à portée
 * autant de fois que le moteur l'accorde (Attaques multiples, Attaque supplémentaire), puis finir le tour. Personne à portée : il
 * s'approche de la meilleure cible par le chemin du moteur (au contact, ou à portée normale **en la voyant** pour un tireur), en
 * Sprintant au contact si son déplacement ne suffit pas, puis attaque s'il le peut encore. Une carte de trace, privée au MJ, dit
 * ce qui a été joué et pourquoi.
 *
 * Étape 4 : le **moral** d'abord (runtime/morale.mjs : test, fuite, reddition) ; le mode **`confirm`** (runtime/confirm.mjs : l'intention
 * montrée au MJ, qui joue, choisit une autre cible, passe ou prend la main) ; la **reprise de main** (§12.3 : un geste du MJ sur le
 * token pendant son tour — le déplacer, utiliser une de ses activités — suspend le pilote pour ce tour) ; l'**arrêt d'urgence** (§13 :
 * Ctrl+Alt+N coupe l'IA, le tour en cours s'arrête à la fin de son étape).
 *
 * Le pilote d'un token : flag de token `flags["darsh-npc"].autopilot` = `on` | `confirm` | `off` (absent : le défaut du monde, réglage
 * `pilotDefault`, `off` — Q12). Jamais un PJ, un token possédé par un joueur ou un token Secret, vérifié à chaque tour (§13).
 */
import { MODULE_ID, loc, log, setting, escape } from "../shared.mjs";
import { levelAtLeast } from "../adapter/settings.mjs";
import * as engine from "../adapter/engine.mjs";
import { attacksOf, viewOf } from "../adapter/view.mjs";
import { factsOf } from "../adapter/sheet.mjs";
import { profileFor } from "./profile.mjs";
import { planAttack, planMove } from "../core/plan.mjs";
import { checkMorale, fleeTurn, moraleOf, noteHarm } from "./morale.mjs";
import { askConfirm, answerAll } from "./confirm.mjs";
import { bark } from "./barks.mjs";

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const isActiveGM = () => game.users.activeGM?.isSelf === true;
/** États qui empêchent d'agir (PHB 2024 : Neutralisé et ceux qui l'entraînent). */
const OUT = ["dead", "unconscious", "incapacitated", "paralyzed", "petrified", "stunned"];
/** Garde-fou : au-delà, le tour est rendu au MJ (SPEC §13 : budget de temps). */
const MAX_ATTACKS = 8;
/** Déplacements par tour : un pour s'approcher, un autre après une cible tombée. */
const MAX_MOVES = 2;
/** Les modes du pilote. */
export const PILOT_MODES = Object.freeze(["off", "on", "confirm"]);
/** Raisons de fin qui laissent finir le tour tout seul (`autoEndTurn`). */
const ENDS_TURN = ["done", "outOfReach", "noEnemy", "noAttack", "incapacitated", "ordered", "noPath", "noMovement", "fleeing", "surrendered", "tooHigh"];
/** Raisons d'un refus de grimper qui disent « hors d'atteinte » (moteur §196). */
const UNREACHABLE = ["noWall", "cannotClimb", "tooHigh", "refused", "notOwner"];

/** Le token peut-il être piloté du tout ? Rend null, ou la raison du refus (clé de traduction). */
export function refusal(token) {
  const actor = token?.actor;
  if ( !actor ) return "SansActeur";
  if ( actor.type === "character" ) return "PJ";
  if ( actor.hasPlayerOwner ) return "Joueur";
  if ( token.disposition === CONST.TOKEN_DISPOSITIONS.SECRET ) return "Secret";
  return null;
}

/** Le pilote de ce token : `on` | `confirm` | `off`. */
export function pilotOf(token) {
  const own = token?.getFlag?.(MODULE_ID, "autopilot");
  if ( PILOT_MODES.includes(own) ) return own;
  if ( setting("pilotDefault") === "hostile" ) return (token?.disposition === CONST.TOKEN_DISPOSITIONS.HOSTILE) ? "on" : "off";
  return "off";
}

/** Poser le pilote d'un token (flag de token : rien sur la fiche). */
export async function setPilot(token, mode) {
  if ( !PILOT_MODES.includes(mode) ) throw new Error(`autopilot: "${mode}" is not ${PILOT_MODES.join("/")}`);
  const why = refusal(token);
  if ( (mode !== "off") && why ) throw new Error(loc(`Pilote.Refus.${why}`, { name: token.name }));
  await token.setFlag(MODULE_ID, "autopilot", mode);
  return mode;
}

/** Les conditions de monde pour piloter : l'IA allumée (barre d'outils), le niveau du module, moteur actif et au moins « Assisté ». */
function worldReady() {
  return setting("aiEnabled") && levelAtLeast("combat") && engine.active() && engine.levelAtLeast("assisted");
}

/** L'intention que le pilote jouerait maintenant pour ce token (sans rien exécuter). `only` : une cible imposée par le MJ (§12.2). */
export function planFor(token, { allowed=null, only=null }={}) {
  const facts = factsOf(token.actor);
  const { profile, enmities } = profileFor(token.actor, token);
  const view = viewOf(token);
  if ( only && view.enemies.some(e => e.id === only) ) view.enemies = view.enemies.filter(e => e.id === only);
  const attacks = attacksOf(token, facts);
  const plan = planAttack(view, profile, enmities, attacks, { allowed });
  const move = (plan.reason === "outOfReach") ? planMove(view, profile, enmities, attacks, { allowed }) : null;
  return { plan, move, view, profile };
}

/**
 * S'approcher (étape 3, SPEC §9.3) : vers la cible de `move`, par le moteur. Au contact, si le déplacement du tour ne suffit pas et
 * que l'Action est libre, Sprinter d'abord (`dash`) — un tireur ne Sprinte pas : il avance et tire au tour suivant. Rend l'étape
 * jouée `{ type: "move", target, dashed, arrived }`, ou `{ reason }` si rien n'a bougé.
 */
async function moveToward(token, combatant, move) {
  const target = token.parent.tokens.get(move.target);
  if ( !target ) return { reason: "noEnemy" };
  const goal = { reachCells: move.reachCells, seeing: move.seeing };
  let direct = engine.pathToward(token, target, goal);
  // §19 : un grimpeur au mur n'a pas de chemin loin du mur (l'A* du moteur l'y garde) — il redescend d'abord, puis marche au sol.
  const climbing = direct ? null : engine.climbState(token);
  if ( climbing?.climbing && !climbing.onCeiling && (climbing.height > 0) && climbing.canDown ) {
    const cells = Math.ceil((climbing.height / (token.parent.grid.distance || 5)) - 1e-6);
    if ( await engine.climbDown(token, cells) ) direct = engine.pathToward(token, target, goal);
  }
  if ( !direct ) return { reason: "noPath" };
  const left = engine.movement(token);
  if ( left && (left.left <= 0) && !direct.arrives ) return { reason: "noMovement" };
  let dashed = false;
  if ( !direct.arrives && !move.seeing && combatant && engine.budget(combatant)?.action && (left?.speed > 0) ) {
    const sprint = engine.pathToward(token, target, { ...goal, extra: left.speed });
    if ( sprint?.moves ) dashed = await engine.takeBasic(token.actor, "dash");
  }
  if ( !direct.moves && !dashed ) return { reason: direct.arrives ? "outOfReach" : "noMovement" };
  const walked = await engine.approachTarget(token, target, goal);
  if ( walked.reason === "unsupported" ) return { reason: "engineTooOld" };
  // §19 : le moteur juge la cible hors d'allonge par le vide vertical (au plafond) — la vue ne le savait pas : on n'insiste pas.
  if ( walked.reason === "tooHigh" ) return { reason: "tooHigh" };
  return { type: "move", target: target.name, dashed, arrived: !!walked.arrived, why: walked.reason ?? null, reasons: move.reasons };
}

/**
 * §19 (escalade) : grimper jusqu'à l'allonge d'une cible perchée, par le moteur (§196 : le pied du mur à côté d'elle, puis la montée,
 * payées au budget du tour). Rend l'étape `{ type: "climb", target, arrived, climbed }`, ou `{ reason }` si rien n'a bougé.
 */
async function climbToward(token, move) {
  const target = token.parent.tokens.get(move.target);
  if ( !target ) return { reason: "noEnemy" };
  const result = await engine.climbToward(token, target, { reachCells: move.reachCells });
  if ( result.reason === "unsupported" ) return { reason: "tooHigh" };
  if ( !result.arrived && !result.climbed && UNREACHABLE.includes(result.reason) ) return { reason: "tooHigh" };
  return { type: "climb", target: target.name, arrived: !!result.arrived, climbed: result.climbed ?? 0, why: result.reason ?? null, reasons: move.reasons };
}

/* -------------------------------------------- */
/*  Reprise de main (§12.3), arrêt d'urgence     */
/* -------------------------------------------- */

/** Tours dont le pilote a la main : clé `combat.round.turn` → token id. */
const playing = new Map();
/** Tours repris par le MJ. */
const suspended = new Set();
/** Actions du pilote en cours (ses propres déplacements et utilisations ne sont pas des gestes du MJ). */
let busy = 0;
const turnKey = (combat, round=combat.round, turn=combat.turn) => `${combat.id}.${round}.${turn}`;

/** Exécuter une action du pilote : pendant ce temps, ce que le token fait vient de lui, pas du MJ. */
async function act(fn) {
  busy += 1;
  try { return await fn(); } finally { busy -= 1; }
}

/** Le MJ a-t-il repris ce tour ? */
function takenOver(combatant) {
  const combat = combatant?.combat;
  return !!combat && suspended.has(turnKey(combat));
}

/** Un geste du MJ sur un token piloté pendant son tour : le pilote se retire pour ce tour. */
function maybeSuspend(token) {
  const combat = game.combat;
  if ( busy || !token || !combat?.started || (combat.combatant?.tokenId !== token.id) ) return;
  const key = turnKey(combat);
  if ( (playing.get(key) !== token.id) || suspended.has(key) ) return;
  suspended.add(key);
  answerAll("manual", token.id);
  log.info(`${token.name}: the GM takes over this turn`);
  ui.notifications.info(loc("Pilote.Repris", { name: token.name }));
}

/** Arrêt d'urgence (§13) : l'IA coupée, les cartes de confirmation tranchées « Je joue ». Le tour en cours finit son étape. */
export function haltAll() {
  answerAll("manual");
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
 * Jouer le tour de ce token, tel que le pilote le fait. Rend `{ steps, reason }` : les étapes jouées (moral, fuite, déplacements,
 * attaques), et pourquoi le tour s'arrête (`done` | une raison de rendre la main). `only` : la cible imposée par le MJ (§12.2).
 */
export async function playTurn(token, combatant=null, { only=null }={}) {
  const steps = [];
  const actor = token.actor;
  if ( OUT.some(s => actor?.statuses?.has(s)) ) return { steps, reason: "incapacitated" };
  if ( engine.turnStopped(token) ) return { steps, reason: "ordered" };
  if ( engine.targetingPending() ) return { steps, reason: "targeting" };
  const combat = combatant?.combat ?? null;
  if ( combat ) {
    // Le moral d'abord (§9.5) : une créature rendue ne joue plus ; un fuyard fuit, sauf s'il se calme ou, acculé, se défend.
    if ( moraleOf(token, combat).state === "surrendered" ) return { steps, reason: "surrendered" };
    const { profile } = profileFor(actor, token);
    const test = await act(() => checkMorale(token, combat, profile));
    if ( test ) steps.push(test);
    if ( moraleOf(token, combat).state === "fleeing" ) {
      const fled = await act(() => fleeTurn(token, combatant, profile, viewOf(token)));
      steps.push(...fled.steps);
      if ( !["calm", "defend"].includes(fled.reason) ) return { steps, reason: fled.reason };
    }
  }
  const result = await fight(token, combatant, steps, { only });
  if ( combat ) {
    const attacked = result.steps.some(s => s.type === "attack");
    await noteHarm(token, combat, { attacked, couldNotReach: ["outOfReach", "noPath", "noMovement", "tooHigh"].includes(result.reason) });
  }
  return result;
}

/** Le combat du tour : s'approcher et attaquer tant que le moteur l'accorde. */
async function fight(token, combatant, steps, { only=null }={}) {
  const started = Date.now();
  let first = true;
  let moves = 0;
  let attacks = 0;
  while ( attacks < MAX_ATTACKS ) {
    if ( game.paused ) return { steps, reason: "paused" };
    if ( !setting("aiEnabled") ) return { steps, reason: "halted" };
    if ( takenOver(combatant) ) return { steps, reason: "takeover" };
    if ( (Date.now() - started) > (setting("turnTimeout") * 1000) ) return { steps, reason: "timeout" };
    if ( refusal(token) ) return { steps, reason: "refused" };
    let allowed = first ? null : allowedNow(token, combatant);
    // Le moteur publie ce qui reste des Attaques multiples par une écriture du MJ : une seconde lecture avant de conclure.
    if ( allowed && !allowed.size ) { await sleep(600); allowed = allowedNow(token, combatant); }
    if ( allowed && !allowed.size ) break;
    const { plan, move } = planFor(token, { allowed, only });
    if ( plan.type !== "attack" ) {
      // Personne à portée : s'approcher (une fois, une seconde après une cible tombée), puis replanifier.
      if ( ["move", "climb"].includes(move?.type) && (moves < MAX_MOVES) && (combatant || !moves) ) {
        moves += 1;
        const step = await act(() => (move.type === "climb") ? climbToward(token, move) : moveToward(token, combatant, move));
        if ( (step.type === "climb") && !step.arrived ) { steps.push(step); return { steps, reason: "done" }; }
        if ( !["move", "climb"].includes(step.type) ) return { steps, reason: (attacks || moves > 1) ? "done" : step.reason };
        steps.push(step);
        if ( step.dashed ) return { steps, reason: "done" };   // l'Action est partie dans le Sprint
        await sleep(300);
        continue;
      }
      if ( attacks || moves ) return { steps, reason: "done" };
      const reason = (move?.type === "yield") ? move.reason : plan.reason;
      return { steps, reason };
    }
    // Un tir à longue portée (Désavantage) : d'abord se rapprocher à portée normale si le déplacement du tour y suffit.
    if ( (plan.mode === "long") && !moves && combatant && (plan.attack.normal > 0) ) {
      const closer = { type: "move", target: plan.target, reachCells: plan.attack.normal, seeing: true, attack: plan.attack, reasons: plan.reasons };
      const near = engine.pathToward(token, token.parent.tokens.get(plan.target), { reachCells: closer.reachCells, seeing: true });
      if ( near?.arrives && near.moves ) {
        moves += 1;
        const step = await act(() => moveToward(token, combatant, closer));
        if ( step.type === "move" ) { steps.push(step); await sleep(300); continue; }
      }
    }
    const target = token.parent.tokens.get(plan.target);
    const activity = await fromUuid(plan.attack.id);
    if ( !target || !activity ) return { steps, reason: "noAttack" };
    const attackMode = (plan.attack.thrown && (plan.mode !== "melee")) ? "thrown" : null;
    if ( !attacks ) await bark(token, "attack").catch(() => null);
    const done = engine.resolutionOf(activity.uuid);
    const used = await act(() => engine.attackWith(activity, target, { attackMode }));
    if ( !used ) return { steps, reason: "refusedByEngine" };
    const resolution = await act(() => done);
    steps.push({ type: "attack", target: target.name, attack: plan.attack.name, mode: plan.mode, reasons: plan.reasons, outcome: outcomeOf(resolution, target.uuid) });
    attacks += 1;
    await token.setFlag(MODULE_ID, "lastTarget", target.id);
    first = false;
    if ( !combatant ) break;   // hors combat : une attaque, pour essayer
    await sleep(400);
  }
  return { steps, reason: "done" };
}

/** La carte de trace, privée aux MJ (SPEC §9.1-5, §12). */
async function trace(token, { steps, reason }) {
  const why = s => s.reasons?.length ? s.reasons.map(r => loc(`Raison.${r}`)).join(", ") : "—";
  const line = s => {
    switch ( s.type ) {
      case "move": return loc("Pilote.Trace.Approche", {
        target: escape(s.target), how: loc(s.dashed ? "Pilote.Trace.Sprint" : "Pilote.Trace.Marche"),
        outcome: loc(s.arrived ? "Pilote.Trace.Arrive" : "Pilote.Trace.Pas"), reasons: why(s)
      });
      case "climb": return loc("Pilote.Trace.Grimpe", {
        target: escape(s.target), cells: s.climbed, outcome: loc(s.arrived ? "Pilote.Trace.Arrive" : "Pilote.Trace.Pas"), reasons: why(s)
      });
      case "morale": return loc(s.success ? "Pilote.Trace.MoralTient" : "Pilote.Trace.MoralCede", {
        causes: s.causes.map(c => loc(`Moral.Cause.${c}`)).join(", "), total: s.total, dc: s.dc
      });
      case "flee": return loc("Pilote.Trace.Fuite", {
        from: escape(s.from), how: s.action ? loc(`Pilote.Trace.Base.${s.action}`) : "—", gapFrom: s.gapFrom ?? "?", gapTo: s.gapTo ?? "?"
      });
      case "surrender": return loc("Pilote.Trace.Reddition", { items: s.dropped?.length ? escape(s.dropped.join(", ")) : "—" });
      default: return loc("Pilote.Trace.Attaque", { attack: escape(s.attack), target: escape(s.target), outcome: escape(s.outcome), reasons: why(s) });
    }
  };
  const lines = steps.map(s => `<li>${line(s)}</li>`).join("");
  const end = (reason === "done") ? "" : `<p class="dnpc-yield">${escape(loc(`Pilote.Rend.${reason}`))}</p>`;
  await ChatMessage.create({
    content: `<div class="dnpc-trace"><h4><i class="fa-solid fa-brain"></i> ${escape(token.name)}</h4>${lines ? `<ul>${lines}</ul>` : ""}${end}</div>`,
    whisper: ChatMessage.getWhisperRecipients("GM").map(u => u.id),
    speaker: { alias: loc("Pilote.Nom") },
    flags: { [MODULE_ID]: { trace: { token: token.uuid, steps, reason } } }
  });
}

/** Au changement de tour : le MJ actif joue le tour d'un token piloté. */
async function onTurnChange(combat, prior, current) {
  if ( !isActiveGM() || !combat?.started || !worldReady() ) return;
  const combatant = combat.combatants.get(current?.combatantId);
  const token = combatant?.token;
  const mode = pilotOf(token);
  if ( !token || (mode === "off") || refusal(token) ) return;
  const key = turnKey(combat, current.round, current.turn);
  if ( playing.has(key) ) return;
  playing.set(key, token.id);
  try {
    // Le moteur remet le budget à neuf par une écriture asynchrone et publie son début de tour : on le laisse finir.
    await sleep(setting("turnDelay"));
    let only = null;
    if ( mode === "confirm" ) {
      const fleeing = moraleOf(token, combat).state === "fleeing";
      const surrendered = moraleOf(token, combat).state === "surrendered";
      const decision = surrendered ? { choice: "play" } : await askConfirm(token, { ...planFor(token), fleeing });
      if ( (decision.choice === "manual") || suspended.has(key) || !setting("aiEnabled") ) {
        suspended.add(key);
        return;
      }
      if ( decision.choice === "skip" ) {
        if ( combat.combatant?.id === combatant.id ) await combat.nextTurn();
        return;
      }
      only = decision.target ?? null;
    }
    const result = await playTurn(token, combatant, { only });
    log.info(`${token.name}: ${result.steps.length} step(s), ${result.reason}`);
    await trace(token, result);
    const still = (combat.combatant?.id === combatant.id) && combat.started;
    if ( still && setting("autoEndTurn") && ENDS_TURN.includes(result.reason) ) {
      await sleep(setting("turnDelay"));
      if ( combat.combatant?.id === combatant.id ) await combat.nextTurn();
    }
  } catch(err) {
    log.error(`${token.name}: turn failed`, err);
    ui.notifications.warn(loc("Pilote.Erreur", { name: token.name, error: err.message }));
  } finally {
    playing.delete(key);
    suspended.delete(key);
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
  // Un clic fait tourner les modes : arrêt → marche → confirmer → arrêt.
  const mode = pilotOf(token);
  const next = PILOT_MODES[(PILOT_MODES.indexOf(mode) + 1) % PILOT_MODES.length];
  const button = document.createElement("button");
  button.type = "button";
  button.className = `control-icon dnpc-pilot${mode !== "off" ? " active" : ""} dnpc-pilot-${mode}`;
  button.dataset.tooltip = `${loc(`Pilote.HUD.Mode.${mode}`)} — ${loc("Pilote.HUD.Clic", { next: loc(`Pilote.HUD.Mode.${next}`) })}`;
  button.innerHTML = `<i class="fa-solid ${mode === "confirm" ? "fa-circle-question" : "fa-brain"}"></i>`;
  button.addEventListener("click", async ev => {
    ev.preventDefault();
    ev.stopPropagation();
    await setPilot(token, next).catch(err => ui.notifications.warn(err.message));
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
  // Reprise de main (§12.3) : un déplacement ou une utilisation lancés par le MJ sur le token dont le pilote a la main.
  Hooks.on("preUpdateToken", (token, changes) => { if ( ("x" in changes) || ("y" in changes) ) maybeSuspend(token); });
  Hooks.on("dnd5e.preUseActivity", activity => {
    const actor = activity?.actor;
    maybeSuspend(actor?.isToken ? actor.token : actor?.getActiveTokens?.(false, true)?.[0]);
  });
  // Arrêt d'urgence (§13).
  game.keybindings.register(MODULE_ID, "killSwitch", {
    name: "DNPC.Raccourci.Arret.Nom", hint: "DNPC.Raccourci.Arret.Indic", restricted: true,
    editable: [{ key: "KeyN", modifiers: ["Control", "Alt"] }],
    onDown: () => { game.settings.set(MODULE_ID, "aiEnabled", false); return true; }
  });
}
