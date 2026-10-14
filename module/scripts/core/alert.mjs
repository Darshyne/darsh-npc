/**
 * Les états d'alerte hors combat (SPEC §4, §7.2, §10 ; étape 6a du §16, demande de l'utilisateur du 2026-10-13). Pur : pas de
 * Foundry, pas d'aléa ; le temps se compte en **pas d'horloge** (runtime/clock.mjs, un par seconde).
 *
 *   idle        au calme : patrouille, poste, ou rien
 *   suspicious  un doute (un bruit, une silhouette, un allié qui crie) : se tourne vers le point, puis va voir   — « ? » jaune
 *   alert       un ennemi vu : le regarde ; l'engagement (§10.3) peut lancer le combat                         — « ! » rouge
 *   searching   l'ennemi perdu de vue : marche jusqu'à sa dernière position connue                            — œil
 *   confused    arrivé, rien trouvé : regarde autour, puis rentre (poste, patrouille, point de départ)       — « ? » gris
 *
 * `step(state, input)` rend le nouvel état et ce qu'il faut faire : `{ state, goal, ticks, action }`, `action` parmi
 * `stay` (rien), `face` (se tourner vers `goal`), `walk` (marcher vers `goal`), `home` (rentrer), `routine` (patrouiller, flâner).
 */

export const STATES = Object.freeze(["idle", "suspicious", "alert", "searching", "confused"]);

/** Durées, en pas d'horloge. */
export const SUSPICIOUS_TICKS = 3;
export const CONFUSED_TICKS = 4;
/** Recherche : au-delà, elle abandonne même sans être arrivée (chemin bloqué, cible trop loin). */
export const SEARCH_TICKS = 30;

/**
 * Un pas de la machine.
 * @param {{state?: string, goal?: {x:number,y:number}|null, ticks?: number}} current
 * @param {object} input
 * @param {{x:number,y:number}|null} input.seen     la position d'un ennemi vu en ce moment (le plus proche), ou null
 * @param {{x:number,y:number}|null} [input.heard]  un point douteux signalé ce pas-ci (bruit, cri d'un allié)
 * @param {boolean} [input.arrived]                 arrivée au but de la marche (ou marche impossible)
 * @param {boolean} [input.atHome]                  à son poste, sur sa patrouille ou à son point de départ
 * @param {boolean} [input.walking]                 une marche est en cours
 */
export function step(current={}, { seen=null, heard=null, arrived=false, atHome=true, walking=false }={}) {
  const state = STATES.includes(current.state) ? current.state : "idle";
  const ticks = (current.ticks ?? 0) + 1;
  const goal = current.goal ?? null;
  // Un ennemi vu l'emporte sur tout : alerte, les yeux sur lui.
  if ( seen ) return { state: "alert", goal: { x: seen.x, y: seen.y }, ticks: (state === "alert") ? ticks : 0, action: "face" };
  switch ( state ) {
    case "alert":
      // Perdu de vue : aller voir où il était.
      return { state: "searching", goal, ticks: 0, action: goal ? "walk" : "stay" };
    case "searching":
      if ( arrived || !goal || (ticks >= SEARCH_TICKS) ) return { state: "confused", goal, ticks: 0, action: "stay" };
      return { state, goal, ticks, action: walking ? "stay" : "walk" };
    case "confused":
      if ( heard ) return { state: "suspicious", goal: { ...heard }, ticks: 0, action: "face" };
      if ( ticks >= CONFUSED_TICKS ) return { state: "idle", goal: null, ticks: 0, action: "home" };
      return { state, goal, ticks, action: "stay" };
    case "suspicious":
      if ( heard ) return { state, goal: { ...heard }, ticks: 0, action: "face" };
      if ( ticks >= SUSPICIOUS_TICKS ) return { state: "searching", goal, ticks: 0, action: goal ? "walk" : "stay" };
      return { state, goal, ticks, action: "face" };
    default:
      if ( heard ) return { state: "suspicious", goal: { ...heard }, ticks: 0, action: "face" };
      return { state: "idle", goal: null, ticks: 0, action: atHome ? "routine" : (walking ? "stay" : "home") };
  }
}

/**
 * L'orientation d'un token (degrés, convention du cœur : 0 = vers le bas de l'écran, sens horaire) pour regarder de `from` vers `to`.
 */
export function facingToward(from, to) {
  const dx = to.x - from.x, dy = to.y - from.y;
  if ( !dx && !dy ) return null;
  const deg = (Math.atan2(dy, dx) * 180 / Math.PI) - 90;
  return ((Math.round(deg) % 360) + 360) % 360;
}

