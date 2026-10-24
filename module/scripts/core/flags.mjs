/**
 * Drapeaux et renforts (SPEC §10.2, §10.5 ; étape 7 du §16) — ce qui se décide sans Foundry : les groupes qu'un drapeau ou une réserve
 * couvre, le poste de tir à prendre, la destination d'un fuyard, les pertes d'un groupe, le délai d'une réserve, qui en part. Pur :
 * l'aléa est injecté (`rng`), distances en cases d'emprise à emprise (0 = au contact), comme la vue (core/view.mjs).
 */
import { atLeast } from "./profile.mjs";

/** Les sortes de drapeau. */
export const FLAG_KINDS = Object.freeze(["forbidden", "refuge", "alarm", "vantage"]);
/** Ce qui fait partir une réserve. */
export const RESERVE_TRIGGERS = Object.freeze(["alarm", "losses", "call", "manual"]);

/** Le champ `groups` d'un drapeau ou d'une réserve (texte « nord, caserne ») : la liste, vide = tous les groupes de la scène. */
export function groupsOf(text) {
  return String(text ?? "").split(/[,;]/).map(s => s.trim()).filter(Boolean);
}

/** Le drapeau couvre-t-il ce groupe ? Une liste vide couvre tout le monde. */
export function covers(groups, group) {
  const list = Array.isArray(groups) ? groups : groupsOf(groups);
  return !list.length || list.includes(group);
}

/**
 * Le poste de tir à prendre (§10.2 `vantage`) pour tirer sur `targetId` avec une attaque de portée normale `normal` (cases) : la case la
 * plus proche du tireur, parmi celles des postes d'où la cible se voit et reste à portée normale. Rend `{ vantage, cells }` (les cases
 * qui conviennent, la plus proche en tête) ou null — aussi quand le tireur est déjà sur une case qui convient.
 * @param {{id:string, cells:{i:number,j:number,from:number,seen:Record<string,number>}[]}[]} vantages
 *        `from` : distance du tireur à la case (cases, 0 = il y est) ; `seen[id]` : distance de la case à cet ennemi s'il s'y voit.
 * @param {string} targetId
 * @param {number} normal
 * @param {{maxFrom?: number}} [options]   `maxFrom` : ce que son déplacement permet (cases).
 */
export function pickVantage(vantages, targetId, normal, { maxFrom=Infinity }={}) {
  if ( !(normal > 0) || !targetId ) return null;
  const fits = c => Number.isFinite(c.seen?.[targetId]) && ((c.seen[targetId] + 1) <= normal) && (c.from <= maxFrom);
  if ( (vantages ?? []).some(v => v.cells.some(c => (c.from === 0) && fits(c))) ) return null;
  let best = null;
  for ( const v of vantages ?? [] ) {
    const cells = v.cells.filter(fits).sort((a, b) => a.from - b.from);
    if ( !cells.length ) continue;
    if ( !best || (cells[0].from < best.cells[0].from) ) best = { vantage: v.id, cells };
  }
  return best;
}

/**
 * Où fuit une créature dont le moral casse (§9.5, §10.5) : `reserve` (aller chercher les renforts, bande `cunning` et plus), `alarm`
 * (donner l'alarme, `average` et plus), `refuge`, ou null (s'éloigner, comme avant ; une `simple` ne pense qu'à elle). Chaque option n'est offerte que si l'adaptateur l'a
 * trouvée atteignable.
 * @param {{band: string}} profile
 * @param {{reserve?: boolean, alarm?: boolean, refuge?: boolean}} reachable
 */
export function fleeGoal(profile, { reserve=false, alarm=false, refuge=false }={}) {
  const band = profile?.band ?? "simple";
  // Qui calcule va chercher la relève, sinon sonne l'alarme ; qui pense un peu sonne l'alarme ; tous filent au refuge s'il y en a un.
  if ( reserve && atLeast(band, "cunning") ) return "reserve";
  if ( alarm && atLeast(band, "average") ) return "alarm";
  if ( refuge ) return "refuge";
  return null;
}

/** Les pertes d'un groupe atteignent-elles `percent` % (§10.5 `losses`) ? `members` : `{ down }` de chacun. */
export function lossesReached(members, percent) {
  const n = (members ?? []).length;
  if ( !n ) return false;
  const down = members.filter(m => m.down).length;
  return down > 0 && ((down * 100) / n) >= Math.max(1, percent ?? 50);
}

/** Le délai d'une réserve avec un aléa de ±30 % (secondes hors combat, rounds en combat : arrondi, au moins 0). */
export function reserveDelay(delay, rng=Math.random, { rounds=false }={}) {
  const base = Math.max(0, Number(delay) || 0);
  if ( !base ) return 0;
  const value = base * (0.7 + (rng() * 0.6));
  return rounds ? Math.max(1, Math.round(value)) : value;
}

/** Qui part (§10.5 `count`) : les `count` premiers (0 = tous), les autres restent en réserve. */
export function pickMembers(members, count) {
  const list = members ?? [];
  const n = Math.max(0, Math.floor(Number(count) || 0));
  return n ? list.slice(0, n) : list.slice();
}

/** La bande donne-t-elle l'alarme en l'atteignant (§10.2 : `simple` et plus ; une bête n'y pense pas) ? */
export const ringsAlarm = band => atLeast(band ?? "bestial", "simple");
