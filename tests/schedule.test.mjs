import { describe, it, expect } from "vitest";
import { parseTime, formatTime, covers, normalizeSlots, slotAt, parseHours, hoursCover, decide, isCatchUp, wakeRounds, WAKE_SECONDS }
  from "../module/scripts/core/schedule.mjs";

const h = (hh, mm=0) => (hh * 60) + mm;

describe("horaires : heures", () => {
  it("lit 22:00, 6:30, 6, 06h15 ; refuse le reste", () => {
    expect(parseTime("22:00")).toBe(h(22));
    expect(parseTime("6:30")).toBe(h(6, 30));
    expect(parseTime("6")).toBe(h(6));
    expect(parseTime("06h15")).toBe(h(6, 15));
    expect(parseTime("24:00")).toBe(0);
    expect(parseTime("6:75")).toBeNull();
    expect(parseTime("25:00")).toBeNull();
    expect(parseTime("midi")).toBeNull();
    expect(formatTime(h(6, 5))).toBe("06:05");
  });

  it("un créneau couvre [de, à[, passe minuit, ou toute la journée", () => {
    expect(covers(h(6), h(18), h(6))).toBe(true);
    expect(covers(h(6), h(18), h(18))).toBe(false);
    expect(covers(h(22), h(6), h(23))).toBe(true);
    expect(covers(h(22), h(6), h(3))).toBe(true);
    expect(covers(h(22), h(6), h(12))).toBe(false);
    expect(covers(h(8), h(8), h(3))).toBe(true);
  });

  it("heures de région : plusieurs plages, vide = toujours", () => {
    const hours = parseHours("06:00-12:00, 14:00 – 18:00");
    expect(hours).toEqual([{ from: h(6), to: h(12) }, { from: h(14), to: h(18) }]);
    expect(hoursCover(hours, h(13))).toBe(false);
    expect(hoursCover(hours, h(15))).toBe(true);
    expect(hoursCover(parseHours(""), h(3))).toBe(true);
  });
});

describe("horaires : créneaux", () => {
  it("normalise et écarte les créneaux illisibles ou sans région", () => {
    const { slots, problems } = normalizeSlots([
      { from: "06:00", to: "18:00", activity: "sleep", region: "R1", wake: 12 },
      { from: "18:00", to: "06:00", activity: "patrol", region: "R2" },
      { from: "x", to: "06:00", activity: "idle" },
      { from: "01:00", to: "02:00", activity: "post" },
      { from: "01:00", to: "02:00", activity: "dance" },
      { from: "02:00", to: "03:00", activity: "off" }
    ]);
    expect(slots.map(s => s.index)).toEqual([0, 1, 5]);
    expect(slots[0]).toMatchObject({ from: h(6), to: h(18), activity: "sleep", region: "R1", wake: 12 });
    expect(slots[1].wake).toBe(WAKE_SECONDS);
    expect(problems).toHaveLength(3);
    expect(normalizeSlots(null)).toEqual({ slots: [], problems: [] });
  });

  it("le premier créneau qui couvre l'heure l'emporte", () => {
    const { slots } = normalizeSlots([
      { from: "12:00", to: "13:00", activity: "idle" },
      { from: "06:00", to: "18:00", activity: "sleep", region: "R1" }
    ]);
    expect(slotAt(slots, h(12, 30)).activity).toBe("idle");
    expect(slotAt(slots, h(7)).activity).toBe("sleep");
    expect(slotAt(slots, h(20))).toBeNull();
  });
});

describe("horaires : qui décide", () => {
  const own = normalizeSlots([{ from: "20:00", to: "22:00", activity: "idle" }]).slots;
  const group = normalizeSlots([
    { from: "06:00", to: "18:00", activity: "sleep", region: "dortoir" },
    { from: "18:00", to: "06:00", activity: "patrol", region: "ronde" }
  ]).slots;
  const assignment = { kind: "post", region: "porte", hours: parseHours("06:00-12:00") };

  it("son horaire, puis son poste dans ses heures, puis son groupe", () => {
    expect(decide({ own, group, assignment }, h(21))).toMatchObject({ source: "own", activity: "idle" });
    expect(decide({ own, group, assignment }, h(8))).toMatchObject({ source: "assignment", activity: "post", region: "porte" });
    expect(decide({ own, group, assignment }, h(14))).toMatchObject({ source: "group", activity: "sleep", region: "dortoir" });
    expect(decide({ own, group, assignment }, h(23))).toMatchObject({ source: "group", activity: "patrol", region: "ronde" });
    expect(decide({}, h(3))).toBeNull();
  });

  it("une patrouille sans heures est toujours tenue ; la clé change avec le créneau", () => {
    const always = { kind: "route", region: "ronde", hours: [] };
    expect(decide({ group, assignment: always }, h(9)).activity).toBe("patrol");
    expect(decide({ group }, h(9)).key).not.toBe(decide({ group }, h(19)).key);
    expect(decide({ group }, h(9)).key).toBe(decide({ group }, h(15)).key);
  });

  it("un saut d'une heure ou plus est un rattrapage ; le réveil se compte en rounds", () => {
    expect(isCatchUp(60)).toBe(false);
    expect(isCatchUp(3600)).toBe(true);
    expect(isCatchUp(-8 * 3600)).toBe(true);
    expect(isCatchUp(null)).toBe(false);
    expect(wakeRounds(12)).toBe(2);
    expect(wakeRounds(1)).toBe(1);
    expect(wakeRounds(0)).toBe(0);
  });
});
