import { MODULE_ID, TEMPLATE_PATH } from "./constants.mjs";
import { FactionEditorMixin, buildFactionContext } from "./faction-editor.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { JournalEntryPageSheet } = foundry.applications.sheets.journal;

/** Sheet for faction journal pages. */
export class FactionPageSheet extends FactionEditorMixin(HandlebarsApplicationMixin(JournalEntryPageSheet)) {
  static DEFAULT_OPTIONS = {
    classes: [MODULE_ID, "amras-faction-sheet"],
    tag: "form",
    position: { width: 520, height: 640 },
    window: { resizable: true, icon: "fa-solid fa-flag" },
    form: { submitOnChange: false, closeOnSubmit: false }
  };

  static PARTS = {
    form: { template: `${TEMPLATE_PATH}/faction-form.hbs`, scrollable: [""] }
  };

  get factionPage() { return this.document; }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    return Object.assign(context, buildFactionContext(this.document));
  }
}
