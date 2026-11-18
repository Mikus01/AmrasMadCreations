import { MODULE_ID } from "./constants.mjs";

const localize = key => game.i18n.localize(`${MODULE_ID}.quest.${key}`);

function clearGiver(root) {
  root.querySelector("[name='giverActorUuid']").value = "";
  root.querySelector("[data-giver-name]").textContent = localize("dropActor");
  root.querySelector("[data-clear-giver]").hidden = true;
}

function observerRow(root, uuid) {
  return [...root.querySelectorAll("[data-actor-observer]")]
    .find(row => row.dataset.actorObserver === uuid);
}

function acceptedRow(root, uuid) {
  return [...root.querySelectorAll("[data-accepted-actor]")]
    .find(row => row.dataset.acceptedActor === uuid);
}

export function findRelatedQuests(quests, query, selected = []) {
  const search = query.trim().toLocaleLowerCase();
  if (!search) return [];
  const excluded = new Set(selected);
  return quests.filter(quest => !excluded.has(quest.uuid)
    && (quest.title.toLocaleLowerCase().includes(search) || quest.uuid.toLocaleLowerCase().includes(search)));
}

let relatedPickerId = 0;
function installRelatedQuestPicker(root) {
  const picker = root.querySelector("[data-related-picker]");
  if (!picker) return;
  const input = picker.querySelector("[data-related-search]");
  const results = picker.querySelector("[data-related-results]");
  const selected = picker.querySelector("[data-related-selected]");
  const rowTemplate = picker.querySelector("[data-related-row]");
  const candidates = [...picker.querySelector("[data-related-candidates]").content.querySelectorAll("[data-related-candidate]")]
    .map(candidate => ({ uuid: candidate.dataset.uuid, title: candidate.dataset.title }));
  results.id = `${MODULE_ID}-related-results-${++relatedPickerId}`;
  input.setAttribute("aria-controls", results.id);

  const close = () => {
    results.hidden = true;
    input.setAttribute("aria-expanded", "false");
  };
  const renderResults = () => {
    const matches = findRelatedQuests(candidates, input.value,
      [...selected.querySelectorAll("[name='relatedQuestIds']")].map(element => element.value));
    results.replaceChildren();
    if (!input.value.trim()) return close();
    const names = new Map();
    for (const candidate of candidates) {
      const name = candidate.title.toLocaleLowerCase();
      names.set(name, (names.get(name) ?? 0) + 1);
    }
    for (const quest of matches) {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("role", "option");
      button.textContent = names.get(quest.title.toLocaleLowerCase()) > 1
        ? `${quest.title} (${quest.uuid})` : quest.title;
      button.addEventListener("click", () => {
        const row = rowTemplate.content.firstElementChild.cloneNode(true);
        row.querySelector("[name='relatedQuestIds']").value = quest.uuid;
        const title = row.querySelector("[data-related-title]");
        title.textContent = button.textContent;
        title.dataset.uuid = quest.uuid;
        selected.append(row);
        input.value = "";
        close();
        input.focus();
      });
      item.append(button);
      results.append(item);
    }
    if (!matches.length) {
      const item = document.createElement("li");
      item.className = "amras-empty";
      item.textContent = localize("relatedNoResults");
      results.append(item);
    }
    results.hidden = false;
    input.setAttribute("aria-expanded", "true");
  };
  input.addEventListener("input", renderResults);
  input.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      close();
    } else if (event.key === "Enter" && !results.hidden) {
      event.preventDefault();
      results.querySelector("button")?.click();
    } else if (event.key === "ArrowDown" && !results.hidden) {
      event.preventDefault();
      results.querySelector("button")?.focus();
    }
  });
  picker.addEventListener("click", event => {
    const remove = event.target.closest("[data-related-remove]");
    if (!remove || !picker.contains(remove)) return;
    remove.closest("[data-related-selection]").remove();
    if (!results.hidden) renderResults();
  });
  picker.addEventListener("focusout", event => {
    if (!picker.contains(event.relatedTarget)) close();
  });
}

