import { clampRenown, getRenownLevel } from "./renown.mjs";

export const DEFAULT_FACTION_IMG = "icons/svg/mystery-man.svg";
export const LEADER_RANK = "leader";

let counter = 0;
function newId() {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `goal-${Date.now().toString(36)}-${(counter++).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const str = v => (typeof v === "string" ? v : "");

/** Create a new faction data object. */
export function createFaction({ name, img, description } = {}) {
  const trimmed = str(name).trim();
  if (!trimmed) throw new Error("Faction name is required.");
  return {
    name: trimmed,
    img: str(img).trim() || DEFAULT_FACTION_IMG,
    description: str(description),
    leadership: [],
    goals: [],
    members: [],
    history: []
  };
}

/** Set (or clear with null) the single leader, preserving other ranks. */
export function setLeader(faction, actorUuid) {
  const others = faction.leadership.filter(l => l.rank !== LEADER_RANK).map(l => ({ ...l }));
  const leadership = actorUuid ? [...others, { actorUuid, rank: LEADER_RANK }] : others;
  return { ...faction, leadership };
}

export function addGoal(faction, { title, description } = {}) {
  const t = str(title).trim();
  if (!t) throw new Error("Goal title is required.");
  const goal = { id: newId(), title: t, description: str(description), completed: false };
  return { ...faction, goals: [...faction.goals.map(g => ({ ...g })), goal] };
}

function requireGoal(faction, id) {
  if (!faction.goals.some(g => g.id === id)) throw new Error(`Unknown goal: ${id}`);
}

export function toggleGoal(faction, id) {
  requireGoal(faction, id);
  return {
    ...faction,
    goals: faction.goals.map(g => (g.id === id ? { ...g, completed: !g.completed } : { ...g }))
  };
}

export function removeGoal(faction, id) {
  requireGoal(faction, id);
  return { ...faction, goals: faction.goals.filter(g => g.id !== id).map(g => ({ ...g })) };
}

export function addMember(faction, actorUuid) {
  if (!actorUuid) throw new Error("Actor UUID is required.");
  const members = faction.members.map(m => ({ ...m }));
  if (!members.some(m => m.actorUuid === actorUuid)) members.push({ actorUuid, points: 0 });
  return { ...faction, members };
}

export function removeMember(faction, actorUuid) {
  return { ...faction, members: faction.members.filter(m => m.actorUuid !== actorUuid).map(m => ({ ...m })) };
}

/**
 * Set a member's renown, logging history.
 * @returns {{faction: object, levelChange: {from: string, to: string}|null}}
 */
export function setRenown(faction, actorUuid, points, { reason = "", user = "", timestamp = Date.now() } = {}) {
  const member = faction.members.find(m => m.actorUuid === actorUuid);
  if (!member) throw new Error(`Actor is not tracked by this faction: ${actorUuid}`);
  const to = clampRenown(points);
  const from = member.points;
  const entry = { actorUuid, from, to, reason, user, timestamp };
  const next = {
    ...faction,
    members: faction.members.map(m => (m.actorUuid === actorUuid ? { ...m, points: to } : { ...m })),
    history: [...faction.history.map(h => ({ ...h })), entry]
  };
  const fromLevel = getRenownLevel(from);
  const toLevel = getRenownLevel(to);
  return { faction: next, levelChange: fromLevel === toLevel ? null : { from: fromLevel, to: toLevel } };
}
