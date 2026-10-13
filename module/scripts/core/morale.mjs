/**
 * Le moral (SPEC §9.5) — étape 4 du plan (§16). Pur et déterministe : pas d'aléa (le test est un jet de sauvegarde lancé par le
 * moteur), pas de Foundry.
 *
 * Un test se déclenche, une fois par cause et par combat, quand la créature :
 *   bloodied      passe à la moitié de ses PV ou moins ;
 *   halfDown      voit tomber la moitié de son groupe (elle comprise, au moins deux) ;
 *   leaderDown    voit tomber son chef (un allié marqué chef, ou de FP plus haut que le sien) ;
 *   cantHarm      ne peut nuire à personne depuis deux tours (aucun ennemi joignable).
 * Le test : sauvegarde de Sagesse DD 10 ; `mindless` et `fanatic` n'y sont pas soumis ; `brave` a l'Avantage, `cowardly` le
 * Désavantage. Un échec : fuir ; se rendre si fuir est impossible et que le profil le permet.
 */

export const MORALE_DC = 10;
export const MORALE_ABILITY = "wis";
/** Tours sans pouvoir nuire avant un test. */
export const IDLE_TURNS = 2;
/** Tours sans ennemi perçu avant qu'un fuyard se calme. */
export const CALM_TURNS = 2;
/** Intelligence minimale pour se rendre (§9.5). */
export const SURRENDER_INT = 6;

export const TRIGGERS = Object.freeze(["bloodied", "halfDown", "leaderDown", "cantHarm"]);

/**
 * Le test de moral de ce profil : null s'il n'y est pas soumis, sinon `{ ability, dc, advantage, disadvantage }`.
 * @param {{courage: string}} profile
 */
export function moraleTest(profile) {
  const courage = profile?.courage ?? "normal";
  if ( (courage === "mindless") || (courage === "fanatic") ) return null;
  return { ability: MORALE_ABILITY, dc: MORALE_DC, advantage: courage === "brave", disadvantage: courage === "cowardly" };
}

/**
 * Les causes de test présentes et pas encore testées ce combat, dans l'ordre de `TRIGGERS`.
 * @param {object} state
 * @param {{value:number, max:number}} state.hp            PV de la créature
 * @param {number|null} state.cr                           son FP
 * @param {{down:boolean, cr?:number|null, leader?:boolean}[]} state.group   ses alliés **du combat** (elle exclue)
 * @param {number} state.idle                              tours de suite sans pouvoir nuire
 * @param {string[]} state.tested                          causes déjà testées ce combat
 */
export function moraleTriggers({ hp, cr=null, group=[], idle=0, tested=[] }={}) {
  const out = [];
  const done = new Set(tested ?? []);
  const add = key => { if ( !done.has(key) ) out.push(key); };
  if ( (hp?.max > 0) && (hp.value > 0) && (hp.value <= hp.max / 2) ) add("bloodied");
  const members = (group ?? []).length + 1;
  const down = (group ?? []).filter(m => m.down).length;
  if ( (members >= 2) && (down >= members / 2) ) add("halfDown");
  if ( (group ?? []).some(m => m.down && (m.leader || (Number.isFinite(m.cr) && Number.isFinite(cr) && (m.cr > cr)))) ) add("leaderDown");
  if ( idle >= IDLE_TURNS ) add("cantHarm");
  return out;
}

/**
 * Peut-elle se rendre (§9.5) ? Intelligence 6 ou plus, ni `mindless`, ni `fanatic`, ni `brave`.
 * @param {{courage: string}} profile
 * @param {number} int
 */
export function canSurrender(profile, int) {
  if ( ["mindless", "fanatic", "brave"].includes(profile?.courage) ) return false;
  return (int ?? 0) >= SURRENDER_INT;
}

/**
 * Comment fuir : Se désengager d'abord si un ennemi est au contact et que la créature y pense (bande `average` ou mieux) ; sinon
 * Foncer. Rend `"disengage"` | `"dash"`.
 * @param {{band: string}} profile
 * @param {boolean} threatened   un ennemi au contact
 * @param {(band:string, min:string) => boolean} atLeast
 */
export function fleeAction(profile, threatened, atLeast) {
  return (threatened && atLeast(profile?.band, "average")) ? "disengage" : "dash";
}