export async function applyQuestDrop(root, kind, data) {
  if (!game.user.isGM) throw new Error("Only a GM can edit quests.");
  const expected = kind === "item" ? "Item" : "Actor";
  if (!["giver", "observer", "accepted", "item"].includes(kind) || data?.type !== expected || !data.uuid) {
    throw new Error(localize("invalidDrop"));
  }
  const document = await fromUuid(data.uuid);
  if (!document || document.documentName !== expected || !document.uuid) {
    throw new Error(localize("invalidDrop"));
  }
  const uuid = document.uuid;
  const accepted = kind === "item" ? null : acceptedRow(root, uuid);
  if ((kind === "accepted" || accepted)
    && !root.querySelector("[data-quest-drop='accepted']")) {
    throw new Error(localize("acceptedLocked"));
  }
  if (kind === "giver") {
    accepted?.remove();
    observerRow(root, uuid)?.remove();
    root.querySelector("[name='giverActorUuid']").value = uuid;
    root.querySelector("[data-giver-name]").textContent = document.name;
    root.querySelector("[data-clear-giver]").hidden = false;
  } else if (kind === "observer") {
    accepted?.remove();
    if (root.querySelector("[name='giverActorUuid']").value === uuid) clearGiver(root);
    if (observerRow(root, uuid)) return;
    const row = root.querySelector("[data-actor-observer-template]").content.firstElementChild.cloneNode(true);
    row.dataset.actorObserver = uuid;
    row.querySelector("[name='observer']").value = `actor|${uuid}`;
    row.querySelector("[data-observer-name]").textContent = document.name;
    root.querySelector("[data-actor-observers]").append(row);
  } else if (kind === "accepted") {
    if (root.querySelector("[name='giverActorUuid']").value === uuid) clearGiver(root);
    observerRow(root, uuid)?.remove();
    if (accepted) return;
    const row = root.querySelector("[data-accepted-actor-template]").content.firstElementChild.cloneNode(true);
    row.dataset.acceptedActor = uuid;
    row.querySelector("[name='acceptedActorUuids']").value = uuid;
    const name = row.querySelector("[data-accepted-name]");
    name.textContent = document.name;
    name.dataset.uuid = uuid;
    root.querySelector("[data-accepted-actors]").append(row);
  } else {
    if (!root.querySelector("[data-quest-drop='item']")) throw new Error(localize("rewards.locked"));
    const existing = [...root.querySelectorAll("[data-item-row]")]
      .find(row => row.querySelector("[name='itemUuid']").value === uuid);
    if (existing) {
      const input = existing.querySelector("[name='itemQuantity']");
      const quantity = Number(input.value);
      if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity >= Number.MAX_SAFE_INTEGER) {
        throw new Error(localize("rewards.invalidItem"));
      }
      input.value = quantity + 1;
      return;
    }
    const row = root.querySelector("[data-item-row-template]").content.firstElementChild.cloneNode(true);
    row.querySelector("[name='itemUuid']").value = uuid;
    row.querySelector("[data-item-name]").textContent = document.name;
    root.querySelector("[data-item-rows]").append(row);
  }
}

export function installQuestDropHandlers(root) {
  installRelatedQuestPicker(root);
  root.querySelector("[data-accepted-actors]")?.addEventListener("click", event => {
    const button = event.target.closest("[data-remove-accepted]");
    if (!button) return;
    if (!game.user.isGM || !root.querySelector("[data-quest-drop='accepted']")) {
      ui.notifications.warn(localize("acceptedLocked"));
      return;
    }
    button.closest("[data-accepted-actor]").remove();
  });
  const clear = root.querySelector("[data-clear-giver]");
  clear?.addEventListener("click", () => clearGiver(root));
  for (const row of root.querySelectorAll("[data-item-row]")) {
    const uuid = row.querySelector("[name='itemUuid']")?.value;
    const label = row.querySelector("[data-item-name]");
    if (uuid && label) {
      fromUuid(uuid).then(item => {
        if (item?.documentName === "Item") label.textContent = item.name;
      }).catch(error => console.warn(`${MODULE_ID} | Could not resolve quest item ${uuid}`, error));
    }
  }
  for (const zone of root.querySelectorAll("[data-quest-drop]")) {
    zone.addEventListener("dragover", event => {
      event.preventDefault();
      zone.classList.add("drag-over");
    });
    zone.addEventListener("dragleave", () => zone.classList.remove("drag-over"));
    zone.addEventListener("drop", async event => {
      event.preventDefault();
      zone.classList.remove("drag-over");
      try {
        const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
        await applyQuestDrop(root, zone.dataset.questDrop, data);
      } catch (error) {
        console.error(`${MODULE_ID} | Quest drop failed`, error);
        ui.notifications.warn(error.message === localize("acceptedLocked")
          ? localize("acceptedLocked") : localize("invalidDrop"));
      }
    });
  }
}
