import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

let buildQuestContext, pageToQuest, questFromForm, saveQuestPage, QuestPageSheet, QuestManager, openQuestPage, openRelatedQuest, buildFactionQuestSection, cleanupQuestRelations;
let FactionManager;

beforeAll(async () => {
  const Base = class {};
  vi.stubGlobal("foundry", {
    applications: { sheets: { journal: { JournalEntryPageSheet: Base } }, api: {
      ApplicationV2: Base, DocumentSheetV2: Base, HandlebarsApplicationMixin: base => base, DialogV2: class {}
    } },
    data: { fields: {} },
    abstract: { TypeDataModel: Base },
    utils: { deepClone: structuredClone, escapeHTML: value => value }
  });
  ({ buildQuestContext, pageToQuest, questFromForm, saveQuestPage, QuestPageSheet, openRelatedQuest } = await import("../scripts/quest-sheet.mjs"));
  ({ QuestManager, openQuestPage, buildFactionQuestSection, cleanupQuestRelations } = await import("../scripts/quest-manager.mjs"));
  ({ FactionManager } = await import("../scripts/faction-manager.mjs"));
});

beforeEach(() => {
  vi.stubGlobal("game", {
    user: { isGM: false },
    actors: { contents: [] },
    journal: { contents: [] },
    i18n: { localize: key => key }
  });
  vi.stubGlobal("fromUuidSync", () => null);
});

function page(uuid, relatedQuestIds = []) {
  return {
    uuid,
    name: uuid,
    type: "amras-mad-inventions.quest",
    system: {
      icon: "icon.svg",
      description: "Description",
      giver: { actorUuid: "", factionUuid: "" },
      state: "offered",
      rewards: { xp: 0, items: [], currency: {} },
      consequence: "",
      observers: [],
      relatedQuestIds,
      rewardAudit: [],
      rewardsGranted: false,
      rewardsLocked: false,
      rewardRemainder: {}
    }
  };
}

function setupFolders() {
  const contents = [];
  game.folders = {
    contents,
    find: predicate => contents.find(predicate),
    get: id => contents.find(folder => folder.id === id)
  };
  const create = vi.fn(async data => {
    const folder = {
      ...data,
      id: `folder-${contents.length + 1}`,
      getFlag: (scope, key) => data.flags?.[scope]?.[key]
    };
    contents.push(folder);
    return folder;
  });
  const Folder = { implementation: { create } };
  vi.stubGlobal("Folder", Folder);
  foundry.documents = { ...foundry.documents, Folder };
  return contents;
}

