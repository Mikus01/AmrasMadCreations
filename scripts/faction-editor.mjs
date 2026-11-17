import { MODULE_ID } from "./constants.mjs";
import {
  addGoal, toggleGoal, removeGoal, addMember, removeMember, setRenown
} from "./faction.mjs";
import { RENOWN_MIN, RENOWN_MAX, getRenownLevel } from "./renown.mjs";
import { canEdit } from "./permissions.mjs";
import { buildFactionQuestSection, createQuestFromFaction, openQuestPage } from "./quest-manager.mjs";
import {
  addRole, renameRole, moveRole, deleteRole, assignMember, removeMember as removeOrganizationMember, moveMember
} from "./faction-organization.mjs";

const i18n = key => game.i18n.localize(`${MODULE_ID}.${key}`);
const format = (key, data) => game.i18n.format(`${MODULE_ID}.${key}`, data);

/** Read a faction page into the plain shape used by the pure logic. */
export function pageToFaction(page) {
  const s = page.system;
  return {
    name: page.name,
    img: s.img,
    description: s.description,
    leadership: (s.leadership ?? []).map(l => ({ actorUuid: l.actorUuid, rank: l.rank })),
    roles: (s.roles ?? []).map(role => ({ id: role.id, name: role.name })),
    organizationalMembers: (s.organizationalMembers ?? []).map(member => ({
      actorUuid: member.actorUuid, roleId: member.roleId
    })),
    goals: s.goals.map(g => ({ id: g.id, title: g.title, description: g.description, completed: g.completed })),
    members: s.members.map(m => ({ actorUuid: m.actorUuid, points: m.points })),
    history: s.history.map(h => ({
      actorUuid: h.actorUuid, from: h.from, to: h.to, reason: h.reason, user: h.user, timestamp: h.timestamp
    }))
  };
}

function actorInfo(uuid) {
  let actor = null;
  try { actor = fromUuidSync(uuid); } catch { /* unresolved */ }
  return { uuid, name: actor?.name ?? i18n("faction.unknownActor"), img: actor?.img ?? "icons/svg/mystery-man.svg" };
}

/** Build the template context shared by the page sheet and the Faction Manager. */
export function buildFactionContext(page) {
  const editable = canEdit({ isGM: game.user.isGM });
  if (!page) return { editable, hasFaction: false, renownMin: RENOWN_MIN, renownMax: RENOWN_MAX };
  const faction = pageToFaction(page);
  const levelLabel = points => i18n(`renown.levels.${getRenownLevel(points)}`);
  return {
    editable,
    hasFaction: true,
    ...buildFactionQuestSection(page),
    renownMin: RENOWN_MIN,
    renownMax: RENOWN_MAX,
    faction: {
      name: faction.name,
      img: faction.img,
      description: faction.description,
      roles: faction.roles.map((role, index) => ({
        ...role,
        index,
        members: faction.organizationalMembers
          .filter(member => member.roleId === role.id)
          .map(member => ({ ...actorInfo(member.actorUuid) }))
      })),
      goals: faction.goals,
      members: faction.members.map(m => ({
        ...actorInfo(m.actorUuid),
        points: m.points,
        levelKey: getRenownLevel(m.points),
        levelLabel: levelLabel(m.points)
      })),
      history: faction.history.slice(-10).reverse().map(h => ({
        actor: actorInfo(h.actorUuid).name,
        from: h.from,
        to: h.to,
        reason: h.reason,
        user: game.users.get(h.user)?.name ?? "",
        date: new Date(h.timestamp).toLocaleString()
      }))
    }
  };
}

async function postLevelChange(page, actorUuid, levelChange) {
  const content = format("chat.levelChange", {
    actor: foundry.utils.escapeHTML(actorInfo(actorUuid).name),
    faction: foundry.utils.escapeHTML(page.name),
    from: i18n(`renown.levels.${levelChange.from}`),
    to: i18n(`renown.levels.${levelChange.to}`)
  });
  await ChatMessage.implementation.create({
    content: `<p class="amras-mad-inventions chat-renown">${content}</p>`,
    speaker: { alias: page.name }
  });
}

/** Apply a pure transformation to the page's faction data and persist it. */
async function commit(page, fn) {
  if (!canEdit({ isGM: game.user.isGM })) return null;
  const faction = pageToFaction(page);
  const result = fn(faction);
  if (result === faction) return null;
  const next = result.faction ?? result;
  const changes = factionUpdate(faction, next);
  if (Object.keys(changes).length) await page.update(changes);
  return result;
}

