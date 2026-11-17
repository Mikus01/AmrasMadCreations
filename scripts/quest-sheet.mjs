import { MODULE_ID, TEMPLATE_PATH } from "./constants.mjs";
import { QUEST_TYPE } from "./quest-model.mjs";
import {
  DEFAULT_QUEST_ICON, QUEST_STATES, addObserver, createQuest, setQuestState,
  addQuestRelation, removeQuestRelation
} from "./quest.mjs";
import { installQuestDropHandlers } from "./quest-form-controls.mjs";

const { HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;
const { JournalEntryPageSheet } = foundry.applications.sheets.journal;

const t = key => game.i18n.localize(`${MODULE_ID}.${key}`);
const esc = value => foundry.utils.escapeHTML(String(value ?? ""));
const isGM = () => game.user?.isGM === true;

function isQuestPage(page) {
  return page?.type === QUEST_TYPE;
}

function factionPages() {
  return game.journal.contents.flatMap(j => j.pages.contents)
    .filter(page => page.type === `${MODULE_ID}.faction`);
}

function resolve(uuid) {
  try { return uuid ? fromUuidSync(uuid) : null; }
  catch { return null; }
}

export function openRelatedQuest(uuid) {
  const page = resolve(uuid);
  const level = CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER;
  if (!isQuestPage(page) || (!isGM() && !page.testUserPermission(game.user, level)
    && !page.parent?.testUserPermission(game.user, level))) {
    ui.notifications.warn(t("quest.unavailable"));
    return false;
  }
  if (page.sheet.rendered) page.sheet.bringToFront();
  else page.sheet.render({ force: true });
  return true;
}

export function pageToQuest(page) {
  const system = page.system;
  return {
    id: page.uuid,
    title: page.name,
    description: system.description,
    icon: system.icon,
    giver: {
      actorUuid: system.giver.actorUuid || "",
      factionUuid: system.giver.factionUuid || ""
    },
    state: system.state,
    rewards: foundry.utils.deepClone(system.rewards),
    consequence: system.consequence,
    observers: system.observers.map(o => ({ type: o.type, uuid: o.uuid })),
    relatedQuestIds: [...system.relatedQuestIds],
    rewardAudit: foundry.utils.deepClone(system.rewardAudit),
    rewardsGranted: system.rewardsGranted,
    rewardsLocked: system.rewardsLocked,
    rewardRemainder: foundry.utils.deepClone(system.rewardRemainder)
  };
}

function allQuestPages() {
  return game.journal.contents.flatMap(j => j.pages.contents)
    .filter(isQuestPage)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function pageState(page) {
  const quest = pageToQuest(page);
  return {
    uuid: page.uuid,
    title: page.name,
    icon: quest.icon || DEFAULT_QUEST_ICON,
    state: quest.state,
    stateLabel: t(`quest.states.${quest.state}`)
  };
}

function currentForm(root) {
  const read = selector => root.querySelector(selector)?.value ?? "";
  const title = read("[name='title']");
  const description = read("[name='description']");
  const icon = read("[name='icon']");
  const actorUuid = read("[name='giverActorUuid']");
  const factionUuid = read("[name='giverFactionUuid']");
  const state = read("[name='state']") || "offered";
  const xp = Number(read("[name='xp']") || 0);

  const items = [...root.querySelectorAll("[data-item-row]")].map(row => ({
    itemUuid: row.querySelector("[name='itemUuid']")?.value.trim() ?? "",
    quantity: Number(row.querySelector("[name='itemQuantity']")?.value ?? 0)
  })).filter(item => item.itemUuid);
  const currency = {};
  for (const row of root.querySelectorAll("[data-currency-row]")) {
    const key = row.querySelector("[name='currencyKey']")?.value.trim();
    const raw = row.querySelector("[name='currencyAmount']")?.value ?? "";
    if (key && raw !== "") {
      if (Object.hasOwn(currency, key)) throw new Error(t("quest.rewards.duplicateCurrency"));
      currency[key] = Number(raw);
    }
  }
  const observers = [...root.querySelectorAll("[data-observer-row]")].map(row => {
    const value = row.querySelector("[name='observer']")?.value ?? "";
    if (!value) return null;
    const [type, ...uuidParts] = value.split("|");
    const uuid = uuidParts.join("|");
    return uuid ? { type, uuid } : null;
  }).filter(Boolean);

  return {
    title, description, icon,
    giver: { actorUuid, factionUuid },
    state,
    rewards: { xp, items, currency },
    consequence: read("[name='consequence']"),
    observers,
    relatedQuestIds: [...root.querySelectorAll("[name='relatedQuestIds']")].map(i => i.value)
  };
}

export function questFromForm(root, { page = null, defaults = {} } = {}) {
  const input = currentForm(root);
  const existing = page ? pageToQuest(page) : null;
  const rewards = existing?.rewardsLocked ? existing.rewards : input.rewards;
  if (!input.title.trim()) throw new Error(t("quest.validation.titleRequired"));
  if (!input.description.trim()) throw new Error(t("quest.validation.descriptionRequired"));
  if (!input.giver.actorUuid && !input.giver.factionUuid) {
    throw new Error(t("quest.validation.giverRequired"));
  }
  if (!Number.isInteger(rewards.xp) || rewards.xp < 0) throw new Error(t("quest.rewards.invalidXp"));
  for (const item of rewards.items) {
    if (!item.itemUuid || !Number.isInteger(item.quantity) || item.quantity < 1) {
      throw new Error(t("quest.rewards.invalidItem"));
    }
  }
  for (const [key, amount] of Object.entries(rewards.currency)) {
    if (!key.trim() || !Number.isInteger(amount) || amount < 0) {
      throw new Error(t("quest.rewards.invalidCurrency"));
    }
  }
  let quest = createQuest({
    title: input.title,
    description: input.description,
    icon: input.icon,
    giver: input.giver,
    rewards,
    consequence: input.consequence
  });
  try {
    for (const observer of input.observers) quest = addObserver(quest, observer, { isGM: true });
  } catch {
    throw new Error(t("quest.validation.observerConflict"));
  }
  quest = setQuestState(quest, existing ? input.state : "offered", { isGM: true });

  if (existing) {
    quest = {
      ...quest,
      id: existing.id,
      relatedQuestIds: input.relatedQuestIds,
      rewardAudit: existing.rewardAudit,
      rewardsGranted: existing.rewardsGranted,
      rewardsLocked: existing.rewardsLocked,
      rewardRemainder: existing.rewardRemainder
    };
  } else {
    quest = {
      ...quest,
      relatedQuestIds: input.relatedQuestIds,
      rewardAudit: [],
      rewardsGranted: false,
      rewardsLocked: false,
      rewardRemainder: {}
    };
  }
  return quest;
}

function questUpdateData(q) {
  return {
    name: q.title,
    "system.icon": q.icon,
    "system.description": q.description,
    "system.giver.actorUuid": q.giver.actorUuid ?? "",
    "system.giver.factionUuid": q.giver.factionUuid ?? "",
    "system.state": q.state,
    "system.rewards": q.rewards,
    "system.consequence": q.consequence ?? "",
    "system.observers": q.observers,
    "system.relatedQuestIds": q.relatedQuestIds,
    "system.rewardAudit": q.rewardAudit,
    "system.rewardsGranted": q.rewardsGranted,
    "system.rewardsLocked": q.rewardsLocked,
    "system.rewardRemainder": q.rewardRemainder
  };
}

async function updateQuestDefinition(page, q) {
  await page.update(questUpdateData(q));
  if (page.parent.pages.size === 1 && page.parent.name !== q.title) {
    await page.parent.update({ name: q.title });
  }
}

async function syncRelations(page, relatedQuestIds) {
  const pages = allQuestPages();
  const quests = pages.map(pageToQuest);
  let updated = quests.map(q => q.id === page.uuid
    ? { ...q, relatedQuestIds: [...new Set(relatedQuestIds.filter(id => id !== q.id))] }
    : q);
  const desired = new Set(relatedQuestIds.filter(id => id !== page.uuid));
  for (const other of pages) {
    if (other.uuid === page.uuid) continue;
    const has = (updated.find(q => q.id === other.uuid)?.relatedQuestIds ?? []).includes(page.uuid);
    const wants = desired.has(other.uuid);
    if (wants && !has) updated = addQuestRelation(updated, page.uuid, other.uuid, { isGM: true });
    else if (!wants && has) updated = removeQuestRelation(updated, page.uuid, other.uuid, { isGM: true });
  }
  await Promise.all(pages.map(async doc => {
    const next = updated.find(q => q.id === doc.uuid);
    const previous = pageToQuest(doc);
    if (JSON.stringify(next?.relatedQuestIds) !== JSON.stringify(previous.relatedQuestIds)) {
      await doc.update({ "system.relatedQuestIds": next.relatedQuestIds });
    }
  }));
}

function assignmentDialog(q) {
  const actors = game.actors.contents;
  const actorChoices = group => actors.map(actor => `<label class="amras-quest-recipient">
    <input type="checkbox" data-assignment-group="${group}" data-actor-uuid="${esc(actor.uuid)}"> ${esc(actor.name)}</label>`).join("");
  const itemRows = (q.rewards.items ?? []).map((item, index) => {
    const document = resolve(item.itemUuid);
    const name = document?.name ?? item.itemUuid;
    const legend = game.i18n.format(`${MODULE_ID}.quest.rewards.itemAssignmentLegend`, {
      item: name, quantity: item.quantity
    });
    return `<fieldset class="amras-quest-item-assignment"><legend>${esc(legend)}</legend>
      ${actors.map(actor => `<label>${esc(actor.name)}
        <input type="number" min="0" max="${Number(item.quantity) || 0}" step="1"
          data-item-index="${index}" data-actor-uuid="${esc(actor.uuid)}" value="0"></label>`).join("")}
    </fieldset>`;
  }).join("");
  return `<div class="amras-quest-assignment">
    <p>${esc(t("quest.rewards.assignmentPrompt"))}</p>
    ${q.rewards.xp > 0 ? `<fieldset><legend>${esc(game.i18n.format(`${MODULE_ID}.quest.rewards.xpAssignmentLegend`, { amount: q.rewards.xp }))}</legend>${actorChoices("xp")}</fieldset>` : ""}
    ${itemRows}
    ${Object.values(q.rewards.currency ?? {}).some(amount => amount > 0) ? `<fieldset><legend>${esc(t("quest.rewards.currencyRecipients"))}</legend>${actorChoices("currency")}</fieldset>` : ""}
  </div>`;
}

async function collectAssignments(q) {
  const html = assignmentDialog(q);
  const result = await DialogV2.prompt({
    window: { title: t("quest.rewards.assignmentTitle") },
    content: html,
    ok: { callback: (event, button) => {
      const root = button.form;
      const checked = [...root.querySelectorAll("[data-actor-uuid]:checked")];
      const xp = q.rewards.xp > 0
        ? checked.filter(input => input.dataset.assignmentGroup === "xp")
          .map(input => input.dataset.actorUuid)
        : [];
      const currency = Object.values(q.rewards.currency ?? {}).some(amount => amount > 0)
        ? checked.filter(input => input.dataset.assignmentGroup === "currency")
          .map(input => input.dataset.actorUuid)
        : [];
      const items = [...root.querySelectorAll("[data-item-index]")].map(input => ({
        itemUuid: q.rewards.items[Number(input.dataset.itemIndex)]?.itemUuid,
        actorUuid: input.dataset.actorUuid,
        quantity: Number(input.value)
      })).filter(a => a.itemUuid && a.quantity > 0);
      return { xp, items, currency };
    } },
    rejectClose: false
  });
  return result ?? null;
}

async function persistCompletion(page, quest) {
  await page.update({
    "system.state": quest.state,
    "system.rewardAudit": quest.rewardAudit,
    "system.rewardsGranted": quest.rewardsGranted,
    "system.rewardsLocked": quest.rewardsLocked,
    "system.rewardRemainder": quest.rewardRemainder
  });
}

async function completeWithAssignments(page, quest) {
  const assignments = await collectAssignments(quest);
  if (assignments === null) return { confirmed: false, success: false };
  try {
    const { completeQuest } = await import("./quest-rewards.mjs");
    const { getQuestRewardAdapter } = await import("./quest-reward-adapters.mjs");
    if (typeof completeQuest !== "function" || typeof getQuestRewardAdapter !== "function") {
      throw new Error(t("notifications.questRewardUnavailable"));
    }
    // Persist editable quest definitions only after the GM confirms. The reward
    // workflow itself durably records its state/audit before and after each payout.
    const current = pageToQuest(page);
    const definition = { ...quest, state: current.state, rewardAudit: current.rewardAudit,
      rewardsGranted: current.rewardsGranted, rewardsLocked: current.rewardsLocked,
      rewardRemainder: current.rewardRemainder };
    const definitionUpdate = questUpdateData(definition);
    delete definitionUpdate["system.relatedQuestIds"];
    await page.update(definitionUpdate);
    if (page.parent.pages.size === 1 && page.parent.name !== definition.title) {
      await page.parent.update({ name: definition.title });
    }
    const completionQuest = pageToQuest(page);
    const adapter = getQuestRewardAdapter(game.system.id, {
      actors: game.actors,
      resolveActor: uuid => fromUuid(uuid),
      resolveItem: uuid => fromUuid(uuid)
    });
    const completed = await completeQuest(completionQuest, {
      assignments,
      applyAward: adapter.applyAward,
      notifyError: error => ui.notifications.error(
        `${t("quest.rewards.awardFailed")}: ${String(error?.message ?? error)}`
      ),
      user: game.user,
      denominations: adapter.denominations,
      persistQuest: async (next, details) => persistCompletion(page, next, details)
    });
    const persisted = page.system.rewardsGranted === true && page.system.state === "completed";
    return { confirmed: true, success: Boolean(completed) || persisted };
  } catch (error) {
    console.error(`${MODULE_ID} | Quest completion failed`, error);
    ui.notifications.error(t("notifications.questCompletionFailed"));
    return {
      confirmed: true,
      success: page.system.rewardsGranted === true && page.system.state === "completed"
    };
  }
}

export async function saveQuestPage(page, quest) {
  if (!isGM() || !isQuestPage(page)) return false;
  const current = pageToQuest(page);
  if (current.rewardsLocked && JSON.stringify(current.rewards) !== JSON.stringify(quest.rewards)) {
    ui.notifications.warn(t("quest.rewards.locked"));
    return false;
  }
  if (quest.state === "completed" && current.state !== "completed" && !current.rewardsGranted) {
    const result = await completeWithAssignments(page, quest);
    if (!result.confirmed) return false;
    if (!result.success) return false;
  } else {
    await updateQuestDefinition(page, quest);
  }
  await syncRelations(page, quest.relatedQuestIds);
  const { refreshQuestJournalAccess } = await import("./quest-manager.mjs");
  await refreshQuestJournalAccess({ journal: page.parent });
  return true;
}

/** Sheet for quest JournalEntryPages. Player views are read-only and use normal document access. */
export class QuestPageSheet extends HandlebarsApplicationMixin(JournalEntryPageSheet) {
  static DEFAULT_OPTIONS = {
    classes: [MODULE_ID, "amras-quest-sheet"],
    tag: "form",
    position: { width: 660, height: 760 },
    window: { resizable: true, icon: "fa-solid fa-scroll" },
    form: { submitOnChange: false, closeOnSubmit: false },
    actions: {
      pickQuestIcon: QuestPageSheet.#pickIcon,
      saveQuest: QuestPageSheet.#save,
      openDocument: QuestPageSheet.#openDocument,
      openRelatedQuest: (event, target) => openRelatedQuest(target.dataset.uuid),
      addItemRow: QuestPageSheet.#addItemRow,
      removeItemRow: QuestPageSheet.#removeItemRow,
      addCurrencyRow: QuestPageSheet.#addCurrencyRow,
      removeCurrencyRow: QuestPageSheet.#removeCurrencyRow,
      addObserverRow: QuestPageSheet.#addObserverRow,
      removeObserverRow: QuestPageSheet.#removeObserverRow
    }
  };

  static #openDocument(event, target) {
    const document = resolve(target.dataset.uuid);
    if (!document) return;
    if (game.user.isGM || document.testUserPermission?.(game.user, CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER)) {
      document.sheet?.render({ force: true });
    }
  }

  static #addItemRow() {
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

  static PARTS = {
    form: { template: `${TEMPLATE_PATH}/quest-form.hbs`, scrollable: [""] }
  };

  static async #pickIcon() {
    if (!isGM()) return;
    const picker = foundry.applications.apps.FilePicker.implementation;
    await new picker({
      type: "image",
      current: this.document.system.icon,
      callback: path => {
        const input = this.element.querySelector("[name='icon']");
        if (input) input.value = path;
      }
    }).browse();
  }

  static async #save(event, target) {
    if (!isGM()) return;
    try {
      const quest = questFromForm(this.element, { page: this.document });
      if (await saveQuestPage(this.document, quest)) await this.render();
    } catch (error) {
      console.error(`${MODULE_ID} | Quest save failed`, error);
      ui.notifications.warn(t("notifications.questInvalid"));
    }
  }

  get questPage() { return this.document; }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    return Object.assign(context, buildQuestContext(this.document));
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    if (isGM()) installQuestDropHandlers(this.element);
  }
}

