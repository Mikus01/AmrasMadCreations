import { beforeAll, describe, expect, it, vi } from "vitest";

let rewards;
let rewardAdapters;
beforeAll(async () => {
  [rewards, rewardAdapters] = await Promise.all([
    import("../scripts/quest-rewards.mjs"),
    import("../scripts/quest-reward-adapters.mjs")
  ]);
});

const gm = { isGM: true };
const quest = (reward = {}) => ({
  id: "quest-a",
  state: "accepted",
  rewards: { xp: 0, items: [], currency: {}, ...reward },
  rewardAudit: [],
  rewardsGranted: false
});
const denominations = [
  { key: "gp", toLower: 10 },
  { key: "sp", toLower: 10 },
  { key: "cp", toLower: null }
];
const complete = (q, options) => rewards.completeQuest(q, {
  persistQuest: async () => {},
  ...options
});

describe("REQ-024/025/026/027 reward assignments", () => {
  it("REQ-024 cancel leaves the quest unchanged and applies nothing", async () => {
    const q = quest({ xp: 100 });
    const applyAward = vi.fn();
    const result = await complete(q, { cancelled: true, applyAward, user: gm });
    expect(result).toEqual(q);
    expect(applyAward).not.toHaveBeenCalled();
    expect(q.state).toBe("accepted");
  });

  it("REQ-024 completes a quest with no rewards and no recipients", async () => {
    const applyAward = vi.fn();
    const result = await complete(quest(), {
      assignments: {}, applyAward, user: gm
    });
    expect(result.state).toBe("completed");
    expect(applyAward).not.toHaveBeenCalled();
  });

  it("REQ-024 requires recipient assignments when a reward is present", async () => {
    const applyAward = vi.fn();
    await expect(complete(quest({ xp: 100 }), {
      assignments: {}, applyAward, user: gm
    })).rejects.toThrow();
    expect(applyAward).not.toHaveBeenCalled();
  });

  it("REQ-025 gives the full XP amount to each selected actor", async () => {
    const applyAward = vi.fn().mockResolvedValue(undefined);
    const result = await complete(quest({ xp: 100 }), {
      assignments: { xp: ["Actor.a", "Actor.b"] }, applyAward, user: gm
    });
    expect(applyAward).toHaveBeenNthCalledWith(
      1, { type: "xp", actorUuid: "Actor.a", amount: 100 }, { idempotencyKey: "quest-a:reward:0" }
    );
    expect(applyAward).toHaveBeenNthCalledWith(
      2, { type: "xp", actorUuid: "Actor.b", amount: 100 }, { idempotencyKey: "quest-a:reward:1" }
    );
    expect(result.state).toBe("completed");
  });

  it("REQ-026 copies assigned item quantities and permits unassigned copies", async () => {
    const applyAward = vi.fn().mockResolvedValue(undefined);
    const q = quest({ items: [{ itemUuid: "Item.potion", quantity: 5 }] });
    await complete(q, {
      assignments: { items: [
        { itemUuid: "Item.potion", actorUuid: "Actor.a", quantity: 1 },
        { itemUuid: "Item.potion", actorUuid: "Actor.b", quantity: 2 }
      ] },
      applyAward,
      user: gm
    });
    expect(applyAward).toHaveBeenNthCalledWith(
      1,
      { type: "item", itemUuid: "Item.potion", actorUuid: "Actor.a", quantity: 1, copy: true },
      { idempotencyKey: "quest-a:reward:0" }
    );
    expect(applyAward).toHaveBeenNthCalledWith(
      2,
      { type: "item", itemUuid: "Item.potion", actorUuid: "Actor.b", quantity: 2, copy: true },
      { idempotencyKey: "quest-a:reward:1" }
    );
    expect(applyAward).toHaveBeenCalledTimes(2);
  });

  it("REQ-026 rejects assigning more item copies than the quest offers", async () => {
    const applyAward = vi.fn();
    await expect(complete(quest({ items: [{ itemUuid: "Item.potion", quantity: 2 }] }), {
      assignments: { items: [
        { itemUuid: "Item.potion", actorUuid: "Actor.a", quantity: 2 },
        { itemUuid: "Item.potion", actorUuid: "Actor.b", quantity: 1 }
      ] },
      applyAward,
      user: gm
    })).rejects.toThrow();
    expect(applyAward).not.toHaveBeenCalled();
  });

  it("REQ-024 requires an assignment for an item-only quest", async () => {
    const applyAward = vi.fn();
    await expect(rewards.completeQuest(quest({ items: [{ itemUuid: "Item.potion", quantity: 2 }] }), {
      assignments: { items: [] }, applyAward, user: gm
    })).rejects.toThrow();
    expect(applyAward).not.toHaveBeenCalled();
  });

  it("REQ-027 converts a higher denomination remainder before splitting", () => {
    const result = rewards.splitCurrency({ gp: 5 }, denominations, ["Actor.a", "Actor.b"]);
    expect(result.allocations).toEqual({
      "Actor.a": { gp: 2, sp: 5 },
      "Actor.b": { gp: 2, sp: 5 }
    });
    expect(result.remainder).toEqual({});
  });

  it("REQ-027 records a remainder that cannot be split or converted", () => {
    const result = rewards.splitCurrency({ cp: 1 }, denominations, ["Actor.a", "Actor.b"]);
    expect(result.remainder).toEqual({ cp: 1 });
    expect(result.allocations["Actor.a"].cp ?? 0).toBe(0);
    expect(result.allocations["Actor.b"].cp ?? 0).toBe(0);
  });
});

