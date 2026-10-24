/**
 * Les répliques (SPEC §11) — ce qui se décide sans Foundry : la famille d'une créature, les clés où chercher ses répliques, la ligne
 * choisie (jamais deux fois la même d'affilée), le droit de parler maintenant (fréquence par moment, délai par token), et la
 * validation d'une table venue de l'éditeur, d'un import ou d'un autre module. L'aléa est injecté (`rng`, core/rng.mjs).
 *
 * Une table de répliques : `{ <clé>: { <moment>: { <langue>: [lignes] } } }` ; clé = identifiant de la fiche (`zombie`…),
 * `subtype:<x>`, `type:<x>` ou une famille (`brute`, `beast`…). Les répliques d'un token (flag `barks`) : `{ <moment>: [lignes] }`.
 */

export const MOMENTS = Object.freeze(["spotted", "engage", "attack", "hit", "bloodied", "kill", "allyDown", "leaderDown", "flee",
  "surrender", "victory", "alarm"]);

/** Chance qu'un moment fasse parler, à la fréquence « normale » (§11 : `spotted` toujours, `attack` rarement). */
export const CHANCE = Object.freeze({
  spotted: 1, engage: 0.6, attack: 0.15, hit: 0.25, bloodied: 0.8, kill: 0.7, allyDown: 0.5, leaderDown: 0.9, flee: 1, surrender: 1,
  victory: 0.8, alarm: 1
});

/** Réglage de fréquence → multiplicateur de chance. `always` : à chaque fois (tests, tables bavardes). */
export const FREQUENCIES = Object.freeze({ rare: 0.4, normal: 1, chatty: 1.8, always: Infinity });

export const FAMILIES = Object.freeze(["brute", "cunning", "fiend", "undead", "dragon", "beast", "mindless", "monster"]);
const MINDLESS_TYPES = new Set(["undead", "construct", "ooze", "plant"]);

/**
 * La famille d'une créature, d'après ses faits (adapter/sheet.mjs) et son profil (core/profile.mjs).
 * @param {{type?: string, speaks?: boolean, spellcaster?: boolean}} facts
 * @param {{band?: string, courage?: string}} profile
 */
export function familyOf(facts={}, profile={}) {
  const type = facts.type ?? "";
  if ( !facts.speaks ) {
    if ( type === "beast" ) return "beast";
    if ( MINDLESS_TYPES.has(type) || (profile.courage === "mindless") ) return "mindless";
    return "monster";
  }
  if ( type === "fiend" ) return "fiend";
  if ( type === "undead" ) return "undead";
  if ( type === "dragon" ) return "dragon";
  if ( ["cunning", "tactical"].includes(profile.band) || facts.spellcaster ) return "cunning";
  return "brute";
}

/** Les clés où chercher, de la plus précise à la plus large. */
export function barkKeys(facts={}, family) {
  return [facts.identifier, facts.subtype ? `subtype:${facts.subtype}` : null, facts.type ? `type:${facts.type}` : null, family]
    .filter(Boolean);
}

/**
 * Les lignes pour ce moment : celles du token d'abord, puis la première couche (monde, modules, génériques) qui en a pour une des clés,
 * dans la langue voulue, sinon en anglais, sinon dans n'importe quelle langue. Une famille qui parle se replie sur `brute`.
 * Rend `{ lines, source }` (`source` : `token` | indice de la couche | null).
 * @param {object} args
 * @param {Record<string, string[]>|null} args.token
 * @param {object[]} args.layers   tables, de la plus forte à la plus faible
 * @param {string[]} args.keys
 * @param {string} args.moment
 * @param {string} args.lang
 * @param {boolean} [args.speaks]
 */
