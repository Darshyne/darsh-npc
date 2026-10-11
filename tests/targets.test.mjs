import { describe, it, expect } from "vitest";
import { scoreTargets, chooseTarget, termsOf, enmityWeight, matchKinds, validateEnmities, isCandidate } from "../module/scripts/core/targets.mjs";
import { appearanceOf, validateView } from "../module/scripts/core/view.mjs";

const enemy = (id, over={}) => ({
  id, name: id, distance: 3, cost: 3, appearance: "fresh", hpFraction: null, armor: "unknown", role: "melee", concentrating: false,
  down: false, visible: true, adjacentAllies: 0,
  kinds: { type: "humanoid", subtype: "", species: "human", group: null, living: true },
  grudge: 0, killedAlly: false, focused: false, provokes: false, hitChance: null, inRange: false, ...over
});

const view = (enemies, self={}) => ({
  self: { id: "me", name: "Gobelin", hp: { value: 7, max: 7 }, cells: 6, reach: 1, lastTarget: null, ...self },
  enemies, allies: [], meta: {}
});

const profile = (band, over={}) => ({ band, range: "melee", courage: "normal", wisdom: "steady", ...over });

describe("apparence (§7.3)", () => {
  it("coupe aux seuils", () => {
    expect(appearanceOf(1)).toBe("fresh");
    expect(appearanceOf(0.75)).toBe("fresh");
    expect(appearanceOf(0.6)).toBe("hurt");
    expect(appearanceOf(0.5)).toBe("bloodied");
    expect(appearanceOf(0.2)).toBe("near-death");
    expect(appearanceOf(0)).toBe("down");
  });
});

describe("score des cibles (§8)", () => {
  it("une bête vise la plus proche, même si une autre est blessée", () => {
    const v = view([enemy("far", { distance: 5, cost: 5, appearance: "near-death" }), enemy("near", { distance: 1, cost: 1 })]);
    expect(chooseTarget(v, profile("bestial")).id).toBe("near");
  });

  it("une créature simple préfère la plus blessée à distance égale", () => {
    const v = view([enemy("a"), enemy("b", { appearance: "bloodied" })]);
    expect(chooseTarget(v, profile("simple")).id).toBe("b");
    expect(chooseTarget(v, profile("simple")).reasons).toContain("wounded");
  });

  it("une créature rusée va chercher le lanceur qui se concentre, même un peu plus loin", () => {
    const v = view([enemy("fighter", { distance: 2, cost: 2 }), enemy("mage", { distance: 4, cost: 4, role: "caster", concentrating: true, armor: "none" })]);
    expect(chooseTarget(v, profile("cunning")).id).toBe("mage");
    expect(chooseTarget(v, profile("bestial")).id).toBe("fighter");
  });

  it("une cible à terre n'est jamais visée ; une cible invisible non plus", () => {
    const v = view([enemy("down", { distance: 0, cost: 0, appearance: "down", down: true }), enemy("hidden", { visible: false }), enemy("up", { distance: 4, cost: 4 })]);
    const scored = scoreTargets(v, profile("bestial"));
    expect(scored.map(s => s.id)).toEqual(["up"]);
  });

  it("une cible injoignable est écartée au contact, gardée à portée de tir", () => {
    const v = view([enemy("island", { distance: 4, cost: Infinity, inRange: true })]);
    expect(scoreTargets(v, profile("average")).length).toBe(0);
    expect(scoreTargets(v, profile("average", { range: "ranged" })).length).toBe(1);
    expect(isCandidate(enemy("x", { cost: Infinity }), profile("mixed"))).toBe(false);
  });

  it("la rancune pèse pour toute créature, surtout bestiale", () => {
    const v = view([enemy("near", { distance: 1, cost: 1 }), enemy("hurtMe", { distance: 2, cost: 2, grudge: 7 })]);
    expect(chooseTarget(v, profile("bestial")).id).toBe("hurtMe");
    expect(termsOf(v.enemies[1], v, profile("bestial")).threat).toBe(1);
  });

  it("une bête garde sa dernière cible tant qu'elle est debout", () => {
    const v = view([enemy("near", { distance: 1, cost: 1 }), enemy("old", { distance: 3, cost: 3 })], { lastTarget: "old" });
    const scored = scoreTargets(v, profile("bestial"));
    expect(scored[0].id).toBe("old");
    expect(scored[0].kept).toBe(true);
    const gone = view([enemy("near", { distance: 1, cost: 1 }), enemy("old", { appearance: "down", down: true })], { lastTarget: "old" });
    expect(chooseTarget(gone, profile("bestial")).id).toBe("near");
  });

  it("l'attaque d'opportunité détourne une créature simple, pas une bête", () => {
    const v = view([enemy("guarded", { distance: 2, cost: 2, provokes: true }), enemy("open", { distance: 3, cost: 3 })]);
    expect(chooseTarget(v, profile("simple")).id).toBe("open");
    expect(chooseTarget(v, profile("bestial")).id).toBe("guarded");
  });

  it("joignable ce tour, avec Foncer, ou pas", () => {
    const p = profile("average");
    expect(termsOf(enemy("a", { cost: 7 }), view([]), p).reachable).toBe(1);
    expect(termsOf(enemy("a", { cost: 10 }), view([]), p).reachable).toBe(0.5);
    expect(termsOf(enemy("a", { cost: 10 }), view([]), profile("simple")).reachable).toBe(0);
    expect(termsOf(enemy("a", { cost: 30 }), view([]), p).reachable).toBe(0);
  });

  it("à égalité parfaite, la plus proche puis l'id", () => {
    const v = view([enemy("b", { distance: 2, cost: 2 }), enemy("a", { distance: 2, cost: 2 }), enemy("c", { distance: 1, cost: 1 })]);
    expect(scoreTargets(v, profile("average")).map(s => s.id)).toEqual(["c", "a", "b"]);
  });

  it("deux raisons au plus, les plus lourdes", () => {
    const v = view([enemy("mage", { role: "caster", concentrating: true, appearance: "bloodied" })]);
    const [best] = scoreTargets(v, profile("cunning"));
    expect(best.reasons.length).toBe(2);
    expect(best.reasons).toContain("caster");
  });
});

