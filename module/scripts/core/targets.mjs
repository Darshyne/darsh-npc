/**
 * Priorisation des cibles (SPEC §8) : pour chaque ennemi de la vue, une somme de termes pondérés par la bande du profil ; la
 * cible est la meilleure, à égalité la plus proche. Chaque score garde ses termes et ses deux premières raisons (carte du MJ).
 * Fonctions pures, déterministes : pas d'aléa ici.
 */
import { atLeast } from "./profile.mjs";
import { WOUNDED_VALUE } from "./view.mjs";

export const TERMS = Object.freeze(["proximity", "reachable", "wounded", "threat", "caster", "isolated", "hitchance", "enmity", "pack", "opportunity"]);

/** Poids par bande (§8.1). `opportunity` est une pénalité : son terme est négatif. */
export const WEIGHTS = Object.freeze({
  bestial:  Object.freeze({ proximity: 3,   reachable: 2,   wounded: 0,   threat: 1.5, caster: 0,   isolated: 0,   hitchance: 0,   enmity: 1, pack: 0,   opportunity: 0 }),
  simple:   Object.freeze({ proximity: 2,   reachable: 2,   wounded: 1.5, threat: 1,   caster: 0,   isolated: 0,   hitchance: 0,   enmity: 1, pack: 0.5, opportunity: 1 }),
  average:  Object.freeze({ proximity: 1,   reachable: 2,   wounded: 1.5, threat: 2,   caster: 0.5, isolated: 0.5, hitchance: 1,   enmity: 1, pack: 1,   opportunity: 1 }),
  cunning:  Object.freeze({ proximity: 0.5, reachable: 1.5, wounded: 1.5, threat: 1.5, caster: 2,   isolated: 1.5, hitchance: 1.5, enmity: 1, pack: 1,   opportunity: 1.5 }),
  tactical: Object.freeze({ proximity: 0.5, reachable: 1.5, wounded: 1.5, threat: 1.5, caster: 2,   isolated: 1.5, hitchance: 1.5, enmity: 1, pack: 2,   opportunity: 2 })
});

/** Au-delà de cette distance (cases), la proximité ne compte plus. */
const FAR = 20;

/**
 * Poids de haine (§8.3) : la somme des lignes dont le `hated` correspond aux `kinds` de l'ennemi. Une ligne correspond si chaque
 * clé donnée est égale ; `any: true` correspond à tout ; `living: true` aux vivants (ni mort-vivant ni artificiel).
 * @param {{hated:object, weight:number}[]} enmities   Les lignes qui concernent déjà la créature (filtrées sur `hater` par l'adaptateur).
 * @param {object} kinds
 */
export function enmityWeight(enmities=[], kinds={}) {
  let total = 0;
  for ( const row of enmities ) if ( matchKinds(row?.hated, kinds) ) total += Number(row.weight) || 0;
  return total;
}

/** `match` sur des `kinds` (type, subtype, species, group, living, any). */
export function matchKinds(match, kinds={}) {
  if ( !match || (typeof match !== "object") ) return false;
  const entries = Object.entries(match);
  if ( !entries.length ) return false;
  for ( const [key, wanted] of entries ) {
    if ( key === "any" ) { if ( wanted !== true ) return false; continue; }
    if ( key === "living" ) { if ( Boolean(kinds.living) !== Boolean(wanted) ) return false; continue; }
    if ( !["type", "subtype", "species", "group"].includes(key) ) return false;
    if ( String(kinds[key] ?? "").toLowerCase() !== String(wanted ?? "").toLowerCase() ) return false;
  }
  return true;
}

/** Les erreurs d'une table de haines `[{ hater, hated, weight }]`. Vide = valide. */
export function validateEnmities(list) {
  const errors = [];
  if ( !Array.isArray(list) ) return ["enmities: a list is expected"];
  const KEYS = ["type", "subtype", "species", "group", "living", "any"];
  list.forEach((row, i) => {
    const where = `enmities[${i}]`;
    for ( const side of ["hater", "hated"] ) {
      const m = row?.[side];
      if ( !m || (typeof m !== "object") || !Object.keys(m).length ) { errors.push(`${where}.${side}: a non-empty object is expected`); continue; }
      for ( const key of Object.keys(m) ) if ( !KEYS.includes(key) ) errors.push(`${where}.${side}.${key}: unknown key`);
    }
    if ( !Number.isFinite(row?.weight) || (row.weight <= 0) || (row.weight > 1) ) errors.push(`${where}.weight: a number in ]0, 1] is expected`);
  });
  return errors;
}

