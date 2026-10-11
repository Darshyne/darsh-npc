/**
 * Moyenne d'une formule de dés déjà résolue (plus de `@…`) : « 2d6 + 3 » → 10, « 1d8 » → 4,5, « 7 » → 7. Sert au score des
 * attaques (dégâts moyens, SPEC §9.2). Fonctions pures. Ce qu'on ne comprend pas (parenthèses, fonctions) compte pour 0, et
 * `understood` le dit.
 */

/**
 * @param {string} formula
 * @returns {{ average: number, understood: boolean }}
 */
export function averageOf(formula) {
  const text = String(formula ?? "").replace(/\s+/g, "");
  if ( !text ) return { average: 0, understood: true };
  let understood = true;
  let total = 0;
  // Termes signés : +2d6, -1, +1d4r1 (modificateurs ignorés sauf la relance basse, approchée).
  const terms = text.match(/[+-]?[^+-]+/g) ?? [];
  for ( const raw of terms ) {
    const sign = raw.startsWith("-") ? -1 : 1;
    const term = raw.replace(/^[+-]/, "");
    const dice = term.match(/^(\d*)d(\d+)([a-z0-9]*)$/i);
    if ( dice ) {
      const number = dice[1] === "" ? 1 : Number(dice[1]);
      const faces = Number(dice[2]);
      total += sign * number * (faces + 1) / 2;
      if ( dice[3] ) understood = false;
      continue;
    }
    if ( /^\d+(\.\d+)?$/.test(term) ) { total += sign * Number(term); continue; }
    understood = false;
  }
  return { average: total, understood };
}
