/**
 * Les horaires des PNJ en jeu (SPEC §10.6, étape 9 bis). Chez le MJ actif, sur la scène qu'il affiche.
 *
 *  - **Où** : l'horaire propre d'un token (flag de token `schedule`), les heures d'une patrouille ou d'un poste (`hours` du
 *    comportement), l'horaire d'un groupe sur la scène (flag de scène `schedules` = `[{ group, slots }]`). Ordre : core/schedule.mjs
 *    `decide`.
 *  - **Quand** : relu à chaque changement de l'horloge du **monde** (`updateWorldTime`, cœur V14 — avancée par le module de temps de la
 *    table, le repos ou le MJ ; jamais touchée ici), à l'affichage d'une scène et quand un horaire change. Le créneau décidé est noté
 *    sur le token (flag `slot`) ; l'horloge temps réel (runtime/clock.mjs) en fait sa routine.
 *  - **Relève** : un créneau qui change marche d'un lieu à l'autre (le moteur) ; un **saut** d'au moins une heure (repos long, MJ qui
 *    avance l'horloge) téléporte au lieu du nouveau créneau et remet l'alerte au calme (rattrapage, §10.6).
 *  - **Sommeil** : un token `sleep` arrivé dans son dortoir **s'endort** (flag de token `asleep`, marqueur 💤 — aucun état sur l'acteur) :
 *    il ne voit rien, n'engage personne ; un pas hostile non caché à 3 cases, un combat à 12 cases qu'il entend (moteur `canHear`) ou
 *    l'alarme de son groupe le réveillent après `wake` secondes (en rounds pendant un combat) ; un dégât ou une entrée en combat, tout
 *    de suite. Réveillé par un bruit, il va voir, puis reste éveillé dix minutes réelles avant de se rendormir.
 *  - **Hors scène** (`off`) : le token est caché (flag `scheduleHidden` : seuls ceux-là sont révélés ensuite, jamais un token caché
 *    par le MJ ou par une réserve).
 */
import { MODULE_ID, log } from "../shared.mjs";
import * as engine from "../adapter/engine.mjs";
import { hostile, centreOf, footprintOf } from "../adapter/view.mjs";
import { PATROL_TYPE, POST_TYPE, behaviorOf, cellsOf, regionHas } from "../adapter/behaviors.mjs";
import { routePoints } from "../core/alert.mjs";
import { normalizeSlots, decide, parseHours, isCatchUp, wakeRounds, WAKE_SECONDS } from "../core/schedule.mjs";
import { refusal } from "./pilot.mjs";
import { groupOf } from "./flags.mjs";
import { memOf, forget } from "./clock.mjs";

const isActiveGM = () => game.users.activeGM?.isSelf === true;
/** Un pas hostile non caché réveille à tant de cases ; un combat entendu, à tant. */
const SLEEP_STEP_CELLS = 3;
const SLEEP_FIGHT_CELLS = 12;
/** Réveillé par un bruit, il reste éveillé tant de temps (ms réelles) avant de se rendormir. */
const AWAKE_MS = 10 * 60 * 1000;

/* -------------------------------------------- */
/*  Lire                                         */
/* -------------------------------------------- */

/** L'heure du monde en minutes depuis minuit, et la longueur du jour (calendrier du cœur). */
export function worldMinute() {
  const c = game.time.components ?? {};
  const days = game.time.calendar?.days ?? {};
  const perHour = days.minutesPerHour ?? 60;
  return { minute: ((c.hour ?? 0) * perHour) + (c.minute ?? 0), dayMinutes: (days.hoursPerDay ?? 24) * perHour };
}

/** L'horaire propre d'un token (brut). */
export const ownSchedule = token => token?.getFlag?.(MODULE_ID, "schedule") ?? null;

/** Les horaires de groupe d'une scène : `[{ group, slots }]`. */
export const groupSchedules = scene => {
  const raw = scene?.getFlag?.(MODULE_ID, "schedules");
  return Array.isArray(raw) ? raw : [];
};

/** L'horaire du groupe de ce token sur sa scène (brut), ou null. */
export function groupSchedule(token) {
  const group = groupOf(token);
  return groupSchedules(token.parent).find(g => g.group === group)?.slots ?? null;
}