/**
 * Les points de passage d'une patrouille (§10.1) : une seule forme **polygone** — ses sommets, dans l'ordre du tracé ; sinon le
 * centre de chaque forme, dans l'ordre où elles sont posées. Formes au format de données V14 (`type` rectangle / ellipse / circle /
 * polygon / line…).
 */
export function routePoints(shapes=[]) {
  const centre = s => {
    switch ( s.type ) {
      case "rectangle": return { x: s.x + ((s.width ?? 0) / 2), y: s.y + ((s.height ?? 0) / 2) };
      case "polygon": case "line": {
        const pts = s.points ?? [];
        const n = Math.floor(pts.length / 2);
        if ( !n ) return null;
        let x = 0, y = 0;
        for ( let i = 0; i < n; i++ ) { x += pts[2 * i]; y += pts[(2 * i) + 1]; }
        return { x: x / n, y: y / n };
      }
      default: return Number.isFinite(s.x) && Number.isFinite(s.y) ? { x: s.x, y: s.y } : null;
    }
  };
  if ( (shapes.length === 1) && ["polygon", "line"].includes(shapes[0].type) ) {
    const pts = shapes[0].points ?? [];
    const out = [];
    for ( let i = 0; i + 1 < pts.length; i += 2 ) out.push({ x: pts[i], y: pts[i + 1] });
    return out;
  }
  return shapes.map(centre).filter(Boolean);
}

/**
 * Le point de passage suivant : `loop` (boucle), `pingpong` (aller-retour), `random`. Rend `{ index, direction }`.
 * @param {number} count
 * @param {{index:number, direction?:number}} at
 * @param {string} mode
 * @param {() => number} [rng]
 */
export function nextWaypoint(count, { index=0, direction=1 }={}, mode="loop", rng=Math.random) {
  if ( count <= 1 ) return { index: 0, direction: 1 };
  if ( mode === "random" ) {
    let next = Math.floor(rng() * (count - 1));
    if ( next >= index ) next += 1;
    return { index: next, direction: 1 };
  }
  if ( mode === "pingpong" ) {
    let dir = direction || 1;
    if ( ((index + dir) < 0) || ((index + dir) >= count) ) dir = -dir;
    return { index: index + dir, direction: dir };
  }
  return { index: (index + 1) % count, direction: 1 };
}

/** Le point de passage le plus proche (pour un token qui (re)prend sa patrouille). */
export function nearestWaypoint(points, at) {
  let best = 0, bestD = Infinity;
  points.forEach((p, i) => {
    const d = Math.hypot(p.x - at.x, p.y - at.y);
    if ( d < bestD ) { best = i; bestD = d; }
  });
  return best;
}

/* -------------------------------------------- */
/*  Regarder autour de soi (2026-10-14)          */
/* -------------------------------------------- */

/** Amplitude du balayage d'une créature au repos, en degrés de part et d'autre de sa direction de référence. */
export const SCANS = Object.freeze({ none: 0, narrow: 45, wide: 90, full: 180 });

/** Entre deux coups d'œil (ms) ; le coup d'œil lui-même dure de quoi voir. */
export const GLANCE_GAP_MS = Object.freeze([6000, 14000]);
export const GLANCE_HOLD_MS = Object.freeze([2500, 5000]);

const between = ([a, b], rng) => a + (rng() * (b - a));
const norm = deg => ((Math.round(deg) % 360) + 360) % 360;

/**
 * Le prochain mouvement de tête d'une créature au repos, ou null s'il n'y a rien à faire maintenant.
 * `glance` : `{ at, away }` (quand agir ; regarde-t-elle ailleurs). Elle regarde d'un côté (entre la moitié et toute l'amplitude),
 * puis revient à sa direction de référence. Une créature sans esprit tourne plus rarement, n'importe où dans l'amplitude.
 * @param {{at?: number, away?: boolean}|null} glance
 * @param {{base: number, scan: string, now: number, rng: () => number, mindless?: boolean}} opts
 * @returns {{rotation: number|null, glance: {at: number, away: boolean}}|null}
 */
export function nextGlance(glance, { base, scan, now, rng, mindless=false }) {
  const amp = SCANS[scan] ?? 0;
  if ( !amp ) return null;
  const slow = mindless ? 1.8 : 1;
  if ( !glance ) return { rotation: null, glance: { at: now + (between(GLANCE_GAP_MS, rng) * slow), away: false } };
  if ( now < glance.at ) return null;
  if ( glance.away ) return { rotation: norm(base), glance: { at: now + (between(GLANCE_GAP_MS, rng) * slow), away: false } };
  const side = rng() < 0.5 ? -1 : 1;
  const offset = mindless ? ((rng() * 2) - 1) * amp : side * ((amp / 2) + (rng() * amp / 2));
  return { rotation: norm(base + offset), glance: { at: now + between(GLANCE_HOLD_MS, rng), away: true } };
}
