import { describe, it, expect } from "vitest";
import {
  DEFAULT_FACTION_IMG, createFaction, setLeader, addGoal, toggleGoal, removeGoal,
  addMember, removeMember, setRenown
} from "../scripts/faction.mjs";

const base = () => createFaction({ name: "Gearwrights" });
const meta = { reason: "Helped", user: "u1", timestamp: 1000 };

describe("REQ-001/002/003 creation", () => {
  it("REQ-001 creates all fields with defaults", () => {
    const f = createFaction({ name: "Gearwrights", img: "a.png", description: "Tinkers" });
    expect(f).toMatchObject({ name: "Gearwrights", img: "a.png", description: "Tinkers" });
    expect(f.leadership).toEqual([]);
    expect(f.goals).toEqual([]);
    expect(f.members).toEqual([]);
    expect(f.history).toEqual([]);
    expect(base().description).toBe("");
  });
  it("REQ-002 requires a name and trims it", () => {
    expect(() => createFaction({ name: "" })).toThrow();
    expect(() => createFaction({ name: "   " })).toThrow();
    expect(() => createFaction({})).toThrow();
    expect(createFaction({ name: "  X  " }).name).toBe("X");
  });
  it("REQ-003 falls back to default logo", () => {
    expect(base().img).toBe(DEFAULT_FACTION_IMG);
    expect(createFaction({ name: "X", img: "  " }).img).toBe(DEFAULT_FACTION_IMG);
  });
});

describe("REQ-004 leader", () => {
  it("REQ-004 sets and replaces the leader", () => {
    let f = setLeader(base(), "Actor.a");
    expect(f.leadership).toEqual([{ actorUuid: "Actor.a", rank: "leader" }]);
    f = setLeader(f, "Actor.b");
    expect(f.leadership).toEqual([{ actorUuid: "Actor.b", rank: "leader" }]);
  });
  it("REQ-004 null clears leader and preserves other ranks", () => {
    let f = { ...base(), leadership: [{ actorUuid: "Actor.c", rank: "lieutenant" }] };
    f = setLeader(f, "Actor.a");
    expect(f.leadership).toHaveLength(2);
    f = setLeader(f, null);
    expect(f.leadership).toEqual([{ actorUuid: "Actor.c", rank: "lieutenant" }]);
  });
});

describe("REQ-005/006 goals", () => {
  it("REQ-005 adds goals with unique ids", () => {
    let f = addGoal(base(), { title: "Build", description: "A tower" });
    f = addGoal(f, { title: "Defend" });
    expect(f.goals).toHaveLength(2);
    expect(f.goals[0]).toMatchObject({ title: "Build", description: "A tower", completed: false });
    expect(f.goals[0].id).not.toBe(f.goals[1].id);
    expect(f.goals[1].description).toBe("");
  });
  it("REQ-005 rejects blank titles", () => {
    expect(() => addGoal(base(), { title: " " })).toThrow();
  });
  it("REQ-006 toggles and removes goals", () => {
    let f = addGoal(base(), { title: "Build" });
    const id = f.goals[0].id;
    f = toggleGoal(f, id);
    expect(f.goals[0].completed).toBe(true);
    f = toggleGoal(f, id);
    expect(f.goals[0].completed).toBe(false);
    f = removeGoal(f, id);
    expect(f.goals).toEqual([]);
  });
  it("REQ-006 throws on unknown goal id", () => {
    expect(() => toggleGoal(base(), "nope")).toThrow();
    expect(() => removeGoal(base(), "nope")).toThrow();
  });
});

describe("REQ-007 members", () => {
  it("REQ-007 adds with 0 points, ignores duplicates, removes", () => {
    let f = addMember(base(), "Actor.a");
    expect(f.members).toEqual([{ actorUuid: "Actor.a", points: 0 }]);
    f = addMember(f, "Actor.a");
    expect(f.members).toHaveLength(1);
    f = removeMember(f, "Actor.a");
    expect(f.members).toEqual([]);
  });
});

describe("REQ-009/010/011/012 renown changes", () => {
  it("REQ-010 logs the change", () => {
    const f = addMember(base(), "Actor.a");
    const { faction } = setRenown(f, "Actor.a", 15, meta);
    expect(faction.members[0].points).toBe(15);
    expect(faction.history).toEqual([
      { actorUuid: "Actor.a", from: 0, to: 15, reason: "Helped", user: "u1", timestamp: 1000 }
    ]);
  });
  it("REQ-009 setRenown clamps", () => {
    const f = addMember(base(), "Actor.a");
    expect(setRenown(f, "Actor.a", 999, meta).faction.members[0].points).toBe(100);
    expect(setRenown(f, "Actor.a", -999, meta).faction.members[0].points).toBe(-100);
  });
  it("REQ-011 reports level change only when level changes", () => {
    const f = addMember(base(), "Actor.a");
    expect(setRenown(f, "Actor.a", 15, meta).levelChange).toEqual({ from: "neutral", to: "liked" });
    expect(setRenown(f, "Actor.a", 5, meta).levelChange).toBeNull();
  });
  it("REQ-012 rejects non-members", () => {
    expect(() => setRenown(base(), "Actor.x", 5, meta)).toThrow();
  });
});

describe("REQ-014 purity", () => {
  it("REQ-014 does not mutate inputs", () => {
    const f = addMember(addGoal(base(), { title: "G" }), "Actor.a");
    const snap = structuredClone(f);
    setLeader(f, "Actor.a");
    toggleGoal(f, f.goals[0].id);
    removeGoal(f, f.goals[0].id);
    addMember(f, "Actor.b");
    removeMember(f, "Actor.a");
    setRenown(f, "Actor.a", 50, meta);
    expect(f).toEqual(snap);
  });
});
