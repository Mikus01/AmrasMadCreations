import { afterEach, describe, expect, it, vi } from "vitest";

class Field {
  constructor(...args) {
    this.args = args;
  }
}

afterEach(() => vi.unstubAllGlobals());

describe("faction data model", () => {
  it("adds organizational fields without removing legacy leadership or renown fields", async () => {
    vi.stubGlobal("foundry", {
      abstract: { TypeDataModel: class {} },
      data: { fields: {
        ArrayField: Field,
        SchemaField: Field,
        StringField: Field,
        FilePathField: Field,
        NumberField: Field,
        BooleanField: Field
      } }
    });
    const { FactionModel } = await import("../scripts/faction-model.mjs");
    const schema = FactionModel.defineSchema();
    expect(Object.keys(schema)).toEqual(expect.arrayContaining([
      "leadership", "roles", "organizationalMembers", "members", "history"
    ]));
    const roleFields = schema.roles.args[0].args[0];
    const memberFields = schema.organizationalMembers.args[0].args[0];
    expect(Object.keys(roleFields)).toEqual(["id", "name"]);
    expect(Object.keys(memberFields)).toEqual(["actorUuid", "roleId"]);
  });
});
