export const DEFAULT_QUEST_ICON = "icons/svg/book.svg";
export const QUEST_STATES = Object.freeze([
  "offered", "rejected", "accepted", "in-progress", "completed", "failed"
]);

function requireGM(user) {
  if (user?.isGM !== true) throw new Error("Only a GM can manage quests.");
}

function requireQuest(quests, id) {
  const quest = quests.find(q => q.id === id);
  if (!quest) throw new Error(`Unknown quest: ${id}`);
  return quest;
}

export function createQuest({
  title, description, icon, giver = {}, rewards, consequence = "", observers = []
} = {}) {
  if (typeof title !== "string" || !title.trim()) throw new Error("Quest title is required.");
  if (typeof description !== "string" || !description.trim()) throw new Error("Quest description is required.");
  if (!giver || ![giver.actorUuid, giver.factionUuid].some(uuid => typeof uuid === "string" && uuid.trim())) {
    throw new Error("A quest giver is required.");
  }
  const quest = {
    title: title.trim(),
    description,
    icon: typeof icon === "string" && icon.trim() ? icon.trim() : DEFAULT_QUEST_ICON,
    giver: { ...giver },
    rewards: rewards ? structuredClone(rewards) : { xp: 0, items: [], currency: {} },
    consequence,
    state: "offered",
    observers: [],
    relatedQuestIds: [],
    rewardAudit: [],
    rewardsGranted: false
  };
  for (const observer of observers) quest.observers = addObserver(quest, observer, { isGM: true }).observers;
  return quest;
}

export function setQuestState(quest, state, user) {
  requireGM(user);
  if (!QUEST_STATES.includes(state)) throw new Error(`Invalid quest state: ${state}`);
  return { ...quest, state };
}

export function addObserver(quest, observer, user) {
  requireGM(user);
  if (!["actor", "faction"].includes(observer?.type)
    || typeof observer.uuid !== "string" || !observer.uuid.trim()) {
    throw new Error("A valid observer is required.");
  }
  const giverUuid = observer.type === "actor" ? quest.giver.actorUuid : quest.giver.factionUuid;
  if (observer.uuid === giverUuid) throw new Error("A giver cannot also be an observer.");
  const observers = (quest.observers ?? []).map(o => ({ ...o }));
  if (!observers.some(o => o.type === observer.type && o.uuid === observer.uuid)) observers.push({ ...observer });
  return { ...quest, observers };
}

export function addQuestRelation(quests, firstId, secondId, user) {
  requireGM(user);
  if (firstId === secondId) throw new Error("A quest cannot link to itself.");
  requireQuest(quests, firstId);
  requireQuest(quests, secondId);
  return quests.map(q => {
    const otherId = q.id === firstId ? secondId : q.id === secondId ? firstId : null;
    if (!otherId) return q;
    return { ...q, relatedQuestIds: [...new Set([...(q.relatedQuestIds ?? []), otherId])] };
  });
}

export function removeQuestRelation(quests, firstId, secondId, user) {
  requireGM(user);
  if (firstId === secondId) throw new Error("A quest cannot link to itself.");
  requireQuest(quests, firstId);
  requireQuest(quests, secondId);
  return quests.map(q => {
    const otherId = q.id === firstId ? secondId : q.id === secondId ? firstId : null;
    return otherId ? { ...q, relatedQuestIds: (q.relatedQuestIds ?? []).filter(id => id !== otherId) } : q;
  });
}

export function deleteQuest(quests, id, user) {
  requireGM(user);
  requireQuest(quests, id);
  return quests.filter(q => q.id !== id).map(q => ({
    ...q, relatedQuestIds: (q.relatedQuestIds ?? []).filter(other => other !== id)
  }));
}

export function questsForFaction(quests, factionUuid) {
  return quests.filter(q => q.giver?.factionUuid === factionUuid
    || (q.observers ?? []).some(o => o.type === "faction" && o.uuid === factionUuid));
}
