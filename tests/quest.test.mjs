import { beforeAll, describe, expect, it } from "vitest";

let quest;
beforeAll(async () => {
  quest = await import("../scripts/quest.mjs");
});

const gm = { isGM: true };
const player = { isGM: false };
const data = (overrides = {}) => ({
  title: "Recover the plans",
  description: "Find the missing plans.",
  giver: { actorUuid: "Actor.giver", factionUuid: null },
  ...overrides
});
const makeQuest = (id, overrides = {}) => ({
  ...quest.createQuest(data(overrides)),
  id
});

describe("REQ-016/017/018 quest data", () => {
  it("REQ-016 rejects a blank title or description", () => {
    expect(() => quest.createQuest(data({ title: "  " }))).toThrow();
    expect(() => quest.createQuest(data({ description: "  " }))).toThrow();
    expect(() => quest.createQuest(data({ title: null }))).toThrow();
    expect(() => quest.createQuest(data({ description: null }))).toThrow();
  });

  it("REQ-016 requires an actor or faction giver and accepts both", () => {
    expect(() => quest.createQuest(data({ giver: {} }))).toThrow();
    expect(() => quest.createQuest(data({ giver: { actorUuid: "  " } }))).toThrow();
    for (const giver of [
      { actorUuid: "Actor.a" },
      { factionUuid: "JournalEntry.f.Page.f" },
      { actorUuid: "Actor.a", factionUuid: "JournalEntry.f.Page.f" }
    ]) {
      expect(quest.createQuest(data({ giver })).giver).toMatchObject(giver);
    }
  });

  it("REQ-016 supplies a default icon and preserves an explicitly supplied icon", () => {
    expect(quest.createQuest(data()).icon).toBeTruthy();
    expect(quest.createQuest(data({ icon: "icons/quest.webp" })).icon).toBe("icons/quest.webp");
  });

  it("REQ-017 starts offered and permits each state transition for a GM", () => {
    const states = ["offered", "rejected", "accepted", "in-progress", "completed", "failed"];
    expect(quest.createQuest(data()).state).toBe("offered");
    for (const from of states) {
      for (const to of states) {
        expect(quest.setQuestState({ ...quest.createQuest(data()), state: from }, to, gm).state).toBe(to);
      }
    }
  });

  it("REQ-017 rejects a player state change or an unknown state", () => {
    const q = quest.createQuest(data());
    expect(() => quest.setQuestState(q, "accepted", player)).toThrow();
    expect(() => quest.setQuestState(q, "unknown", gm)).toThrow();
    expect(q.state).toBe("offered");
  });

  it("REQ-018 retains combined rewards and an optional consequence", () => {
    const rewards = {
      xp: 100,
      items: [{ itemUuid: "Item.sword", quantity: 2 }],
      currency: { gp: 5 }
    };
    const q = quest.createQuest(data({ rewards, consequence: "The town falls." }));
    expect(q.rewards).toEqual(rewards);
    expect(q.consequence).toBe("The town falls.");
    expect(quest.createQuest(data()).consequence).toBeFalsy();
    expect(quest.createQuest(data()).rewards).toMatchObject({ xp: 0, items: [], currency: {} });
    rewards.items[0].quantity = 9;
    expect(q.rewards.items[0].quantity).toBe(2);
  });
});