/** L'affectation du token (patrouille, poste) et les heures de sa région. */
function assignmentOf(token, dayMinutes) {
  for ( const [kind, type] of [["route", PATROL_TYPE], ["post", POST_TYPE]] ) {
    const id = token.getFlag(MODULE_ID, kind);
    const region = id ? token.parent.regions.get(id) : null;
    const behavior = region ? behaviorOf(region, type) : null;
    if ( behavior ) return { kind, region: region.id, hours: parseHours(behavior.system?.hours, dayMinutes) };
  }
  return null;
}

/** Le token a-t-il un horaire (propre, de groupe, ou des heures à son poste) ? */
export function scheduled(token) {
  if ( !token?.parent || refusal(token) ) return false;
  if ( ownSchedule(token)?.length ) return true;
  if ( groupSchedule(token)?.length ) return true;
  const { dayMinutes } = worldMinute();
  return !!assignmentOf(token, dayMinutes)?.hours?.length;
}

/** Ce que le token doit faire maintenant d'après ses horaires (sans rien écrire), ou null. */
export function decideFor(token) {
  const { minute, dayMinutes } = worldMinute();
  const own = normalizeSlots(ownSchedule(token), dayMinutes).slots;
  const group = normalizeSlots(groupSchedule(token), dayMinutes).slots;
  return decide({ own, group, assignment: assignmentOf(token, dayMinutes) }, minute);
}

/** Le créneau en cours, noté sur le token (`{ key, activity, region, wake, source }`, `activity` null = rien), ou null (pas d'horaire). */
export const slotOf = token => token?.getFlag?.(MODULE_ID, "slot") ?? null;

/** Dort-il ? */
export const asleep = token => !!token?.getFlag?.(MODULE_ID, "asleep");

/* -------------------------------------------- */
/*  Appliquer                                    */
/* -------------------------------------------- */

/** Des cases libres d'une région (aucun token vivant dessus), au hasard. */
function freeCellsIn(region, token) {
  const bottom = region.elevation?.bottom;
  const cells = cellsOf(region, { elevation: Number.isFinite(bottom) ? bottom : 0 });
  const taken = new Set();
  for ( const other of region.parent.tokens ) {
    if ( (other === token) || !other.actor || ((other.actor.system?.attributes?.hp?.value ?? 1) <= 0) ) continue;
    const f = footprintOf(other);
    for ( let i = f.i0; i <= f.i1; i++ ) for ( let j = f.j0; j <= f.j1; j++ ) taken.add(`${i}.${j}`);
  }
  return cells.filter(c => !taken.has(`${c.i}.${c.j}`)).sort(() => Math.random() - 0.5);
}

/** Le bas d'une région (élévation), ou null s'il n'est pas borné. */
const bottomOf = region => (Number.isFinite(region?.elevation?.bottom) ? region.elevation.bottom : null);

/** Le niveau V14 d'une région (le premier), ou null. */
export function levelOfRegion(region) {
  const levels = region?.levels;
  if ( !levels?.size ) return null;
  return [...levels][0];
}

/** Où se trouve le lieu d'un créneau : un point (centre de case) et un niveau, ou null (sur place). */
export function placeOf(token, slot) {
  const region = slot?.region ? token.parent.regions.get(slot.region) : null;
  if ( !region ) return null;
  if ( slot.activity === "patrol" ) {
    const points = routePoints(region.shapes.map(s => s.toObject?.() ?? s));
    return points.length ? { x: points[0].x, y: points[0].y, level: levelOfRegion(region), elevation: bottomOf(region) } : null;
  }
  const cell = freeCellsIn(region, token)[0];
  return cell ? { x: cell.x, y: cell.y, level: levelOfRegion(region), elevation: bottomOf(region) } : null;
}

/**
 * Poser le token sur son lieu, sans marche (rattrapage d'un saut d'horloge, ou retour d'un token « parti »). C'est une mise en place
 * par le MJ actif, comme une réserve qui crée ses tokens : pas un déplacement de jeu (aucune règle de mouvement ne s'applique).
 */
async function place(token, point, extra={}) {
  const size = token.parent.grid.size;
  const update = { _id: token.id, x: point.x - ((token.width * size) / 2), y: point.y - ((token.height * size) / 2), ...extra };
  if ( point.level && (point.level !== token._source.level) ) update.level = point.level;
  if ( Number.isFinite(point.elevation) ) update.elevation = point.elevation;
  // On n'attend pas plus de trois secondes (voir `halt`).
  halt(token);
  const done = token.parent.updateEmbeddedDocuments("Token", [update], { animate: false });
  await Promise.race([done, new Promise(r => setTimeout(r, 3000))]);
}

