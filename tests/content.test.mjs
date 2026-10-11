import { describe, it, expect } from "vitest";
import { PROFILES } from "../module/scripts/content/profiles.mjs";
import { ENMITIES } from "../module/scripts/content/enmities.mjs";
import { validateProfiles } from "../module/scripts/core/profile.mjs";
import { validateEnmities } from "../module/scripts/core/targets.mjs";
import { seeded, between, pick, chance } from "../module/scripts/core/rng.mjs";

describe("contenu livré", () => {
  it("les profils livrés sont valides", () => {
    expect(validateProfiles(PROFILES)).toEqual([]);
  });
  it("les haines livrées sont valides", () => {
    expect(validateEnmities(ENMITIES)).toEqual([]);
  });
  it("rien de propre à une campagne : pas de sélection par nom", () => {
    for ( const entry of PROFILES ) expect(Object.keys(entry.match)).not.toContain("name");
  });
});

describe("aléa à graine", () => {
  it("rejoue la même suite", () => {
    const a = seeded(42), b = seeded(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    expect(seeded(1)()).not.toBe(seeded(2)());
  });
  it("reste dans les bornes", () => {
    const rng = seeded(7);
    for ( let i = 0; i < 200; i++ ) {
      const n = between(rng, 2, 5);
      expect(n).toBeGreaterThanOrEqual(2);
      expect(n).toBeLessThanOrEqual(5);
    }
    expect(["a", "b"]).toContain(pick(rng, ["a", "b"]));
    expect(pick(rng, [])).toBeUndefined();
    expect(chance(rng, 1)).toBe(true);
    expect(chance(rng, 0)).toBe(false);
  });
});
