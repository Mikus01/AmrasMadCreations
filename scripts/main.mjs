import { MODULE_ID, FACTION_TYPE, QUEST_TYPE } from "./constants.mjs";
import { registerSettings } from "./settings.mjs";
import { FactionModel } from "./faction-model.mjs";
import { FactionPageSheet } from "./faction-sheet.mjs";
import { FactionManager, refreshManager } from "./faction-manager.mjs";
import { QuestModel } from "./quest-model.mjs";
import { QuestPageSheet } from "./quest-sheet.mjs";
import {
  openQuestManager, refreshQuestAccessAndManager, allowQuestPageModification, cleanupQuestRelations
} from "./quest-manager.mjs";
import { organizeJournals, isJournalMigration, isJournalMigrationRunning } from "./journal-organization.mjs";

Hooks.once("init", () => {
  console.log(`${MODULE_ID} | Initializing`);
  registerSettings();

  CONFIG.JournalEntryPage.dataModels[FACTION_TYPE] = FactionModel;
  CONFIG.JournalEntryPage.typeLabels ??= {};
  CONFIG.JournalEntryPage.typeLabels[FACTION_TYPE] = `${MODULE_ID}.faction.typeLabel`;
  CONFIG.JournalEntryPage.typeIcons ??= {};
  CONFIG.JournalEntryPage.typeIcons[FACTION_TYPE] = "fa-solid fa-flag";
  CONFIG.JournalEntryPage.dataModels[QUEST_TYPE] = QuestModel;
  CONFIG.JournalEntryPage.typeLabels[QUEST_TYPE] = `${MODULE_ID}.quest.typeLabel`;
  CONFIG.JournalEntryPage.typeIcons[QUEST_TYPE] = "fa-solid fa-scroll";

  foundry.applications.apps.DocumentSheetConfig.registerSheet(
    foundry.documents.JournalEntryPage, MODULE_ID, FactionPageSheet,
    { types: [FACTION_TYPE], makeDefault: true, label: `${MODULE_ID}.faction.sheetLabel` }
  );
  foundry.applications.apps.DocumentSheetConfig.registerSheet(
    foundry.documents.JournalEntryPage, MODULE_ID, QuestPageSheet,
    { types: [QUEST_TYPE], makeDefault: true, label: `${MODULE_ID}.quest.sheetLabel` }
  );
});

Hooks.once("ready", () => {
  scheduleJournalOrganization();
  if (game.settings.get(MODULE_ID, "debug")) {
    console.log(`${MODULE_ID} | Ready`);
  }
});

const boundDirectories = new WeakSet();
Hooks.on("renderJournalDirectory", (app, html) => {
  const root = html instanceof HTMLElement ? html : html[0];
  if (!boundDirectories.has(root)) {
    root.addEventListener("click", event => {
      const link = event.target.closest("[data-action='activateEntry']");
      const row = link?.closest("[data-entry-id]");
      if (!row) return;
      const journal = game.journal.get(row.dataset.entryId);
      if (journal?.pages.size !== 1) return;
      const page = journal.pages.contents[0];
      if (page.type !== QUEST_TYPE && page.type !== FACTION_TYPE) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (game.user.isGM || page.testUserPermission(game.user, CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER)) {
        if (page.sheet.rendered) page.sheet.bringToFront();
        else page.sheet.render({ force: true });
      } else {
        ui.notifications.warn(game.i18n.localize(`${MODULE_ID}.quest.unavailable`));
      }
    }, true);
    boundDirectories.add(root);
  }
  const target = root.querySelector(".header-actions") ?? root.querySelector("header");
  if (!target) return;
  if (!root.querySelector(".amras-open-factions")) {
    const button = document.createElement("button");
    button.type = "button";
    button.classList.add("amras-open-factions");
    button.innerHTML = `<i class="fa-solid fa-flag"></i> ${game.i18n.localize(`${MODULE_ID}.manager.open`)}`;
    button.addEventListener("click", () => {
      const existing = foundry.applications.instances.get(FactionManager.DEFAULT_OPTIONS.id);
      (existing ?? new FactionManager()).render({ force: true });
    });
    target.append(button);
  }
  if (game.user.isGM && !root.querySelector(".amras-open-quests")) {
    const button = document.createElement("button");
    button.type = "button";
    button.classList.add("amras-open-quests");
    button.innerHTML = `<i class="fa-solid fa-scroll"></i> ${game.i18n.localize(`${MODULE_ID}.quest.manager.open`)}`;
    button.addEventListener("click", openQuestManager);
    target.append(button);
  }
});

function scheduleJournalOrganization() {
  if (!game.user?.isGM || game.users.activeGM?.id !== game.user.id || isJournalMigrationRunning()) return;
  organizeJournals().then(scheduleQuestRefresh).catch(error => {
    console.error(`${MODULE_ID} | Journal organization failed`, error);
    ui.notifications.error(game.i18n.localize(`${MODULE_ID}.notifications.journalMigrationFailed`));
  });
}

let refreshTimer;
function scheduleQuestRefresh() {
  if (!game.user?.isGM || isJournalMigrationRunning()
    || (game.users.activeGM && game.users.activeGM.id !== game.user.id)) return;
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    if (isJournalMigrationRunning()) return;
    refreshQuestAccessAndManager().catch(error => {
      console.error(`${MODULE_ID} | Quest access synchronization failed`, error);
      ui.notifications.error(game.i18n.localize(`${MODULE_ID}.notifications.questAccessFailed`));
    });
  }, 50);
}
Hooks.on("updateUser", scheduleJournalOrganization);

for (const hook of [
  "createJournalEntry", "updateJournalEntry", "deleteJournalEntry",
  "createJournalEntryPage", "updateJournalEntryPage", "deleteJournalEntryPage",
  "createActor", "updateActor", "deleteActor", "createUser", "updateUser", "deleteUser"
]) {
  Hooks.on(hook, () => {
    refreshManager();
    scheduleQuestRefresh();
  });
}

function cleanupDeletedQuests(uuids) {
  if (!game.user?.isGM || (game.users.activeGM && game.users.activeGM.id !== game.user.id)) return;
  cleanupQuestRelations(uuids).catch(error => {
    console.error(`${MODULE_ID} | Quest relationship cleanup failed`, error);
    ui.notifications.error(game.i18n.localize(`${MODULE_ID}.notifications.questCleanupFailed`));
  });
}
Hooks.on("deleteJournalEntryPage", (page, options) => {
  if (page.type === QUEST_TYPE && !isJournalMigration(options)) cleanupDeletedQuests([page.uuid]);
});
Hooks.on("deleteJournalEntry", (journal, options) => {
  if (!isJournalMigration(options)) {
    cleanupDeletedQuests(journal.pages.contents.filter(page => page.type === QUEST_TYPE).map(page => page.uuid));
  }
});

for (const hook of ["preCreateJournalEntryPage", "preUpdateJournalEntryPage", "preDeleteJournalEntryPage"]) {
  Hooks.on(hook, (page, dataOrOptions, optionsOrUserId, userId) =>
    allowQuestPageModification(page, userId ?? optionsOrUserId));
}
for (const hook of ["preCreateJournalEntry", "preUpdateJournalEntry", "preDeleteJournalEntry"]) {
  Hooks.on(hook, (journal, dataOrOptions, optionsOrUserId, userId) => {
    const user = game.users.get(userId ?? optionsOrUserId);
    const pages = journal.pages?.contents ?? [];
    if (pages.some(page => page.type === QUEST_TYPE) && !user?.isGM) return false;
  });
}