const clamp01 = x => Math.max(0, Math.min(1, x));

/**
 * Les termes d'un ennemi, chacun dans [0, 1] (`opportunity` dans [-1, 0]).
 * @param {import("./view.mjs").Enemy} enemy
 * @param {import("./view.mjs").View} view
 * @param {object} profile
 * @param {{hated:object, weight:number}[]} enmities
 */
export function termsOf(enemy, view, profile, enmities=[]) {
  const cells = view.self.cells ?? 0;
  const reach = view.self.reach ?? 1;
  const ranged = (profile.range !== "melee") && enemy.inRange && (enemy.visible !== false);
  const thisTurn = (enemy.cost <= cells + reach) || ranged;
  const withDash = (enemy.cost <= 2 * cells + reach) && atLeast(profile.band, "average");
  const reachable = thisTurn ? 1 : (withDash ? 0.5 : 0);
  const maxHp = Math.max(1, view.self.hp?.max ?? 1);
  return {
    proximity: Number.isFinite(enemy.cost) ? 1 - clamp01(enemy.cost / FAR) : 0,
    reachable,
    wounded: WOUNDED_VALUE[enemy.appearance] ?? 0,
    threat: clamp01((enemy.grudge ?? 0) / maxHp + (enemy.killedAlly ? 0.5 : 0)),
    caster: (enemy.role === "caster" ? 0.7 : 0) + (enemy.concentrating ? 0.3 : 0),
    isolated: 1 / (1 + (enemy.adjacentAllies ?? 0)),
    hitchance: Number.isFinite(enemy.hitChance) ? clamp01(enemy.hitChance) : 0.5,
    enmity: clamp01(enmityWeight(enmities, enemy.kinds)),
    pack: enemy.focused ? 1 : 0,
    opportunity: enemy.provokes ? -1 : 0
  };
}

/** Un ennemi est-il candidat ? Debout, perçu, et joignable d'une façon ou d'une autre (chemin fini, ou à portée de tir). */
export function isCandidate(enemy, profile) {
  if ( enemy.down || (enemy.visible === false) ) return false;
  if ( Number.isFinite(enemy.cost) ) return true;
  return (profile.range !== "melee") && !!enemy.inRange;
}

/**
 * Les ennemis classés, du meilleur au pire : `[{ id, score, terms, reasons }]`. Une créature `bestial` garde sa dernière
 * cible tant qu'elle est debout (§6.1).
 * @returns {{id:string, score:number, terms:object, reasons:string[], kept?:boolean}[]}
 */
export function scoreTargets(view, profile, enmities=[]) {
  const weights = WEIGHTS[profile.band] ?? WEIGHTS.average;
  const scored = [];
  for ( const enemy of view.enemies ?? [] ) {
    if ( !isCandidate(enemy, profile) ) continue;
    const terms = termsOf(enemy, view, profile, enmities);
    const contributions = TERMS.map(t => [t, (weights[t] ?? 0) * terms[t]]);
    const score = contributions.reduce((sum, [, v]) => sum + v, 0);
    scored.push({ id: enemy.id, score, terms, contributions, distance: enemy.distance });
  }
  // Les raisons : les deux contributions les plus lourdes parmi les termes qui DISTINGUENT les candidats (un terme égal pour tous
  // — « joignable », « proche » quand tout le monde l'est — n'explique rien au MJ) ; seul candidat : ses deux termes les plus lourds.
  const discriminating = new Set(TERMS.filter(t => {
    const values = scored.map(s => s.contributions.find(([k]) => k === t)[1]);
    return values.some(v => Math.abs(v - values[0]) > 1e-9);
  }));
  for ( const s of scored ) {
    const pool = discriminating.size ? s.contributions.filter(([t]) => discriminating.has(t)) : s.contributions;
    s.reasons = pool.filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([t]) => t);
    delete s.contributions;
  }
  scored.sort((a, b) => (b.score - a.score) || (a.distance - b.distance) || String(a.id).localeCompare(String(b.id)));
  if ( (profile.band === "bestial") && view.self.lastTarget ) {
    const i = scored.findIndex(s => s.id === view.self.lastTarget);
    if ( i > 0 ) { const [kept] = scored.splice(i, 1); kept.kept = true; scored.unshift(kept); }
  }
  return scored.map(({ distance, ...rest }) => rest);
}

/** La meilleure cible, ou null. */
export function chooseTarget(view, profile, enmities=[]) {
  return scoreTargets(view, profile, enmities)[0] ?? null;
}
