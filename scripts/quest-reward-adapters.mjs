/**
 * Foundry document adapters for quest rewards.
 *
 * A system is recognized here only when its reward fields are verified. The
 * adapter intentionally rejects unverified reward types instead of falling
 * back to a generic update which might corrupt another system's Actor data.
 */

export class UnsupportedRewardError extends Error {
  constructor(systemId, rewardType) {
    super(`Quest ${rewardType} rewards are not verified for the "${systemId ?? "unknown"}" system.`);
    this.name = "UnsupportedRewardError";
    this.systemId = systemId;
    this.rewardType = rewardType;
  }
}

const TEN_TO_ONE = Object.freeze([
  Object.freeze({ key: "pp", toLower: 10 }),
  Object.freeze({ key: "gp", toLower: 10 }),
  Object.freeze({ key: "sp", toLower: 10 }),
  Object.freeze({ key: "cp", toLower: null })
]);

const DND5E_DENOMINATIONS = Object.freeze([
  Object.freeze({ key: "pp", toLower: 10 }),
  Object.freeze({ key: "gp", toLower: 2 }),
  Object.freeze({ key: "ep", toLower: 5 }),
  Object.freeze({ key: "sp", toLower: 10 }),
  Object.freeze({ key: "cp", toLower: null })
]);

const SHADOWDARK_DENOMINATIONS = Object.freeze([
  Object.freeze({ key: "gp", toLower: 10 }),
  Object.freeze({ key: "sp", toLower: 10 }),
  Object.freeze({ key: "cp", toLower: null })
]);

const PROFILES = Object.freeze({
  dnd5e: Object.freeze({
    xpPath: "details.xp.value",
    currencyPath: "currency",
    currencyKeys: ["pp", "gp", "ep", "sp", "cp"],
    denominations: DND5E_DENOMINATIONS,
    item: true
  }),
  shadowdark: Object.freeze({
    xpPath: "level.xp",
    currencyPath: "coins",
    currencyKeys: ["gp", "sp", "cp"],
    denominations: SHADOWDARK_DENOMINATIONS,
    item: true
  }),
  pf2e: Object.freeze({
    xpPath: "details.xp.value",
    currencyMethod: "pf2e-add-coins",
    currencyKeys: ["pp", "gp", "sp", "cp"],
    denominations: TEN_TO_ONE,
    item: true
  }),
  // The Cosmere RPG source confirms a system.currency data model, but the
  // inspected current source did not establish a safe XP or currency-award
  // write API. Those reward types must remain manual until verified.
  "cosmere-rpg": Object.freeze({
    item: true
  })
});

function getProperty(object, path) {
  return path.split(".").reduce((value, part) => value?.[part], object);
}

async function defaultResolveUuid(uuid) {
  if (typeof globalThis.fromUuid !== "function") {
    throw new Error("Foundry's fromUuid API is unavailable; provide a UUID resolver.");
  }
  return globalThis.fromUuid(uuid);
}

function collectionResolver(collection) {
  if (!collection) return null;
  return async uuid => collection.get?.(uuid)
    ?? collection.contents?.find(document => document.uuid === uuid)
    ?? collection.find?.(document => document.uuid === uuid)
    ?? null;
}

function normalizeItemSource(item, quantity) {
  if (!item) throw new Error("The quest item could not be resolved.");
  const source = typeof item.toObject === "function" ? item.toObject() : structuredClone(item);
  if (!source || typeof source !== "object" || !source.system || typeof source.system !== "object") {
    throw new Error("The resolved item has no serializable system data.");
  }
  if (typeof source.system.quantity === "number") {
    source.system.quantity = quantity;
  } else if (quantity !== 1) {
    throw new Error("This system item has no verified system.quantity field for stack assignment.");
  }
  delete source._id;
  delete source.id;
  delete source.folder;
  delete source.sort;
  delete source.ownership;
  return source;
}

function validateCurrency(currency, allowedKeys) {
  if (!currency || typeof currency !== "object" || Array.isArray(currency)) {
    throw new TypeError("Currency award data must be an object.");
  }
  const updates = {};
  for (const [denomination, amount] of Object.entries(currency)) {
    if (!allowedKeys.includes(denomination)) {
      throw new Error(`Unsupported currency denomination: ${denomination}.`);
    }
    if (!Number.isSafeInteger(amount) || amount < 0) {
      throw new TypeError(`Currency amount ${denomination} must be a non-negative safe integer.`);
    }
    if (amount) updates[denomination] = amount;
  }
  return updates;
}

async function resolveFoundryDocument(resolveUuid, uuid, label) {
  if (typeof uuid !== "string" || !uuid.trim()) throw new TypeError(`${label} UUID is required.`);
  const document = await resolveUuid(uuid);
  if (!document) throw new Error(`${label} ${uuid} could not be resolved.`);
  return document;
}

