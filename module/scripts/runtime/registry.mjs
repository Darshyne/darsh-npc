/**
 * Tables enregistrées par d'autres modules (SPEC §14.1, `api.ai.register(source, table)`) : profils et haines, validées par le
 * cœur, gardées par source sur ce client. Même schéma que `api.content.register` du moteur : une entrée fausse est écartée et
 * signalée, les autres sont prises. Rien n'est écrit dans le monde.
 */
import { validateProfiles } from "../core/profile.mjs";
import { validateEnmities } from "../core/targets.mjs";
import { log } from "../shared.mjs";

/** @type {Map<string, {profiles: Array, enmities: Array}>} */
const tables = new Map();

/**
 * @param {string} source   L'identifiant du module qui enregistre.
 * @param {{profiles?: Array, enmities?: Array}} table
 * @returns {{source: string, accepted: {profiles: number, enmities: number}, rejected: string[]}}
 */
export function register(source, table={}) {
  if ( !source || (typeof source !== "string") ) throw new Error("register: a source id is expected");
  const rejected = [];
  const keep = { profiles: [], enmities: [] };
  for ( const [i, entry] of (Array.isArray(table.profiles) ? table.profiles : []).entries() ) {
    const errors = validateProfiles([entry]).map(e => e.replace(/^profiles\[0\]/, `profiles[${i}]`));
    if ( errors.length ) rejected.push(...errors); else keep.profiles.push(entry);
  }
  for ( const [i, row] of (Array.isArray(table.enmities) ? table.enmities : []).entries() ) {
    const errors = validateEnmities([row]).map(e => e.replace(/^enmities\[0\]/, `enmities[${i}]`));
    if ( errors.length ) rejected.push(...errors); else keep.enmities.push(row);
  }
  tables.set(source, keep);
  if ( rejected.length ) log.warn(`${source} : ${rejected.length} entrée(s) refusée(s)`, rejected);
  return { source, accepted: { profiles: keep.profiles.length, enmities: keep.enmities.length }, rejected };
}

export function unregister(source) {
  return tables.delete(source);
}

/** Ce qui est enregistré, par source (copies). */
export function registered() {
  return Object.fromEntries(Array.from(tables, ([s, t]) => [s, { profiles: [...t.profiles], enmities: [...t.enmities] }]));
}

/** Toutes les entrées enregistrées, sources confondues, dans l'ordre d'enregistrement. */
export function registeredProfiles() {
  return Array.from(tables.values()).flatMap(t => t.profiles);
}

export function registeredEnmities() {
  return Array.from(tables.values()).flatMap(t => t.enmities);
}