/** Le réveil d'un token (sans alerte : la fin d'un créneau de sommeil, ou un bruit après son délai). */
export async function wakeUp(token, { point=null, alarmed=null, cause="slot" }={}) {
  const mem = memOf(token);
  mem.wake = null;
  if ( asleep(token) ) await token.unsetFlag(MODULE_ID, "asleep").catch(() => {});
  if ( cause !== "slot" ) mem.awakeUntil = Date.now() + AWAKE_MS;
  if ( alarmed ) { mem.alarmed = { ...alarmed }; mem.alarmAt = Date.now(); }
  else if ( point ) mem.heard = { ...point };
  log.info(`${token.name} wakes up (${cause})`);
}

/** S'endormir (dans son dortoir, au calme). */
async function fallAsleep(token) {
  if ( asleep(token) ) return;
  await token.setFlag(MODULE_ID, "asleep", { since: game.time.worldTime });
  log.info(`${token.name} falls asleep`);
}

/**
 * Arrêter le mouvement du cœur en cours d'un token. Tant qu'il n'est pas fini (animation qui ne finit pas : fenêtre du MJ en
 * arrière-plan), le cœur met en file **toute** mise à jour du token derrière lui — un flag compris —, et la relève attendait sans fin.
 */
function halt(token) {
  if ( !token.movement || ["completed", "stopped"].includes(token.movement.state) ) return;
  try { token.stopMovement?.(); } catch(err) { log.warn(`${token.name}: movement not stopped`, err); }
}

/** Passer d'un créneau à l'autre. `jump` : rattrapage (téléporte, remet au calme). */
async function transition(token, before, next, { jump=false }={}) {
  const entry = { at: Date.now(), name: token.name, to: next?.key ?? "none", jump, steps: [], token };
  trace.push(entry);
  if ( trace.length > 30 ) trace.shift();
  try { await transitionSteps(token, next, { jump, entry }); }
  finally { traced(entry, "end"); delete entry.token; }
}

async function transitionSteps(token, next, { jump, entry }) {
  // Un nouveau créneau interrompt la marche en cours (relève : il repart vers son nouveau lieu).
  halt(token);
  memOf(token).walking = false;
  const stored = next ? { key: next.key, activity: next.activity, region: next.region ?? null, wake: next.wake ?? WAKE_SECONDS,
    source: next.source } : { key: "none", activity: null, region: null };
  traced(entry, "start");
  await token.setFlag(MODULE_ID, "slot", stored);
  traced(entry, "slot");
  const wasHidden = !!token.getFlag(MODULE_ID, "scheduleHidden");
  if ( asleep(token) && (stored.activity !== "sleep") ) await wakeUp(token, { cause: "slot" });
  if ( jump ) await forget(token);
  traced(entry, "forget");
  const mem = memOf(token);
  Object.assign(mem, { route: null, failedAt: null, arrived: false, glance: null, base: null, awakeUntil: 0 });
  // Hors de la scène.
  if ( stored.activity === "off" ) {
    if ( jump || !stored.region ) await hide(token);
    return;
  }
  // Déjà dans la région de son créneau (un rattrapage n'y touche pas) : il y reste.
  const region = stored.region ? token.parent.regions.get(stored.region) : null;
  const inside = !!region && (stored.activity !== "patrol") && regionHas(region, centreOf(token), token._source.elevation ?? 0);
  const point = (stored.activity && !inside) ? placeOf(token, stored) : null;
  if ( wasHidden ) {
    // Il revient : à son nouveau lieu (ou où il était parti), révélé.
    await token.unsetFlag(MODULE_ID, "scheduleHidden");
    await place(token, point ?? centreOf(token), { hidden: false });
  } else if ( jump && point ) await place(token, point);
  traced(entry, `placed ${point ? "yes" : "no"} inside ${inside}`);
  memOf(token).home = point ? { x: point.x, y: point.y } : centreOf(token);
  if ( jump && (stored.activity === "sleep") ) await fallAsleep(token);
  traced(entry, "asleep");
}

/** Cacher un token « parti » (horaire `off`). */
export async function hide(token) {
  if ( token.hidden ) return;
  await token.setFlag(MODULE_ID, "scheduleHidden", true);
  await token.update({ hidden: true });
}