export function linesFor({ token=null, layers=[], keys=[], moment, lang, speaks=true }) {
  const own = token?.[moment];
  if ( Array.isArray(own) && own.length ) return { lines: own, source: "token" };
  const pick = byLang => {
    if ( !byLang ) return null;
    for ( const l of [lang, "en", ...Object.keys(byLang)] ) if ( Array.isArray(byLang[l]) && byLang[l].length ) return byLang[l];
    return null;
  };
  const tried = speaks ? [...keys, "brute"] : keys;
  for ( const [i, layer] of layers.entries() ) {
    for ( const key of tried ) {
      const lines = pick(layer?.[key]?.[moment]);
      if ( lines ) return { lines, source: i };
    }
  }
  return { lines: [], source: null };
}

/** Une ligne, jamais `last` s'il y en a une autre. */
export function chooseLine(lines, last, rng=Math.random) {
  if ( !lines?.length ) return null;
  const pool = (lines.length > 1) ? lines.filter(l => l !== last) : lines;
  return pool[Math.floor(rng() * pool.length) % pool.length];
}

/**
 * Peut-elle parler maintenant ? Le délai depuis sa dernière réplique (`cooldownMs`), puis la chance du moment × la fréquence.
 * `force` : sans délai ni tirage (fuite, reddition, réplique demandée par le MJ).
 */
export function mayBark({ moment, frequency="normal", lastAt=0, now=Date.now(), cooldownMs=0, rng=Math.random, force=false }) {
  if ( force ) return true;
  if ( lastAt && ((now - lastAt) < cooldownMs) ) return false;
  const chance = Math.min(1, (CHANCE[moment] ?? 0.5) * (FREQUENCIES[frequency] ?? 1));
  return (chance >= 1) || (rng() < chance);
}

/**
 * Les erreurs d'une table de répliques (vide : valide). Clé non vide ; moment connu ; langue de 2 à 5 lettres ; lignes = chaînes non
 * vides de 200 caractères au plus.
 */
export function validateBarks(table, path="barks") {
  const errors = [];
  if ( !table || (typeof table !== "object") || Array.isArray(table) ) return [`${path}: an object is expected`];
  for ( const [key, moments] of Object.entries(table) ) {
    if ( !key.trim() ) errors.push(`${path}: empty key`);
    if ( !moments || (typeof moments !== "object") || Array.isArray(moments) ) { errors.push(`${path}.${key}: an object is expected`); continue; }
    for ( const [moment, langs] of Object.entries(moments) ) {
      if ( !MOMENTS.includes(moment) ) { errors.push(`${path}.${key}.${moment}: unknown moment`); continue; }
      if ( !langs || (typeof langs !== "object") || Array.isArray(langs) ) { errors.push(`${path}.${key}.${moment}: an object is expected`); continue; }
      for ( const [lang, lines] of Object.entries(langs) ) {
        if ( !/^[a-z]{2}([-_][A-Za-z]{2})?$/.test(lang) ) errors.push(`${path}.${key}.${moment}.${lang}: not a language code`);
        if ( !Array.isArray(lines) ) { errors.push(`${path}.${key}.${moment}.${lang}: a list of lines is expected`); continue; }
        for ( const line of lines ) {
          if ( (typeof line !== "string") || !line.trim() || (line.length > 200) ) errors.push(`${path}.${key}.${moment}.${lang}: bad line`);
        }
      }
    }
  }
  return errors;
}

/** Les répliques d'un token (flag `barks`) : `{ moment: [lignes] }`. */
export function validateTokenBarks(barks) {
  if ( !barks || (typeof barks !== "object") || Array.isArray(barks) ) return ["token barks: an object is expected"];
  const errors = [];
  for ( const [moment, lines] of Object.entries(barks) ) {
    if ( !MOMENTS.includes(moment) ) errors.push(`token barks.${moment}: unknown moment`);
    if ( !Array.isArray(lines) || lines.some(l => (typeof l !== "string") || !l.trim() || (l.length > 200)) ) errors.push(`token barks.${moment}: bad lines`);
  }
  return errors;
}
