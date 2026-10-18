/**
 * Planifier un tour (SPEC §9.1-3, §9.2) — étape 2 du plan (§16) : attaquer la meilleure cible **déjà à portée**, sinon rendre la
 * main. Pas de déplacement ici (étape 3). Pur et déterministe : pas d'aléa, pas de Foundry.
 *
 * Une attaque (mise à plat par l'adaptateur, distances en cases) :
 *   { id, item, name, melee, ranged, reach, normal, long, damage, equipped, unarmed }
 *   reach    allonge au contact, en cases (1 = 5 ft) ; 0 si l'attaque n'est pas de contact
 *   normal   portée normale à distance, en cases ; 0 si l'attaque ne tire pas
 *   long     portée longue, en cases (≥ normal)
 * Distance entre deux emprises en cases, 0 = au contact (adapter/view.mjs, `footprintDistance`).
 */
import { scoreTargets } from "./targets.mjs";

/** Chance de toucher supposée quand la vue ne la connaît pas (le moteur ne la publie pas encore : SPEC §14.2 R8). */
export const DEFAULT_HIT = 0.6;

/**
 * Cette attaque atteint-elle un ennemi à `distance` cases (0 = au contact), et à quel prix ? Rend `{ mode, factor }` ou null.
 *   mode    `melee` | `ranged` | `long`
 *   factor  ce que vaut le coup, relatif (le Désavantage divise par deux : portée longue, ou tir au contact d'un ennemi)
 */
export function reachOf(attack, distance, { threatened=false }={}) {
  if ( !attack || !Number.isFinite(distance) ) return null;
  if ( attack.melee && (attack.reach > 0) && (distance <= attack.reach - 1) ) return { mode: "melee", factor: 1 };
  if ( attack.ranged && (attack.normal > 0) ) {
    // Une case de distance de bord à bord : la cible est à (distance + 1) cases du tireur.
    const cells = distance + 1;
    const disadvantage = threatened ? 0.5 : 1;   // PHB 2024 : tirer avec un ennemi au contact donne le Désavantage
    if ( cells <= attack.normal ) return { mode: "ranged", factor: disadvantage };
    if ( cells <= Math.max(attack.long, attack.normal) ) return { mode: "long", factor: 0.5 * disadvantage };
  }
  return null;
}

/**
 * La meilleure attaque contre cet ennemi, parmi celles permises : `chance × dégâts moyens × facteur`. Une arme non tenue ou les
 * mains nues ne servent que s'il n'y a rien d'autre. Rend `{ attack, mode, value }` ou null.
 * @param {object[]} attacks
 * @param {{distance:number, hitChance?:number|null}} enemy
 * @param {{allowed?: Set<string>|null, threatened?: boolean}} [options]   `allowed` : ids d'items encore jouables (Attaques multiples).
 */
export function chooseAttack(attacks, enemy, { allowed=null, threatened=false }={}) {
  const chance = Number.isFinite(enemy?.hitChance) ? enemy.hitChance : DEFAULT_HIT;
  let best = null;
  for ( const attack of attacks ?? [] ) {
    if ( allowed && !allowed.has(attack.item) ) continue;
    const reach = reachOf(attack, enemy.distance, { threatened });
    if ( !reach ) continue;
    const fallback = (!attack.equipped || attack.unarmed) ? 0.25 : 1;
    const value = chance * Math.max(0.5, attack.damage ?? 0) * reach.factor * fallback;
    // À valeur égale, l'attaque sans Désavantage l'emporte.
    const better = !best || (value > best.value + 1e-9) || ((Math.abs(value - best.value) <= 1e-9) && (reach.factor > best.factor));
    if ( better ) best = { attack, mode: reach.mode, value, factor: reach.factor };
  }
  return best;
}

/**
 * L'intention du tour : la première cible du classement (§8) qu'une attaque permise atteint d'où l'on est.
 * Rend `{ type: "attack", target, attack, mode, reasons, score }` ou `{ type: "yield", reason }`.
 *   reasons   `noEnemy` (aucun ennemi perçu debout) | `noAttack` (aucune attaque sur la fiche, ou plus aucune permise)
 *             | `outOfReach` (des ennemis, aucun à portée : il faudrait bouger — étape 3)
 * @param {import("./view.mjs").View} view
 * @param {object} profile
 * @param {object[]} enmities
 * @param {object[]} attacks
 * @param {{allowed?: Set<string>|null}} [options]
 */