/** Les dernières relèves (diagnostic des scénarios) : `{ at, name, to, jump, steps: [[étape, ms]] }`. */
export const trace = [];
const traced = (entry, step) => entry?.steps.push([step, Date.now() - entry.at, entry.token?.movement?.state ?? null]);

/** Les relectures passent une à la fois ; `next` : celle qui attend son tour (les demandes qui arrivent s'y fusionnent). */
let tail = Promise.resolve();
let next = null;

/**
 * Relire les horaires de la scène (MJ actif). `delta` : le saut de l'horloge du monde qui l'a demandé (secondes). Une demande qui arrive
 * pendant une relecture n'est pas perdue (un saut juste après la pose d'un horaire) : elle passe ensuite, fusionnée avec les autres
 * demandes en attente (le plus grand saut, `force`).
 */
export function refreshScene(scene=canvas?.scene, { delta=null, force=false }={}) {
  if ( !scene || !isActiveGM() ) return Promise.resolve([]);
  if ( next && (next.scene === scene) ) {
    if ( Math.abs(Number(delta) || 0) > Math.abs(Number(next.delta) || 0) ) next.delta = delta;
    next.force ||= force;
    return next.promise;
  }
  const req = { scene, delta, force };
  next = req;
  req.promise = tail = tail.catch(() => null).then(() => {
    if ( next === req ) next = null;
    return refreshNow(req.scene, req);
  });
  return req.promise;
}

/** L'heure du monde vue par la dernière relecture : un saut se voit quelle que soit la demande qui le lit en premier. */
let lastSeen = null;

async function refreshNow(scene, { delta, force }) {
  const changed = [];
  const now = game.time.worldTime;
  // Une relecture sans saut demandée juste avant un saut d'horloge (un horaire qui vient d'être posé) passe parfois après lui : c'est
  // l'écart avec la relecture précédente qui dit le rattrapage, pas seulement le `delta` de la demande.
  const jump = isCatchUp(delta) || ((lastSeen !== null) && isCatchUp(now - lastSeen));
  lastSeen = now;
  // Un rattrapage pose les tokens : une marche du moteur en cours les remettrait sur leur ancien chemin. Les marches de ce client (le
  // MJ actif : celles de l'IA) s'arrêtent d'abord — un saut d'une heure remet tout le monde au calme de toute façon.
  if ( jump && scene.tokens.some(t => scheduled(t) && memOf(t).walking) ) {
    engine.stopWalks();
    await new Promise(r => setTimeout(r, 400));
  }
  for ( const token of scene.tokens ) {
    const stored = slotOf(token);
    if ( !scheduled(token) ) {
      if ( stored ) await token.unsetFlag(MODULE_ID, "slot");
      continue;
    }
    const next = decideFor(token);
    const key = next?.key ?? "none";
    if ( !force && (stored?.key === key) ) continue;
    try {
      await transition(token, stored, next, { jump: jump || (force && !stored) });
      changed.push({ name: token.name, from: stored?.key ?? null, to: key, jump });
    } catch(err) { log.error(`${token.name}: schedule transition failed`, err); }
  }
  if ( changed.length ) log.info(`schedules: ${changed.map(c => `${c.name} → ${c.to}${c.jump ? " (jump)" : ""}`).join(", ")}`);
  return changed;
}

/* -------------------------------------------- */
/*  L'horloge temps réel                          */
/* -------------------------------------------- */

/** Combat commencé de la scène, ou null. */
const startedCombat = scene => game.combats.find(c => c.started && (c.scene?.id === scene.id)) ?? null;

/**
 * Un pas d'horloge pour un token à horaire : rend true s'il dort (l'horloge ne lui fait rien voir ni faire). S'endort dans son dortoir,
 * se réveille à l'heure dite après un bruit ou l'alarme.
 */
