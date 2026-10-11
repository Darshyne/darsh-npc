/**
 * Haines génériques livrées par le module (SPEC §8.3) : `{ hater, hated, weight }`, où `hater` sélectionne la créature
 * (type, subtype, species, group) et `hated` l'ennemi (type, subtype, species, group, living, any). Le poids (]0, 1]) s'ajoute au
 * terme `enmity` du score des cibles. Rien ici ne vient d'une campagne ni ne nomme un PJ ; les haines d'une table vont dans la
 * surcouche du monde ou dans le module privé de campagne (`api.ai.register`). Validé par `validateEnmities`.
 */
export const ENMITIES = Object.freeze([
  // Les morts-vivants en veulent aux vivants.
  { hater: { type: "undead" }, hated: { living: true }, weight: 0.5 },
  // Les gnolls s'en prennent à tout ce qui bouge.
  { hater: { subtype: "gnoll" }, hated: { any: true }, weight: 0.4 },
  // Vieilles rancunes du folklore : gobelinoïdes et nains, orcs et elfes.
  { hater: { subtype: "goblinoid" }, hated: { species: "dwarf" }, weight: 0.3 },
  { hater: { subtype: "orc" }, hated: { species: "elf" }, weight: 0.3 },
  // Les fiélons haïssent les célestes, et réciproquement.
  { hater: { type: "fiend" }, hated: { type: "celestial" }, weight: 0.6 },
  { hater: { type: "celestial" }, hated: { type: "fiend" }, weight: 0.6 }
]);
