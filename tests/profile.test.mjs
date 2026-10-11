import { describe, it, expect } from "vitest";
import {
  bandOf, atLeast, wisdomOf, courageOf, rangeOf, traitFlags, profileOf, validateOverride, validateProfiles, matchFacts, layersFrom
} from "../module/scripts/core/profile.mjs";

/** Des faits synthétiques (aucune fiche réelle) : un humanoïde moyen. */
const facts = (over={}) => ({
  type: "humanoid", subtype: "goblinoid", alignment: "Neutral Evil", cr: 0.25,
  abilities: { int: 10, wis: 8, cha: 8 },
  skills: { prcPassive: 9, ste: 6, itm: null, sur: null },
  hp: { value: 7, max: 7 }, speed: { walk: 30, fly: 0, swim: 0, climb: 0, burrow: 0 },
  senses: { darkvision: 60, blindsight: 0, tremorsense: 0, truesight: 0 },
  legendary: false, speaks: true, spellcaster: false, traits: ["nimble-escape"],
  attacks: [{ id: "a", name: "Cimeterre", ranged: false, spell: false, range: { reach: 5, units: "ft" }, damage: 5.5 }],
  species: null,
  ...over
});

describe("bandes d'Intelligence (§6.1)", () => {
  it("coupe aux bons seuils", () => {
    expect(bandOf(1)).toBe("bestial");
    expect(bandOf(3)).toBe("bestial");
    expect(bandOf(4)).toBe("simple");
    expect(bandOf(7)).toBe("simple");
    expect(bandOf(8)).toBe("average");
    expect(bandOf(11)).toBe("average");
    expect(bandOf(12)).toBe("cunning");
    expect(bandOf(15)).toBe("cunning");
    expect(bandOf(16)).toBe("tactical");
    expect(bandOf(undefined)).toBe("average");
  });
  it("se compare", () => {
    expect(atLeast("cunning", "average")).toBe(true);
    expect(atLeast("simple", "average")).toBe(false);
  });
});

describe("Sagesse (§6.2)", () => {
  it("fragile, posée, sang-froid", () => {
    expect(wisdomOf(5)).toBe("fragile");
    expect(wisdomOf(10)).toBe("steady");
    expect(wisdomOf(16)).toBe("cool");
  });
});

describe("courage (§6.3)", () => {
  it("un zombi est sans esprit, un spectre non", () => {
    expect(courageOf(facts({ type: "undead", abilities: { int: 3 } }))).toBe("mindless");
    expect(courageOf(facts({ type: "undead", abilities: { int: 13 }, cr: 1 }))).toBe("normal");
  });
  it("un artificiel est toujours sans esprit", () => {
    expect(courageOf(facts({ type: "construct", abilities: { int: 14 } }))).toBe("mindless");
  });
  it("fiélons, célestes, dragons et légendaires sont braves", () => {
    expect(courageOf(facts({ type: "fiend" }))).toBe("brave");
    expect(courageOf(facts({ type: "dragon" }))).toBe("brave");
    expect(courageOf(facts({ legendary: true }))).toBe("brave");
  });
  it("un mauvais intelligent et puissant est fanatique", () => {
    expect(courageOf(facts({ alignment: "Lawful Evil", abilities: { int: 14 }, cr: 7 }))).toBe("fanatic");
    expect(courageOf(facts({ alignment: "Lawful Evil", abilities: { int: 14 }, cr: 2 }))).toBe("normal");
  });
  it("les petites bêtes et les petits humanoïdes sont lâches", () => {
    expect(courageOf(facts({ type: "beast", cr: 0.125 }))).toBe("cowardly");
    expect(courageOf(facts({ type: "beast", cr: 2 }))).toBe("normal");
    expect(courageOf(facts({ type: "humanoid", cr: 0.25 }))).toBe("cowardly");
  });
});

