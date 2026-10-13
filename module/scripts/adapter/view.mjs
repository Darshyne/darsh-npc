/**
 * La vue d'un token (SPEC §7) construite depuis Foundry : ennemis et alliés d'après la disposition des tokens, distances en cases
 * d'emprise à emprise, apparences (§7.3), rôles. Lecture seule. Étape 1 : **dégradé et avoué** dans `meta` —
 *  - le coût de chemin est la distance (`costIsDistance`) tant que le moteur ne publie pas d'A* sans déplacement (SPEC §14.2 R1) ;
 *  - « qui voit qui » est ce que le MJ voit (`visionFrom: "gm"`) tant que le moteur ne publie pas sa vision (R2) : un token caché
 *    (`hidden`) est exclu, le reste est tenu pour perçu.
 * Positions lues sur `_source` (position de jeu), jamais sur `x/y` (position animée — piège V14 noté par le moteur).
 */
import { appearanceOf } from "../core/view.mjs";
import { factsOf, armorWeightOf, roleOf } from "./sheet.mjs";
import { canSee, movement, pathCost } from "./engine.mjs";
import { MODULE_ID, setting } from "../shared.mjs";

const D = () => CONST.TOKEN_DISPOSITIONS;

/** Emprise d'un token en cases : `{ i0, j0, i1, j1 }` (bornes comprises). */
export function footprintOf(token) {
  const grid = token.parent.grid;
  const { x, y, width, height } = token._source;
  const top = grid.getOffset({ x: x + 1, y: y + 1 });
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  return { i0: top.i, j0: top.j, i1: top.i + h - 1, j1: top.j + w - 1 };
}

/** Distance de Chebyshev entre deux emprises, en cases (0 : adjacentes ou superposées). */
export function footprintDistance(a, b) {
  const di = Math.max(0, a.i0 - b.i1, b.i0 - a.i1);
  const dj = Math.max(0, a.j0 - b.j1, b.j0 - a.j1);
  return Math.max(di, dj) - (Math.max(di, dj) > 0 ? 1 : 0);
}

/** Les deux tokens sont-ils ennemis ? Hostile contre Amical ; un Neutre ou un Secret n'est l'ennemi de personne. */
export function hostile(a, b) {
  const da = a.disposition, db = b.disposition;
  if ( (da === D().SECRET) || (db === D().SECRET) ) return false;
  return ((da === D().HOSTILE) && (db === D().FRIENDLY)) || ((da === D().FRIENDLY) && (db === D().HOSTILE));
}

/** Même camp : même disposition (hors Secret). */
export function allied(a, b) {
  return (a.disposition !== D().SECRET) && (a.disposition === b.disposition);
}

/** Longueur d'une case dans l'unité de la fiche, pour convertir une Vitesse en cases (jamais de distance en dur). */
function cellsOfSpeed(scene, speed, units) {
  const grid = scene.grid;
  if ( !grid.distance ) return 0;
  let value = speed ?? 0;
  const from = units ?? grid.units;
  if ( from && grid.units && (from !== grid.units) && (typeof dnd5e?.utils?.convertLength === "function") ) {
    try { value = dnd5e.utils.convertLength(value, from, grid.units); } catch { /* même unité supposée */ }
  }
  return Math.floor(value / grid.distance);
}

/**
 * Les attaques d'un token, distances en cases (core/plan.mjs) : allonge, portée normale et longue, converties depuis l'unité de la
 * fiche vers celle de la grille (jamais de distance en dur). Une attaque de contact sans allonge écrite a 5 ft — la règle — dans
 * l'unité de la grille (1 case).
 */
