import { MODULE_ID, TEMPLATE_PATH, FACTION_TYPE } from "./constants.mjs";
import { FactionEditorMixin, buildFactionContext, pageToFaction } from "./faction-editor.mjs";
import { canEdit, canView } from "./permissions.mjs";
import { getJournalFolder } from "./journal-organization.mjs";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

/** Standalone manager listing all factions the user may see. */
export class FactionManager extends FactionEditorMixin(HandlebarsApplicationMixin(ApplicationV2)) {
  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-faction-manager`,
    classes: [MODULE_ID, "amras-faction-manager"],
    position: { width: 860, height: 640 },
    window: { title: `${MODULE_ID}.manager.title`, resizable: true, icon: "fa-solid fa-flag" },
    actions: {
      selectFaction: FactionManager.#onSelect,
      createFaction: FactionManager.#onCreate,
      deleteFaction: FactionManager.#onDelete,
      openSheet: FactionManager.#onOpenSheet
    }
  };

  static PARTS = {
    list: { template: `${TEMPLATE_PATH}/faction-list.hbs`, scrollable: [".amras-faction-list"] },
    form: { template: `${TEMPLATE_PATH}/faction-form.hbs`, scrollable: [""] }
  };

  /** @type {string|null} */
  selectedUuid = null;

  /** All faction pages visible to the current user. */
  static getVisiblePages() {
    const ownedActorUuids = game.actors.filter(a => a.isOwner).map(a => a.uuid);
    const viewer = { isGM: game.user.isGM, ownedActorUuids };
    return game.journal.contents
      .flatMap(j => j.pages.contents)
      .filter(p => p.type === FACTION_TYPE && canView(viewer, pageToFaction(p)))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  get factionPage() {
    if (!this.selectedUuid) return null;
    const page = fromUuidSync(this.selectedUuid);
    return page && page.type === FACTION_TYPE ? page : null;
  }

  async _preparePartContext(partId, context, options) {
    context = await super._preparePartContext(partId, context, options);
    if (partId === "list") {
      const pages = FactionManager.getVisiblePages();
      if (this.selectedUuid && !pages.some(p => p.uuid === this.selectedUuid)) this.selectedUuid = null;
      context.editable = canEdit({ isGM: game.user.isGM });
      context.factions = pages.map(p => ({
        uuid: p.uuid, name: p.name, img: p.system.img, selected: p.uuid === this.selectedUuid
      }));
    } else if (partId === "form") {
      Object.assign(context, buildFactionContext(this.factionPage));
      context.inManager = true;
    }
    return context;
  }

  static async #onSelect(event, target) {
    this.selectedUuid = target.dataset.uuid;
    await this.render();
  }

  static async #onOpenSheet() {
    this.factionPage?.sheet.render({ force: true });
  }

  static async #onCreate() {
    if (!canEdit({ isGM: game.user.isGM })) return;
    const name = await DialogV2.prompt({
      window: { title: game.i18n.localize(`${MODULE_ID}.manager.create`) },
      content: `<div class="form-group"><label>${game.i18n.localize(`${MODULE_ID}.faction.name`)}</label>
        <input type="text" name="name" autofocus></div>`,
      ok: { callback: (event, button) => button.form.elements.name.value.trim() },
      rejectClose: false
    });
    if (!name) return;
    try {
      const folder = await getJournalFolder("faction");
      const journal = await foundry.documents.JournalEntry.implementation.create({
        name, folder: folder.id,
        pages: [{ name, type: FACTION_TYPE }]
      });
      this.selectedUuid = journal.pages.contents[0].uuid;
      await this.render();
    } catch (error) {
      console.error(`${MODULE_ID} | Faction creation failed`, error);
      ui.notifications.error(game.i18n.localize(`${MODULE_ID}.notifications.factionCreateFailed`));
    }
  }

  static async #onDelete() {
    const page = this.factionPage;
    if (!page || !canEdit({ isGM: game.user.isGM })) return;
    const ok = await DialogV2.confirm({
      window: { title: game.i18n.localize(`${MODULE_ID}.manager.delete`) },
      content: `<p>${game.i18n.format(`${MODULE_ID}.manager.deleteConfirm`, { name: foundry.utils.escapeHTML(page.name) })}</p>`,
      rejectClose: false
    });
    if (!ok) return;
    this.selectedUuid = null;
    // Delete the whole journal when the faction is its only page.
    if (page.parent.pages.size === 1) await page.parent.delete();
    else await page.delete();
  }
}

/** The single open manager, if any. */
export function refreshManager() {
  const app = foundry.applications.instances.get(FactionManager.DEFAULT_OPTIONS.id);
  if (app?.rendered) app.render();
}
