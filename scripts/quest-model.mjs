import { MODULE_ID } from "./constants.mjs";
import { DEFAULT_QUEST_ICON, QUEST_STATES } from "./quest.mjs";

const f = foundry.data.fields;

export const QUEST_TYPE = `${MODULE_ID}.quest`;

const STATE_CHOICES = Object.fromEntries(QUEST_STATES.map(state => [
  state,
  `${MODULE_ID}.quest.states.${state}`
]));

/** DataModel stored on quest JournalEntryPages. */
export class QuestModel extends foundry.abstract.TypeDataModel {
  static LOCALIZATION_PREFIXES = [`${MODULE_ID}.quest`];

  static defineSchema() {
    return {
      icon: new f.FilePathField({ categories: ["IMAGE"], initial: DEFAULT_QUEST_ICON }),
      description: new f.StringField({ required: true, blank: false, initial: "" }),
      giver: new f.SchemaField({
        actorUuid: new f.StringField({ initial: "" }),
        factionUuid: new f.StringField({ initial: "" })
      }),
      state: new f.StringField({ choices: STATE_CHOICES, initial: "offered" }),
      rewards: new f.SchemaField({
        xp: new f.NumberField({ integer: true, min: 0, initial: 0 }),
        items: new f.ArrayField(new f.SchemaField({
          itemUuid: new f.StringField({ required: true, blank: false }),
          quantity: new f.NumberField({ required: true, integer: true, min: 1 })
        })),
        currency: new f.ObjectField({ initial: {} })
      }),
      consequence: new f.StringField({ initial: "" }),
      observers: new f.ArrayField(new f.SchemaField({
        type: new f.StringField({ required: true, choices: { actor: "actor", faction: "faction" } }),
        uuid: new f.StringField({ required: true, blank: false })
      })),
      acceptedActorUuids: new f.ArrayField(new f.StringField({ required: true, blank: false })),
      relatedQuestIds: new f.ArrayField(new f.StringField({ required: true, blank: false })),
      rewardAudit: new f.ArrayField(new f.SchemaField({
        id: new f.StringField({ initial: "" }),
        idempotencyKey: new f.StringField({ required: true, blank: false }),
        type: new f.StringField({ required: true }),
        actorUuid: new f.StringField({ initial: "" }),
        recipientUuids: new f.ArrayField(new f.StringField({ required: true, blank: false })),
        status: new f.StringField({
          required: true,
          choices: {
            pending: "pending", awarded: "awarded", failed: "failed",
            unknown: "unknown", unawarded: "unawarded"
          }
        }),
        amount: new f.NumberField({ nullable: true }),
        itemUuid: new f.StringField({ initial: "" }),
        quantity: new f.NumberField({ nullable: true, integer: true }),
        currency: new f.ObjectField({ nullable: true }),
        copy: new f.BooleanField({ initial: false }),
        unawarded: new f.BooleanField({ initial: false }),
        error: new f.StringField({ initial: "" }),
        timestamp: new f.StringField({ initial: "" }),
        reconciledAt: new f.StringField({ initial: "" })
      })),
      rewardsGranted: new f.BooleanField({ initial: false }),
      rewardsLocked: new f.BooleanField({ initial: false }),
      rewardRemainder: new f.ObjectField({ initial: {} })
    };
  }
}