describe("REQ-029 reward audit and idempotence", () => {
  it("REQ-029 records successful awards and failures and completes with a GM notification", async () => {
    const applyAward = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("Actor cannot receive XP"));
    const notifyError = vi.fn();
    const persisted = [];
    const result = await rewards.completeQuest(quest({ xp: 100 }), {
      assignments: { xp: ["Actor.a", "Actor.b"] },
      applyAward,
      notifyError,
      user: gm,
      persistQuest: async (value, { phase }) => persisted.push({
        state: value.state,
        status: value.rewardAudit.at(-1)?.status,
        phase
      })
    });
    expect(result.state).toBe("completed");
    expect(result.rewardAudit).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "xp", actorUuid: "Actor.a", status: "awarded" }),
      expect.objectContaining({
        type: "xp", actorUuid: "Actor.b", status: "failed", error: expect.stringContaining("cannot receive XP")
      })
    ]));
    expect(notifyError).toHaveBeenCalled();
    expect(persisted[0]).toMatchObject({ state: "completed", status: "pending", phase: "claimed" });
    expect(persisted.slice(1).map(entry => entry.phase)).toEqual(["awarded", "failed"]);
  });

  it("REQ-029 does not award again after leaving and re-entering Completed", async () => {
    const applyAward = vi.fn().mockResolvedValue(undefined);
    const options = { assignments: { xp: ["Actor.a"] }, applyAward, user: gm, persistQuest: async () => {} };
    const completed = await rewards.completeQuest(quest({ xp: 100 }), options);
    const completedAgain = await rewards.completeQuest({ ...completed, state: "accepted" }, options);
    expect(completedAgain.state).toBe("completed");
    expect(applyAward).toHaveBeenCalledTimes(1);
  });

  it("REQ-029 does not retry failed awards automatically on later completion", async () => {
    const applyAward = vi.fn().mockRejectedValue(new Error("Unsupported system"));
    const notifyError = vi.fn();
    const options = { assignments: { xp: ["Actor.a"] }, applyAward, notifyError, user: gm, persistQuest: async () => {} };
    const completed = await rewards.completeQuest(quest({ xp: 100 }), options);
    expect(completed.state).toBe("completed");
    const completedAgain = await rewards.completeQuest({ ...completed, state: "accepted" }, options);
    expect(completedAgain.state).toBe("completed");
    expect(applyAward).toHaveBeenCalledTimes(1);
  });

  it("REQ-029 requires the durable pending checkpoint before attempting an award", async () => {
    const applyAward = vi.fn().mockResolvedValue(undefined);
    await expect(rewards.completeQuest(quest({ xp: 20 }), {
      assignments: { xp: ["Actor.a"] },
      applyAward,
      user: gm
    })).rejects.toThrow(/persistQuest is required/);
    expect(applyAward).not.toHaveBeenCalled();

    await expect(rewards.completeQuest(quest({ xp: 20 }), {
      assignments: { xp: ["Actor.a"] },
      applyAward,
      user: gm,
      persistQuest: vi.fn().mockRejectedValue(new Error("Journal save failed"))
    })).rejects.toThrow("Journal save failed");
    expect(applyAward).not.toHaveBeenCalled();
  });

  it("REQ-029 marks interrupted pending awards unknown without retrying", async () => {
    const persisted = vi.fn();
    const recovered = await rewards.markInterruptedAwardsUnknown({
      ...quest({ xp: 20 }),
      rewardsGranted: true,
      rewardAudit: [{ type: "xp", actorUuid: "Actor.a", status: "pending" }]
    }, { persistQuest: persisted });
    expect(recovered.rewardAudit[0]).toMatchObject({
      status: "unknown",
      error: expect.stringContaining("verify Actor")
    });
    expect(persisted).toHaveBeenCalledWith(
      expect.objectContaining({ rewardAudit: [expect.objectContaining({ status: "unknown" })] }),
      { phase: "recovery" }
    );
  });

  it("REQ-029 rejects reward edits after first completion", () => {
    const completed = { ...quest({ xp: 100 }), state: "failed", rewardsGranted: true };
    expect(() => rewards.updateRewards(completed, { xp: 200, items: [], currency: {} }, gm)).toThrow();
    expect(completed.rewards.xp).toBe(100);
  });
});

