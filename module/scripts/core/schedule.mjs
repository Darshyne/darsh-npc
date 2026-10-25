/**
 * Les horaires des PNJ (SPEC §10.6, étape 9 bis). Pur : pas de Foundry ; l'heure arrive en **minutes depuis minuit** (le runtime la
 * lit dans `game.time.components`), la longueur d'un jour en minutes (1 440 par défaut).
 *
 * Un horaire = une liste de **créneaux** `{ from: "22:00", to: "06:00", activity, region, wake }` :
 *   patrol  sur l'itinéraire de la patrouille `region`
 *   post    dans le poste de garde `region`
 *   sleep   endormi dans le dortoir `region` (toute région) ; `wake` : secondes avant de se réveiller sur un bruit (6 = un round)
 *   idle    vaque sur place (ou dans `region`, s'il y en a une)
 *   off     hors de la scène : caché (s'il a une `region`, il y marche d'abord)
 * Un créneau couvre `from` ≤ heure < `to` ; `to` avant `from` passe minuit ; `from` = `to` : toute la journée. Le premier créneau qui
 * couvre l'heure l'emporte.
 */

export const ACTIVITIES = Object.freeze(["patrol", "post", "sleep", "idle", "off"]);
/** Activités qui demandent une région. */
export const NEEDS_REGION = Object.freeze(["patrol", "post", "sleep"]);
/** Délai de réveil par défaut (secondes réelles, un round hors combat). */
export const WAKE_SECONDS = 6;
/** Un saut d'horloge du monde d'au moins tant de secondes est un « rattrapage » : on téléporte au lieu de marcher. */
export const CATCH_UP_SECONDS = 3600;

/** « 22:00 », « 6:30 », « 6 » → minutes depuis minuit ; null si illisible. */
export function parseTime(text, dayMinutes=1440) {
  const m = String(text ?? "").trim().match(/^(\d{1,2})(?:[:hH.](\d{2}))?$/);
  if ( !m ) return null;
  const minutes = (Number(m[1]) * 60) + Number(m[2] ?? 0);
  if ( Number(m[2] ?? 0) >= 60 ) return null;
  if ( minutes > dayMinutes ) return null;
  return minutes % dayMinutes;
}

/** Minutes → « 06:00 ». */
export function formatTime(minutes) {
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** L'heure `minute` est-elle dans [from, to[ (en passant minuit si to < from ; toute la journée si from = to) ? */
export function covers(from, to, minute) {
  if ( from === to ) return true;
  return (from < to) ? ((minute >= from) && (minute < to)) : ((minute >= from) || (minute < to));
}

/**
 * Valider et normaliser un horaire. Rend `{ slots, problems }` : les créneaux lisibles (`from`/`to` en minutes, `index` d'origine),
 * et ce qui a été écarté.
 */
export function normalizeSlots(raw, dayMinutes=1440) {
  const slots = [], problems = [];
  if ( !Array.isArray(raw) ) return { slots, problems: raw == null ? [] : ["not a list"] };
  raw.forEach((s, index) => {
    const from = parseTime(s?.from, dayMinutes), to = parseTime(s?.to, dayMinutes);
    if ( (from === null) || (to === null) ) return problems.push(`slot ${index + 1}: unreadable time`);
    if ( !ACTIVITIES.includes(s?.activity) ) return problems.push(`slot ${index + 1}: unknown activity ${s?.activity}`);
    const region = s.region ? String(s.region) : null;
    if ( NEEDS_REGION.includes(s.activity) && !region ) return problems.push(`slot ${index + 1}: ${s.activity} needs a region`);
    const wake = Number.isFinite(Number(s.wake)) && (s.wake !== "") && (s.wake !== null) ? Math.max(0, Number(s.wake)) : WAKE_SECONDS;
    slots.push({ index, from, to, activity: s.activity, region, wake });
  });
  return { slots, problems };
}

/** Le créneau actif d'un horaire normalisé à cette heure, ou null. */
export function slotAt(slots, minute) {
  return slots.find(s => covers(s.from, s.to, minute)) ?? null;
}

/** Des heures de région, « 06:00-22:00, 23:00-01:00 » → `[{ from, to }]` ; vide = toujours. */
export function parseHours(text, dayMinutes=1440) {
  const out = [];
  for ( const part of String(text ?? "").split(/[,;]/) ) {
    const m = part.trim().match(/^(\S+)\s*[-–]\s*(\S+)$/);
    if ( !m ) continue;
    const from = parseTime(m[1], dayMinutes), to = parseTime(m[2], dayMinutes);
    if ( (from !== null) && (to !== null) ) out.push({ from, to });
  }
  return out;
}

/** Des heures de région couvrent-elles cette minute ? (aucune heure lisible = toujours) */
export function hoursCover(hours, minute) {
  return !hours.length || hours.some(h => covers(h.from, h.to, minute));
}

/**
 * Ce que fait un token maintenant, dans l'ordre (§10.6) :
 *   1. son propre horaire, s'il a un créneau à cette heure ;
 *   2. son affectation (patrouille, poste), si les heures de la région la couvrent (pas d'heures : toujours) ;
 *   3. l'horaire de son groupe sur la scène, s'il a un créneau ;
 *   4. rien (sa routine d'avant les horaires : son point de départ).
 * @param {{own?: object[], group?: object[], assignment?: {kind: string, region: string, hours?: {from:number,to:number}[]}|null}} sources
 *   `own` et `group` déjà normalisés
 * @param {number} minute
 * @returns {{source: string, activity: string, region: string|null, wake?: number, key: string}|null}
 */
export function decide({ own=[], group=[], assignment=null }={}, minute) {
  const mine = slotAt(own, minute);
  if ( mine ) return { source: "own", ...pick(mine), key: `own.${mine.index}.${mine.activity}.${mine.region ?? ""}` };
  if ( assignment && hoursCover(assignment.hours ?? [], minute) ) {
    const activity = (assignment.kind === "route") ? "patrol" : "post";
    return { source: "assignment", activity, region: assignment.region, key: `assignment.${activity}.${assignment.region}` };
  }
  const shared = slotAt(group, minute);
  if ( shared ) return { source: "group", ...pick(shared), key: `group.${shared.index}.${shared.activity}.${shared.region ?? ""}` };
  return null;
}
const pick = s => ({ activity: s.activity, region: s.region, wake: s.wake });

/**
 * Le passage d'un créneau à l'autre : marcher (relève visible), ou téléporter (rattrapage d'un saut d'horloge, §10.6).
 * @param {number|null} delta  le saut de l'horloge du monde qui a fait changer le créneau (secondes), null si inconnu
 */
export function isCatchUp(delta) {
  return Number.isFinite(delta) && (Math.abs(delta) >= CATCH_UP_SECONDS);
}

/** Un réveil : dans combien de rounds de combat, pour un délai en secondes (au moins un si le délai n'est pas nul). */
export function wakeRounds(seconds) {
  return seconds > 0 ? Math.max(1, Math.ceil(seconds / 6)) : 0;
}
