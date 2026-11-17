import { DEFAULT_FACTION_IMG, LEADER_RANK } from "./faction.mjs";
import { RENOWN_MIN, RENOWN_MAX } from "./renown.mjs";

const f = foundry.data.fields;

export class FactionModel extends foundry.abstract.TypeDataModel {
  static LOCALIZATION_PREFIXES = ["amras-mad-inventions.faction"];

  static defineSchema() {
    return {
      img: new f.FilePathField({ categories: ["IMAGE"], initial: DEFAULT_FACTION_IMG }),
      description: new f.StringField({ initial: "" }),
      leadership: new f.ArrayField(new f.SchemaField({
        actorUuid: new f.StringField({ required: true, blank: false }),
        rank: new f.StringField({ required: true, initial: LEADER_RANK })
      })),
      roles: new f.ArrayField(new f.SchemaField({
        id: new f.StringField({ required: true, blank: false }),
        name: new f.StringField({ required: true, blank: false })
      })),
      organizationalMembers: new f.ArrayField(new f.SchemaField({
        actorUuid: new f.StringField({ required: true, blank: false }),
        roleId: new f.StringField({ required: true, blank: false })
      })),
      goals: new f.ArrayField(new f.SchemaField({
        id: new f.StringField({ required: true, blank: false }),
        title: new f.StringField({ required: true, blank: false }),
        description: new f.StringField({ initial: "" }),
        completed: new f.BooleanField({ initial: false })
      })),
      members: new f.ArrayField(new f.SchemaField({
        actorUuid: new f.StringField({ required: true, blank: false }),
        points: new f.NumberField({ required: true, integer: true, min: RENOWN_MIN, max: RENOWN_MAX, initial: 0 })
      })),
      history: new f.ArrayField(new f.SchemaField({
        actorUuid: new f.StringField({ required: true }),
        from: new f.NumberField({ required: true, integer: true }),
        to: new f.NumberField({ required: true, integer: true }),
        reason: new f.StringField({ initial: "" }),
        user: new f.StringField({ initial: "" }),
        timestamp: new f.NumberField({ required: true, integer: true })
      }))
    };
  }
}