describe("REQ-028 Foundry reward adapters", () => {
  it("uses verified D&D 5e XP and currency paths", async () => {
    const actor = {
      system: { details: { xp: { value: 250 } }, currency: { pp: 0, gp: 1, ep: 0, sp: 2, cp: 3 } },
      update: vi.fn().mockResolvedValue(undefined)
    };
    const adapter = rewardAdapters.getQuestRewardAdapter("dnd5e", {
      resolveActor: async () => actor
    });
    await adapter.applyAward(
      { type: "xp", actorUuid: "Actor.a", amount: 100 },
      { idempotencyKey: "quest:xp" }
    );
    expect(actor.update).toHaveBeenCalledWith({ "system.details.xp.value": 350 });
    await adapter.applyAward(
      { type: "currency", actorUuid: "Actor.a", currency: { gp: 2, sp: 4 } },
      { idempotencyKey: "quest:coins" }
    );
    expect(actor.update).toHaveBeenLastCalledWith({
      "system.currency.gp": 3,
      "system.currency.sp": 6
    });
  });

  it("uses Shadowdark XP and currency paths and PF2e's currency API", async () => {
    const shadowdarkActor = {
      system: { level: { xp: 10 }, coins: { gp: 1, sp: 2, cp: 3 } },
      update: vi.fn().mockResolvedValue(undefined)
    };
    const shadowdark = rewardAdapters.getQuestRewardAdapter("shadowdark", {
      resolveActor: async () => shadowdarkActor
    });
    await shadowdark.applyAward(
      { type: "xp", actorUuid: "Actor.sd", amount: 5 },
      { idempotencyKey: "quest:sd-xp" }
    );
    expect(shadowdarkActor.update).toHaveBeenCalledWith({ "system.level.xp": 15 });
    await shadowdark.applyAward(
      { type: "currency", actorUuid: "Actor.sd", currency: { gp: 2 } },
      { idempotencyKey: "quest:sd-coins" }
    );
    expect(shadowdarkActor.update).toHaveBeenLastCalledWith({ "system.coins.gp": 3 });

    const pf2eActor = { inventory: { addCoins: vi.fn().mockResolvedValue(undefined) } };
    const pf2e = rewardAdapters.getQuestRewardAdapter("pf2e", {
      resolveActor: async () => pf2eActor
    });
    await pf2e.applyAward(
      { type: "currency", actorUuid: "Actor.pf2e", currency: { gp: 2, cp: 1 } },
      { idempotencyKey: "quest:pf2e-coins" }
    );
    expect(pf2eActor.inventory.addCoins).toHaveBeenCalledWith({ gp: 2, cp: 1 });
  });

  it("copies Items and rejects unverified or unsupported reward fields", async () => {
    const itemSource = { _id: "original", name: "Potion", type: "consumable", system: { quantity: 7 } };
    const actor = { createEmbeddedDocuments: vi.fn().mockResolvedValue([]), update: vi.fn() };
    const dnd5e = rewardAdapters.getQuestRewardAdapter("dnd5e", {
      resolveActor: async () => actor,
      resolveItem: async () => ({ toObject: () => structuredClone(itemSource) })
    });
    await dnd5e.applyAward(
      { type: "item", itemUuid: "Item.potion", actorUuid: "Actor.a", quantity: 2, copy: true },
      { idempotencyKey: "quest:item" }
    );
    expect(actor.createEmbeddedDocuments).toHaveBeenCalledWith("Item", [
      expect.objectContaining({ name: "Potion", system: { quantity: 2 } })
    ], { keepId: false });
    expect(itemSource.system.quantity).toBe(7);

    const cosmere = rewardAdapters.getQuestRewardAdapter("cosmere-rpg", {
      resolveActor: async () => ({ system: {}, update: vi.fn() })
    });
    expect(cosmere.capabilities).toMatchObject({ xp: false, items: true, currency: false });
    await expect(cosmere.applyAward(
      { type: "xp", actorUuid: "Actor.cosmere", amount: 5 },
      { idempotencyKey: "quest:cosmere-xp" }
    )).rejects.toBeInstanceOf(rewardAdapters.UnsupportedRewardError);

    const cosmereCurrencyQuest = await rewards.completeQuest(quest({
      xp: 0,
      currency: { marks: 3 }
    }), {
      assignments: { currency: ["Actor.cosmere"] },
      applyAward: cosmere.applyAward,
      denominations: cosmere.denominations,
      user: gm,
      persistQuest: async () => {}
    });
    expect(cosmereCurrencyQuest.rewardAudit).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "currency",
        status: "failed",
        recipientUuids: ["Actor.cosmere"],
        error: expect.stringContaining("not verified")
      })
    ]));

    const unsupported = rewardAdapters.getQuestRewardAdapter("my-system");
    const result = await complete(quest({ xp: 5 }), {
      assignments: { xp: ["Actor.a"] },
      applyAward: unsupported.applyAward,
      user: gm
    });
    expect(result.rewardAudit).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "xp", status: "failed", error: expect.stringContaining("not verified") })
    ]));
  });
});
