import { beforeEach, describe, expect, it, vi } from "vitest";
import { getJournalFolder, organizeJournals } from "../scripts/journal-organization.mjs";

const moduleId = "amras-mad-inventions";
const factionType = `${moduleId}.faction`;
const questType = `${moduleId}.quest`;

function world() {
  const folders = [];
  const journals = [];
  let nextJournal = 0;
  const folderCreate = vi.fn(async data => {
    const folder = {
      ...structuredClone(data),
      id: data._id,
      getFlag: (scope, key) => data.flags?.[scope]?.[key]
    };
    folders.push(folder);
    return folder;
  });
  const makeJournal = data => {
    const id = data._id ?? `new-${++nextJournal}`;
    const journal = {
      id, uuid: `JournalEntry.${id}`, name: data.name,
      flags: structuredClone(data.flags ?? {}),
      ownership: structuredClone(data.ownership ?? { default: 0 }),
      folder: folders.find(folder => folder.id === data.folder) ?? null,
      getFlag(scope, key) { return this.flags[scope]?.[key]; },
      toObject() {
        return {
          _id: this.id, name: this.name, flags: structuredClone(this.flags),
          ownership: structuredClone(this.ownership),
          pages: this.pages.contents.map(page => page.toObject())
        };
      },
      async update(changes) {
        if (changes.folder) this.folder = folders.find(folder => folder.id === changes.folder);
      },
      async delete(options) {
        this.deleteOptions = options;
        journals.splice(journals.indexOf(this), 1);
      },
      async deleteEmbeddedDocuments(type, ids, options) {
        this.deleteOptions = options;
        this.pages.contents = this.pages.contents.filter(page => !ids.includes(page.id));
      }
    };
    const pages = data.pages.map((item, index) => {
      const page = {
        id: item._id ?? `page-${index}`,
        name: item.name, type: item.type, parent: journal,
        system: structuredClone(item.system ?? {}),
        get uuid() { return `${journal.uuid}.JournalEntryPage.${this.id}`; },
        toObject() {
          return { _id: this.id, name: this.name, type: this.type, system: structuredClone(this.system) };
        },
        async update(changes) {
          if (this.failNextUpdate) {
            this.failNextUpdate = false;
            throw new Error("Reference update failed");
          }
          for (const [path, value] of Object.entries(changes)) {
            const parts = path.split(".");
            let target = this;
            while (parts.length > 1) target = target[parts.shift()];
            target[parts[0]] = structuredClone(value);
          }
        }
      };
      return page;
    });
    journal.pages = { contents: pages, get size() { return this.contents.length; } };
    journals.push(journal);
    return journal;
  };
  const journalCreate = vi.fn(async data => makeJournal(data));
  vi.stubGlobal("game", {
    user: { id: "gm", isGM: true },
    users: { activeGM: { id: "gm" } },
    folders: {
      contents: folders,
      find: fn => folders.find(fn),
      get: id => folders.find(folder => folder.id === id)
    },
    journal: { contents: journals },
    i18n: { localize: key => key }
  });
  vi.stubGlobal("foundry", {
    documents: {
      Folder: { implementation: { create: folderCreate } },
      JournalEntry: { implementation: { create: journalCreate } }
    }
  });
  vi.stubGlobal("ui", { notifications: { warn: vi.fn() } });
  return { folders, journals, makeJournal, folderCreate, journalCreate };
}

const questData = ({ faction = "", related = [], observers = [] } = {}) => ({
  giver: { factionUuid: faction }, observers, relatedQuestIds: related
});

beforeEach(() => vi.unstubAllGlobals());