export function factionUpdate(previous, next) {
  const changes = {};
  for (const key of ["leadership", "roles", "organizationalMembers", "goals", "members", "history"]) {
    if (JSON.stringify(previous[key]) !== JSON.stringify(next[key])) changes[`system.${key}`] = next[key];
  }
  return changes;
}

async function dropActor(event) {
  const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
  if (data?.type !== "Actor" || !data.uuid) return null;
  return data.uuid;
}

/** Action handlers; `this` is the application instance (needs `factionPage`). */
const ACTIONS = {
  async createFactionQuest() {
    await createQuestFromFaction(this.factionPage);
  },
  openFactionQuest(event, target) {
    if (!openQuestPage(target.dataset.uuid)) ui.notifications.warn(i18n("quest.unavailable"));
  },
  async pickImage() {
    const page = this.factionPage;
    if (!page || !canEdit({ isGM: game.user.isGM })) return;
    const FP = foundry.applications.apps.FilePicker.implementation;
    await new FP({
      type: "image",
      current: page.system.img,
      callback: path => page.update({ "system.img": path })
    }).browse();
  },
  async addGoal(event, target) {
    const root = target.closest(".amras-faction-form");
    const title = root.querySelector("[data-goal-title]");
    const desc = root.querySelector("[data-goal-description]");
    if (!title.value.trim()) {
      ui.notifications.warn(i18n("notifications.goalTitleRequired"));
      return;
    }
    await commit(this.factionPage, f => addGoal(f, { title: title.value, description: desc.value }));
  },
  async toggleGoal(event, target) {
    await commit(this.factionPage, f => toggleGoal(f, target.dataset.goalId));
  },
  async removeGoal(event, target) {
    await commit(this.factionPage, f => removeGoal(f, target.dataset.goalId));
  },
  async removeMember(event, target) {
    await commit(this.factionPage, f => removeMember(f, target.dataset.actorUuid));
  },
  async addRole(event, target) {
    const root = target.closest(".amras-faction-form");
    const input = root.querySelector("[data-role-name]");
    if (!input.value.trim()) {
      ui.notifications.warn(i18n("notifications.roleNameRequired"));
      return;
    }
    await commit(this.factionPage, f => addRole(f, { name: input.value }, { isGM: game.user.isGM }));
  },
  async deleteRole(event, target) {
    const page = this.factionPage;
    const faction = page && pageToFaction(page);
    if (!faction || !canEdit({ isGM: game.user.isGM })) return;
    const roleId = target.dataset.roleId;
    const affected = faction.organizationalMembers.filter(member => member.roleId === roleId);
    let reassignRoleId = null;
    if (affected.length) {
      const options = faction.roles.filter(role => role.id !== roleId);
      if (!options.length) {
        ui.notifications.warn(i18n("notifications.lastRole"));
        return;
      }
      const choices = options.map(role =>
        `<option value="${foundry.utils.escapeHTML(role.id)}">${foundry.utils.escapeHTML(role.name)}</option>`
      ).join("");
      reassignRoleId = await foundry.applications.api.DialogV2.prompt({
        window: { title: i18n("faction.reassignBeforeDelete") },
        content: `<div class="form-group"><label>${i18n("faction.reassignRole")}</label>
          <select name="roleId">${choices}</select></div>`,
        ok: { callback: (event, button) => button.form.elements.roleId.value },
        rejectClose: false
      });
      if (!reassignRoleId) return;
    }
    await commit(page, f => deleteRole(f, roleId, reassignRoleId, { isGM: game.user.isGM }));
  },
  async removeOrganizationMember(event, target) {
    await commit(this.factionPage, f =>
      removeOrganizationMember(f, target.dataset.actorUuid, { isGM: game.user.isGM }));
  }
};

/**
 * Mixin giving an ApplicationV2 the faction editing behaviour.
 * The host must provide a `factionPage` getter.
 */
