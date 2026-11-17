import { MODULE_ID, FACTION_TYPE, QUEST_TYPE } from "./constants.mjs";

const FOLDERS = {
  faction: { id: "AMIFactionsFold1", name: "Factions" },
  quest: { id: "AMIQuestsFolder1", name: "Quests" }
};
const SOURCE_FLAG = "migrationSource";
const MIGRATION_OPTION = "amrasJournalMigration";
const pendingFolders = new Map();
let migrating = false;

export function isJournalMigrationRunning() {
  return migrating;
}

export function isJournalMigration(options) {
  return options?.[MIGRATION_OPTION] === true;
}

function isOwnedFolder(folder, kind) {
  return folder?.type === "JournalEntry" && !folder.folder
    && folder.getFlag(MODULE_ID, "journalFolder") === kind;
}

export async function getJournalFolder(kind) {
  const definition = FOLDERS[kind];
  if (!definition) throw new Error(`Unknown journal folder type: ${kind}`);
  const existing = game.folders.find(folder => isOwnedFolder(folder, kind));
  if (existing) return existing;
  if (pendingFolders.has(kind)) return pendingFolders.get(kind);
  const pending = (async () => {
    const conflicting = game.folders.get(definition.id);
    if (conflicting) {
      if (isOwnedFolder(conflicting, kind)) return conflicting;
      throw new Error(`Journal folder ID is already in use: ${definition.id}`);
    }
    try {
      const created = await foundry.documents.Folder.implementation.create({
        _id: definition.id, name: definition.name, type: "JournalEntry", folder: null,
        flags: { [MODULE_ID]: { journalFolder: kind } }
      }, { keepId: true });
      if (!isOwnedFolder(created, kind)) throw new Error(`Could not create journal folder: ${definition.name}`);
      return created;
    } catch (error) {
      const created = game.folders.get(definition.id);
      if (isOwnedFolder(created, kind)) return created;
      throw error;
    }
  })();
  pendingFolders.set(kind, pending);
  try {
    return await pending;
  } finally {
    pendingFolders.delete(kind);
  }
}

function pageKind(page) {
  if (page.type === FACTION_TYPE) return "faction";
  if (page.type === QUEST_TYPE) return "quest";
  return null;
}

function migratedCopy(uuid) {
  return game.journal.contents.find(journal => journal.getFlag(MODULE_ID, SOURCE_FLAG) === uuid);
}

async function copyPage(journal, page, folder) {
  const existing = migratedCopy(page.uuid);
  if (existing) {
    const copy = existing.pages.contents.find(candidate => candidate.type === page.type);
    if (!copy || existing.pages.size !== 1) throw new Error(`Invalid migrated journal for ${page.uuid}`);
    return copy;
  }
  const data = journal.toObject();
  delete data._id;
  delete data._stats;
  data.name = page.name;
  data.folder = folder.id;
  data.pages = [page.toObject()];
  data.flags = data.flags ?? {};
  data.flags[MODULE_ID] = { ...data.flags[MODULE_ID], [SOURCE_FLAG]: page.uuid };
  const created = await foundry.documents.JournalEntry.implementation.create(data);
  const copy = created.pages.contents.find(candidate => candidate.type === page.type);
  if (!copy || created.pages.size !== 1) throw new Error(`Could not copy ${page.uuid}`);
  return copy;
}

async function remapQuestReferences(replacements) {
  for (const journal of game.journal.contents) {
    for (const page of journal.pages.contents) {
      if (page.type !== QUEST_TYPE) continue;
      const giver = page.system.giver.factionUuid;
      const observers = page.system.observers.map(observer => ({
        type: observer.type,
        uuid: observer.type === "faction" ? replacements.get(observer.uuid) ?? observer.uuid : observer.uuid
      }));
      const related = page.system.relatedQuestIds.map(uuid => replacements.get(uuid) ?? uuid);
      const changes = {};
      if (replacements.has(giver)) changes["system.giver.factionUuid"] = replacements.get(giver);
      if (JSON.stringify(observers) !== JSON.stringify(page.system.observers)) changes["system.observers"] = observers;
      if (JSON.stringify(related) !== JSON.stringify(page.system.relatedQuestIds)) changes["system.relatedQuestIds"] = related;
      if (Object.keys(changes).length) await page.update(changes);
    }
  }
}

function comparablePage(page, replacements) {
  const data = page.toObject();
  delete data._id;
  delete data._stats;
  if (page.type === QUEST_TYPE) {
    const system = data.system;
    system.giver.factionUuid = replacements.get(system.giver.factionUuid) ?? system.giver.factionUuid;
    system.observers = system.observers.map(observer => ({
      ...observer,
      uuid: observer.type === "faction" ? replacements.get(observer.uuid) ?? observer.uuid : observer.uuid
    }));
    system.relatedQuestIds = system.relatedQuestIds.map(uuid => replacements.get(uuid) ?? uuid);
  }
  return JSON.stringify(data);
}

export async function organizeJournals() {
  if (!game.user?.isGM || game.users.activeGM?.id !== game.user.id || migrating) return;
  migrating = true;
  try {
    const folders = {
      faction: await getJournalFolder("faction"),
      quest: await getJournalFolder("quest")
    };
    const journals = [...game.journal.contents];
    const mixed = [];
    for (const journal of journals) {
      const pages = journal.pages.contents.filter(page => pageKind(page));
      const kinds = new Set(pages.map(pageKind));
      if (kinds.size > 1) mixed.push({ journal, pages });
      else if (kinds.size === 1) {
        const folder = folders[[...kinds][0]];
        if (journal.folder?.id !== folder.id) await journal.update({ folder: folder.id });
      }
    }
    if (!mixed.length) return;
    ui.notifications.warn(game.i18n.localize(`${MODULE_ID}.notifications.journalMigrationLinks`));
    const replacements = new Map();
    const copiedPages = [];
    for (const { journal, pages } of mixed) {
      for (const page of pages) {
        const copy = await copyPage(journal, page, folders[pageKind(page)]);
        replacements.set(page.uuid, copy.uuid);
        copiedPages.push({ page, copy });
      }
    }
    for (const { page, copy } of copiedPages) {
      if (comparablePage(page, replacements) !== comparablePage(copy, replacements)) {
        throw new Error(`Migration copy differs from its source: ${page.uuid}`);
      }
    }
    await remapQuestReferences(replacements);
    for (const { journal, pages } of mixed) {
      const options = { [MIGRATION_OPTION]: true };
      if (journal.pages.size === pages.length) await journal.delete(options);
      else await journal.deleteEmbeddedDocuments("JournalEntryPage", pages.map(page => page.id), options);
    }
  } finally {
    migrating = false;
  }
}