describe("REQ-044–046 journal organization", () => {
  it("creates distinct module-owned folders once and moves existing journals without changing UUIDs", async () => {
    const { folders, makeJournal, folderCreate } = world();
    folders.push({ id: "unrelated", name: "Factions", type: "JournalEntry", folder: null, getFlag: () => undefined });
    const faction = makeJournal({
      _id: "f", name: "Faction", pages: [{ _id: "fp", name: "Faction", type: factionType }]
    });
    const quest = makeJournal({
      _id: "q", name: "Quest", pages: [{ _id: "qp", name: "Quest", type: questType, system: questData() }]
    });
    const oldUuids = [faction.pages.contents[0].uuid, quest.pages.contents[0].uuid];
    await organizeJournals();
    await organizeJournals();
    expect(folderCreate).toHaveBeenCalledTimes(2);
    expect(faction.folder.name).toBe("Factions");
    expect(faction.folder.id).not.toBe("unrelated");
    expect(quest.folder.name).toBe("Quests");
    expect([faction.pages.contents[0].uuid, quest.pages.contents[0].uuid]).toEqual(oldUuids);
    expect(await getJournalFolder("faction")).toBe(faction.folder);
  });

  it("splits mixed journals, remaps module links, and retains ordinary pages", async () => {
    const { makeJournal, journals, journalCreate } = world();
    const mixed = makeJournal({
      _id: "mixed", name: "Mixed", ownership: { default: 2 },
      pages: [
        { _id: "f", name: "Faction", type: factionType, system: { description: "Faction data" } },
        { _id: "q", name: "Quest", type: questType, system: questData() },
        { _id: "text", name: "Notes", type: "text" }
      ]
    });
    const [faction, quest] = mixed.pages.contents;
    quest.system.giver.factionUuid = faction.uuid;
    const external = makeJournal({
      _id: "external", name: "Other", pages: [{
        _id: "other", name: "Other", type: questType,
        system: questData({ faction: faction.uuid, related: [quest.uuid], observers: [{ type: "faction", uuid: faction.uuid }] })
      }]
    });
    await organizeJournals();
    const copies = journals.filter(j => j.getFlag(moduleId, "migrationSource"));
    const newFaction = copies.find(j => j.pages.contents[0].type === factionType).pages.contents[0];
    const newQuest = copies.find(j => j.pages.contents[0].type === questType).pages.contents[0];
    expect(external.pages.contents[0].system).toEqual(questData({
      faction: newFaction.uuid, related: [newQuest.uuid], observers: [{ type: "faction", uuid: newFaction.uuid }]
    }));
    expect(newFaction.system.description).toBe("Faction data");
    expect(newQuest.system.giver.factionUuid).toBe(newFaction.uuid);
    expect(newFaction.parent.ownership).toEqual({ default: 2 });
    expect(mixed.pages.contents.map(page => page.type)).toEqual(["text"]);
    expect(mixed.deleteOptions).toEqual({ amrasJournalMigration: true });
    expect(ui.notifications.warn).toHaveBeenCalledOnce();
    await organizeJournals();
    expect(journalCreate).toHaveBeenCalledTimes(2);
  });

  it("retains originals and reuses copies after a reference-update failure", async () => {
    const { makeJournal, journals, journalCreate } = world();
    const mixed = makeJournal({
      _id: "mixed", name: "Mixed",
      pages: [
        { _id: "f", name: "Faction", type: factionType },
        { _id: "q", name: "Quest", type: questType, system: questData() }
      ]
    });
    const other = makeJournal({
      _id: "other", name: "Other",
      pages: [{ _id: "p", name: "Other", type: questType, system: questData({ related: [mixed.pages.contents[1].uuid] }) }]
    });
    other.pages.contents[0].failNextUpdate = true;
    await expect(organizeJournals()).rejects.toThrow("Reference update failed");
    expect(mixed.pages.size).toBe(2);
    expect(journals).toContain(mixed);
    expect(journalCreate).toHaveBeenCalledTimes(2);
    await organizeJournals();
    expect(journals).not.toContain(mixed);
    expect(journalCreate).toHaveBeenCalledTimes(2);
    expect(other.pages.contents[0].system.relatedQuestIds[0]).not.toContain(".mixed.");
  });

  it("does not discard edits when an incomplete migration copy diverges", async () => {
    const { makeJournal, journals, journalCreate } = world();
    const mixed = makeJournal({
      _id: "mixed", name: "Mixed",
      pages: [
        { _id: "f", name: "Faction", type: factionType, system: { description: "Original" } },
        { _id: "q", name: "Quest", type: questType, system: questData({ related: ["JournalEntry.mixed.JournalEntryPage.q"] }) }
      ]
    });
    mixed.pages.contents[1].failNextUpdate = true;
    await expect(organizeJournals()).rejects.toThrow("Reference update failed");
    const copy = journals.find(j => j.getFlag(moduleId, "migrationSource") === mixed.pages.contents[0].uuid);
    copy.pages.contents[0].system.description = "Edited copy";
    await expect(organizeJournals()).rejects.toThrow("Migration copy differs");
    expect(mixed.pages.size).toBe(2);
    expect(copy.pages.contents[0].system.description).toBe("Edited copy");
    expect(journalCreate).toHaveBeenCalledTimes(2);
  });

  it("does not migrate on a non-active GM client", async () => {
    const { folderCreate } = world();
    game.users.activeGM = { id: "another-gm" };
    await organizeJournals();
    expect(folderCreate).not.toHaveBeenCalled();
  });
});