describe("haines (§8.3)", () => {
  const undeadRows = [{ hater: { type: "undead" }, hated: { living: true }, weight: 0.5 }];
  it("correspond sur living, any, type, species, group", () => {
    expect(matchKinds({ living: true }, { living: true })).toBe(true);
    expect(matchKinds({ living: true }, { living: false })).toBe(false);
    expect(matchKinds({ any: true }, {})).toBe(true);
    expect(matchKinds({ species: "Elf" }, { species: "elf" })).toBe(true);
    expect(matchKinds({}, {})).toBe(false);
    expect(matchKinds({ name: "x" }, {})).toBe(false);
  });
  it("additionne les lignes qui correspondent", () => {
    expect(enmityWeight(undeadRows, { living: true })).toBe(0.5);
    expect(enmityWeight(undeadRows, { living: false })).toBe(0);
    expect(enmityWeight([...undeadRows, { hated: { species: "elf" }, weight: 0.3 }], { living: true, species: "elf" })).toBeCloseTo(0.8);
  });
  it("fait pencher le choix", () => {
    const v = view([enemy("dwarf", { kinds: { species: "dwarf", living: true } }), enemy("human", { kinds: { species: "human", living: true } })]);
    const rows = [{ hater: { subtype: "goblinoid" }, hated: { species: "dwarf" }, weight: 0.5 }];
    expect(chooseTarget(v, profile("simple"), rows).id).toBe("dwarf");
    expect(chooseTarget(v, profile("simple"), rows).reasons).toContain("enmity");
  });
  it("valide une table", () => {
    expect(validateEnmities(undeadRows)).toEqual([]);
    expect(validateEnmities([{ hater: {}, hated: { any: true }, weight: 0.5 }])).toHaveLength(1);
    expect(validateEnmities([{ hater: { type: "undead" }, hated: { any: true }, weight: 2 }])).toHaveLength(1);
    expect(validateEnmities([{ hater: { type: "undead" }, hated: { name: "Bob" }, weight: 0.5 }])).toHaveLength(1);
  });
});

describe("validation de la vue", () => {
  it("accepte une vue bien formée et refuse le reste", () => {
    expect(validateView(view([enemy("a")]))).toEqual([]);
    expect(validateView(view([enemy("a", { cost: -1, appearance: "dead" })]))).toHaveLength(2);
    expect(validateView({ self: {}, enemies: "x" })).not.toEqual([]);
  });
});
