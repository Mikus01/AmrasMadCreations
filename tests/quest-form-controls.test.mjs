import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyQuestDrop, findRelatedQuests } from "../scripts/quest-form-controls.mjs";

function fixture() {
  const giver = { value: "" };
  const giverName = { textContent: "" };
  const clear = { hidden: true };
  const actors = [];
  const accepted = [];
  const items = [];
  const actorRow = () => {
    const row = {
      dataset: {},
      input: { value: "" },
      label: { textContent: "" },
      querySelector(selector) {
        return selector === "[name='observer']" ? this.input : this.label;
      },
      remove() { actors.splice(actors.indexOf(this), 1); }
    };
    return row;
  };
  const itemRow = () => ({
    uuid: { value: "" },
    quantity: { value: "1" },
    label: { textContent: "" },
    querySelector(selector) {
      if (selector === "[name='itemUuid']") return this.uuid;
      if (selector === "[name='itemQuantity']") return this.quantity;
      return this.label;
    }
  });
  const acceptedRow = () => ({
    dataset: {},
    input: { value: "" },
    label: { textContent: "", dataset: {} },
    querySelector(selector) {
      return selector === "[name='acceptedActorUuids']" ? this.input : this.label;
    },
    remove() { accepted.splice(accepted.indexOf(this), 1); }
  });
  let locked = false;
  let acceptedLocked = false;
  const root = {
    querySelector(selector) {
      const entries = {
        "[name='giverActorUuid']": giver,
        "[data-giver-name]": giverName,
        "[data-clear-giver]": clear,
        "[data-actor-observers]": { append: row => actors.push(row) },
        "[data-accepted-actors]": { append: row => accepted.push(row) },
        "[data-accepted-actor-template]": { content: { firstElementChild: { cloneNode: acceptedRow } } },
        "[data-quest-drop='accepted']": acceptedLocked ? null : {},
        "[data-item-rows]": { append: row => items.push(row) },
        "[data-actor-observer-template]": { content: { firstElementChild: { cloneNode: actorRow } } },
        "[data-item-row-template]": { content: { firstElementChild: { cloneNode: itemRow } } },
        "[data-quest-drop='item']": locked ? null : {}
      };
      return entries[selector];
    },
    querySelectorAll(selector) {
      if (selector === "[data-actor-observer]") return actors;
      if (selector === "[data-accepted-actor]") return accepted;
      return items;
    }
  };
  return { root, giver, actors, accepted, items, lock: () => { locked = true; },
    lockAccepted: () => { acceptedLocked = true; } };
}

beforeEach(() => {
  vi.stubGlobal("game", { user: { isGM: true }, i18n: { localize: key => key } });
  vi.stubGlobal("fromUuid", vi.fn(async uuid => {
    const type = uuid.startsWith("Actor.") ? "Actor" : "Item";
    return { uuid, name: uuid, documentName: type };
  }));
});

