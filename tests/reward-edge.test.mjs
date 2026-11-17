import { beforeAll, describe, expect, it, vi } from "vitest";

let rewards;
beforeAll(async () => {
  rewards = await import("../scripts/quest-rewards.mjs");
});

const denominations = [
  { key: "gp", toLower: 10 },
  { key: "sp", toLower: 10 },
  { key: "cp", toLower: null }
];

describe("REQ-027 multi-denomination currency distribution", () => {
  it("combines converted remainders with existing lower denominations", () => {
    const { allocations, remainder } = rewards.splitCurrency(
      { gp: 5, sp: 8 }, denominations, ["Actor.a", "Actor.b", "Actor.c"]
    );
    for (const actor of ["Actor.a", "Actor.b", "Actor.c"]) {
      expect(allocations[actor]).toEqual({ gp: 1, sp: 9, cp: 3 });
    }
    expect(remainder).toEqual({ cp: 1 });
  });

  it("rejects currency distribution with no recipients or duplicate recipients", () => {
    expect(() => rewards.splitCurrency({ gp: 5 }, denominations, [])).toThrow();
    expect(() => rewards.splitCurrency({ gp: 5 }, denominations, ["Actor.a", "Actor.a"])).toThrow();
  });

  it("rejects negative and fractional currency amounts", () => {
    expect(() => rewards.splitCurrency({ gp: -1 }, denominations, ["Actor.a"])).toThrow();
    expect(() => rewards.splitCurrency({ gp: 1.5 }, denominations, ["Actor.a"])).toThrow();
  });

  it("records indivisible currency when completing the quest", async () => {
    const quest = {
      state: "accepted",
      rewards: { xp: 0, items: [], currency: { cp: 1 } },
      rewardAudit: [],
      rewardsGranted: false
    };
    const result = await rewards.completeQuest(quest, {
      assignments: { currency: ["Actor.a", "Actor.b"] },
      denominations,
      applyAward: vi.fn(),
      user: { isGM: true }
    });
    expect(result.state).toBe("completed");
    expect(result.rewardAudit).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "currency", status: "unawarded", currency: { cp: 1 } })
    ]));
  });
});
