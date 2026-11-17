import { MODULE_ID, TEMPLATE_PATH } from "./constants.mjs";
import { QUEST_TYPE } from "./quest-model.mjs";
import { canView } from "./permissions.mjs";
import {
  buildQuestContext, pageToQuest, questFromForm, saveQuestPage, openRelatedQuest
} from "./quest-sheet.mjs";
import { installQuestDropHandlers } from "./quest-form-controls.mjs";
import { getJournalFolder } from "./journal-organization.mjs";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

const t = key => game.i18n.localize(`${MODULE_ID}.${key}`);

export function canManageQuests(user = game.user) {
  return user?.isGM === true;
}

/** Use from preUpdate/preDelete JournalEntryPage hooks to enforce GM-only edits. */
export function allowQuestPageModification(page, userId) {
  if (page?.type !== QUEST_TYPE) return true;
  return canManageQuests(game.users.get(userId));
}

function questPages() {
  return game.journal.contents.flatMap(j => j.pages.contents)
    .filter(page => page.type === QUEST_TYPE)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function resolve(uuid) {
  try { return uuid ? fromUuidSync(uuid) : null; }
  catch { return null; }
}

function questSystem(q) {
  return {
    icon: q.icon,
    description: q.description,
    giver: { actorUuid: q.giver.actorUuid ?? "", factionUuid: q.giver.factionUuid ?? "" },
    state: q.state,
    rewards: q.rewards,
    consequence: q.consequence ?? "",
    observers: q.observers,
    relatedQuestIds: q.relatedQuestIds,
    rewardAudit: q.rewardAudit ?? [],
    rewardsGranted: q.rewardsGranted ?? false,
    rewardsLocked: q.rewardsLocked ?? false,
    rewardRemainder: q.rewardRemainder ?? {}
  };
}

function userCanOpen(page) {
  if (game.user.isGM) return true;
  const level = CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER;
  return page.testUserPermission(game.user, level)
    || page.parent?.testUserPermission(game.user, level) === true;
}

/** Faction sheet context. Only transmit links to quest pages the current user can read. */
export function buildFactionQuestSection(factionPage) {
  const quests = factionPage ? questPages().filter(page => {
    const q = pageToQuest(page);
    const involved = q.giver.factionUuid === factionPage.uuid
      || q.observers.some(observer => observer.type === "faction" && observer.uuid === factionPage.uuid);
    return involved && userCanOpen(page);
  }).map(page => ({
    uuid: page.uuid,
    title: page.name,
    icon: page.system.icon,
    state: page.system.state,
    stateLabel: t(`quest.states.${page.system.state}`)
  })) : [];
  return { factionQuests: quests, canCreateQuest: game.user.isGM };
}

/** Open a quest page only when Foundry has transmitted it and the user may observe it. */
export function openQuestPage(pageOrUuid) {
  const page = typeof pageOrUuid === "string" ? resolve(pageOrUuid) : pageOrUuid;
  if (!page || page.type !== QUEST_TYPE || !userCanOpen(page)) return false;
  page.sheet.render({ force: true });
  return true;
}

/** Ask how the originating faction participates, then open a prefilled manager form. */
export async function createQuestFromFaction(factionPage, { association } = {}) {
  if (!game.user.isGM || !factionPage) return false;
  if (!["giver", "observer", "none"].includes(association)) {
    association = await DialogV2.prompt({
      window: { title: t("quest.factionCreate.title") },
      content: `<div class="form-group"><label>${t("quest.factionCreate.association")}</label>
        <select name="association">
          <option value="giver">${t("quest.factionCreate.giver")}</option>
          <option value="observer">${t("quest.factionCreate.observer")}</option>
          <option value="none">${t("quest.factionCreate.none")}</option>
        </select></div>`,
      ok: { callback: (event, button) => button.form.elements.association.value },
      rejectClose: false
    });
    if (!association) return false;
  }
  const app = foundry.applications.instances.get(QuestManager.DEFAULT_OPTIONS.id) ?? new QuestManager();
  app.selectedUuid = null;
  app.creating = true;
  app.newQuestDefaults = {
    giver: { actorUuid: "", factionUuid: association === "giver" ? factionPage.uuid : "" },
    observers: association === "observer" ? [{ type: "faction", uuid: factionPage.uuid }] : []
  };
  app.render({ force: true });
  return true;
}

/**
 * Refresh explicit JournalEntry observer rights for faction-linked quests.
 * The quest JournalEntry's default ownership stays NONE; individual eligible
 * users receive OBSERVER. Previous manual rights are restored when auto-grants lapse.
 */
export async function refreshQuestJournalAccess({ journal = null } = {}) {
  if (!game.user.isGM) return;
  const pages = (journal ? journal.pages.contents : questPages()).filter(page => page.type === QUEST_TYPE);
  const observerLevel = CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER;
  const ownerLevel = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
  for (const page of pages) {
    const q = pageToQuest(page);
    const factionUuids = new Set([
      q.giver.factionUuid,
      ...q.observers.filter(observer => observer.type === "faction").map(observer => observer.uuid)
    ].filter(Boolean));
    const eligible = new Set();
    for (const uuid of factionUuids) {
      const faction = resolve(uuid);
      if (faction?.type !== `${MODULE_ID}.faction`) continue;
      const members = faction.system.members.map(member => ({ actorUuid: member.actorUuid }));
      const trackedActors = members.map(member => resolve(member.actorUuid)).filter(Boolean);
      for (const user of game.users.contents) {
        if (user.isGM) continue;
        if (!faction.testUserPermission(user, observerLevel)) continue;
        const ownedActorUuids = trackedActors
          .filter(actor => actor.testUserPermission(user, ownerLevel))
          .map(actor => actor.uuid);
        if (canView({ isGM: false, ownedActorUuids }, { members })) eligible.add(user.id);
      }
    }

    const parent = page.parent;
    if (parent.pages.size !== 1) {
      eligible.clear();
      console.warn(`${MODULE_ID} | Automatic quest access requires a journal containing only the quest page: ${parent.uuid}`);
    }
    const previous = parent.getFlag(MODULE_ID, "questAccess") ?? { users: [], original: {} };
    const nextOwnership = foundry.utils.deepClone(parent.ownership ?? {
      default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE
    });
    const original = { ...(previous.original ?? {}) };
    for (const userId of previous.users ?? []) {
      if (eligible.has(userId)) continue;
        if (Object.hasOwn(original, userId) && original[userId] !== null && original[userId] !== undefined) {
          nextOwnership[userId] = original[userId];
        } else delete nextOwnership[userId];
      delete original[userId];
    }
    for (const userId of eligible) {
      if (!Object.hasOwn(original, userId)) original[userId] = nextOwnership[userId] ?? null;
      // Faction-based quest access is deliberately read-only, even if a manual
      // Owner grant existed before this module's access synchronization.
      nextOwnership[userId] = observerLevel;
    }
    const nextUsers = [...eligible].sort();
    if (JSON.stringify(parent.ownership) !== JSON.stringify(nextOwnership)
      || JSON.stringify(previous.users ?? []) !== JSON.stringify(nextUsers)
      || JSON.stringify(previous.original ?? {}) !== JSON.stringify(original)) {
      await parent.update({
        ownership: nextOwnership,
        [`flags.${MODULE_ID}.questAccess`]: { users: nextUsers, original }
      });
    }
  }
}

/** Create the JournalEntry which stores a quest and initialize faction-based access. */
async function createQuestPage(q) {
  const none = CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE;
  const folder = await getJournalFolder("quest");
  const journal = await foundry.documents.JournalEntry.implementation.create({
    name: q.title,
    folder: folder.id,
    ownership: { default: none },
    pages: [{ name: q.title, type: QUEST_TYPE, system: questSystem(q) }]
  });
  const page = journal.pages.contents.find(p => p.type === QUEST_TYPE);
  if (!page) throw new Error(t("notifications.questCreateFailed"));
  await refreshQuestJournalAccess({ journal });
  return page;
}

async function deleteQuestPage(page) {
  if (page.parent.pages.size === 1) await page.parent.delete();
  else await page.delete();
  await cleanupQuestRelations([page.uuid]);
}

/** Remove references when a quest is deleted through any Foundry surface. */
export async function cleanupQuestRelations(deletedUuids) {
  if (!game.user.isGM || !deletedUuids.length) return;
  const deleted = new Set(deletedUuids);
  for (const page of questPages()) {
    if (deleted.has(page.uuid)) continue;
    const previous = [...page.system.relatedQuestIds];
    const next = previous.filter(uuid => !deleted.has(uuid));
    if (next.length !== previous.length) await page.update({ "system.relatedQuestIds": next });
  }
}

/** GM-only manager for creating, editing, linking, and deleting quests. */
export class QuestManager extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-quest-manager`,
    classes: [MODULE_ID, "amras-quest-manager"],
    position: { width: 920, height: 720 },
    window: { title: `${MODULE_ID}.quest.manager.title`, resizable: true, icon: "fa-solid fa-scroll" },
    actions: {
      selectQuest: QuestManager.#select,
      createQuest: QuestManager.#create,
      saveQuest: QuestManager.#save,
      deleteQuest: QuestManager.#delete,
      openSheet: QuestManager.#openSheet,
      pickQuestIcon: QuestManager.#pickIcon,
      openDocument: QuestManager.#openDocument,
      openRelatedQuest: (event, target) => openRelatedQuest(target.dataset.uuid),
      addItemRow: QuestManager.#addItemRow,
      removeItemRow: QuestManager.#removeItemRow,
      addCurrencyRow: QuestManager.#addCurrencyRow,
      removeCurrencyRow: QuestManager.#removeCurrencyRow,
      addObserverRow: QuestManager.#addObserverRow,
      removeObserverRow: QuestManager.#removeObserverRow
    }
  };

  static PARTS = {
    list: { template: `${TEMPLATE_PATH}/quest-list.hbs`, scrollable: [".amras-quest-list"] },
    form: { template: `${TEMPLATE_PATH}/quest-form.hbs`, scrollable: [""] }
  };

  selectedUuid = null;
  creating = false;
  newQuestDefaults = {};

  get questPage() {
    if (!this.selectedUuid) return null;
    try {
      const page = fromUuidSync(this.selectedUuid);
      return page?.type === QUEST_TYPE ? page : null;
    } catch { return null; }
  }

  render(options = {}) {
    if (!game.user?.isGM) return this;
    return super.render(options);
  }

  async _preparePartContext(partId, context, options) {
    context = await super._preparePartContext(partId, context, options);
    if (partId === "list") {
      const pages = questPages();
      if (this.selectedUuid && !pages.some(page => page.uuid === this.selectedUuid)) this.selectedUuid = null;
      context.editable = game.user.isGM;
      context.quests = pages.map(page => ({
        uuid: page.uuid,
        title: page.name,
        icon: page.system.icon,
        state: page.system.state,
        stateLabel: t(`quest.states.${page.system.state}`),
        selected: page.uuid === this.selectedUuid
      }));
    } else if (partId === "form") {
      const page = this.questPage;
      if (page) {
        Object.assign(context, buildQuestContext(page));
        context.inManager = true;
        context.creating = false;
      } else {
        Object.assign(context, buildQuestContext(null, {
          defaults: this.newQuestDefaults,
          creating: this.creating
        }));
        context.inManager = true;
        context.creating = this.creating;
      }

    }
    return context;
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    if (game.user.isGM) installQuestDropHandlers(this.element);
  }

  static async #select(event, target) {
    this.selectedUuid = target.dataset.uuid;
    this.creating = false;
    this.newQuestDefaults = {};
    await this.render();
  }

  static async #create() {
    if (!game.user.isGM) return;
    this.selectedUuid = null;
    this.creating = true;
    this.newQuestDefaults = {};
    await this.render();
  }

  static async #save(event, target) {
    if (!game.user.isGM) return;
    try {
      const page = this.questPage;
      const q = questFromForm(this.element, { page, defaults: this.newQuestDefaults });
      if (page) {
        if (await saveQuestPage(page, q)) {
          this.creating = false;
          await this.render();
        }
        return;
      }
      if (!this.creating) return;
      const created = await createQuestPage(q);
      q.id = created.uuid;
      if (await saveQuestPage(created, q)) {
        this.selectedUuid = created.uuid;
        this.creating = false;
        this.newQuestDefaults = {};
        await this.render();
      }
    } catch (error) {
      console.error(`${MODULE_ID} | Quest save failed`, error);
      ui.notifications.warn(t("notifications.questInvalid"));
    }
  }

  static async #delete() {
    const page = this.questPage;
    if (!page || !game.user.isGM) return;
    const confirmed = await DialogV2.confirm({
      window: { title: t("quest.manager.deleteTitle") },
      content: `<p>${game.i18n.format(`${MODULE_ID}.quest.manager.deleteConfirm`, {
        title: foundry.utils.escapeHTML(page.name)
      })}</p>`,
      rejectClose: false
    });
    if (!confirmed) return;
    await deleteQuestPage(page);
    this.selectedUuid = null;
    await this.render();
  }

  static async #openSheet() {
    const page = this.questPage;
    if (page && userCanOpen(page)) page.sheet.render({ force: true });
  }

  static async #pickIcon() {
    if (!game.user.isGM) return;
    const input = this.element.querySelector("[name='icon']");
    if (!input) return;
    const picker = foundry.applications.apps.FilePicker.implementation;
    await new picker({
      type: "image",
      current: input.value,
      callback: path => { input.value = path; }
    }).browse();
  }

  static #openDocument(event, target) {
    const document = resolve(target.dataset.uuid);
    if (document && (game.user.isGM || document.testUserPermission?.(game.user, CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER))) {
      document.sheet?.render({ force: true });
    }
  }

  static #addItemRow(event, target) {
    const template = this.element.querySelector("[data-item-row-template]");
    const list = this.element.querySelector("[data-item-rows]");
    if (template && list) list.append(template.content.cloneNode(true));
  }

  static #removeItemRow(event, target) {
    target.closest("[data-item-row]")?.remove();
  }

  static #addCurrencyRow() {
    const template = this.element.querySelector("[data-currency-row-template]");
    const list = this.element.querySelector("[data-currency-rows]");
    if (template && list) list.append(template.content.cloneNode(true));
  }

  static #removeCurrencyRow(event, target) {
    target.closest("[data-currency-row]")?.remove();
  }

  static #addObserverRow() {
    const template = this.element.querySelector("[data-observer-row-template]");
    const list = this.element.querySelector("[data-observer-rows]");
    if (template && list) list.append(template.content.cloneNode(true));
  }

  static #removeObserverRow(event, target) {
    target.closest("[data-observer-row]")?.remove();
  }
}

export function openQuestManager() {
  if (!game.user.isGM) return null;
  const app = foundry.applications.instances.get(QuestManager.DEFAULT_OPTIONS.id) ?? new QuestManager();
  app.render({ force: true });
  return app;
}

export async function refreshQuestManager() {
  const app = foundry.applications.instances.get(QuestManager.DEFAULT_OPTIONS.id);
  if (app?.rendered) await app.render();
}

/** Parent hook integration: call on ready and on JournalEntry/Page, Actor, and User updates. */
export async function refreshQuestAccessAndManager() {
  await refreshQuestJournalAccess();
  await refreshQuestManager();
}
