import { describe, it, expect } from "vitest";
import { averageOf } from "../module/scripts/core/dice.mjs";

describe("moyenne d'une formule", () => {
  it("dés et constantes", () => {
    expect(averageOf("2d6 + 3")).toEqual({ average: 10, understood: true });
    expect(averageOf("1d8")).toEqual({ average: 4.5, understood: true });
    expect(averageOf("d4+1")).toEqual({ average: 3.5, understood: true });
    expect(averageOf("7")).toEqual({ average: 7, understood: true });
    expect(averageOf("")).toEqual({ average: 0, understood: true });
    expect(averageOf("2d6 - 1")).toEqual({ average: 6, understood: true });
  });
  it("dit ce qu'elle n'a pas compris", () => {
    expect(averageOf("1d6 + @mod").understood).toBe(false);
    expect(averageOf("1d6 + @mod").average).toBe(3.5);
    expect(averageOf("2d6r1").understood).toBe(false);
  });
});