describe("quest UI integration", () => {
  it("only exposes related quest links to players", () => {
    const current = page("quest-a", ["quest-b"]);
    const context = buildQuestContext(current, {
      relatedPages: [current, page("quest-b"), page("quest-c")]
    });
    expect(context.editable).toBe(false);
    expect(context.relatedQuests.map(q => q.uuid)).toEqual(["quest-b"]);
  });

  it("REQ-020 preserves selected and unresolved links and disambiguates duplicate quest names", () => {
    game.user.isGM = true;
    const current = page("quest-a", ["quest-b", "missing"]);
    const first = { ...page("quest-b"), name: "Dragon" };
    const second = { ...page("quest-c"), name: "Dragon" };
    const { relatedQuests } = buildQuestContext(current, { relatedPages: [current, first, second] });
    expect(relatedQuests).toEqual([
      expect.objectContaining({ uuid: "quest-b", linked: true, displayTitle: "Dragon (quest-b)" }),
      expect.objectContaining({ uuid: "quest-c", linked: false, displayTitle: "Dragon (quest-c)" }),
      expect.objectContaining({ uuid: "missing", linked: true, missing: true })
    ]);
  });

  it("REQ-020 saves added and removed relationships reciprocally without changing states", async () => {
    game.user.isGM = true;
    game.users = { contents: [] };
    vi.stubGlobal("CONST", { DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0, OBSERVER: 2, OWNER: 3 } });
    const first = page("quest-a");
    const second = page("quest-b");
    second.system.state = "accepted";
    for (const questPage of [first, second]) {
      questPage.parent = {
        name: questPage.name,
        pages: { size: 1, contents: [questPage] },
        ownership: { default: 0 },
        getFlag: () => ({ users: [], original: {} }),
        update: vi.fn()
      };
      questPage.update = vi.fn(async changes => {
        for (const [key, value] of Object.entries(changes)) {
          if (key === "name") questPage.name = value;
          else if (key.startsWith("system.")) {
            const parts = key.split(".").slice(1);
            let target = questPage.system;
            while (parts.length > 1) target = target[parts.shift()];
            target[parts[0]] = structuredClone(value);
          }
        }
      });
    }
    game.journal.contents = [first.parent, second.parent];
    const definition = pageToQuest(first);
    definition.relatedQuestIds = [second.uuid];
    expect(await saveQuestPage(first, definition)).toBe(true);
    expect(first.system.relatedQuestIds).toEqual([second.uuid]);
    expect(second.system.relatedQuestIds).toEqual([first.uuid]);
    definition.relatedQuestIds = [];
    expect(await saveQuestPage(first, definition)).toBe(true);
    expect(first.system.relatedQuestIds).toEqual([]);
    expect(second.system.relatedQuestIds).toEqual([]);
    expect([first.system.state, second.system.state]).toEqual(["offered", "accepted"]);
  });

  it("REQ-043 opens a related quest only when the viewer has access", () => {
    vi.stubGlobal("CONST", { DOCUMENT_OWNERSHIP_LEVELS: { OBSERVER: 2 } });
    const related = page("quest-b");
    related.sheet = { render: vi.fn() };
    related.testUserPermission = vi.fn(() => false);
    vi.stubGlobal("fromUuidSync", uuid => uuid === related.uuid ? related : null);
    expect(openQuestPage(related.uuid)).toBe(false);
    expect(related.sheet.render).not.toHaveBeenCalled();
    related.testUserPermission.mockReturnValue(true);
    expect(openQuestPage(related.uuid)).toBe(true);
    expect(related.sheet.render).toHaveBeenCalledWith({ force: true });
    expect(openQuestPage("missing")).toBe(false);
  });

  it("REQ-048 preserves accepted Actor UUIDs in quest forms and defaults legacy pages to an empty list", () => {
    game.user.isGM = true;
    const values = {
      title: "Quest", description: "Description", icon: "", giverActorUuid: "Actor.giver",
      giverFactionUuid: "", state: "offered", xp: "0", consequence: ""
    };
    const root = {
      querySelector: selector => {
        const key = selector.match(/name='([^']+)'/)?.[1];
        return key in values ? { value: values[key] } : null;
      },
      querySelectorAll: selector => selector === "[name='acceptedActorUuids']"
        ? [{ value: "Actor.first" }, { value: "Actor.second" }] : []
    };
    const legacy = page("quest-a");
    expect(pageToQuest(legacy).acceptedActorUuids).toEqual([]);
    expect(questFromForm(root).acceptedActorUuids).toEqual(["Actor.first", "Actor.second"]);
    legacy.system.acceptedActorUuids = ["Actor.first", "Actor.missing"];
    expect(pageToQuest(legacy).acceptedActorUuids).toEqual(["Actor.first", "Actor.missing"]);
  });

  it("REQ-049 rejects participant changes while the saved state is completed, even when reopening", async () => {
    game.user.isGM = true;
    vi.stubGlobal("ui", { notifications: { warn: vi.fn() } });
    vi.stubGlobal("CONST", { DOCUMENT_OWNERSHIP_LEVELS: { OBSERVER: 2, OWNER: 3 } });
    game.users = { contents: [] };
    const completed = page("quest-completed");
    completed.system.state = "completed";
    completed.system.acceptedActorUuids = ["Actor.first"];
    completed.update = vi.fn();
    completed.parent = {
      name: completed.name, ownership: { default: 0 },
      pages: { size: 1, contents: [completed] },
      getFlag: () => ({ users: [], original: {} }),
      update: vi.fn()
    };
    game.journal.contents = [completed.parent];
    const changed = {
      ...pageToQuest(completed),
      state: "in-progress",
      acceptedActorUuids: ["Actor.second"]
    };
    expect(await saveQuestPage(completed, changed)).toBe(false);
    expect(completed.update).not.toHaveBeenCalled();
    expect(ui.notifications.warn).toHaveBeenCalled();
  });

  it("REQ-048/049 preserves participants until the reopened state is saved", async () => {
    game.user.isGM = true;
    game.users = { contents: [] };
    vi.stubGlobal("CONST", { DOCUMENT_OWNERSHIP_LEVELS: { OBSERVER: 2, OWNER: 3 } });
    vi.stubGlobal("ui", { notifications: { warn: vi.fn() } });
    const current = page("quest-a");
    current.system.state = "completed";
    current.system.acceptedActorUuids = ["Actor.first"];
    current.parent = {
      name: current.name, ownership: { default: 0 },
      pages: { size: 1, contents: [current] },
      getFlag: () => ({ users: [], original: {} }),
      update: vi.fn()
    };
    current.update = vi.fn(async changes => {
      for (const [path, value] of Object.entries(changes)) {
        if (path === "name") current.name = value;
        else if (path.startsWith("system.")) {
          const parts = path.split(".").slice(1);
          let target = current.system;
          while (parts.length > 1) target = target[parts.shift()];
          target[parts[0]] = structuredClone(value);
        }
      }
    });
    game.journal.contents = [current.parent];
    expect(buildQuestContext(current, { relatedPages: [] }).acceptedEditable).toBe(false);
    const reopened = { ...pageToQuest(current), state: "in-progress" };
    expect(await saveQuestPage(current, reopened)).toBe(true);
    expect(current.system.acceptedActorUuids).toEqual(["Actor.first"]);
    expect(buildQuestContext(current, { relatedPages: [] }).acceptedEditable).toBe(true);
    const updated = { ...pageToQuest(current), acceptedActorUuids: ["Actor.second"] };
    expect(await saveQuestPage(current, updated)).toBe(true);
    expect(pageToQuest(current).acceptedActorUuids).toEqual(["Actor.second"]);
    game.user.isGM = false;
    const player = buildQuestContext(current, { relatedPages: [] });
    expect(player.acceptedEditable).toBe(false);
    expect(player.quest.acceptedActors).toEqual([{ uuid: "Actor.second", name: "Actor.second" }]);
  });

  it("REQ-051 saves participants on confirmed completion", async () => {
    game.user.isGM = true;
    game.users = { contents: [] };
    game.system = { id: "unsupported" };
    game.i18n.format = key => key;
    vi.stubGlobal("CONST", { DOCUMENT_OWNERSHIP_LEVELS: { OBSERVER: 2, OWNER: 3 } });
    vi.stubGlobal("ui", { notifications: { warn: vi.fn(), error: vi.fn() } });
    foundry.applications.api.DialogV2.prompt = vi.fn().mockResolvedValue({ xp: [], items: [], currency: [] });
    const current = page("quest-a");
    current.system.acceptedActorUuids = [];
    current.parent = {
      name: current.name, ownership: { default: 0 },
      pages: { size: 1, contents: [current] },
      getFlag: () => ({ users: [], original: {} }),
      update: vi.fn()
    };
    current.update = vi.fn(async changes => {
      for (const [path, value] of Object.entries(changes)) {
        if (path === "name") current.name = value;
        else if (path.startsWith("system.")) {
          const parts = path.split(".").slice(1);
          let target = current.system;
          while (parts.length > 1) target = target[parts.shift()];
          target[parts[0]] = structuredClone(value);
        }
      }
    });
    game.journal.contents = [current.parent];
    const changed = { ...pageToQuest(current), state: "completed", acceptedActorUuids: ["Actor.a"] };
    expect(await saveQuestPage(current, changed)).toBe(true);
    expect(current.system.state).toBe("completed");
    expect(current.system.acceptedActorUuids).toEqual(["Actor.a"]);
  });

  it("REQ-051 discards form edits after completion is cancelled in either quest form", async () => {
    game.user.isGM = true;
    game.i18n.format = key => key;
    foundry.applications.api.DialogV2.prompt = vi.fn().mockResolvedValue(null);
    const current = page("quest-a");
    current.system.giver.actorUuid = "Actor.giver";
    current.system.acceptedActorUuids = [];
    current.update = vi.fn();
    const values = {
      title: "Unsaved", description: "Description", icon: "", giverActorUuid: "Actor.giver",
      giverFactionUuid: "", state: "completed", xp: "0", consequence: ""
    };
    const root = {
      querySelector: selector => {
        const key = selector.match(/name='([^']+)'/)?.[1];
        return key in values ? { value: values[key] } : null;
      },
      querySelectorAll: selector => selector === "[name='acceptedActorUuids']"
        ? [{ value: "Actor.a" }] : []
    };
    for (const [action, app] of [
      [QuestManager.DEFAULT_OPTIONS.actions.saveQuest, { questPage: current, element: root, render: vi.fn() }],
      [QuestPageSheet.DEFAULT_OPTIONS.actions.saveQuest, { document: current, element: root, render: vi.fn() }]
    ]) {
      await action.call(app);
      expect(app.render).toHaveBeenCalledOnce();
    }
    expect(current.update).not.toHaveBeenCalled();
  });

  it("REQ-052 preselects accepted Actors for XP and currency but not item quantities", async () => {
    game.user.isGM = true;
    game.actors.contents = [
      { uuid: "Actor.accepted", name: "Accepted" },
      { uuid: "Actor.other", name: "Other" }
    ];
    game.i18n.format = key => key;
    vi.stubGlobal("fromUuidSync", () => null);
    const prompt = vi.fn().mockResolvedValue(null);
    foundry.applications.api.DialogV2.prompt = prompt;
    const offered = page("quest-a");
    offered.system.acceptedActorUuids = ["Actor.accepted"];
    offered.system.rewards = {
      xp: 10, currency: { gp: 5 }, items: [{ itemUuid: "Item.reward", quantity: 2 }]
    };
    offered.update = vi.fn();
    const changed = { ...pageToQuest(offered), state: "completed" };
    expect(await saveQuestPage(offered, changed)).toBe(false);
    const html = prompt.mock.calls[0][0].content;
    const inputs = [...html.matchAll(/<input\b[^>]*>/g)].map(match => match[0]);
    for (const group of ["xp", "currency"]) {
      const accepted = inputs.find(input => input.includes(`data-assignment-group="${group}"`)
        && input.includes('data-actor-uuid="Actor.accepted"'));
      const other = inputs.find(input => input.includes(`data-assignment-group="${group}"`)
        && input.includes('data-actor-uuid="Actor.other"'));
      expect(accepted).toMatch(/\bchecked(?:\s|=|>)/);
      expect(other).not.toMatch(/\bchecked(?:\s|=|>)/);
    }
    const items = inputs.filter(input => input.includes("data-item-index="));
    expect(items).toHaveLength(2);
    for (const item of items) expect(item).toContain('value="0"');
    expect(offered.update).not.toHaveBeenCalled();
  });

  it("REQ-043 notifies when a related quest is unavailable or inaccessible", () => {
    vi.stubGlobal("CONST", { DOCUMENT_OWNERSHIP_LEVELS: { OBSERVER: 2 } });
    vi.stubGlobal("ui", { notifications: { warn: vi.fn() } });
    const related = page("quest-b");
    related.testUserPermission = () => false;
    related.sheet = { render: vi.fn() };
    vi.stubGlobal("fromUuidSync", uuid => uuid === related.uuid ? related : null);
    expect(openRelatedQuest("missing")).toBe(false);
    expect(openRelatedQuest(related.uuid)).toBe(false);
    expect(ui.notifications.warn).toHaveBeenCalledTimes(2);
    game.user.isGM = true;
    expect(openRelatedQuest(related.uuid)).toBe(true);
    expect(related.sheet.render).toHaveBeenCalledWith({ force: true });
    related.sheet.rendered = true;
    related.sheet.bringToFront = vi.fn();
    expect(openRelatedQuest(related.uuid)).toBe(true);
    expect(related.sheet.bringToFront).toHaveBeenCalledOnce();
    expect(related.sheet.render).toHaveBeenCalledOnce();
  });

  it("REQ-044 creates faction journals in a folder", async () => {
    game.user.isGM = true;
    const folders = setupFolders();
    foundry.applications.api.DialogV2.prompt = vi.fn().mockResolvedValue("Faction");
    const create = vi.fn().mockResolvedValue({ pages: { contents: [{ uuid: "Faction.page" }] } });
    foundry.documents.JournalEntry = { implementation: { create } };
    const manager = { selectedUuid: null, render: vi.fn() };
    await FactionManager.DEFAULT_OPTIONS.actions.createFaction.call(manager);
    expect(create).toHaveBeenCalledOnce();
    const folder = folders.find(entry => entry.type === "JournalEntry" && entry.name === "Factions");
    expect(folder).toBeDefined();
    expect(create.mock.calls[0][0].folder).toBe(folder.id);
  });

  it("REQ-044 creates quest journals in a folder", async () => {
    game.user.isGM = true;
    const folders = setupFolders();
    game.users = { contents: [] };
    vi.stubGlobal("CONST", { DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0, OBSERVER: 2, OWNER: 3 } });
    vi.stubGlobal("ui", { notifications: { warn: vi.fn(), error: vi.fn() } });
    const create = vi.fn(async data => {
      const journal = {
        name: data.name,
        ownership: data.ownership,
        getFlag: () => ({ users: [], original: {} }),
        update: vi.fn()
      };
      const questPage = {
        uuid: "quest-created", name: data.name, type: data.pages[0].type,
        system: structuredClone(data.pages[0].system), parent: journal,
        update: vi.fn()
      };
      journal.pages = { size: 1, contents: [questPage] };
      game.journal.contents.push(journal);
      return journal;
    });
    foundry.documents.JournalEntry = { implementation: { create } };
    const values = {
      title: "Quest", description: "Description", icon: "", giverActorUuid: "Actor.giver",
      giverFactionUuid: "", state: "offered", xp: "0", consequence: ""
    };
    const manager = {
      questPage: null, creating: true, newQuestDefaults: {},
      element: {
        querySelector: selector => {
          const key = selector.match(/name='([^']+)'/)?.[1];
          return key in values ? { value: values[key] } : null;
        },
        querySelectorAll: () => []
      },
      render: vi.fn()
    };
    await QuestManager.DEFAULT_OPTIONS.actions.saveQuest.call(manager);
    expect(create).toHaveBeenCalledOnce();
    const folder = folders.find(entry => entry.type === "JournalEntry" && entry.name === "Quests");
    expect(folder).toBeDefined();
    expect(create.mock.calls[0][0].folder).toBe(folder.id);
  });

  it("REQ-042 provides all D&D currency controls without dropping existing other denominations", () => {
    game.user.isGM = true;
    game.system = { id: "dnd5e" };
    const current = page("quest-a");
    current.system.rewards.currency = { gp: 7, custom: 3 };
    const { quest } = buildQuestContext(current, { relatedPages: [] });
    expect(quest.currencyEntries).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "pp" }),
      expect.objectContaining({ key: "gp", amount: 7 }),
      expect.objectContaining({ key: "ep" }),
      expect.objectContaining({ key: "sp" }),
      expect.objectContaining({ key: "cp" }),
      expect.objectContaining({ key: "custom", amount: 3 })
    ]));
  });

  it("REQ-042 keeps non-D&D currency entries editable without imposing D&D denominations", () => {
    game.user.isGM = true;
    game.system = { id: "shadowdark" };
    const current = page("quest-a");
    current.system.rewards.currency = { gp: 7, custom: 3 };
    const { quest } = buildQuestContext(current, { relatedPages: [] });
    expect(quest.currencyEntries).toEqual([{ key: "gp", amount: 7 }, { key: "custom", amount: 3 }]);
  });

  it("REQ-037 separates saved actor and faction observers in the quest form", () => {
    const current = page("quest-a");
    current.system.observers = [
      { type: "actor", uuid: "Actor.a" },
      { type: "faction", uuid: "JournalEntry.f.Page.f" }
    ];
    const { quest } = buildQuestContext(current, { relatedPages: [] });
    expect(quest.observers.map(o => [o.uuid, o.isActor, o.isFaction])).toEqual([
      ["Actor.a", true, false], ["JournalEntry.f.Page.f", false, true]
    ]);
    expect(quest.observers[1].options).toContainEqual({
      value: "faction|JournalEntry.f.Page.f", label: "JournalEntry.f.Page.f", selected: true
    });
  });

  it("REQ-020/037/042 preserves related links, currencies, and observers when saving", () => {
    game.user.isGM = true;
    const relatedInputs = [{ value: "quest-b" }, { value: "quest-c" }];
    const values = {
      title: "Test", description: "A quest", icon: "", giverActorUuid: "Actor.giver",
      giverFactionUuid: "", state: "offered", xp: "0", consequence: ""
    };
    const row = entries => ({
      querySelector: selector => {
        const key = selector.match(/name='([^']+)'/)?.[1];
        return key in entries ? { value: entries[key] } : null;
      }
    });
    const root = {
      querySelector: selector => {
        const key = selector.match(/name='([^']+)'/)?.[1];
        return key in values ? { value: values[key] } : null;
      },
      querySelectorAll: selector => ({
        "[data-item-row]": [row({ itemUuid: "Item.a", itemQuantity: "2" })],
        "[data-currency-row]": [
          row({ currencyKey: "pp", currencyAmount: "0" }),
          row({ currencyKey: "gp", currencyAmount: "7" }),
          row({ currencyKey: "custom", currencyAmount: "3" })
        ],
        "[data-observer-row]": [
          row({ observer: "actor|Actor.observer" }),
          row({ observer: "faction|JournalEntry.f.Page.f" })
        ],
        "[name='relatedQuestIds']": relatedInputs
      }[selector] ?? [])
    };
    const quest = questFromForm(root);
    expect(quest.rewards).toEqual({
      xp: 0, items: [{ itemUuid: "Item.a", quantity: 2 }],
      currency: { pp: 0, gp: 7, custom: 3 }
    });
    expect(quest.observers).toEqual([
      { type: "actor", uuid: "Actor.observer" },
      { type: "faction", uuid: "JournalEntry.f.Page.f" }
    ]);
    expect(quest.relatedQuestIds).toEqual(["quest-b", "quest-c"]);
    relatedInputs.shift();
    const updated = questFromForm(root, { page: page("quest-a", ["quest-b"]) });
    expect(updated.relatedQuestIds).toEqual(["quest-c"]);
    expect(updated.id).toBe("quest-a");
  });

  it("registers editing actions on both the manager and quest sheet", () => {
    for (const action of ["pickQuestIcon", "saveQuest", "addItemRow", "removeItemRow",
      "addCurrencyRow", "removeCurrencyRow", "addObserverRow", "removeObserverRow"]) {
      expect(QuestPageSheet.DEFAULT_OPTIONS.actions[action]).toBeTypeOf("function");
      expect(QuestManager.DEFAULT_OPTIONS.actions[action]).toBeTypeOf("function");
    }
  });

  it("shows GM-only faction quest creation controls", () => {
    expect(buildFactionQuestSection(null).canCreateQuest).toBe(false);
    game.user.isGM = true;
    expect(buildFactionQuestSection(null).canCreateQuest).toBe(true);
  });

  it("cleans up deleted quest references without altering unrelated links", async () => {
    game.user.isGM = true;
    const survivor = page("quest-b", ["quest-a", "quest-c"]);
    survivor.update = vi.fn().mockResolvedValue(undefined);
    game.journal.contents = [{ pages: { contents: [survivor] } }];
    await cleanupQuestRelations(["quest-a"]);
    expect(survivor.update).toHaveBeenCalledWith({ "system.relatedQuestIds": ["quest-c"] });
  });
});
