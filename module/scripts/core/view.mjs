/**
 * La vue (SPEC §4, §7) : ce qu'une créature perçoit à l'instant où elle décide — objet plat, sans Foundry dedans, construit par
 * adapter/view.mjs et entrée du cœur de décision. Ce fichier en fixe la forme, l'apparence des ennemis (§7.3) et la validation.
 *
 * @typedef {object} View
 * @property {Self} self
 * @property {Enemy[]} enemies      Les ennemis perçus (un ennemi caché ou invisible n'y est pas).
 * @property {Ally[]} allies
 * @property {object} meta          Ce que la vue n'a pas pu faire proprement (`costIsDistance`, `omniscient`, `visionFrom`).
 *
 * @typedef {object} Self
 * @property {string} id
 * @property {string} name
 * @property {{value:number, max:number}} hp
 * @property {number} cells          Déplacement restant, en cases (hors combat : la Vitesse entière).
 * @property {number} reach          Allonge au contact, en cases (1 = 5 ft).
 * @property {string|null} lastTarget   L'ennemi visé au tour précédent, s'il est encore là.
 *
 * @typedef {object} Enemy
 * @property {string} id
 * @property {string} name
 * @property {number} distance      Cases entre les deux emprises (0 = au contact).
 * @property {number} cost          Coût de chemin en cases (Infinity : injoignable). Égal à `distance` quand `meta.costIsDistance`.
 * @property {string} appearance    `fresh` | `hurt` | `bloodied` | `near-death` | `down` (§7.3).
 * @property {number|null} hpFraction   Seulement en mode omniscient.
 * @property {string} armor         `heavy` | `medium` | `light` | `none` | `unknown`.
 * @property {string} role          `melee` | `ranged` | `caster` | `unknown`.
 * @property {boolean} concentrating
 * @property {boolean} down
 * @property {boolean} visible
 * @property {number} adjacentAllies   Alliés de l'ennemi à 1 case de lui.
 * @property {{type:string|null, subtype:string, species:string|null, group:string|null, living:boolean}} kinds
 * @property {number} grudge        Dégâts qu'il a infligés à la créature (mémoire, §7.2) ; 0 sans mémoire.
 * @property {boolean} killedAlly
 * @property {boolean} focused      Un allié de la créature l'attaque déjà.
 * @property {boolean} provokes     L'atteindre provoque une attaque d'opportunité.
 * @property {number|null} hitChance   Chance de toucher estimée (0..1) ; null = inconnue.
 * @property {boolean} inRange      À portée d'une attaque à distance de la créature, en la voyant.
 *
 * @typedef {object} Ally
 * @property {string} id
 * @property {string} name
 * @property {number} distance
 * @property {boolean} down
 */

export const APPEARANCES = Object.freeze(["fresh", "hurt", "bloodied", "near-death", "down"]);
export const ARMORS = Object.freeze(["heavy", "medium", "light", "none", "unknown"]);
export const ROLES = Object.freeze(["melee", "ranged", "caster", "unknown"]);

/** L'apparence d'une créature d'après sa fraction de PV (§7.3). */
export function appearanceOf(fraction) {
  if ( !Number.isFinite(fraction) || (fraction <= 0) ) return "down";
  if ( fraction <= 0.25 ) return "near-death";
  if ( fraction <= 0.5 ) return "bloodied";
  if ( fraction < 0.75 ) return "hurt";
  return "fresh";
}

/** Valeur du terme `wounded` par apparence (§8.1) : plus c'est abîmé, plus c'est tentant ; à terre : hors score. */
export const WOUNDED_VALUE = Object.freeze({ fresh: 0, hurt: 0.35, bloodied: 0.7, "near-death": 1, down: 0 });

/** Les erreurs d'une vue. Vide = valide. */
export function validateView(view) {
  const errors = [];
  if ( !view || (typeof view !== "object") ) return ["view: an object is expected"];
  const self = view.self;
  if ( !self?.id ) errors.push("self.id: missing");
  if ( !Number.isFinite(self?.cells) || (self.cells < 0) ) errors.push("self.cells: a number ≥ 0 is expected");
  if ( !Number.isFinite(self?.reach) || (self.reach < 1) ) errors.push("self.reach: a number ≥ 1 is expected");
  if ( !Array.isArray(view.enemies) ) errors.push("enemies: a list is expected");
  else view.enemies.forEach((e, i) => {
    const where = `enemies[${i}]`;
    if ( !e?.id ) errors.push(`${where}.id: missing`);
    if ( !Number.isFinite(e?.distance) || (e.distance < 0) ) errors.push(`${where}.distance: a number ≥ 0 is expected`);
    if ( !((e?.cost === Infinity) || (Number.isFinite(e?.cost) && (e.cost >= 0))) ) errors.push(`${where}.cost: a number ≥ 0 or Infinity is expected`);
    if ( !APPEARANCES.includes(e?.appearance) ) errors.push(`${where}.appearance: "${e?.appearance}" is not one of ${APPEARANCES.join(", ")}`);
    if ( !ARMORS.includes(e?.armor ?? "unknown") ) errors.push(`${where}.armor: unknown value`);
    if ( !ROLES.includes(e?.role ?? "unknown") ) errors.push(`${where}.role: unknown value`);
  });
  if ( !Array.isArray(view.allies) ) errors.push("allies: a list is expected");
  return errors;
}
