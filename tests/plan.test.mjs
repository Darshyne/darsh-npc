import { describe, it, expect } from "vitest";
import { reachOf, chooseAttack, planAttack, DEFAULT_HIT } from "../module/scripts/core/plan.mjs";

const enemy = (id, over={}) => ({
  id, name: id, distance: 0, cost: 0, appearance: "fresh", hpFraction: null, armor: "unknown", role: "melee", concentrating: false,
  down: false, visible: true, adjacentAllies: 0,
  kinds: { type: "humanoid", subtype: "", species: "human", group: null, living: true },
  grudge: 0, killedAlly: false, focused: false, provokes: false, hitChance: null, inRange: false, ...over
});
const view = (enemies, self={}) => ({
  self: { id: "me", name: "Gobelin", hp: { value: 7, max: 7 }, cells: 6, reach: 1, lastTarget: null, ...self },
  enemies, allies: [], meta: {}
});
const profile = (band="average", over={}) => ({ band, range: "melee", courage: "normal", wisdom: "steady", ...over });
const attack = (name, over={}) => ({
  id: `Actor.a.Item.${name}.Activity.x`, item: name, name, melee: true, ranged: false, thrown: false, reach: 1, normal: 0, long: 0,
  damage: 5, equipped: true, unarmed: false, ...over
});

describe("portée d'une attaque (étape 2)", () => {
  it("contact : à 0 case avec une allonge de 1 case, à 1 case seulement avec 2 cases d'allonge", () => {
    expect(reachOf(attack("sabre"), 0)).toEqual({ mode: "melee", factor: 1 });
    expect(reachOf(attack("sabre"), 1)).toBeNull();
    expect(reachOf(attack("pique", { reach: 2 }), 1)).toEqual({ mode: "melee", factor: 1 });
  });
  it("tir : portée normale, puis longue au Désavantage ; au-delà, rien", () => {
    const bow = attack("arc", { melee: false, ranged: true, reach: 0, normal: 16, long: 64 });
    expect(reachOf(bow, 10)).toEqual({ mode: "ranged", factor: 1 });
    expect(reachOf(bow, 30)).toEqual({ mode: "long", factor: 0.5 });
    expect(reachOf(bow, 70)).toBeNull();
  });
  it("tirer avec un ennemi au contact : Désavantage", () => {
    const bow = attack("arc", { melee: false, ranged: true, reach: 0, normal: 16, long: 64 });
    expect(reachOf(bow, 0, { threatened: true })).toEqual({ mode: "ranged", factor: 0.5 });
  });
});

describe("choix de l'attaque", () => {
  it("la plus forte en dégâts moyens ; une arme de jet au contact se joue au contact", () => {
    const pick = chooseAttack([attack("dague", { damage: 4, thrown: true, ranged: true, normal: 4, long: 12 }), attack("cimeterre", { damage: 6 })], enemy("e"));
    expect(pick.attack.name).toBe("cimeterre");
    expect(pick.mode).toBe("melee");
  });
  it("une arme rangée ou les mains nues seulement faute de mieux", () => {
    const pick = chooseAttack([attack("poings", { damage: 2, unarmed: true }), attack("hache", { damage: 4, equipped: false }), attack("épée", { damage: 3 })], enemy("e"));
    expect(pick.attack.name).toBe("épée");
    expect(chooseAttack([attack("poings", { damage: 2, unarmed: true })], enemy("e")).attack.name).toBe("poings");
  });
  it("seulement les items encore permis (Attaques multiples)", () => {
    const pick = chooseAttack([attack("morsure", { damage: 9 }), attack("griffes", { damage: 5 })], enemy("e"), { allowed: new Set(["griffes"]) });
    expect(pick.attack.name).toBe("griffes");
  });
  it("valeur = chance × dégâts × facteur ; chance par défaut quand la vue ne la connaît pas", () => {
    expect(chooseAttack([attack("x", { damage: 10 })], enemy("e")).value).toBeCloseTo(DEFAULT_HIT * 10);
    expect(chooseAttack([attack("x", { damage: 10 })], enemy("e", { hitChance: 0.9 })).value).toBeCloseTo(9);
  });
});

describe("intention du tour (étape 2 : sans déplacement)", () => {
  it("attaque la meilleure cible déjà à portée", () => {
    const v = view([enemy("loin", { distance: 4, cost: 4, appearance: "bloodied" }), enemy("près", { distance: 0, cost: 0 })]);
    const plan = planAttack(v, profile(), [], [attack("cimeterre")]);
    expect(plan).toMatchObject({ type: "attack", target: "près", mode: "melee" });
    expect(plan.attack.name).toBe("cimeterre");
  });
  it("rend la main : aucun ennemi, aucune attaque, personne à portée", () => {
    expect(planAttack(view([]), profile(), [], [attack("x")])).toEqual({ type: "yield", reason: "noEnemy" });
    expect(planAttack(view([enemy("e")]), profile(), [], [])).toEqual({ type: "yield", reason: "noAttack" });
    expect(planAttack(view([enemy("e", { distance: 5, cost: 5 })]), profile(), [], [attack("x")])).toEqual({ type: "yield", reason: "outOfReach" });
  });
  it("un ennemi à terre n'est pas une cible (pas d'achèvement par défaut, Q2)", () => {
    expect(planAttack(view([enemy("e", { down: true, appearance: "down" })]), profile(), [], [attack("x")]).reason).toBe("noEnemy");
  });
  it("un tireur vise à distance ; au contact d'un ennemi, il garde le contact s'il a une arme de contact", () => {
    const bow = attack("arc", { melee: false, ranged: true, reach: 0, normal: 16, long: 64, damage: 6 });
    const plan = planAttack(view([enemy("e", { distance: 6, cost: 6, inRange: true })]), profile("average", { range: "ranged" }), [], [bow]);
    expect(plan).toMatchObject({ type: "attack", target: "e", mode: "ranged" });
    const close = planAttack(view([enemy("e")]), profile(), [], [bow, attack("dague", { damage: 3 })]);
    expect(close.attack.name).toBe("dague");
  });
  it("plus aucune attaque permise : rend la main", () => {
    expect(planAttack(view([enemy("e")]), profile(), [], [attack("x")], { allowed: new Set() }).reason).toBe("noAttack");
  });
});