const DND_CURRENCIES = [
  ["pp", "platinum"], ["gp", "gold"], ["ep", "electrum"],
  ["sp", "silver"], ["cp", "copper"]
];

function currencyEntries(currency) {
  const entries = Object.entries(currency ?? {}).map(([key, amount]) => ({ key, amount }));
  if (game.system?.id !== "dnd5e") return entries;
  const denominations = DND_CURRENCIES.map(([key, name]) => ({
    key, amount: currency?.[key] ?? 0, fixed: true,
    label: t(`quest.rewards.denominations.${key}`),
    icon: `systems/dnd5e/icons/currency/${name}.webp`
  }));
  return [...denominations, ...entries.filter(entry => !DND_CURRENCIES.some(([key]) => key === entry.key))];
}

function decorateRelatedQuests(quests) {
  const counts = new Map();
  for (const quest of quests) {
    const name = quest.title.toLocaleLowerCase();
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return quests.map(quest => ({
    ...quest,
    displayTitle: counts.get(quest.title.toLocaleLowerCase()) > 1
      ? `${quest.title} (${quest.uuid})` : quest.title
  }));
}

export function buildQuestContext(page, { defaults = {}, relatedPages = allQuestPages(), creating = false } = {}) {
  const editable = isGM();
  if (!page) {
    const initial = {
      title: "",
      description: "",
      icon: DEFAULT_QUEST_ICON,
      giver: { actorUuid: "", factionUuid: "", ...(defaults.giver ?? {}) },
      state: "offered",
      rewards: { xp: 0, items: [], currency: {} },
      consequence: "",
      observers: defaults.observers ?? [],
      relatedQuestIds: []
    };
    const factions = game.journal.contents.flatMap(j => j.pages.contents)
      .filter(p => p.type === `${MODULE_ID}.faction`);
    return {
      editable,
      hasQuest: creating,
      quest: {
        ...initial,
        stateOptions: QUEST_STATES.map(state => ({
          key: state, label: t(`quest.states.${state}`), selected: state === initial.state
        })),
        observers: initial.observers.map(observer => ({
          type: observer.type,
          isActor: observer.type === "actor",
          isFaction: observer.type === "faction",
          value: `${observer.type}|${observer.uuid}`,
          uuid: observer.uuid,
          name: resolve(observer.uuid)?.name ?? observer.uuid,
          options: [
            ...factions.map(faction => ({
              value: `faction|${faction.uuid}`,
              label: faction.name,
              selected: observer.type === "faction" && observer.uuid === faction.uuid
            }))
          ]
        })),
        items: [],
        currencyEntries: currencyEntries(initial.rewards.currency),
        audit: []
      },
      factions: factions.map(faction => ({
        uuid: faction.uuid, name: faction.name, selected: faction.uuid === initial.giver.factionUuid
      })),
      observerOptions: factions.map(faction => ({ value: `faction|${faction.uuid}`, label: faction.name })),
      relatedQuests: decorateRelatedQuests(relatedPages.map(other => ({ ...pageState(other), linked: false }))),
      defaults
    };
  }
  const q = pageToQuest(page);
  const factions = game.journal.contents.flatMap(j => j.pages.contents)
    .filter(p => p.type === `${MODULE_ID}.faction`)
    .sort((a, b) => a.name.localeCompare(b.name)).map(faction => ({
    uuid: faction.uuid, name: faction.name, selected: faction.uuid === q.giver.factionUuid
  }));
  const observerRows = q.observers.map(observer => {
    const doc = resolve(observer.uuid);
    const options = factionPages().map(faction => ({
      value: `faction|${faction.uuid}`,
      label: faction.name,
      selected: observer.type === "faction" && observer.uuid === faction.uuid
    }));
    if (observer.type === "faction" && !options.some(option => option.selected)) {
      options.push({ value: `faction|${observer.uuid}`, label: observer.uuid, selected: true });
    }
    return {
      type: observer.type,
      isActor: observer.type === "actor",
      isFaction: observer.type === "faction",
      value: `${observer.type}|${observer.uuid}`,
      uuid: observer.uuid,
      name: doc?.name ?? observer.uuid,
      options
    };
  });
  const items = q.rewards.items.map(item => ({
    ...item, name: resolve(item.itemUuid)?.name ?? item.itemUuid
  }));
  const currencies = currencyEntries(q.rewards.currency);
  const related = relatedPages.filter(other => other.uuid !== page.uuid
    && (editable || q.relatedQuestIds.includes(other.uuid))).map(other => ({
    ...pageState(other), linked: q.relatedQuestIds.includes(other.uuid)
  }));
  if (editable) {
    for (const uuid of q.relatedQuestIds) {
      if (uuid !== page.uuid && !related.some(other => other.uuid === uuid)) {
        related.push({ uuid, title: uuid, linked: true, missing: true });
      }
    }
  }
  return {
    editable,
    hasQuest: true,
    quest: {
      ...q,
      stateLabel: t(`quest.states.${q.state}`),
      stateOptions: QUEST_STATES.map(state => ({ key: state, label: t(`quest.states.${state}`), selected: state === q.state })),
      giverActorName: resolve(q.giver.actorUuid)?.name ?? "",
      giverFactionName: resolve(q.giver.factionUuid)?.name ?? "",
      observers: observerRows,
      items,
      currencyEntries: currencies,
      audit: q.rewardAudit.slice().reverse(),
      auditRows: q.rewardAudit.slice().reverse().map(entry => ({
        ...entry,
        typeLabel: t(`quest.rewards.auditType.${entry.type}`),
        statusLabel: t(`quest.rewards.auditStatus.${entry.status}`),
        recipientText: (entry.recipientUuids ?? []).join(", "),
        currencyText: Object.entries(entry.currency ?? {}).map(([key, amount]) => `${amount} ${key}`).join(", ")
      })),
      hasAudit: q.rewardAudit.length > 0,
      rewardRemainderText: Object.entries(q.rewardRemainder ?? {}).map(([key, amount]) => `${amount} ${key}`).join(", "),
      hasRewardRemainder: Object.keys(q.rewardRemainder ?? {}).length > 0
    },
    factions,
    observerOptions: [
      ...game.journal.contents.flatMap(j => j.pages.contents)
        .filter(faction => faction.type === `${MODULE_ID}.faction`)
        .map(faction => ({ value: `faction|${faction.uuid}`, label: faction.name }))
    ],
    relatedQuests: decorateRelatedQuests(related),
    defaults
  };
}
