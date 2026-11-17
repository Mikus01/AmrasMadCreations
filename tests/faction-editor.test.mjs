import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

let buildFactionContext, factionUpdate, pageToFaction;
beforeAll(async () => {
  const Base = class {};
  vi.stubGlobal("foundry", {
    applications: { sheets: { journal: { JournalEntryPageSheet: Base } }, api: {
      ApplicationV2: Base, DocumentSheetV2: Base, HandlebarsApplicationMixin: base => base, DialogV2: class {}
    } },
    data: { fields: {} },
    abstract: { TypeDataModel: Base }
  });
  ({ buildFactionContext, factionUpdate, pageToFaction } = await import("../scripts/faction-editor.mjs"));
});

afterEach(() => vi.unstubAllGlobals());

describe("faction organization integration", () => {
  it("renders organizational members separately from tracked renown actors", () => {
    vi.stubGlobal("game", {
      user: { isGM: false },
      i18n: { localize: key => key },
      users: new Map(),
      journal: { contents: [] }
    });
    vi.stubGlobal("fromUuidSync", uuid => ({ name: uuid, img: "actor.webp" }));
    const page = {
      name: "Faction",
      system: {
        img: "faction.webp",
        description: "",
        leadership: [{ actorUuid: "Actor.oldLeader", rank: "leader" }],
        roles: [{ id: "captain", name: "Captain" }],
        organizationalMembers: [{ actorUuid: "Actor.member", roleId: "captain" }],
        members: [{ actorUuid: "Actor.tracked", points: 15 }],
        goals: [],
        history: []
      }
    };
    const context = buildFactionContext(page);
    expect(context.editable).toBe(false);
    expect(context.faction.roles[0].members.map(m => m.uuid)).toEqual(["Actor.member"]);
    expect(context.faction.members.map(m => m.uuid)).toEqual(["Actor.tracked"]);
    expect(pageToFaction(page).leadership).toEqual([{ actorUuid: "Actor.oldLeader", rank: "leader" }]);
  });

  it("only updates changed fields, so organizational edits do not overwrite renown", () => {
    const previous = {
      leadership: [], roles: [], organizationalMembers: [], goals: [],
      members: [{ actorUuid: "Actor.a", points: 15 }], history: []
    };
    const next = { ...previous, roles: [{ id: "leader", name: "Leader" }] };
    expect(factionUpdate(previous, next)).toEqual({ "system.roles": next.roles });
    const renown = { ...previous, members: [{ actorUuid: "Actor.a", points: 20 }] };
    expect(factionUpdate(previous, renown)).toEqual({ "system.members": renown.members });
  });
});