export function FactionEditorMixin(Base) {
  return class FactionEditor extends Base {
    static DEFAULT_OPTIONS = {
      actions: { ...ACTIONS }
    };

    /** Change handler for renown inputs. */
    async _changeRenown(actorUuid, value) {
      const page = this.factionPage;
      const points = Number(value);
      if (!page || !Number.isFinite(points)) return this.render();
      const current = page.system.members.find(m => m.actorUuid === actorUuid)?.points;
      if (current === undefined || current === Math.round(Math.min(RENOWN_MAX, Math.max(RENOWN_MIN, points)))) {
        return this.render();
      }
      const result = await commit(page, f => setRenown(f, actorUuid, Math.round(points), {
        reason: "", user: game.user.id, timestamp: Date.now()
      }));
      if (result?.levelChange) await postLevelChange(page, actorUuid, result.levelChange);
    }

    async _onRender(context, options) {
      await super._onRender(context, options);
      const root = this.element;
      const page = this.factionPage;
      if (!page || !canEdit({ isGM: game.user.isGM })) return;

      // Text fields.
      root.querySelector("[data-field='name']")?.addEventListener("change", ev => {
        const name = ev.target.value.trim();
        if (name) page.update({ name });
        else ev.target.value = page.name;
      });
      root.querySelector("[data-field='description']")?.addEventListener("change", ev => {
        page.update({ "system.description": ev.target.value });
      });
      root.querySelector("[data-role-name]")?.addEventListener("keydown", ev => {
        if (ev.key !== "Enter") return;
        ev.preventDefault();
        ACTIONS.addRole.call(this, ev, ev.target);
      });
      for (const input of root.querySelectorAll("[data-role-edit]")) {
        input.addEventListener("change", async ev => {
          const roleId = ev.target.dataset.roleId;
          const name = ev.target.value.trim();
          if (!name) {
            ev.target.value = (page.system.roles ?? []).find(role => role.id === roleId)?.name ?? "";
            ui.notifications.warn(i18n("notifications.roleNameRequired"));
            return;
          }
          await commit(page, f => renameRole(f, roleId, name, { isGM: game.user.isGM }));
        });
      }
      root.querySelector("[data-goal-title]")?.addEventListener("keydown", ev => {
        if (ev.key !== "Enter") return;
        ev.preventDefault();
        ACTIONS.addGoal.call(this, ev, ev.target);
      });

      // Renown controls.
      for (const box of root.querySelectorAll(".amras-renown")) {
        const range = box.querySelector("input[type=range]");
        const number = box.querySelector("input[type=number]");
        range.addEventListener("input", () => { number.value = range.value; });
        const onChange = ev => this._changeRenown(box.dataset.actorUuid, ev.target.value);
        range.addEventListener("change", onChange);
        number.addEventListener("change", onChange);
      }

      // Drag & drop of Actors.
      for (const zone of root.querySelectorAll("[data-drop]")) {
        zone.addEventListener("dragover", ev => { ev.preventDefault(); zone.classList.add("drag-over"); });
        zone.addEventListener("dragleave", () => zone.classList.remove("drag-over"));
        zone.addEventListener("drop", async ev => {
          ev.preventDefault();
          zone.classList.remove("drag-over");
          const uuid = await dropActor(ev);
          if (!uuid) return ui.notifications.warn(i18n("notifications.dropActor"));
          if (zone.dataset.drop === "member") await commit(page, f => addMember(f, uuid));
        });
      }

      // Reorder roles and assign existing/new Actors by dropping on a role.
      const roleType = "application/x-amras-faction-role";
      const memberType = "application/x-amras-faction-member";
      for (const handle of root.querySelectorAll("[data-role-drag]")) {
        handle.addEventListener("dragstart", event => {
          const role = handle.closest("[data-org-role]");
          event.dataTransfer?.setData(roleType, role.dataset.roleId);
          if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
        });
      }
      for (const member of root.querySelectorAll("[data-org-member]")) {
        member.addEventListener("dragstart", event => {
          event.dataTransfer?.setData(memberType, member.dataset.actorUuid);
          if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
        });
      }
      for (const zone of root.querySelectorAll("[data-org-role]")) {
        zone.addEventListener("dragover", event => {
          event.preventDefault();
          zone.classList.add("drag-over");
        });
        zone.addEventListener("dragleave", () => zone.classList.remove("drag-over"));
        zone.addEventListener("drop", async event => {
          event.preventDefault();
          zone.classList.remove("drag-over");
          const roleId = zone.dataset.roleId;
          const draggedRole = event.dataTransfer?.getData(roleType);
          if (draggedRole) {
            const index = Number(zone.dataset.roleIndex);
            await commit(page, f => moveRole(f, draggedRole, index, { isGM: game.user.isGM }));
            return;
          }
          const draggedMember = event.dataTransfer?.getData(memberType);
          if (draggedMember) {
            await commit(page, f => moveMember(f, draggedMember, roleId, { isGM: game.user.isGM }));
            return;
          }
          const uuid = await dropActor(event);
          if (!uuid) return ui.notifications.warn(i18n("notifications.dropActor"));
          await commit(page, f => assignMember(f, uuid, roleId, { isGM: game.user.isGM }));
        });
      }
    }
  };
}
