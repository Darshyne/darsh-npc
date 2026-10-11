/**
 * Surcharges de profil livrées par le module (SPEC §6.4, couche « module ») : par type ou sous-type de créature, génériques —
 * rien de propre à une campagne, aucun nom de créature premium. Ce qui se déduit déjà de la fiche (core/profile.mjs) n'est pas
 * répété ici. Format : `{ match: { type | subtype | identifier | species }, set: { band | courage | range | wisdom | speaks | leader } }`,
 * validé par `validateProfiles` (tests/content.test.mjs).
 */
export const PROFILES = Object.freeze([
  // Les vases et les plantes ne parlent pas, quelle que soit leur fiche.
  { match: { type: "ooze" }, set: { speaks: false, courage: "mindless" } },
  { match: { type: "plant" }, set: { speaks: false } },
  // Les gnolls se battent dans la frénésie et ne se rendent pas ; les kobolds détalent.
  { match: { subtype: "gnoll" }, set: { courage: "fanatic" } },
  { match: { subtype: "kobold" }, set: { courage: "cowardly" } },
  // Un essaim n'a pas de moral.
  { match: { subtype: "swarm" }, set: { courage: "mindless", speaks: false } }
]);
