import { beforeAll, describe, expect, it } from "vitest";
import { canView } from "../scripts/permissions.mjs";
import { setRenown } from "../scripts/faction.mjs";

let organization;
beforeAll(async () => {
  organization = await import("../scripts/faction-organization.mjs");
});

const gm = { isGM: true };
const player = { isGM: false };
const empty = () => ({ roles: [], organizationalMembers: [], members: [], history: [] });
const withRoles = () => organization.addRole(
  organization.addRole(empty(), { id: "leader", name: "Leader" }, gm),
  { id: "captain", name: "Captain" },
  gm
);

describe("REQ-030/031/032 faction organization", () => {
  it("REQ-030 creates, renames, and reorders roles without parents", () => {
    let faction = withRoles();
    faction = organization.renameRole(faction, "captain", "Commander", gm);
    faction = organization.moveRole(faction, "captain", 0, gm);
    expect(faction.roles.map(r => r.name)).toEqual(["Commander", "Leader"]);
    expect(faction.roles.every(r => !("parentId" in r))).toBe(true);
  });

  it("REQ-031 reassigns instead of duplicating a member and removes membership", () => {
    let faction = organization.assignMember(withRoles(), "Actor.a", "leader", gm);
    faction = organization.assignMember(faction, "Actor.a", "captain", gm);
    expect(faction.organizationalMembers).toEqual([{ actorUuid: "Actor.a", roleId: "captain" }]);
    faction = organization.removeMember(faction, "Actor.a", gm);
    expect(faction.organizationalMembers).toEqual([]);
  });

  it("REQ-031 permits independent assignments in different factions", () => {
    const first = organization.assignMember(withRoles(), "Actor.a", "leader", gm);
    const second = organization.assignMember(withRoles(), "Actor.a", "captain", gm);
    expect(first.organizationalMembers[0].roleId).toBe("leader");
    expect(second.organizationalMembers[0].roleId).toBe("captain");
  });

  it("REQ-031 rejects assignment to a nonexistent role", () => {
    expect(() => organization.assignMember(withRoles(), "Actor.a", "missing", gm)).toThrow();
  });

  it("REQ-032 moves roles with their members and reassigns member drops", () => {
    let faction = organization.assignMember(withRoles(), "Actor.a", "leader", gm);
    faction = organization.moveRole(faction, "leader", 1, gm);
    expect(faction.roles.map(r => r.id)).toEqual(["captain", "leader"]);
    expect(faction.organizationalMembers[0].roleId).toBe("leader");
    faction = organization.moveMember(faction, "Actor.a", "captain", gm);
    expect(faction.organizationalMembers[0].roleId).toBe("captain");
    expect(organization.moveMember(faction, "Actor.a", "captain", gm)).toEqual(faction);
  });
});

describe("REQ-033/034/035 safety and permissions", () => {
  it("REQ-033 reassigns all members before deleting a populated role", () => {
    let faction = organization.assignMember(withRoles(), "Actor.a", "leader", gm);
    faction = organization.assignMember(faction, "Actor.b", "leader", gm);
    expect(() => organization.deleteRole(faction, "leader", null, gm)).toThrow();
    faction = organization.deleteRole(faction, "leader", "captain", gm);
    expect(faction.roles.map(r => r.id)).toEqual(["captain"]);
    expect(faction.organizationalMembers).toEqual([
      { actorUuid: "Actor.a", roleId: "captain" },
      { actorUuid: "Actor.b", roleId: "captain" }
    ]);
  });

  it("REQ-033 blocks deleting a populated last role", () => {
    let faction = organization.addRole(empty(), { id: "only", name: "Only" }, gm);
    faction = organization.assignMember(faction, "Actor.a", "only", gm);
    expect(() => organization.deleteRole(faction, "only", null, gm)).toThrow();
  });

  it("REQ-033 rejects an invalid or deleted role as the reassignment target", () => {
    const faction = organization.assignMember(withRoles(), "Actor.a", "leader", gm);
    expect(() => organization.deleteRole(faction, "leader", "leader", gm)).toThrow();
    expect(() => organization.deleteRole(faction, "leader", "missing", gm)).toThrow();
    expect(faction.organizationalMembers).toEqual([{ actorUuid: "Actor.a", roleId: "leader" }]);
  });

  it("REQ-034 does not alter renown or history when membership changes", () => {
    const faction = {
      ...withRoles(),
      members: [{ actorUuid: "Actor.a", points: 15 }],
      history: [{ actorUuid: "Actor.a", from: 0, to: 15 }]
    };
    const snapshot = structuredClone(faction);
    let next = organization.assignMember(faction, "Actor.a", "leader", gm);
    next = organization.assignMember(next, "Actor.a", "captain", gm);
    next = organization.removeMember(next, "Actor.a", gm);
    expect(next.members).toEqual(snapshot.members);
    expect(next.history).toEqual(snapshot.history);
    expect(faction).toEqual(snapshot);
  });

  it("REQ-034 renown changes do not alter organizational membership", () => {
    let faction = organization.assignMember(withRoles(), "Actor.a", "leader", gm);
    faction = { ...faction, members: [{ actorUuid: "Actor.a", points: 0 }] };
    const updated = setRenown(faction, "Actor.a", 15, { timestamp: 1000 }).faction;
    expect(updated.organizationalMembers).toEqual([{ actorUuid: "Actor.a", roleId: "leader" }]);
  });

  it("REQ-035 rejects player role and member management", () => {
    const faction = withRoles();
    expect(() => organization.addRole(faction, { id: "x", name: "X" }, player)).toThrow();
    expect(() => organization.assignMember(faction, "Actor.a", "leader", player)).toThrow();
    expect(() => organization.deleteRole(faction, "leader", null, player)).toThrow();
  });

  it("REQ-035 organizational membership alone does not grant faction visibility", () => {
    const faction = organization.assignMember(withRoles(), "Actor.a", "leader", gm);
    expect(canView({ isGM: false, ownedActorUuids: ["Actor.a"] }, faction)).toBe(false);
    expect(canView({ isGM: false, ownedActorUuids: ["Actor.a"] }, {
      ...faction, members: [{ actorUuid: "Actor.a", points: 0 }]
    })).toBe(true);
  });
});