export function planAttack(view, profile, enmities, attacks, { allowed=null }={}) {
  const ranked = scoreTargets(view, profile, enmities);
  if ( !ranked.length ) return { type: "yield", reason: "noEnemy" };
  const usable = (attacks ?? []).filter(a => !allowed || allowed.has(a.item));
  if ( !usable.length ) return { type: "yield", reason: "noAttack" };
  const threatened = (view.enemies ?? []).some(e => !e.down && (e.distance === 0));
  const byId = new Map((view.enemies ?? []).map(e => [e.id, e]));
  for ( const scored of ranked ) {
    const enemy = byId.get(scored.id);
    if ( !enemy ) continue;
    const pick = chooseAttack(usable, enemy, { allowed, threatened });
    if ( pick ) return { type: "attack", target: enemy.id, attack: pick.attack, mode: pick.mode, reasons: scored.reasons, score: scored.score };
  }
  return { type: "yield", reason: "outOfReach" };
}

/**
 * §19 (escalade) : la cible est-elle hors d'atteinte d'une attaque de contact par le seul vide vertical (au mur, au plafond, en vol) ?
 * Alors aucune marche au sol n'y mène (le moteur répond `tooHigh` à l'approche). `vertical` : le vide en cases (0 sans moteur qui le dit).
 */
export const tooHighFor = (enemy, attack) => !!attack && ((enemy?.vertical ?? 0) > Math.max(1, attack.reach ?? 1) + 1e-9);

/**
 * Étape 3 (SPEC §9.3) : où aller quand aucune cible n'est à portée. La meilleure cible du classement (§8) ; un **tireur** (profil
 * `ranged`, ou sans attaque de contact) s'en approche jusqu'à la portée normale de sa meilleure attaque à distance, **en la voyant** —
 * il garde ses distances ; sinon, au contact, jusqu'à l'allonge de sa meilleure attaque de contact. Rend
 * `{ type: "move", target, reachCells, seeing, attack, reasons }`, ou `{ type: "yield", reason }`.
 */
export function planMove(view, profile, enmities, attacks, { allowed=null }={}) {
  const ranked = scoreTargets(view, profile, enmities);
  if ( !ranked.length ) return { type: "yield", reason: "noEnemy" };
  const usable = (attacks ?? []).filter(a => !allowed || allowed.has(a.item));
  const strongest = list => list.reduce((best, a) => (!best || ((a.damage ?? 0) > (best.damage ?? 0)) ? a : best), null);
  const armed = list => list.filter(a => a.equipped && !a.unarmed);
  const melee = strongest(armed(usable.filter(a => a.melee && (a.reach > 0)))) ?? strongest(usable.filter(a => a.melee && (a.reach > 0)));
  const ranged = strongest(armed(usable.filter(a => a.ranged && (a.normal > 0) && !a.thrown))) ?? strongest(usable.filter(a => a.ranged && (a.normal > 0)));
  const shooter = !!ranged && ((profile.range === "ranged") || !melee);
  const attack = shooter ? ranged : melee;
  if ( !attack ) return { type: "yield", reason: "noAttack" };
  if ( shooter ) {
    const first = ranked[0];
    return { type: "move", target: first.id, reachCells: attack.normal, seeing: true, attack, reasons: first.reasons };
  }
  // §19 (escalade) : une cible perchée hors d'allonge — grimper jusqu'à elle (vitesse d'escalade, Pattes d'araignée), sinon la viser à
  // distance s'il y a de quoi, sinon la suivante du classement ; personne d'atteignable : garder sa position (`tooHigh`).
  const byId = new Map((view.enemies ?? []).map(e => [e.id, e]));
  let perched = null;
  for ( const scored of ranked ) {
    const enemy = byId.get(scored.id);
    if ( !enemy ) continue;
    if ( !tooHighFor(enemy, melee) ) return { type: "move", target: enemy.id, reachCells: melee.reach, seeing: false, attack: melee, reasons: scored.reasons };
    if ( view.self?.climber && !view.self?.onCeiling ) return { type: "climb", target: enemy.id, reachCells: melee.reach, attack: melee, reasons: scored.reasons };
    if ( ranged ) return { type: "move", target: enemy.id, reachCells: ranged.normal, seeing: true, attack: ranged, reasons: scored.reasons };
    perched ??= enemy.id;
  }
  return { type: "yield", reason: "tooHigh", target: perched };
}