describe("quest form drops", () => {
  it("REQ-048/050 moves Actors between participants and other roles without duplicates", async () => {
    const { root, giver, actors, accepted } = fixture();
    const actor = { type: "Actor", uuid: "Actor.a" };
    await applyQuestDrop(root, "observer", actor);
    await applyQuestDrop(root, "accepted", actor);
    await applyQuestDrop(root, "accepted", actor);
    expect(actors).toHaveLength(0);
    expect(accepted.map(row => row.input.value)).toEqual(["Actor.a"]);
    await applyQuestDrop(root, "giver", actor);
    expect(accepted).toHaveLength(0);
    expect(giver.value).toBe("Actor.a");
    await applyQuestDrop(root, "accepted", actor);
    expect(giver.value).toBe("");
    expect(accepted.map(row => row.input.value)).toEqual(["Actor.a"]);
    await applyQuestDrop(root, "observer", actor);
    expect(accepted).toHaveLength(0);
    expect(actors.map(row => row.input.value)).toEqual(["actor|Actor.a"]);
  });

  it("REQ-048/050 rejects invalid participant drops and non-GM changes", async () => {
    const { root, accepted } = fixture();
    await expect(applyQuestDrop(root, "accepted", { type: "Item", uuid: "Item.a" })).rejects.toThrow();
    fromUuid.mockResolvedValueOnce(null);
    await expect(applyQuestDrop(root, "accepted", { type: "Actor", uuid: "Actor.missing" })).rejects.toThrow();
    game.user.isGM = false;
    await expect(applyQuestDrop(root, "accepted", { type: "Actor", uuid: "Actor.a" })).rejects.toThrow();
    expect(accepted).toHaveLength(0);
  });

  it("REQ-049/050 rejects moves that would alter the locked participant list", async () => {
    const { root, giver, actors, accepted, lockAccepted } = fixture();
    const actor = { type: "Actor", uuid: "Actor.a" };
    await applyQuestDrop(root, "accepted", actor);
    lockAccepted();
    await expect(applyQuestDrop(root, "giver", actor)).rejects.toThrow();
    await expect(applyQuestDrop(root, "observer", actor)).rejects.toThrow();
    await expect(applyQuestDrop(root, "accepted", { type: "Actor", uuid: "Actor.b" })).rejects.toThrow();
    expect(accepted.map(row => row.input.value)).toEqual(["Actor.a"]);
    expect(giver.value).toBe("");
    expect(actors).toHaveLength(0);
  });

  it("replaces or clears a giver when moving Actors between giver and observers", async () => {
    const { root, giver, actors } = fixture();
    const a = { type: "Actor", uuid: "Actor.a" };
    const b = { type: "Actor", uuid: "Actor.b" };
    await applyQuestDrop(root, "observer", a);
    await applyQuestDrop(root, "observer", a);
    expect(actors).toHaveLength(1);
    await applyQuestDrop(root, "giver", a);
    expect(giver.value).toBe("Actor.a");
    expect(actors).toHaveLength(0);
    await applyQuestDrop(root, "giver", b);
    expect(giver.value).toBe("Actor.b");
    await applyQuestDrop(root, "observer", b);
    expect(giver.value).toBe("");
    expect(actors.map(row => row.input.value)).toEqual(["actor|Actor.b"]);
  });

  it("adds resolvable items, increments duplicates, and rejects locked rewards", async () => {
    const { root, items, lock } = fixture();
    const drop = { type: "Item", uuid: "Compendium.pack.Item.a" };
    await applyQuestDrop(root, "item", drop);
    await applyQuestDrop(root, "item", drop);
    expect(items).toHaveLength(1);
    expect(items[0].uuid.value).toBe(drop.uuid);
    expect(Number(items[0].quantity.value)).toBe(2);
    lock();
    await expect(applyQuestDrop(root, "item", drop)).rejects.toThrow();
    expect(Number(items[0].quantity.value)).toBe(2);
  });

  describe("REQ-020 related quest autocomplete", () => {
    const quests = [
      { uuid: "Quest.a", title: "Dragon Hunt" },
      { uuid: "Quest.b", title: "DRAGON Hunt" },
      { uuid: "Quest.c", title: "The Lost Crown" }
    ];

    it("REQ-020 matches title substrings case-insensitively and excludes selected quests", () => {
      expect(findRelatedQuests(quests, " dragon ", ["Quest.a"])).toEqual([quests[1]]);
      expect(findRelatedQuests(quests, "lost")).toEqual([quests[2]]);
      expect(findRelatedQuests(quests, "Quest.b")).toEqual([quests[1]]);
      expect(findRelatedQuests(quests, "   ")).toEqual([]);
      expect(findRelatedQuests(quests, "missing")).toEqual([]);
    });
  });

  it("rejects wrong types and unresolved documents without changing selections", async () => {
    const { root, giver, items } = fixture();
    await expect(applyQuestDrop(root, "giver", { type: "Item", uuid: "Item.a" })).rejects.toThrow();
    fromUuid.mockResolvedValueOnce(null);
    await expect(applyQuestDrop(root, "item", { type: "Item", uuid: "Item.missing" })).rejects.toThrow();
    fromUuid.mockRejectedValueOnce(new Error("Missing compendium"));
    await expect(applyQuestDrop(root, "item", { type: "Item", uuid: "Item.unavailable" })).rejects.toThrow();
    expect(giver.value).toBe("");
    expect(items).toHaveLength(0);
  });
});
