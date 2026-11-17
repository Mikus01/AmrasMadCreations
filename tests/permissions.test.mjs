import { describe, it, expect } from "vitest";
import { canEdit, canView } from "../scripts/permissions.mjs";
import { createFaction, addMember } from "../scripts/faction.mjs";

const faction = addMember(createFaction({ name: "F" }), "Actor.a");

describe("REQ-013 permissions", () => {
  it("REQ-013 only GMs can edit", () => {
    expect(canEdit({ isGM: true })).toBe(true);
    expect(canEdit({ isGM: false })).toBe(false);
  });
  it("REQ-013 GMs can view everything", () => {
    expect(canView({ isGM: true, ownedActorUuids: [] }, faction)).toBe(true);
  });
  it("REQ-013 players view only if they own a tracked actor", () => {
    expect(canView({ isGM: false, ownedActorUuids: ["Actor.a"] }, faction)).toBe(true);
    expect(canView({ isGM: false, ownedActorUuids: ["Actor.z"] }, faction)).toBe(false);
    expect(canView({ isGM: false, ownedActorUuids: [] }, faction)).toBe(false);
  });
});