describe("déplacement (étape 3)", () => {
  it("au contact : la meilleure cible, jusqu'à l'allonge de la meilleure arme de contact", async () => {
    const { planMove } = await import("../module/scripts/core/plan.mjs");
    const v = view([enemy("loin", { distance: 6, cost: 6 })]);
    const move = planMove(v, profile(), [], [attack("cimeterre", { damage: 6 }), attack("pique", { damage: 5, reach: 2 })]);
    expect(move).toMatchObject({ type: "move", target: "loin", reachCells: 1, seeing: false });
    expect(move.attack.name).toBe("cimeterre");
  });
  it("un tireur garde ses distances : sa portée normale, en voyant la cible", async () => {
    const { planMove } = await import("../module/scripts/core/plan.mjs");
    const bow = attack("arc", { melee: false, ranged: true, reach: 0, normal: 16, long: 64 });
    const move = planMove(view([enemy("e", { distance: 30, cost: 30 })]), profile("average", { range: "ranged" }), [], [bow, attack("dague", { damage: 3 })]);
    expect(move).toMatchObject({ type: "move", reachCells: 16, seeing: true });
    expect(move.attack.name).toBe("arc");
  });
  it("sans arme de contact, même un profil de mêlée tire ; sans attaque, rend la main", async () => {
    const { planMove } = await import("../module/scripts/core/plan.mjs");
    const bow = attack("arc", { melee: false, ranged: true, reach: 0, normal: 16, long: 64 });
    expect(planMove(view([enemy("e", { distance: 30, cost: 30 })]), profile(), [], [bow])).toMatchObject({ seeing: true, reachCells: 16 });
    expect(planMove(view([enemy("e")]), profile(), [], [])).toEqual({ type: "yield", reason: "noAttack" });
    expect(planMove(view([]), profile(), [], [attack("x")])).toEqual({ type: "yield", reason: "noEnemy" });
  });
});

describe("§19 : une cible perchée (au mur, au plafond)", () => {
  const ceiling = over => enemy("plafond", { distance: 1, vertical: 2, flat: 0, cost: 1, ...over });
  it("le vide vertical seul dépasse l'allonge : hors d'atteinte au sol", async () => {
    const { tooHighFor } = await import("../module/scripts/core/plan.mjs");
    expect(tooHighFor(ceiling(), attack("x"))).toBe(true);
    expect(tooHighFor(ceiling({ vertical: 1 }), attack("x"))).toBe(false);
    expect(tooHighFor(ceiling(), attack("pique", { reach: 2 }))).toBe(false);
    expect(tooHighFor(enemy("sol"), attack("x"))).toBe(false);   // sans moteur qui la publie : pas de vide vertical
  });
  it("au plafond, la mêlée ne l'atteint pas d'où l'on est (distance en trois dimensions)", () => {
    expect(planAttack(view([ceiling()]), profile(), [], [attack("griffes")]).reason).toBe("outOfReach");
  });
  it("une créature qui grimpe vite (vitesse d'escalade, Pattes d'araignée) va la chercher", async () => {
    const { planMove } = await import("../module/scripts/core/plan.mjs");
    const move = planMove(view([ceiling()], { climber: true }), profile(), [], [attack("morsure")]);
    expect(move).toMatchObject({ type: "climb", target: "plafond", reachCells: 1 });
  });
  it("une créature déjà au plafond ne grimpe pas de nouveau", async () => {
    const { planMove } = await import("../module/scripts/core/plan.mjs");
    expect(planMove(view([ceiling()], { climber: true, onCeiling: true }), profile(), [], [attack("morsure")])).toMatchObject({ type: "yield", reason: "tooHigh" });
  });
  it("sinon, une attaque à distance : s'approcher en la voyant", async () => {
    const { planMove } = await import("../module/scripts/core/plan.mjs");
    const javelin = attack("javelot", { melee: false, ranged: true, reach: 0, normal: 6, long: 24 });
    expect(planMove(view([ceiling({ distance: 8 })]), profile(), [], [attack("lance", { damage: 6 }), javelin])).toMatchObject({ type: "move", seeing: true, reachCells: 6, attack: { name: "javelot" } });
  });
  it("sinon, la cible suivante qu'on peut atteindre au sol", async () => {
    const { planMove } = await import("../module/scripts/core/plan.mjs");
    const move = planMove(view([ceiling(), enemy("sol", { distance: 4, cost: 4 })]), profile(), [], [attack("griffes")]);
    expect(move).toMatchObject({ type: "move", target: "sol", seeing: false });
  });
  it("personne d'atteignable : garder sa position et rendre la main (`tooHigh`)", async () => {
    const { planMove } = await import("../module/scripts/core/plan.mjs");
    expect(planMove(view([ceiling()]), profile(), [], [attack("griffes")])).toEqual({ type: "yield", reason: "tooHigh", target: "plafond" });
  });
});
