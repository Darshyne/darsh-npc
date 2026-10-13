import { describe, it, expect } from "vitest";
import { MOMENTS, FAMILIES, familyOf, barkKeys, linesFor, chooseLine, mayBark, validateBarks, validateTokenBarks } from "../module/scripts/core/barks.mjs";
import { BARKS, EMOTE_FAMILIES } from "../module/scripts/content/barks.mjs";
import { seeded } from "../module/scripts/core/rng.mjs";

describe("répliques génériques (contenu)", () => {
  it("valides, une entrée par famille, en fr et en en", () => {
    expect(validateBarks(BARKS)).toEqual([]);
    expect(Object.keys(BARKS).sort()).toEqual([...FAMILIES].sort());
    for ( const [family, moments] of Object.entries(BARKS) ) {
      for ( const [moment, langs] of Object.entries(moments) ) {
        expect(langs.fr?.length, `${family}.${moment}.fr`).toBeGreaterThan(0);
        expect(langs.en?.length, `${family}.${moment}.en`).toBeGreaterThan(0);
      }
    }
  });
  it("une famille qui parle a tous les moments ; les autres ont les moments de combat d'une bête", () => {
    for ( const m of MOMENTS ) expect(BARKS.brute[m], `brute.${m}`).toBeTruthy();
    for ( const f of EMOTE_FAMILIES ) for ( const m of ["engage", "hit", "kill"] ) expect(BARKS[f][m], `${f}.${m}`).toBeTruthy();
  });
});

describe("famille et clés", () => {
  it("qui ne parle pas : bête, sans esprit, monstre", () => {
    expect(familyOf({ type: "beast", speaks: false })).toBe("beast");
    expect(familyOf({ type: "undead", speaks: false })).toBe("mindless");
    expect(familyOf({ type: "monstrosity", speaks: false })).toBe("monster");
  });
  it("qui parle : fiélon, mort-vivant, dragon, rusé (bande ou sorts), brute", () => {
    expect(familyOf({ type: "fiend", speaks: true })).toBe("fiend");
    expect(familyOf({ type: "undead", speaks: true })).toBe("undead");
    expect(familyOf({ type: "dragon", speaks: true })).toBe("dragon");
    expect(familyOf({ type: "humanoid", speaks: true }, { band: "cunning" })).toBe("cunning");
    expect(familyOf({ type: "humanoid", speaks: true, spellcaster: true }, { band: "average" })).toBe("cunning");
    expect(familyOf({ type: "humanoid", speaks: true }, { band: "average" })).toBe("brute");
  });
  it("clés : identifiant, sous-type, type, famille", () => {
    expect(barkKeys({ identifier: "bandit", subtype: "human", type: "humanoid" }, "brute")).toEqual(["bandit", "subtype:human", "type:humanoid", "brute"]);
  });
});

describe("choisir les lignes", () => {
  const world = { "type:humanoid": { attack: { fr: ["Du monde"] } } };
  it("le token d'abord, puis la première couche qui a le moment", () => {
    expect(linesFor({ token: { attack: ["Du token"] }, layers: [world, BARKS], keys: ["type:humanoid", "brute"], moment: "attack", lang: "fr" }))
      .toEqual({ lines: ["Du token"], source: "token" });
    expect(linesFor({ layers: [world, BARKS], keys: ["type:humanoid", "brute"], moment: "attack", lang: "fr" }).lines).toEqual(["Du monde"]);
    expect(linesFor({ layers: [world, BARKS], keys: ["type:humanoid", "brute"], moment: "hit", lang: "fr" }).lines).toEqual(BARKS.brute.hit.fr);
  });
  it("langue absente : l'anglais ; une famille qui parle sans ce moment se replie sur brute ; un geste, jamais", () => {
    expect(linesFor({ layers: [BARKS], keys: ["brute"], moment: "attack", lang: "de" }).lines).toEqual(BARKS.brute.attack.en);
    expect(linesFor({ layers: [BARKS], keys: ["fiend"], moment: "surrender", lang: "fr" }).lines).toEqual(BARKS.brute.surrender.fr);
    expect(linesFor({ layers: [BARKS], keys: ["mindless"], moment: "surrender", lang: "fr", speaks: false }).lines).toEqual([]);
  });
  it("jamais deux fois la même d'affilée", () => {
    const rng = seeded(3);
    let last = null;
    for ( let i = 0; i < 30; i++ ) { const line = chooseLine(["a", "b", "c"], last, rng); expect(line).not.toBe(last); last = line; }
    expect(chooseLine(["seule"], "seule")).toBe("seule");
    expect(chooseLine([], null)).toBeNull();
  });
});

describe("parler maintenant ?", () => {
  it("le délai par token, puis la chance du moment × la fréquence ; forcé : toujours", () => {
    expect(mayBark({ moment: "spotted", lastAt: 1000, now: 5000, cooldownMs: 10000 })).toBe(false);
    expect(mayBark({ moment: "spotted", lastAt: 1000, now: 20000, cooldownMs: 10000 })).toBe(true);
    expect(mayBark({ moment: "attack", rng: () => 0.5 })).toBe(false);
    expect(mayBark({ moment: "attack", frequency: "always", rng: () => 0.99 })).toBe(true);
    expect(mayBark({ moment: "flee", lastAt: 1000, now: 1001, cooldownMs: 10000, force: true })).toBe(true);
  });
});

describe("validation", () => {
  it("refuse un moment inconnu, une langue fausse, une ligne vide", () => {
    expect(validateBarks({ x: { dance: { fr: ["a"] } } })[0]).toMatch(/unknown moment/);
    expect(validateBarks({ x: { hit: { francais: ["a"] } } })[0]).toMatch(/language/);
    expect(validateBarks({ x: { hit: { fr: [""] } } })[0]).toMatch(/bad line/);
    expect(validateTokenBarks({ hit: ["Ouille"] })).toEqual([]);
    expect(validateTokenBarks({ hit: "Ouille" })[0]).toMatch(/bad lines/);
  });
});
