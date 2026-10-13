import { describe, it, expect } from "vitest";
import { step, facingToward, routePoints, nextWaypoint, nearestWaypoint, SUSPICIOUS_TICKS, CONFUSED_TICKS, SEARCH_TICKS } from "../module/scripts/core/alert.mjs";

describe("états d'alerte (étape 6a)", () => {
  it("au calme : la routine ; hors de chez soi : rentrer", () => {
    expect(step({ state: "idle" })).toMatchObject({ state: "idle", action: "routine" });
    expect(step({ state: "idle" }, { atHome: false })).toMatchObject({ state: "idle", action: "home" });
    expect(step({ state: "idle" }, { atHome: false, walking: true }).action).toBe("stay");
  });
  it("un ennemi vu : alerte, regarder vers lui, de n'importe quel état", () => {
    for ( const state of ["idle", "suspicious", "searching", "confused", "alert"] ) {
      expect(step({ state }, { seen: { x: 5, y: 6 } })).toMatchObject({ state: "alert", goal: { x: 5, y: 6 }, action: "face" });
    }
  });
  it("perdu de vue : chercher à sa dernière position ; arrivé sans rien : confus, puis rentrer", () => {
    let s = step({ state: "alert", goal: { x: 10, y: 10 } });
    expect(s).toMatchObject({ state: "searching", goal: { x: 10, y: 10 }, action: "walk" });
    s = step(s, { walking: true });
    expect(s).toMatchObject({ state: "searching", action: "stay" });
    s = step(s, { arrived: true });
    expect(s).toMatchObject({ state: "confused", action: "stay" });
    for ( let i = 1; i < CONFUSED_TICKS; i++ ) s = step(s);
    expect(s.state).toBe("confused");
    s = step(s);
    expect(s).toMatchObject({ state: "idle", goal: null, action: "home" });
  });
  it("une recherche trop longue abandonne", () => {
    let s = { state: "searching", goal: { x: 1, y: 1 }, ticks: SEARCH_TICKS - 1 };
    expect(step(s, { walking: true }).state).toBe("confused");
  });
  it("un doute : se tourner, puis aller voir ; un nouveau bruit relance le doute", () => {
    let s = step({ state: "idle" }, { heard: { x: 3, y: 4 } });
    expect(s).toMatchObject({ state: "suspicious", goal: { x: 3, y: 4 }, action: "face" });
    for ( let i = 1; i < SUSPICIOUS_TICKS; i++ ) s = step(s);
    expect(s.state).toBe("suspicious");
    s = step(s);
    expect(s).toMatchObject({ state: "searching", action: "walk" });
    expect(step({ state: "confused" }, { heard: { x: 0, y: 9 } })).toMatchObject({ state: "suspicious", goal: { x: 0, y: 9 } });
  });
});

describe("orientation et patrouilles", () => {
  it("orientation du cœur : 0 vers le bas, 90 vers la gauche, 180 vers le haut, 270 vers la droite", () => {
    expect(facingToward({ x: 0, y: 0 }, { x: 0, y: 10 })).toBe(0);
    expect(facingToward({ x: 0, y: 0 }, { x: -10, y: 0 })).toBe(90);
    expect(facingToward({ x: 0, y: 0 }, { x: 0, y: -10 })).toBe(180);
    expect(facingToward({ x: 0, y: 0 }, { x: 10, y: 0 })).toBe(270);
    expect(facingToward({ x: 1, y: 1 }, { x: 1, y: 1 })).toBeNull();
  });
  it("itinéraire : les sommets d'un polygone seul, sinon le centre de chaque forme", () => {
    expect(routePoints([{ type: "polygon", points: [0, 0, 100, 0, 100, 100] }])).toEqual([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }]);
    expect(routePoints([{ type: "rectangle", x: 0, y: 0, width: 100, height: 100 }, { type: "ellipse", x: 300, y: 300, radiusX: 50, radiusY: 50 }]))
      .toEqual([{ x: 50, y: 50 }, { x: 300, y: 300 }]);
  });
  it("point suivant : boucle, aller-retour, hasard (jamais le même)", () => {
    expect(nextWaypoint(3, { index: 2 }, "loop").index).toBe(0);
    expect(nextWaypoint(3, { index: 2, direction: 1 }, "pingpong")).toEqual({ index: 1, direction: -1 });
    expect(nextWaypoint(3, { index: 0, direction: -1 }, "pingpong")).toEqual({ index: 1, direction: 1 });
    for ( let i = 0; i < 20; i++ ) expect(nextWaypoint(4, { index: 2 }, "random", () => Math.random()).index).not.toBe(2);
    expect(nearestWaypoint([{ x: 0, y: 0 }, { x: 100, y: 0 }], { x: 90, y: 5 })).toBe(1);
  });
});
