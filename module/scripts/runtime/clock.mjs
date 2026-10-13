/**
 * L'horloge du temps réel (SPEC §10.4, étape 6a) : chez le MJ actif, un pas par seconde, sur la scène qu'il affiche. Chaque token
 * **mené** par l'IA (pilote en marche ou à confirmer, ou affecté à une patrouille ou à un poste) qui n'est pas dans un combat commencé
 * fait un pas de sa machine d'alerte (core/alert.mjs) : il regarde (la vision du moteur), passe en alerte s'il voit un ennemi, va
 * voir la dernière position connue quand il le perd, reste confus s'il ne trouve rien, puis retourne à sa routine — patrouille,
 * poste de garde, ou son point de départ. Les marches sont celles du moteur (`api.approach`). Le jeu en pause : plus rien ne bouge
 * (les marches en cours sont arrêtées).
 *
 * État : flag de token `alert` = `{ state, at }` (pour les marqueurs, ui/markers.mjs, et après un rechargement) ; le reste (but,
 * marche en cours, point de passage) vit dans la mémoire du MJ actif.
 */
import { MODULE_ID, log, setting } from "../shared.mjs";
import { levelAtLeast } from "../adapter/settings.mjs";
import * as engine from "../adapter/engine.mjs";
import { allied, hostile } from "../adapter/view.mjs";
import { PATROL_TYPE, POST_TYPE, behaviorOf, regionHas } from "../adapter/behaviors.mjs";
import { step, facingToward, routePoints, nextWaypoint, nearestWaypoint } from "../core/alert.mjs";
import { pilotOf, refusal } from "./pilot.mjs";
import { bark } from "./barks.mjs";
import { check as checkEngagement } from "./engage.mjs";

const TICK_MS = 1000;
/** Les alliés à moins de tant de cases entendent un camarade qui donne l'alerte. */
const ALERT_RADIUS = 8;
const OUT = ["dead", "unconscious", "incapacitated", "paralyzed", "petrified", "stunned"];
const isActiveGM = () => game.users.activeGM?.isSelf === true;

/** Mémoire par token : `{ state, goal, ticks, walking, purpose, arrived, heard, home, route, waitUntil }`. */
const memory = new Map();
const memOf = token => {
  if ( !memory.has(token.id) ) memory.set(token.id, { state: "idle", goal: null, ticks: 0, walking: false, purpose: null, arrived: false,
    heard: null, home: null, route: null, waitUntil: 0 });
  return memory.get(token.id);
};

/** Le centre d'un token, à sa position validée (`_source` : la position animée n'est pas la bonne, piège V14). */
function centreOf(token) {
  const size = token.parent.grid.size;
  return { x: token._source.x + ((token.width * size) / 2), y: token._source.y + ((token.height * size) / 2) };
}

function able(token) {
  const actor = token?.actor;
  if ( !actor || token.hidden ) return false;
  if ( (actor.system?.attributes?.hp?.value ?? 1) <= 0 ) return false;
  return !OUT.some(s => actor.statuses?.has(s));
}

/** Le token est-il mené par l'IA hors combat ? */
export function driven(token) {
  if ( refusal(token) ) return false;
  return !!(token.getFlag(MODULE_ID, "route") || token.getFlag(MODULE_ID, "post")) || (pilotOf(token) !== "off");
}

/** Le monde fait-il tourner le temps réel ? */
function running() {
  return setting("aiEnabled") && levelAtLeast("patrols") && engine.active() && !game.paused;
}

/** Le token est-il dans un combat commencé de sa scène ? */
const fighting = token => game.combats.some(c => c.started && (c.scene?.id === token.parent.id) && c.combatants.some(x => x.tokenId === token.id));

/** L'ennemi vu le plus proche (sa position), ou null. */
function seenEnemy(token, all) {
  const me = centreOf(token);
  let best = null, bestD = Infinity;
  for ( const other of all ) {
    if ( (other === token) || !able(other) || !hostile(token, other) ) continue;
    if ( engine.canSee(token, other) !== true ) continue;
    const at = centreOf(other);
    const d = Math.hypot(at.x - me.x, at.y - me.y);
    if ( d < bestD ) { best = at; bestD = d; }
  }
  return best;
}

/**
 * Marcher vers un point. `purpose` : `search` | `home` | `routine`. La routine vise la case exacte (une patrouille passe par ses
 * sommets, sans couper les coins) ; si elle est bloquée (marche ratée vers ce même point), ou pour une recherche, la case et ses
 * voisines : le moteur prend la plus proche.
 */
function walkTo(token, point, purpose) {
  const mem = memOf(token);
  if ( mem.walking || !point ) return;
  const grid = token.parent.grid;
  const c = grid.getOffset({ x: point.x, y: point.y });
  const key = `${c.i}.${c.j}`;
  const exact = (purpose !== "search") && (mem.failedAt !== key);
  const cells = exact ? [{ i: c.i, j: c.j }] : [];
  if ( !exact ) for ( const di of [0, -1, 1] ) for ( const dj of [0, -1, 1] ) cells.push({ i: c.i + di, j: c.j + dj });
  mem.walking = true;
  mem.purpose = purpose;
  engine.approachCells(token, cells, token._source.level ?? null)
    .catch(err => { log.warn(`${token.name}: walk failed`, err); return { arrived: false }; })
    .then(result => {
      mem.walking = false;
      mem.arrived = true;
      mem.failedAt = (exact && !result?.arrived) ? key : null;
    });
}

