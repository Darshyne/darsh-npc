/**
 * Aléa injecté (SPEC §5) : le cœur ne tire jamais `Math.random` lui-même, il reçoit un générateur. Les tests passent un
 * générateur à graine et rejouent la même décision ; en jeu, l'adaptateur passe `Math.random`. Fonctions pures.
 */

/** Générateur à graine (mulberry32) : `next()` rend un nombre dans [0, 1). */
export function seeded(seed=1) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Un entier dans [min, max] (bornes comprises). */
export function between(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}

/** Un élément de la liste, ou undefined si elle est vide. */
export function pick(rng, list) {
  if ( !list?.length ) return undefined;
  return list[Math.floor(rng() * list.length)];
}

/** Vrai avec la probabilité donnée (0..1). */
export function chance(rng, probability) {
  return rng() < probability;
}
