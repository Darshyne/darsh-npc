import { describe, it, expect } from "vitest";
import { nextGlance, SCANS, GLANCE_GAP_MS, GLANCE_HOLD_MS } from "../module/scripts/core/alert.mjs";

const seq = values => { let n = 0; return () => values[n++ % values.length]; };

describe("regarder autour de soi", () => {
  it("rien sans balayage", () => {
    expect(nextGlance(null, { base: 90, scan: "none", now: 0, rng: Math.random })).toBe(null);
  });

  it("d'abord une attente, puis un coup d'œil d'un côté, puis le retour", () => {
    const rng = seq([0.5]);
    const first = nextGlance(null, { base: 90, scan: "wide", now: 0, rng });
    expect(first.rotation).toBe(null);
    expect(first.glance.at).toBe(GLANCE_GAP_MS[0] + (0.5 * (GLANCE_GAP_MS[1] - GLANCE_GAP_MS[0])));
    expect(nextGlance(first.glance, { base: 90, scan: "wide", now: 1000, rng })).toBe(null);
    const look = nextGlance(first.glance, { base: 90, scan: "wide", now: first.glance.at, rng: seq([0.2, 1]) });
    expect(look.glance.away).toBe(true);
    expect(look.rotation).toBe(0);   // 90 − 90 (côté gauche, amplitude entière)
    const back = nextGlance(look.glance, { base: 90, scan: "wide", now: look.glance.at, rng });
    expect(back.rotation).toBe(90);
    expect(back.glance.away).toBe(false);
  });

  it("toujours dans l'amplitude, au moins la moitié ; angles ramenés à [0, 360)", () => {
    for ( let k = 0; k < 200; k++ ) {
      const r = nextGlance({ at: 0, away: false }, { base: 10, scan: "narrow", now: 0, rng: Math.random });
      const d = Math.abs(((r.rotation - 10 + 540) % 360) - 180);
      expect(r.rotation).toBeGreaterThanOrEqual(0);
      expect(r.rotation).toBeLessThan(360);
      expect(d).toBeGreaterThanOrEqual(SCANS.narrow / 2 - 1);
      expect(d).toBeLessThanOrEqual(SCANS.narrow + 1);
      expect(r.glance.at).toBeLessThanOrEqual(GLANCE_HOLD_MS[1]);
    }
  });

  it("une créature sans esprit attend plus longtemps", () => {
    const a = nextGlance(null, { base: 0, scan: "full", now: 0, rng: seq([0.5]) });
    const b = nextGlance(null, { base: 0, scan: "full", now: 0, rng: seq([0.5]), mindless: true });
    expect(b.glance.at).toBeGreaterThan(a.glance.at);
  });
});