describe("portée préférée et traits", () => {
  it("melee / ranged / mixed", () => {
    expect(rangeOf([{ ranged: false }])).toBe("melee");
    expect(rangeOf([{ ranged: true }])).toBe("ranged");
    expect(rangeOf([{ ranged: true }, { ranged: false }])).toBe("mixed");
    expect(rangeOf([])).toBe("melee");
  });
  it("les identifiants connus deviennent des drapeaux", () => {
    const flags = traitFlags(["pack-tactics", "Keen-Smell", "sunlight-sensitivity"]);
    expect(flags.packTactics).toBe(true);
    expect(flags.keenSenses).toBe(true);
    expect(flags.sunlightSensitivity).toBe(true);
    expect(flags.ambusher).toBe(false);
  });
});

describe("profil et couches (§6.4)", () => {
  it("se déduit de la fiche", () => {
    const p = profileOf(facts());
    expect(p.band).toBe("average");
    expect(p.wisdom).toBe("steady");
    expect(p.courage).toBe("cowardly");
    expect(p.range).toBe("melee");
    expect(p.speaks).toBe(true);
    expect(p.senses.darkvision).toBe(true);
    expect(p.traits.nimbleEscape).toBe(true);
    expect(p.stealthy).toBe(true);
    expect(p.from.band).toBe("sheet");
  });
  it("la dernière couche gagne et dit d'où elle vient", () => {
    const p = profileOf(facts(), [
      { source: "module", set: { courage: "normal" } },
      { source: "world", set: { courage: "brave", band: "cunning" } },
      { source: "token", set: { courage: "fanatic" } }
    ]);
    expect(p.courage).toBe("fanatic");
    expect(p.from.courage).toBe("token");
    expect(p.band).toBe("cunning");
    expect(p.from.band).toBe("world");
  });
  it("une valeur hors liste est ignorée", () => {
    const p = profileOf(facts(), [{ source: "token", set: { courage: "heroic", speaks: "yes", leader: true } }]);
    expect(p.courage).toBe("cowardly");
    expect(p.speaks).toBe(true);
    expect(p.leader).toBe(true);
  });
  it("une créature muette d'après la fiche ne parle pas", () => {
    expect(profileOf(facts({ speaks: false })).speaks).toBe(false);
    expect(profileOf(facts({ speaks: undefined, type: "beast", abilities: { int: 8 } })).speaks).toBe(false);
    expect(profileOf(facts({ speaks: undefined, abilities: { int: 8 } })).speaks).toBe(true);
  });
});

describe("validation des surcharges et des tables", () => {
  it("refuse les clés inconnues et les mauvaises valeurs", () => {
    expect(validateOverride({ band: "cunning", leader: true })).toEqual([]);
    expect(validateOverride({ band: "genius" })).toHaveLength(1);
    expect(validateOverride({ colour: "red" })).toHaveLength(1);
    expect(validateOverride(null)).toHaveLength(1);
  });
  it("valide une table de profils", () => {
    expect(validateProfiles([{ match: { type: "ooze" }, set: { speaks: false } }])).toEqual([]);
    expect(validateProfiles([{ match: { name: "Strahd" }, set: {} }])).toHaveLength(1);
    expect(validateProfiles([{ set: { band: "simple" } }])).toHaveLength(1);
    expect(validateProfiles("nope")).toHaveLength(1);
  });
  it("sélectionne par type, sous-type, identifiant, espèce — insensible à la casse", () => {
    const f = facts({ identifier: "gobelin" });
    expect(matchFacts({ type: "Humanoid" }, f)).toBe(true);
    expect(matchFacts({ type: "humanoid", subtype: "gnoll" }, f)).toBe(false);
    expect(matchFacts({ identifier: "gobelin" }, f)).toBe(true);
    expect(matchFacts({ name: "x" }, f)).toBe(false);
    expect(layersFrom([{ match: { subtype: "goblinoid" }, set: { courage: "normal" } }, { match: { type: "ooze" }, set: {} }], f, "module"))
      .toEqual([{ source: "module", set: { courage: "normal" } }]);
  });
});