export function attacksOf(token, facts=factsOf(token.actor)) {
  const scene = token.parent;
  return facts.attacks.map(a => {
    // Une arme de jet (dague, javelot) est typée « contact » par dnd5e : elle se lance aussi, à sa portée (le moteur tient le mode).
    const ranged = a.ranged || !!a.thrown;
    const reach = a.melee ? Math.max(1, cellsOfSpeed(scene, a.range.reach ?? 0, a.range.units)) : 0;
    const normal = ranged ? cellsOfSpeed(scene, a.range.value ?? 0, a.range.units) : 0;
    const long = ranged ? Math.max(normal, cellsOfSpeed(scene, a.range.long ?? 0, a.range.units)) : 0;
    return { id: a.id, item: a.item, name: a.name, melee: a.melee, ranged, thrown: !!a.thrown, reach, normal, long,
      damage: a.damage, equipped: a.equipped, unarmed: a.unarmed };
  });
}

function isDown(actor) {
  const hp = actor?.system?.attributes?.hp;
  return !!actor && ((hp?.value ?? 0) <= 0);
}

/**
 * @param {TokenDocument} token
 * @param {{omniscient?: boolean}} [options]
 * @returns {import("../core/view.mjs").View}
 */
export function viewOf(token, { omniscient=setting("omniscient") }={}) {
  const scene = token.parent;
  const facts = factsOf(token.actor);
  const mine = footprintOf(token);
  const grid = scene.grid;
  const moving = movement(token);
  const cells = moving ? Math.floor((moving.left ?? 0) / grid.distance) : cellsOfSpeed(scene, facts.speed.walk, facts.speed.units);
  const reachCells = Math.max(1, ...facts.attacks.filter(a => !a.ranged && a.range.reach).map(a => cellsOfSpeed(scene, a.range.reach, a.range.units)));
  const longestShot = Math.max(0, ...facts.attacks.filter(a => a.ranged).map(a => cellsOfSpeed(scene, a.range.long ?? a.range.value ?? 0, a.range.units)));
  const others = scene.tokens.filter(t => (t.id !== token.id) && t.actor && !t.hidden);
  const enemies = [];
  const allies = [];
  for ( const other of others ) {
    const theirs = footprintOf(other);
    const distance = footprintDistance(mine, theirs);
    if ( allied(token, other) ) { allies.push({ id: other.id, name: other.name, distance, down: isDown(other.actor) }); continue; }
    if ( !hostile(token, other) ) continue;
    const theirFacts = factsOf(other.actor);
    const hp = other.actor.system?.attributes?.hp ?? {};
    const fraction = (hp.max ?? 0) > 0 ? (hp.value ?? 0) / hp.max : 0;
    const seen = canSee(token, other);
    const cost = pathCost(token, { target: other }) ?? distance;
    enemies.push({
      id: other.id,
      name: other.name,
      distance,
      cost,
      appearance: appearanceOf(fraction),
      hpFraction: omniscient ? fraction : null,
      armor: armorWeightOf(other.actor),
      role: roleOf(theirFacts),
      concentrating: theirFacts.concentrating,
      down: isDown(other.actor),
      visible: seen ?? true,
      adjacentAllies: others.filter(t => (t !== other) && allied(other, t) && !isDown(t.actor) && (footprintDistance(theirs, footprintOf(t)) === 0)).length,
      kinds: {
        type: theirFacts.type, subtype: theirFacts.subtype, species: theirFacts.species,
        group: other.getFlag(MODULE_ID, "group") ?? null,
        living: !["undead", "construct"].includes(theirFacts.type)
      },
      grudge: 0,
      killedAlly: false,
      focused: false,
      provokes: false,
      hitChance: null,
      inRange: (longestShot > 0) && (distance <= longestShot)
    });
  }
  return {
    self: {
      id: token.id, name: token.name, hp: { value: facts.hp.value, max: facts.hp.max }, cells, reach: reachCells,
      lastTarget: token.getFlag(MODULE_ID, "lastTarget") ?? null
    },
    enemies,
    allies,
    meta: {
      scene: scene.id,
      costIsDistance: !enemies.some(e => pathCost(token, { target: scene.tokens.get(e.id) }) !== null),
      omniscient: !!omniscient,
      visionFrom: enemies.some(e => canSee(token, scene.tokens.get(e.id)) !== null) ? "engine" : "gm",
      inCombat: !!moving
    }
  };
}
