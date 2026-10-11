/**
 * Le profil d'une créature (SPEC §6) : ce qu'elle *est*, déduit des faits lus sur sa fiche par l'adaptateur (adapter/sheet.mjs),
 * puis surchargé par des couches ordonnées (contenu du module < table enregistrée par un autre module < surcouche du monde < flag du
 * token — SPEC §6.4). Fonctions pures, aucune dépendance à Foundry.
 *
 * @typedef {object} Facts   Ce que l'adaptateur lit sur la fiche (jamais écrit).
 * @property {string|null} type          Type de créature dnd5e (`beast`, `undead`, `humanoid`…).
 * @property {string} subtype            Sous-type libre (`goblinoid`, `gnoll`…), en minuscules.
 * @property {string} alignment          Alignement libre (« Chaotic Evil »).
 * @property {number|null} cr
 * @property {{int:number, wis:number, cha:number}} abilities
 * @property {{prcPassive:number|null, ste:number|null, itm:number|null, sur:number|null}} skills
 * @property {{value:number, max:number}} hp
 * @property {{walk:number, fly:number, swim:number, climb:number, burrow:number}} speed   Dans l'unité de la fiche.
 * @property {{darkvision:number, blindsight:number, tremorsense:number, truesight:number}} senses
 * @property {boolean} legendary
 * @property {boolean} speaks            La fiche connaît au moins une langue.
 * @property {boolean} spellcaster
 * @property {string[]} traits           Identifiants dnd5e des aptitudes (`pack-tactics`…).
 * @property {Attack[]} attacks
 * @property {string|null} species       Espèce d'un PJ (identifiant de l'item d'espèce), sinon null.
 *
 * @typedef {object} Attack
 * @property {string} id        uuid de l'activité
 * @property {string} name
 * @property {boolean} ranged
 * @property {boolean} spell
 * @property {{value:number|null, long:number|null, reach:number|null, units:string|null}} range
 * @property {number} damage    Dégâts moyens d'un coup qui touche.
 */

export const BANDS = Object.freeze(["bestial", "simple", "average", "cunning", "tactical"]);
export const COURAGES = Object.freeze(["mindless", "fanatic", "brave", "normal", "cowardly"]);
export const RANGES = Object.freeze(["melee", "ranged", "mixed"]);
export const WISDOMS = Object.freeze(["fragile", "steady", "cool"]);

/** Les clés qu'une couche peut surcharger, et leurs valeurs permises (null : libre, booléen). */
export const OVERRIDE_KEYS = Object.freeze({
  band: BANDS, courage: COURAGES, range: RANGES, wisdom: WISDOMS, speaks: "boolean", leader: "boolean"
});

/** Les sources de couche, dans l'ordre où elles s'appliquent (la dernière gagne). */
export const LAYER_SOURCES = Object.freeze(["module", "registered", "world", "token"]);

/** Types sans esprit quand l'Intelligence est bestiale : ils ne fuient ni ne se rendent (SPEC §6.3). */
const MINDLESS_TYPES = new Set(["undead", "construct", "ooze", "plant"]);
const BRAVE_TYPES = new Set(["fiend", "celestial", "dragon"]);
const MUTE_TYPES = new Set(["beast", "ooze", "plant"]);

/** Bande d'Intelligence (SPEC §6.1). */
export function bandOf(int) {
  if ( !Number.isFinite(int) ) return "average";
  if ( int <= 3 ) return "bestial";
  if ( int <= 7 ) return "simple";
  if ( int <= 11 ) return "average";
  if ( int <= 15 ) return "cunning";
  return "tactical";
}

export const bandRank = band => BANDS.indexOf(band);
/** La bande vaut-elle au moins `min` ? */
export const atLeast = (band, min) => bandRank(band) >= bandRank(min);

/** Sagesse : moral et sang-froid (SPEC §6.2). */
export function wisdomOf(wis) {
  if ( !Number.isFinite(wis) ) return "steady";
  if ( wis <= 7 ) return "fragile";
  if ( wis >= 14 ) return "cool";
  return "steady";
}

/** Courage déduit du type, de l'alignement, du FP et des traits (SPEC §6.3). */
export function courageOf(facts) {
  const int = facts.abilities?.int ?? 10;
  const type = facts.type ?? null;
  const cr = facts.cr ?? 0;
  if ( type === "construct" ) return "mindless";
  if ( MINDLESS_TYPES.has(type) && (int <= 3) ) return "mindless";
  if ( facts.legendary || BRAVE_TYPES.has(type) ) return "brave";
  if ( /evil/i.test(facts.alignment ?? "") && (int >= 12) && (cr >= 5) ) return "fanatic";
  if ( (type === "beast") && (cr < 1) ) return "cowardly";
  if ( (type === "humanoid") && (cr < 1) ) return "cowardly";
  return "normal";
}

/** Portée préférée d'après les attaques de la fiche (SPEC §6.3). */
export function rangeOf(attacks=[]) {
  const melee = attacks.some(a => !a.ranged);
  const ranged = attacks.some(a => a.ranged);
  if ( melee && ranged ) return "mixed";
  if ( ranged ) return "ranged";
  return "melee";
}

