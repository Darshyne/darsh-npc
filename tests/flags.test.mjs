import { describe, it, expect } from "vitest";
import { groupsOf, covers, pickVantage, fleeGoal, lossesReached, reserveDelay, pickMembers, ringsAlarm } from "../module/scripts/core/flags.mjs";
import { step } from "../module/scripts/core/alert.mjs";
import { seeded } from "../module/scripts/core/rng.mjs";

describe("groupes d'un drapeau", () => {
  it("lit une liste séparée par des virgules, vide = tous", () => {
    expect(groupsOf(" nord, caserne ;; ")).toEqual(["nord", "caserne"]);
    expect(groupsOf("")).toEqual([]);
    expect(covers("", "nord")).toBe(true);
    expect(covers("nord, sud", "sud")).toBe(true);
    expect(covers(["nord"], "sud")).toBe(false);
  });
});

describe("poste de tir", () => {
  const vantages = [
    { id: "loin", cells: [{ i: 0, j: 0, from: 9, seen: { t: 4 } }] },
    { id: "proche", cells: [{ i: 5, j: 5, from: 4, seen: { t: 3 } }, { i: 5, j: 6, from: 3, seen: {} }, { i: 6, j: 6, from: 2, seen: { t: 20 } }] }
  ];
  it("la case la plus proche d'où la cible se voit à portée normale", () => {
    const r = pickVantage(vantages, "t", 16);
    expect(r.vantage).toBe("proche");
    expect(r.cells.map(c => `${c.i}.${c.j}`)).toEqual(["5.5"]);
  });
  it("rien quand la portée ou le déplacement ne suffisent pas", () => {
    expect(pickVantage(vantages, "t", 3)).toBeNull();
    expect(pickVantage(vantages, "t", 16, { maxFrom: 3 })).toBeNull();
    expect(pickVantage(vantages, "t", 16, { maxFrom: 9 }).vantage).toBe("proche");
  });
  it("rien s'il y est déjà sur une bonne case", () => {
    const here = [{ id: "ici", cells: [{ i: 1, j: 1, from: 0, seen: { t: 2 } }] }, ...vantages];
    expect(pickVantage(here, "t", 16)).toBeNull();
  });
});

describe("où fuir", () => {
  const all = { reserve: true, alarm: true, refuge: true };
  it("qui calcule va chercher la réserve, qui pense un peu sonne l'alarme, les autres filent au refuge", () => {
    expect(fleeGoal({ band: "cunning" }, all)).toBe("reserve");
    expect(fleeGoal({ band: "tactical" }, { alarm: true })).toBe("alarm");
    expect(fleeGoal({ band: "average" }, all)).toBe("alarm");
    expect(fleeGoal({ band: "simple" }, all)).toBe("refuge");
    expect(fleeGoal({ band: "simple" }, { reserve: true, alarm: true })).toBeNull();
    expect(fleeGoal({ band: "average" }, {})).toBeNull();
  });
});

describe("réserves", () => {
  it("les pertes atteignent le seuil", () => {
    const g = n => Array.from({ length: 4 }, (_, i) => ({ down: i < n }));
    expect(lossesReached(g(1), 50)).toBe(false);
    expect(lossesReached(g(2), 50)).toBe(true);
    expect(lossesReached(g(0), 1)).toBe(false);
    expect(lossesReached([], 50)).toBe(false);
  });
  it("le délai varie de ±30 %, en rounds au moins un", () => {
    const rng = seeded(7);
    for ( let k = 0; k < 50; k++ ) {
      const v = reserveDelay(10, rng);
      expect(v).toBeGreaterThanOrEqual(7);
      expect(v).toBeLessThanOrEqual(13);
    }
    expect(reserveDelay(0, rng)).toBe(0);
    expect(reserveDelay(1, () => 0, { rounds: true })).toBe(1);
  });
  it("combien partent", () => {
    expect(pickMembers([1, 2, 3], 2)).toEqual([1, 2]);
    expect(pickMembers([1, 2, 3], 0)).toEqual([1, 2, 3]);
  });
  it("une bête ne sonne pas l'alarme", () => {
    expect(ringsAlarm("bestial")).toBe(false);
    expect(ringsAlarm("simple")).toBe(true);
  });
});

describe("l'alarme dans la machine d'alerte", () => {
  it("met en alerte et en route vers la dernière position connue, puis il y cherche", () => {
    const a = step({ state: "idle" }, { alarmed: { x: 10, y: 20 } });
    expect(a).toMatchObject({ state: "alert", goal: { x: 10, y: 20 }, action: "walk" });
    const b = step(a, {});
    expect(b).toMatchObject({ state: "searching", goal: { x: 10, y: 20 }, action: "walk" });
  });
  it("un ennemi vu l'emporte sur l'alarme", () => {
    expect(step({ state: "idle" }, { seen: { x: 1, y: 1 }, alarmed: { x: 9, y: 9 } }).goal).toEqual({ x: 1, y: 1 });
  });
});