export async function sleepStep(token, { atHome, walking, state }) {
  const slot = slotOf(token);
  const mem = memOf(token);
  const now = Date.now();
  if ( !asleep(token) ) {
    if ( (slot?.activity === "sleep") && atHome && !walking && (state === "idle") && (now >= (mem.awakeUntil ?? 0)) ) await fallAsleep(token);
    return asleep(token);
  }
  // L'alarme du groupe, reçue en dormant : un bruit qui réveille, et le but à suivre une fois debout.
  if ( mem.alarmed ) { soundAt(token, mem.alarmed, { alarmed: mem.alarmed }); mem.alarmed = null; }
  const wake = mem.wake;
  if ( wake ) {
    const combat = startedCombat(token.parent);
    const due = Number.isFinite(wake.round) ? (combat ? combat.round >= wake.round : true) : now >= wake.at;
    if ( due ) { await wakeUp(token, { point: wake.point, alarmed: wake.alarmed, cause: wake.alarmed ? "alarm" : "noise" }); return false; }
  }
  return true;
}

/** Un bruit pour un dormeur : son réveil est programmé (le premier bruit compte ; l'alarme remplace un bruit). */
function soundAt(token, point, { alarmed=null }={}) {
  const mem = memOf(token);
  if ( mem.wake && !(alarmed && !mem.wake.alarmed) ) return;
  const seconds = Number.isFinite(slotOf(token)?.wake) ? slotOf(token).wake : WAKE_SECONDS;
  const combat = startedCombat(token.parent);
  mem.wake = combat ? { round: combat.round + wakeRounds(seconds), point: { ...point }, alarmed }
    : { at: Date.now() + (seconds * 1000), point: { ...point }, alarmed };
}

/**
 * Un bruit à `point`, fait par `source` (un token) : les dormeurs de la scène à `cells` cases qui l'entendent (moteur `canHear`) se
 * réveilleront. `hostileOnly` : seulement un pas ennemi (un camarade qui passe ne réveille personne).
 */
export function noiseNear(scene, point, source, { cells=SLEEP_STEP_CELLS, hostileOnly=true }={}) {
  if ( !isActiveGM() || !scene ) return [];
  const radius = cells * scene.grid.size;
  const woken = [];
  for ( const sleeper of scene.tokens ) {
    if ( (sleeper === source) || !asleep(sleeper) || sleeper.hidden ) continue;
    if ( hostileOnly && !(source && hostile(sleeper, source)) ) continue;
    const at = centreOf(sleeper);
    if ( Math.hypot(at.x - point.x, at.y - point.y) > radius ) continue;
    if ( source && (engine.canHear(sleeper, source) === false) ) continue;
    soundAt(sleeper, point);
    woken.push(sleeper.name);
  }
  return woken;
}

/** Un pas de token (hors de l'horloge des menés : un PJ aussi fait du bruit). */
export function onStep(mover) {
  if ( !mover?.actor || mover.hidden || engine.isHidden(mover) || (mover.parent !== canvas.scene) ) return;
  noiseNear(mover.parent, centreOf(mover), mover);
}

/** Pour les scénarios : les dormeurs de la scène et leur réveil. */
export function sleepersOf(scene=canvas?.scene) {
  return (scene?.tokens ?? []).filter(asleep).map(t => {
    const wake = memOf(t).wake;
    return { id: t.id, name: t.name, wake: wake ? { at: wake.at ?? null, round: wake.round ?? null, alarmed: !!wake.alarmed } : null };
  });
}

/* -------------------------------------------- */
/*  Écrire un horaire                            */
/* -------------------------------------------- */

/** Poser l'horaire propre d'un token (null : le retirer), puis relire la scène. */
export async function setOwnSchedule(token, slots) {
  if ( refusal(token) ) throw new Error(`${token.name}: never a player character`);
  if ( slots?.length ) await token.update({ [`flags.${MODULE_ID}.schedule`]: slots });
  else await token.unsetFlag(MODULE_ID, "schedule");
  if ( !scheduled(token) && slotOf(token) ) await token.unsetFlag(MODULE_ID, "slot");
  if ( token.parent === canvas.scene ) await refreshScene(token.parent);
  return ownSchedule(token);
}

/** Poser l'horaire d'un groupe sur une scène (null : le retirer), puis relire la scène. */
export async function setGroupSchedule(scene, group, slots) {
  const list = groupSchedules(scene).filter(g => g.group !== group);
  if ( slots?.length ) list.push({ group, slots });
  await scene.update({ [`flags.${MODULE_ID}.schedules`]: list });
  if ( scene === canvas.scene ) await refreshScene(scene);
  return groupSchedules(scene);
}