/** Se tourner vers un point (orientation du token, donnée du token). */
async function face(token, point) {
  const rotation = facingToward(centreOf(token), point);
  if ( rotation === null ) return;
  const diff = Math.abs((((token.rotation - rotation) % 360) + 540) % 360 - 180);
  if ( diff > 15 ) await token.update({ rotation }).catch(() => {});
}

/** La routine de ce token : sa patrouille, son poste, ou rien. */
function routineOf(token) {
  const scene = token.parent;
  const routeId = token.getFlag(MODULE_ID, "route");
  const route = routeId ? scene.regions.get(routeId) : null;
  const patrol = route ? behaviorOf(route, PATROL_TYPE) : null;
  if ( patrol ) return { kind: "route", region: route, behavior: patrol };
  const postId = token.getFlag(MODULE_ID, "post");
  const postRegion = postId ? scene.regions.get(postId) : null;
  const post = postRegion ? behaviorOf(postRegion, POST_TYPE) : null;
  if ( post ) return { kind: "post", region: postRegion, behavior: post };
  return null;
}

/** Est-il chez lui (dans son poste, sur sa patrouille — toujours —, ou à son point de départ) ? */
function atHome(token, routine, mem) {
  if ( routine?.kind === "route" ) return true;
  const here = centreOf(token);
  if ( routine?.kind === "post" ) return regionHas(routine.region, here, token._source.elevation ?? 0);
  if ( !mem.home ) return true;
  return Math.hypot(here.x - mem.home.x, here.y - mem.home.y) <= token.parent.grid.size;
}

/** Rentrer : le point de passage le plus proche, le centre du poste, ou le point de départ. */
function goHome(token, routine, mem) {
  if ( routine?.kind === "route" ) {
    const points = routePoints(routine.region.shapes.map(s => s.toObject?.() ?? s));
    if ( !points.length ) return;
    mem.route = { regionId: routine.region.id, points, index: nearestWaypoint(points, centreOf(token)), direction: 1 };
    walkTo(token, points[mem.route.index], "home");
  } else if ( routine?.kind === "post" ) {
    const b = routine.region.object?.bounds;
    walkTo(token, b ? { x: b.x + (b.width / 2), y: b.y + (b.height / 2) } : mem.home, "home");
  } else if ( mem.home ) walkTo(token, mem.home, "home");
}

/** Un pas de routine au calme. */
async function doRoutine(token, routine, mem, now) {
  if ( mem.walking ) return;
  if ( routine?.kind === "route" ) {
    const points = routePoints(routine.region.shapes.map(s => s.toObject?.() ?? s));
    if ( !points.length ) return;
    if ( !mem.route || (mem.route.regionId !== routine.region.id) || (mem.route.points.length !== points.length) ) {
      mem.route = { regionId: routine.region.id, points, index: nearestWaypoint(points, centreOf(token)), direction: 1 };
      mem.waitUntil = 0;
    }
    mem.route.points = points;
    const target = points[mem.route.index];
    const here = centreOf(token);
    const there = Math.hypot(here.x - target.x, here.y - target.y) <= token.parent.grid.size * ((mem.failedAt ? 1.5 : 0.5));
    if ( !there ) return walkTo(token, target, "routine");
    if ( mem.arrived ) {
      // Arrivé : la pause du comportement, avec un aléa de ±30 %.
      mem.arrived = false;
      const pause = (routine.behavior.system?.pause ?? 3) * 1000;
      mem.waitUntil = now + (pause * (0.7 + (Math.random() * 0.6)));
    }
    if ( now < mem.waitUntil ) return;
    const next = nextWaypoint(points.length, mem.route, routine.behavior.system?.mode ?? "loop");
    mem.route.index = next.index;
    mem.route.direction = next.direction;
    return walkTo(token, points[next.index], "routine");
  }
  if ( routine?.kind === "post" ) {
    const sys = routine.behavior.system ?? {};
    if ( mem.arrived ) { mem.arrived = false; mem.waitUntil = now + 6000 + (Math.random() * 8000); }
    if ( Number.isFinite(sys.facing) && (now >= mem.waitUntil - 4000) ) {
      const diff = Math.abs((((token.rotation - sys.facing) % 360) + 540) % 360 - 180);
      if ( diff > 15 ) await token.update({ rotation: sys.facing }).catch(() => {});
    }
    if ( !sys.wander || (now < mem.waitUntil) ) return;
    // Flâner : un point au hasard dans le poste.
    const b = routine.region.object?.bounds;
    if ( !b ) return;
    for ( let i = 0; i < 10; i++ ) {
      const p = { x: b.x + (Math.random() * b.width), y: b.y + (Math.random() * b.height) };
      if ( regionHas(routine.region, p, token._source.elevation ?? 0) ) return walkTo(token, p, "routine");
    }
    mem.waitUntil = now + 6000;
  }
}