/**
 * Create an adapter that resolves Actors and items by UUID.
 *
 * @param {object} options
 * @param {string} options.systemId Foundry game system id.
 * @param {Function} [options.resolveActor] Async Actor UUID resolver.
 * @param {Function} [options.resolveItem] Async Item UUID resolver.
 * @param {object} [options.actors] Foundry Actor collection.
 */
export function getQuestRewardAdapter(systemId, {
  resolveActor,
  resolveItem,
  actors
} = {}) {
  const profile = PROFILES[systemId];
  const collectionLookup = collectionResolver(actors);
  const actorResolver = resolveActor ?? (collectionLookup
    ? async uuid => await collectionLookup(uuid) ?? await defaultResolveUuid(uuid)
    : defaultResolveUuid);
  const itemResolver = resolveItem ?? defaultResolveUuid;
  const capabilities = Object.freeze({
    xp: Boolean(profile?.xpPath),
    items: Boolean(profile?.item),
    currency: Boolean(profile?.currencyPath || profile?.currencyMethod)
  });

  const applyAward = async (award, { idempotencyKey } = {}) => {
    if (!profile) throw new UnsupportedRewardError(systemId, award?.type ?? "unknown");
    if (!award || typeof award !== "object") throw new TypeError("An award object is required.");
    if (!idempotencyKey) throw new TypeError("An award idempotency key is required.");
    if (globalThis.game?.system?.id && globalThis.game.system.id !== systemId) {
      throw new Error(`Adapter "${systemId}" cannot award in active system "${globalThis.game.system.id}".`);
    }

    if (award.type === "remainder") {
      throw new Error("Currency remainder is an audit record and cannot be automatically awarded.");
    }
    if (award.type === "item") {
      if (!profile.item) throw new UnsupportedRewardError(systemId, "item");
      const actor = await resolveFoundryDocument(actorResolver, award.actorUuid, "Actor");
      if (typeof actor.createEmbeddedDocuments !== "function") {
        throw new Error("This Actor cannot receive embedded Item documents.");
      }
      if (!Number.isSafeInteger(award.quantity) || award.quantity < 1) {
        throw new TypeError("Item award quantity must be a positive safe integer.");
      }
      const item = await resolveFoundryDocument(itemResolver, award.itemUuid, "Item");
      const source = normalizeItemSource(item, award.quantity);
      await actor.createEmbeddedDocuments("Item", [source], { keepId: false });
      return;
    }

    const actor = await resolveFoundryDocument(actorResolver, award.actorUuid, "Actor");

    if (award.type === "xp") {
      if (!profile.xpPath) throw new UnsupportedRewardError(systemId, "XP");
      if (typeof actor.update !== "function") throw new Error("This Actor cannot be updated.");
      if (!Number.isSafeInteger(award.amount) || award.amount < 0) {
        throw new TypeError("XP award amount must be a non-negative safe integer.");
      }
      const current = getProperty(actor.system, profile.xpPath);
      if (!Number.isSafeInteger(current) || current < 0) {
        throw new Error(`Actor does not expose a valid system.${profile.xpPath} XP field.`);
      }
      const next = current + award.amount;
      if (!Number.isSafeInteger(next)) throw new RangeError("Updated XP exceeds the safe integer range.");
      await actor.update({ [`system.${profile.xpPath}`]: next });
      return;
    }

    if (award.type === "currency") {
      const values = validateCurrency(award.currency, profile.currencyKeys ?? []);
      if (!profile.currencyPath && !profile.currencyMethod) {
        throw new UnsupportedRewardError(systemId, "currency");
      }
      if (profile.currencyMethod === "pf2e-add-coins") {
        if (typeof actor.inventory?.addCoins !== "function") {
          throw new Error("PF2e Actor does not expose the verified inventory.addCoins API.");
        }
        await actor.inventory.addCoins(values);
        return;
      }
      if (typeof actor.update !== "function") throw new Error("This Actor cannot be updated.");
      const current = getProperty(actor.system, profile.currencyPath);
      if (!current || typeof current !== "object") {
        throw new Error(`Actor does not expose system.${profile.currencyPath} currency data.`);
      }
      const updates = {};
      for (const [denomination, amount] of Object.entries(values)) {
        if (!Object.hasOwn(current, denomination) || !Number.isSafeInteger(current[denomination])) {
          throw new Error(`Actor does not expose the ${denomination} currency field.`);
        }
        const next = current[denomination] + amount;
        if (!Number.isSafeInteger(next)) throw new RangeError(`${denomination} currency exceeds the safe integer range.`);
        updates[`system.${profile.currencyPath}.${denomination}`] = next;
      }
      if (Object.keys(updates).length) await actor.update(updates);
      return;
    }

    throw new UnsupportedRewardError(systemId, award.type);
  };

  return Object.freeze({
    systemId,
    supported: Boolean(profile),
    capabilities,
    denominations: profile?.denominations,
    applyAward
  });
}

/** Alias emphasizing that the returned adapter is a configured handler. */
export const createQuestRewardAdapter = getQuestRewardAdapter;