/** Identifiants dnd5e des traits qui changent la conduite → drapeaux. */
const TRAIT_FLAGS = Object.freeze({
  packTactics: ["pack-tactics"],
  keenSenses: ["keen-senses", "keen-smell", "keen-hearing", "keen-sight", "keen-hearing-and-smell", "keen-hearing-and-sight"],
  sunlightSensitivity: ["sunlight-sensitivity", "light-sensitivity"],
  nimbleEscape: ["nimble-escape"],
  ambusher: ["ambusher", "surprise-attack", "false-appearance"],
  legendaryResistance: ["legendary-resistance"]
});

/** @param {string[]} identifiers */
export function traitFlags(identifiers=[]) {
  const set = new Set(identifiers.map(i => String(i).toLowerCase()));
  const out = {};
  for ( const [flag, ids] of Object.entries(TRAIT_FLAGS) ) out[flag] = ids.some(id => set.has(id));
  return out;
}

/**
 * Le profil, couches appliquées. `from[clé]` dit d'où vient chaque valeur (« sheet » ou la source de la couche).
 * @param {Facts} facts
 * @param {{source:string, set:object}[]} layers   Dans l'ordre d'application (SPEC §6.4) ; une valeur hors liste est ignorée.
 */
export function profileOf(facts, layers=[]) {
  const int = facts.abilities?.int ?? 10;
  const base = {
    band: bandOf(int),
    wisdom: wisdomOf(facts.abilities?.wis),
    courage: courageOf(facts),
    range: rangeOf(facts.attacks),
    speaks: facts.speaks ?? ((int >= 6) && !MUTE_TYPES.has(facts.type)),
    leader: false
  };
  const from = Object.fromEntries(Object.keys(base).map(k => [k, "sheet"]));
  for ( const layer of layers ) {
    if ( !layer?.set ) continue;
    for ( const [key, value] of Object.entries(layer.set) ) {
      if ( !allowedValue(key, value) ) continue;
      base[key] = value;
      from[key] = layer.source ?? "unknown";
    }
  }
  return {
    ...base,
    mobility: {
      fly: (facts.speed?.fly ?? 0) > 0,
      swim: (facts.speed?.swim ?? 0) > 0,
      climb: (facts.speed?.climb ?? 0) > 0,
      burrow: (facts.speed?.burrow ?? 0) > 0
    },
    senses: {
      darkvision: (facts.senses?.darkvision ?? 0) > 0,
      blindsight: (facts.senses?.blindsight ?? 0) > 0,
      tremorsense: (facts.senses?.tremorsense ?? 0) > 0,
      truesight: (facts.senses?.truesight ?? 0) > 0
    },
    traits: traitFlags(facts.traits),
    stealthy: (facts.skills?.ste ?? 0) >= 5,
    legendary: !!facts.legendary,
    spellcaster: !!facts.spellcaster,
    from
  };
}

function allowedValue(key, value) {
  const allowed = OVERRIDE_KEYS[key];
  if ( !allowed ) return false;
  if ( allowed === "boolean" ) return typeof value === "boolean";
  return allowed.includes(value);
}

/** Les erreurs d'une surcharge (`set`) : clés inconnues, valeurs hors liste. Vide = valide. */
export function validateOverride(set) {
  const errors = [];
  if ( !set || (typeof set !== "object") || Array.isArray(set) ) return ["set: an object is expected"];
  for ( const [key, value] of Object.entries(set) ) {
    const allowed = OVERRIDE_KEYS[key];
    if ( !allowed ) { errors.push(`${key}: unknown key`); continue; }
    if ( !allowedValue(key, value) ) errors.push(`${key}: "${value}" is not one of ${allowed === "boolean" ? "true/false" : allowed.join(", ")}`);
  }
  return errors;
}

/** Les clés sur lesquelles une entrée de table (`match`) peut sélectionner une créature. */
export const MATCH_KEYS = Object.freeze(["type", "subtype", "identifier", "species"]);

/** Une sélection correspond-elle aux faits ? Chaque clé donnée doit être égale (insensible à la casse) ; vide = tout le monde. */
export function matchFacts(match, facts) {
  if ( !match || (typeof match !== "object") ) return false;
  for ( const [key, wanted] of Object.entries(match) ) {
    if ( !MATCH_KEYS.includes(key) ) return false;
    const have = key === "identifier" ? facts.identifier : facts[key];
    if ( String(have ?? "").toLowerCase() !== String(wanted ?? "").toLowerCase() ) return false;
  }
  return true;
}

/**
 * Les erreurs d'une table de profils `[{ match, set }]`. Vide = valide.
 * @param {Array} list
 */
export function validateProfiles(list) {
  const errors = [];
  if ( !Array.isArray(list) ) return ["profiles: a list is expected"];
  list.forEach((entry, i) => {
    const where = `profiles[${i}]`;
    if ( !entry?.match || (typeof entry.match !== "object") ) errors.push(`${where}.match: an object is expected`);
    else for ( const key of Object.keys(entry.match) ) if ( !MATCH_KEYS.includes(key) ) errors.push(`${where}.match.${key}: unknown key`);
    for ( const e of validateOverride(entry?.set) ) errors.push(`${where}.${e}`);
  });
  return errors;
}

/** Les couches d'une table de profils qui s'appliquent à ces faits, dans l'ordre de la table. */
export function layersFrom(list, facts, source) {
  return (list ?? []).filter(entry => matchFacts(entry.match, facts)).map(entry => ({ source, set: entry.set }));
}
