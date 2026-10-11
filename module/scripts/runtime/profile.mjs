/**
 * Le profil d'une créature, couches composées (SPEC §6.4) : contenu du module < tables enregistrées < surcouche du monde
 * < flag du token. Et les haines qui la concernent (lignes dont `hater` correspond à ses faits), mêmes couches. Lecture seule.
 */
import { profileOf, layersFrom, matchFacts, validateOverride } from "../core/profile.mjs";
import { matchKinds } from "../core/targets.mjs";
import { PROFILES } from "../content/profiles.mjs";
import { ENMITIES } from "../content/enmities.mjs";
import { factsOf } from "../adapter/sheet.mjs";
import { registeredProfiles, registeredEnmities } from "./registry.mjs";
import { MODULE_ID, setting, log } from "../shared.mjs";

function worldTable() {
  const world = setting("world") ?? {};
  return { profiles: Array.isArray(world.profiles) ? world.profiles : [], enmities: Array.isArray(world.enmities) ? world.enmities : [] };
}

/** Les couches qui s'appliquent à ces faits, dans l'ordre d'application. */
export function layersFor(facts, token=null) {
  const layers = [
    ...layersFrom(PROFILES, facts, "module"),
    ...layersFrom(registeredProfiles(), facts, "registered"),
    ...layersFrom(worldTable().profiles, facts, "world")
  ];
  const own = token?.getFlag?.(MODULE_ID, "profile");
  if ( own ) {
    const errors = validateOverride(own);
    if ( errors.length ) log.warn(`${token.name} : surcharge de profil ignorée`, errors);
    else layers.push({ source: "token", set: own });
  }
  return layers;
}

/** Les kinds de la créature elle-même, pour sélectionner les lignes de haine dont elle est le `hater`. */
function ownKinds(facts, token) {
  return {
    type: facts.type, subtype: facts.subtype, species: facts.species,
    group: token?.getFlag?.(MODULE_ID, "group") ?? null,
    living: !["undead", "construct"].includes(facts.type)
  };
}

/** Les lignes de haine qui concernent cette créature (`hater` correspond), toutes couches. */
export function enmitiesFor(facts, token=null) {
  const kinds = ownKinds(facts, token);
  const all = [...ENMITIES, ...registeredEnmities(), ...worldTable().enmities];
  return all.filter(row => matchKinds(row.hater, kinds) || matchFacts(row.hater, facts));
}

/**
 * @param {Actor} actor
 * @param {TokenDocument|null} [token]
 * @returns {{ facts: object, profile: object, enmities: Array }}
 */
export function profileFor(actor, token=null) {
  const facts = factsOf(actor);
  const profile = profileOf(facts, layersFor(facts, token));
  return { facts, profile, enmities: enmitiesFor(facts, token) };
}
