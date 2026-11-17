import { describe, it, expect } from "vitest";
import { RENOWN_LEVELS, RENOWN_MIN, RENOWN_MAX, clampRenown, getRenownLevel } from "../scripts/renown.mjs";

describe("REQ-008 renown levels", () => {
  it("REQ-008 has 8 levels from infamous to paragon", () => {
    expect(RENOWN_LEVELS.map(l => l.key)).toEqual(
      ["infamous", "hated", "disliked", "neutral", "liked", "respected", "revered", "paragon"]);
  });

  it.each([
    [-100, "infamous"], [-76, "infamous"], [-75, "hated"], [-41, "hated"],
    [-40, "disliked"], [-11, "disliked"], [-10, "neutral"], [0, "neutral"], [9, "neutral"],
    [10, "liked"], [39, "liked"], [40, "respected"], [74, "respected"],
    [75, "revered"], [89, "revered"], [90, "paragon"], [100, "paragon"]
  ])("REQ-008 %i points -> %s", (points, key) => {
    expect(getRenownLevel(points)).toBe(key);
  });
});

describe("REQ-009 clamping", () => {
  it("REQ-009 bounds are -100..100", () => {
    expect([RENOWN_MIN, RENOWN_MAX]).toEqual([-100, 100]);
  });
  it("REQ-009 clamps out-of-range values", () => {
    expect(clampRenown(250)).toBe(100);
    expect(clampRenown(-250)).toBe(-100);
    expect(clampRenown(5)).toBe(5);
  });
  it("REQ-009 rejects non-finite values", () => {
    expect(() => clampRenown(NaN)).toThrow();
    expect(() => clampRenown(Infinity)).toThrow();
    expect(() => clampRenown("5")).toThrow();
  });
});