describe("REQ-019/020/021/022 quest links", () => {
  it("REQ-019 adds actor and faction observers but rejects a giver as observer", () => {
    let q = quest.createQuest(data());
    q = quest.addObserver(q, { type: "actor", uuid: "Actor.other" }, gm);
    q = quest.addObserver(q, { type: "faction", uuid: "JournalEntry.f.Page.f" }, gm);
    expect(q.observers).toEqual([
      { type: "actor", uuid: "Actor.other" },
      { type: "faction", uuid: "JournalEntry.f.Page.f" }
    ]);
    expect(() => quest.addObserver(q, { type: "actor", uuid: "Actor.giver" }, gm)).toThrow();
  });

  it("REQ-019 rejects faction givers as observers and does not duplicate observers", () => {
    const q = quest.createQuest(data({ giver: { factionUuid: "JournalEntry.f.Page.f" } }));
    expect(() => quest.addObserver(q, { type: "faction", uuid: "JournalEntry.f.Page.f" }, gm)).toThrow();
    const first = quest.addObserver(q, { type: "actor", uuid: "Actor.a" }, gm);
    const second = quest.addObserver(first, { type: "actor", uuid: "Actor.a" }, gm);
    expect(second.observers).toEqual([{ type: "actor", uuid: "Actor.a" }]);
    expect(q.observers).toEqual([]);
    expect(() => quest.addObserver(q, { type: "actor", uuid: "Actor.a" }, player)).toThrow();
    expect(() => quest.addObserver(q, { type: "actor", uuid: " " }, gm)).toThrow();
  });

  it("REQ-020 adds and removes both sides without changing states", () => {
    const initial = [makeQuest("a"), { ...makeQuest("b"), state: "accepted" }];
    const linked = quest.addQuestRelation(initial, "a", "b", gm);
    expect(linked[0].relatedQuestIds).toContain("b");
    expect(linked[1].relatedQuestIds).toContain("a");
    expect(linked.map(q => q.state)).toEqual(["offered", "accepted"]);
    const unlinked = quest.removeQuestRelation(linked, "a", "b", gm);
    expect(unlinked[0].relatedQuestIds).not.toContain("b");
    expect(unlinked[1].relatedQuestIds).not.toContain("a");
    expect(initial[0].relatedQuestIds).not.toContain("b");
  });

  it("REQ-020 rejects self-links and player modifications", () => {
    const quests = [makeQuest("a"), makeQuest("b")];
    expect(() => quest.addQuestRelation(quests, "a", "a", gm)).toThrow();
    expect(() => quest.addQuestRelation(quests, "a", "b", player)).toThrow();
    expect(() => quest.addQuestRelation(quests, "a", "missing", gm)).toThrow();
    expect(() => quest.removeQuestRelation(quests, "a", "b", player)).toThrow();
  });

  it("REQ-020 adding a relationship twice never creates duplicate links", () => {
    let quests = [makeQuest("a"), makeQuest("b")];
    quests = quest.addQuestRelation(quests, "a", "b", gm);
    quests = quest.addQuestRelation(quests, "a", "b", gm);
    expect(quests[0].relatedQuestIds).toEqual(["b"]);
    expect(quests[1].relatedQuestIds).toEqual(["a"]);
  });

  it("REQ-021 deleting a quest removes links without altering surviving states", () => {
    let quests = quest.addQuestRelation([makeQuest("a"), makeQuest("b"), makeQuest("c")], "a", "b", gm);
    quests = quest.addQuestRelation(quests, "b", "c", gm);
    const remaining = quest.deleteQuest(quests, "a", gm);
    expect(remaining).toHaveLength(2);
    expect(remaining[0]).toMatchObject({ id: "b", state: "offered", relatedQuestIds: ["c"] });
    expect(remaining[1]).toMatchObject({ id: "c", state: "offered", relatedQuestIds: ["b"] });
    expect(quests[0].relatedQuestIds).toEqual(["b"]);
    expect(() => quest.deleteQuest(quests, "a", player)).toThrow();
  });

  it("REQ-022 lists faction giver and observer quests, but not unrelated quests", () => {
    const factionUuid = "JournalEntry.f.Page.f";
    const giver = makeQuest("giver", { giver: { factionUuid } });
    const observer = quest.addObserver(makeQuest("observer"), { type: "faction", uuid: factionUuid }, gm);
    const unrelated = makeQuest("unrelated");
    expect(quest.questsForFaction([giver, observer, unrelated], factionUuid).map(q => q.id))
      .toEqual(["giver", "observer"]);
  });
});