/** Écrire l'état (flag de token, pour les marqueurs) quand il change. */
async function setState(token, state) {
  const own = token.getFlag(MODULE_ID, "alert");
  if ( own?.state === state ) return;
  await token.setFlag(MODULE_ID, "alert", { state, at: Date.now() });
}

/** Un pas pour un token. */
async function tickToken(token, all, now) {
  const mem = memOf(token);
  if ( !mem.home ) mem.home = centreOf(token);
  const routine = routineOf(token);
  const seen = seenEnemy(token, all);
  const purposeWasSearch = mem.purpose === "search";
  const input = { seen, heard: mem.heard, arrived: mem.arrived && purposeWasSearch, atHome: atHome(token, routine, mem), walking: mem.walking };
  mem.heard = null;
  if ( purposeWasSearch && mem.arrived ) mem.arrived = false;
  const before = mem.state;
  const next = step(mem, input);
  Object.assign(mem, { state: next.state, goal: next.goal, ticks: next.ticks });
  if ( next.state !== before ) {
    await setState(token, next.state);
    if ( next.state === "alert" ) onAlert(token, all, next.goal);
    if ( (next.state === "idle") && (routine?.kind === "route") ) mem.route = null;
  }
  switch ( next.action ) {
    case "face": if ( next.goal ) await face(token, next.goal); break;
    case "walk": walkTo(token, next.goal, "search"); break;
    case "home": goHome(token, routine, mem); break;
    case "routine": await doRoutine(token, routine, mem, now); break;
  }
}

/** Passé en alerte : réplique, les alliés proches entendent, et l'engagement juge la scène. */
function onAlert(token, all, point) {
  bark(token, "spotted").catch(() => null);
  const me = centreOf(token);
  const radius = ALERT_RADIUS * token.parent.grid.size;
  for ( const other of all ) {
    if ( (other === token) || !able(other) || !allied(token, other) || !driven(other) ) continue;
    const at = centreOf(other);
    if ( Math.hypot(at.x - me.x, at.y - me.y) <= radius ) memOf(other).heard = point ? { ...point } : { ...me };
  }
  if ( setting("autoEngage") && levelAtLeast("engage") ) checkEngagement(token.parent).catch(() => null);
}

let busy = false;

/** Un pas d'horloge pour la scène affichée. */
export async function tick() {
  if ( busy || !isActiveGM() || !running() ) return;
  const scene = canvas.scene;
  if ( !scene ) return;
  busy = true;
  try {
    const all = scene.tokens.contents;
    const now = Date.now();
    for ( const token of all ) {
      if ( !able(token) || !driven(token) || fighting(token) ) continue;
      try { await tickToken(token, all, now); }
      catch(err) { log.error(`${token.name}: real-time step failed`, err); }
    }
  } finally { busy = false; }
}

/** Pour les scénarios et l'API : l'état d'un token, et un doute à lui donner. */
export function alertOf(token) {
  const mem = memory.get(token.id);
  return { state: mem?.state ?? token.getFlag(MODULE_ID, "alert")?.state ?? "idle", goal: mem?.goal ?? null, walking: !!mem?.walking,
    route: mem?.route ? { index: mem.route.index, points: mem.route.points.length } : null };
}

export function hear(token, point) {
  memOf(token).heard = { ...point };
}

/** Oublier un token (remise à zéro : scénarios, changement d'affectation). */
export async function forget(token) {
  memory.delete(token.id);
  await token.unsetFlag(MODULE_ID, "alert").catch(() => {});
}

let timer = null;

export function registerClock() {
  Hooks.once("ready", () => {
    timer = setInterval(() => { tick().catch(err => log.error("clock failed", err)); }, TICK_MS);
  });
  // La pause : les marches en cours s'arrêtent (le moteur laisse le MJ marcher en pause : on vérifie nous-mêmes, §13).
  Hooks.on("pauseGame", paused => {
    if ( !paused || !isActiveGM() ) return;
    engine.stopWalks();
    for ( const mem of memory.values() ) mem.walking = false;
  });
  Hooks.on("canvasReady", () => memory.clear());
  // Un token déplacé par le MJ (pas par une marche de l'IA), hors combat : sa nouvelle place devient son point de départ.
  Hooks.on("updateToken", (token, changes) => {
    if ( !isActiveGM() || !(("x" in changes) || ("y" in changes)) ) return;
    const mem = memory.get(token.id);
    if ( !mem || mem.walking || fighting(token) ) return;
    mem.home = centreOf(token);
  });
  // Un combat fini : ceux qui en sortent repartent de « confus » (ils cherchent encore, puis rentrent).
  Hooks.on("deleteCombat", combat => {
    for ( const c of combat.combatants ) {
      const mem = c.tokenId ? memory.get(c.tokenId) : null;
      if ( mem && (mem.state === "alert") ) Object.assign(mem, { state: "confused", ticks: 0 });
    }
  });
}