export function registerSchedules() {
  const later = foundry.utils.debounce(() => refreshScene().catch(err => log.error("schedules failed", err)), 200);
  // L'horloge du monde (cœur V14) : un saut d'au moins une heure est un rattrapage.
  let jumped = 0;
  const jumpLater = foundry.utils.debounce(() => {
    const delta = jumped;
    jumped = 0;
    refreshScene(canvas?.scene, { delta }).catch(err => log.error("schedules failed", err));
  }, 200);
  Hooks.on("updateWorldTime", (worldTime, delta) => {
    if ( !isActiveGM() ) return;
    jumped += Number(delta) || 0;
    jumpLater();
  });
  // Une scène affichée : le temps a pu passer depuis (le créneau noté n'est plus le bon : rattrapage).
  Hooks.on("canvasReady", () => {
    if ( !isActiveGM() ) return;
    setTimeout(() => refreshScene(canvas.scene, { delta: Infinity }).catch(err => log.error("schedules failed", err)), 500);
  });
  // Un horaire, une affectation, un groupe qui changent ; un comportement de poste ou de patrouille modifié.
  Hooks.on("updateToken", (token, changes) => {
    const f = changes.flags?.[MODULE_ID];
    if ( !isActiveGM() || !f || (token.parent !== canvas.scene) ) return;
    if ( ["schedule", "-=schedule", "route", "-=route", "post", "-=post", "group", "-=group"].some(k => k in f) ) later();
  });
  Hooks.on("updateScene", (scene, changes) => { if ( isActiveGM() && (scene === canvas.scene) && changes.flags?.[MODULE_ID] ) later(); });
  Hooks.on("updateRegionBehavior", b => { if ( isActiveGM() && [PATROL_TYPE, POST_TYPE].includes(b.type) ) later(); });
  // Un pas dans le noir réveille les dormeurs proches ; un combat entendu, ceux de plus loin.
  Hooks.on("updateToken", (token, changes) => { if ( isActiveGM() && (("x" in changes) || ("y" in changes)) ) onStep(token); });
  engine.onResolution(resolution => {
    if ( !isActiveGM() || !canvas.scene ) return;
    const source = fromUuidSync(resolution.source ?? "", { strict: false });
    const attacker = source?.isToken ? source.token : source?.getActiveTokens?.(false, true)?.find(t => t.parent === canvas.scene);
    if ( attacker?.parent === canvas.scene ) noiseNear(canvas.scene, centreOf(attacker), attacker, { cells: SLEEP_FIGHT_CELLS, hostileOnly: false });
  });
  // Un dégât, une entrée en combat : réveillé tout de suite.
  Hooks.on("updateActor", (actor, changes, options) => {
    if ( !isActiveGM() || !changes.system?.attributes?.hp ) return;
    // dnd5e note les PV d'avant dans `options.dnd5e.hp` : une perte (PV ou PV temporaires) réveille ; à défaut, tout changement.
    const before = options?.dnd5e?.hp, hp = actor.system.attributes.hp;
    if ( before && !(((before.value ?? 0) > (hp.value ?? 0)) || ((before.temp ?? 0) > (hp.temp ?? 0))) ) return;
    for ( const t of actor.getActiveTokens?.(false, true) ?? [] ) if ( asleep(t) ) wakeUp(t, { point: centreOf(t), cause: "damage" }).catch(() => {});
  });
  Hooks.on("createCombatant", combatant => {
    const t = combatant.token;
    if ( isActiveGM() && t && asleep(t) ) wakeUp(t, { cause: "combat" }).catch(() => {});
  });
}

/** Les sources d'un token (pour l'éditeur et les scénarios) : son horaire, celui de son groupe, le créneau noté. */
export function scheduleInfo(token) {
  const { minute, dayMinutes } = worldMinute();
  return {
    minute, dayMinutes, group: groupOf(token), own: ownSchedule(token), groupSlots: groupSchedule(token),
    problems: [...normalizeSlots(ownSchedule(token), dayMinutes).problems, ...normalizeSlots(groupSchedule(token), dayMinutes).problems],
    decided: decideFor(token), slot: slotOf(token), asleep: asleep(token), hiddenBySchedule: !!token.getFlag(MODULE_ID, "scheduleHidden"),
    inRegion: (() => {
      const s = slotOf(token);
      const region = s?.region ? token.parent.regions.get(s.region) : null;
      return region ? regionHas(region, centreOf(token), token._source.elevation ?? 0) : null;
    })()
  };
}
