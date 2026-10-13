import { describe, it, expect } from "vitest";
import { moraleTest, moraleTriggers, canSurrender, fleeAction, MORALE_DC } from "../module/scripts/core/morale.mjs";
import { atLeast } from "../module/scripts/core/profile.mjs";

describe("test de moral (étape 4)", () => {
  it("sans pensée ni fanatique : pas de test ; brave à l'Avantage, lâche au Désavantage", () => {
    expect(moraleTest({ courage: "mindless" })).toBeNull();
    expect(moraleTest({ courage: "fanatic" })).toBeNull();
    expect(moraleTest({ courage: "normal" })).toEqual({ ability: "wis", dc: MORALE_DC, advantage: false, disadvantage: false });
    expect(moraleTest({ courage: "brave" }).advantage).toBe(true);
    expect(moraleTest({ courage: "cowardly" }).disadvantage).toBe(true);
  });
});

describe("causes d'un test", () => {
  it("à la moitié de ses PV, une fois", () => {
    expect(moraleTriggers({ hp: { value: 5, max: 10 } })).toEqual(["bloodied"]);
    expect(moraleTriggers({ hp: { value: 6, max: 10 } })).toEqual([]);
    expect(moraleTriggers({ hp: { value: 5, max: 10 }, tested: ["bloodied"] })).toEqual([]);
    expect(moraleTriggers({ hp: { value: 0, max: 10 } })).toEqual([]);
  });
  it("la moitié du groupe tombée (elle comprise)", () => {
    const hp = { value: 10, max: 10 };
    expect(moraleTriggers({ hp, group: [{ down: true }] })).toEqual(["halfDown"]);
    expect(moraleTriggers({ hp, group: [{ down: true }, { down: false }, { down: false }] })).toEqual([]);
    expect(moraleTriggers({ hp, group: [{ down: true }, { down: true }, { down: false }] })).toEqual(["halfDown"]);
    expect(moraleTriggers({ hp, group: [] })).toEqual([]);
  });
  it("le chef tombé : marqué chef, ou de FP plus haut", () => {
    const hp = { value: 10, max: 10 };
    const group = [{ down: false }, { down: false }, { down: false }];
    expect(moraleTriggers({ hp, cr: 0.125, group: [...group, { down: true, cr: 2 }] })).toEqual(["leaderDown"]);
    expect(moraleTriggers({ hp, cr: 2, group: [...group, { down: true, cr: 2 }] })).toEqual([]);
    expect(moraleTriggers({ hp, cr: 2, group: [...group, { down: true, cr: 0, leader: true }] })).toEqual(["leaderDown"]);
  });
  it("deux tours sans pouvoir nuire", () => {
    expect(moraleTriggers({ hp: { value: 10, max: 10 }, idle: 1 })).toEqual([]);
    expect(moraleTriggers({ hp: { value: 10, max: 10 }, idle: 2 })).toEqual(["cantHarm"]);
  });
});

describe("se rendre, fuir", () => {
  it("se rend : Intelligence 6+, ni sans pensée, ni fanatique, ni brave", () => {
    expect(canSurrender({ courage: "normal" }, 10)).toBe(true);
    expect(canSurrender({ courage: "cowardly" }, 6)).toBe(true);
    expect(canSurrender({ courage: "normal" }, 5)).toBe(false);
    expect(canSurrender({ courage: "brave" }, 14)).toBe(false);
    expect(canSurrender({ courage: "fanatic" }, 14)).toBe(false);
  });
  it("au contact, une créature qui y pense se désengage ; sinon elle fonce", () => {
    expect(fleeAction({ band: "average" }, true, atLeast)).toBe("disengage");
    expect(fleeAction({ band: "bestial" }, true, atLeast)).toBe("dash");
    expect(fleeAction({ band: "average" }, false, atLeast)).toBe("dash");
  });
});
