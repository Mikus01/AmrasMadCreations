const REWARD_STATES = Object.freeze(["awarded", "failed", "pending", "unawarded", "unknown"]);
const ACTIVE_COMPLETIONS = new Set();

function assertGM(user) {
  if (!user?.isGM) throw new Error("Only a GM can complete a quest and distribute rewards.");
}

function finiteNonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer.`);
  }
}

function copy(value) {
  return structuredClone(value);
}

function normalizeRecipients(value, label) {
  if (!Array.isArray(value)) throw new TypeError(`${label} assignments must be an array of Actor UUIDs.`);
  if (value.some(uuid => typeof uuid !== "string" || !uuid.trim())) {
    throw new TypeError(`${label} assignments must contain nonblank Actor UUIDs.`);
  }
  if (new Set(value).size !== value.length) throw new Error(`${label} assignments cannot contain duplicate Actor UUIDs.`);
  return [...value];
}

function validateRewardDefinitions(rewards = {}) {
  const xp = rewards.xp ?? 0;
  finiteNonNegativeInteger(xp, "XP reward");
  if (!Array.isArray(rewards.items ?? [])) throw new TypeError("Item rewards must be an array.");
  for (const [index, item] of (rewards.items ?? []).entries()) {
    if (typeof item.itemUuid !== "string" || !item.itemUuid.trim()) {
      throw new TypeError(`Item reward ${index + 1} needs an item UUID.`);
    }
    finiteNonNegativeInteger(item.quantity, `Item reward ${index + 1} quantity`);
  }
  if (!rewards.currency || typeof rewards.currency !== "object" || Array.isArray(rewards.currency)) {
    throw new TypeError("Currency rewards must be an object keyed by denomination.");
  }
  for (const [key, amount] of Object.entries(rewards.currency)) {
    if (!key.trim()) throw new TypeError("Currency denomination keys cannot be blank.");
    finiteNonNegativeInteger(amount, `Currency reward ${key}`);
  }
}

function buildAwards(rewards, assignments, denominations) {
  const awards = [];
  const xpRecipients = normalizeRecipients(assignments.xp ?? [], "XP");
  const currencyRecipients = normalizeRecipients(assignments.currency ?? [], "Currency");
  const xp = rewards.xp ?? 0;

  if (xp > 0 && !xpRecipients.length) throw new Error("Assign at least one recipient for the XP reward.");
  for (const actorUuid of xpRecipients) {
    if (xp > 0) awards.push({ type: "xp", actorUuid, amount: xp });
  }

  const assignedItems = assignments.items ?? [];
  if (!Array.isArray(assignedItems)) throw new TypeError("Item assignments must be an array.");
  const available = new Map();
  for (const item of rewards.items ?? []) {
    available.set(item.itemUuid, (available.get(item.itemUuid) ?? 0) + item.quantity);
  }
  const used = new Map();
  for (const assignment of assignedItems) {
    const { itemUuid, actorUuid, quantity } = assignment ?? {};
    if (typeof itemUuid !== "string" || !available.has(itemUuid)) {
      throw new Error(`Item assignment refers to an item not included in the quest: ${itemUuid ?? "(missing UUID)"}.`);
    }
    if (typeof actorUuid !== "string" || !actorUuid.trim()) {
      throw new TypeError("Every item assignment needs a recipient Actor UUID.");
    }
    finiteNonNegativeInteger(quantity, `Assigned quantity for ${itemUuid}`);
    const nextUsed = (used.get(itemUuid) ?? 0) + quantity;
    if (nextUsed > available.get(itemUuid)) {
      throw new Error(`Assigned quantity for ${itemUuid} exceeds the quest reward quantity.`);
    }
    used.set(itemUuid, nextUsed);
    if (quantity > 0) awards.push({ type: "item", itemUuid, actorUuid, quantity, copy: true });
  }
  if ([...available.values()].some(quantity => quantity > 0)
    && ![...used.values()].some(quantity => quantity > 0)) {
    throw new Error("Assign at least one item reward to a recipient.");
  }

  const currency = rewards.currency ?? {};
  const currencyTotal = Object.values(currency).some(amount => amount > 0);
  if (currencyTotal && !currencyRecipients.length) {
    throw new Error("Assign at least one recipient for the currency reward.");
  }
  if (currencyTotal && !Array.isArray(denominations)) {
    awards.push({
      type: "currency",
      currency: copy(currency),
      recipientUuids: currencyRecipients,
      failed: true,
      error: "Currency denomination conversion or actor write support is not verified for this system."
    });
  } else if (currencyTotal) {
    try {
      const split = splitCurrency(currency, denominations, currencyRecipients);
      for (const actorUuid of currencyRecipients) {
        const allocation = split.allocations[actorUuid] ?? {};
        if (Object.values(allocation).some(amount => amount > 0)) {
          awards.push({ type: "currency", actorUuid, currency: allocation });
        }
      }
      for (const [denomination, amount] of Object.entries(split.remainder)) {
        if (amount > 0) {
          awards.push({
            type: "currency",
            currency: { [denomination]: amount },
            unawarded: true,
            error: "Currency could not be divided into an available denomination."
          });
        }
      }
    } catch (error) {
      awards.push({
        type: "currency",
        currency: copy(currency),
        recipientUuids: currencyRecipients,
        failed: true,
        error: `Currency distribution could not be prepared: ${error instanceof Error ? error.message : String(error)}`
      });
    }
  }
  return awards;
}

/**
 * Divide currency among recipients. A leftover coin is successively converted
 * into the next denomination down, then divided again. The final indivisible
 * amount is returned as `remainder` for GM adjudication.
 *
 * Denominations are ordered largest-to-smallest and use
 * `{ key, toLower }`, where `toLower` is the integer number of the next coin
 * represented by one current coin. The smallest denomination has `toLower:null`.
 */
export function splitCurrency(currency, denominations, recipients) {
  if (!Array.isArray(denominations) || !denominations.length) {
    throw new TypeError("At least one currency denomination is required.");
  }
  const actors = normalizeRecipients(recipients, "Currency");
  if (!actors.length) throw new Error("At least one currency recipient is required.");

  const keys = new Set();
  for (let i = 0; i < denominations.length; i += 1) {
    const denomination = denominations[i];
    if (!denomination || typeof denomination.key !== "string" || !denomination.key.trim()) {
      throw new TypeError(`Invalid currency denomination at index ${i}.`);
    }
    if (keys.has(denomination.key)) throw new Error(`Duplicate currency denomination: ${denomination.key}.`);
    keys.add(denomination.key);
    const last = i === denominations.length - 1;
    if (last ? denomination.toLower !== null : !Number.isSafeInteger(denomination.toLower) || denomination.toLower < 1) {
      throw new TypeError(`Invalid conversion ratio for currency denomination ${denomination.key}.`);
    }
  }

  const remaining = {};
  for (const [key, amount] of Object.entries(currency ?? {})) {
    finiteNonNegativeInteger(amount, `Currency amount ${key}`);
    if (!keys.has(key)) throw new Error(`Unsupported currency denomination: ${key}.`);
    if (amount) remaining[key] = amount;
  }
  const allocations = Object.fromEntries(actors.map(uuid => [uuid, {}]));
  const remainder = {};
  for (let index = 0; index < denominations.length; index += 1) {
    const { key, toLower } = denominations[index];
    const amount = remaining[key] ?? 0;
    const quotient = Math.floor(amount / actors.length);
    const coinsLeft = amount % actors.length;
    if (quotient) for (const actorUuid of actors) allocations[actorUuid][key] = quotient;
    if (!coinsLeft) continue;

    if (toLower === null) {
      remainder[key] = coinsLeft;
      continue;
    }
    const nextKey = denominations[index + 1].key;
    const converted = (remaining[nextKey] ?? 0) + coinsLeft * toLower;
    if (!Number.isSafeInteger(converted)) throw new RangeError(`Converted ${nextKey} currency exceeds the safe integer range.`);
    remaining[nextKey] = converted;
  }
  return { allocations, remainder };
}

/**
 * Complete a quest and distribute assigned rewards.
 *
 * `persistQuest` is required whenever an Actor reward will be attempted. It must durably persist every checkpoint before
 * this function proceeds. The first checkpoint locks the reward definition and
 * stores all awards as pending before any actor document is changed. Each
 * result is persisted immediately after its attempt. There is no cross-document
 * transaction in Foundry: after a crash, a pending award is ambiguous and must
 * be adjudicated rather than retried.
 *
 * @param {object} quest A detached quest data object with `id`, `state`, and `rewards`.
 * @param {object} options
 * @returns {Promise<object>} A new quest object with reward audit and status.
 */
export async function completeQuest(quest, {
  assignments = {},
  applyAward,
  notifyError = () => {},
  user,
  persistQuest,
  denominations,
  cancelled = false,
  now = () => new Date().toISOString()
} = {}) {
  assertGM(user);
  if (!quest || typeof quest !== "object") throw new TypeError("A quest is required.");
  if (cancelled) return copy(quest);

  if (quest.rewardsGranted || quest.rewardsLocked) {
    return { ...copy(quest), state: "completed" };
  }
  validateRewardDefinitions(quest.rewards ?? {});
  const awards = buildAwards(quest.rewards ?? {}, assignments, denominations);
  const timestamp = now();
  const questId = quest.id ?? quest.uuid;
  const payableAwards = awards.filter(award => !award.unawarded && !award.failed);
  const requiresPersistence = awards.some(award => !award.unawarded);
  if ((!questId || typeof questId !== "string") && payableAwards.length) {
    throw new TypeError("A quest id or UUID is required when applying rewards.");
  }
  if (requiresPersistence && typeof persistQuest !== "function") {
    throw new TypeError("persistQuest is required before applying any reward.");
  }
  if (payableAwards.length && typeof applyAward !== "function") {
    throw new TypeError("An award adapter is required when applying rewards.");
  }
  const auditQuestId = questId ?? "quest-without-id";

  const audit = awards.map((award, index) => ({
    id: `${auditQuestId}:reward:${index}`,
    idempotencyKey: `${auditQuestId}:reward:${index}`,
    ...copy(award),
    status: award.unawarded ? "unawarded" : award.failed ? "failed" : "pending",
    error: award.unawarded || award.failed ? award.error : undefined,
    timestamp
  }));
  let result = {
    ...copy(quest),
    state: "completed",
    rewardAudit: [...(quest.rewardAudit ?? []), ...audit],
    rewardRemainder: audit
      .filter(entry => entry.status === "unawarded")
      .reduce((all, entry) => ({ ...all, ...entry.currency }), {}),
    rewardsGranted: true,
    rewardsLocked: true,
    completedAt: quest.completedAt ?? timestamp
  };
  if (ACTIVE_COMPLETIONS.has(auditQuestId)) {
    throw new Error(`Reward completion for ${auditQuestId} is already running in this client.`);
  }
  ACTIVE_COMPLETIONS.add(auditQuestId);
  try {
    // Persist the completion claim and pending ledger before the first side effect.
    if (typeof persistQuest === "function") await persistQuest(copy(result), { phase: "claimed" });

    for (let index = 0; index < awards.length; index += 1) {
      const plannedAward = awards[index];
      if (plannedAward.unawarded || plannedAward.failed) {
        try {
          await notifyError(new Error(plannedAward.error ?? "Currency remainder requires manual adjudication."), {
            quest: result,
            award: plannedAward
          });
        } catch {
          // A notification failure must not stop later awards or erase the audit.
        }
        continue;
      }

      let updatedEntry;
      try {
        await applyAward(copy(plannedAward), { idempotencyKey: audit[index].idempotencyKey });
        updatedEntry = { ...audit[index], status: "awarded" };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        updatedEntry = { ...audit[index], status: "failed", error: message };
        try {
          await notifyError(error, { quest: result, award: plannedAward });
        } catch {
          // A notification failure must not stop later awards or erase the audit.
        }
      }
      audit[index] = updatedEntry;
      result = {
        ...result,
        rewardAudit: [...(quest.rewardAudit ?? []), ...audit]
      };
      await persistQuest(copy(result), { phase: updatedEntry.status, award: copy(plannedAward) });
    }
    return result;
  } finally {
    ACTIVE_COMPLETIONS.delete(auditQuestId);
  }
}

/**
 * Mark durable `pending` entries as ambiguous after recovery from a crash.
 * This helper never retries or invokes an award adapter.
 */
export async function markInterruptedAwardsUnknown(quest, { persistQuest, now = () => new Date().toISOString() } = {}) {
  if (typeof persistQuest !== "function") throw new TypeError("persistQuest is required.");
  const result = copy(quest);
  const at = now();
  result.rewardAudit = (result.rewardAudit ?? []).map(entry => entry.status === "pending"
    ? { ...entry, status: "unknown", error: entry.error ?? "Interrupted while applying; verify Actor before manual adjudication.", reconciledAt: at }
    : entry);
  await persistQuest(copy(result), { phase: "recovery" });
  return result;
}

/** Replace a quest's reward definition only before its first completion. */
export function updateRewards(quest, rewards, user) {
  assertGM(user);
  if (quest?.rewardsLocked || quest?.rewardsGranted || quest?.state === "completed") {
    throw new Error("Quest rewards cannot be edited after first completion.");
  }
  validateRewardDefinitions(rewards);
  return { ...copy(quest), rewards: copy(rewards) };
}

export { REWARD_STATES };
