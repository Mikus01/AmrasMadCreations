/** GMs edit everything. */
export function canEdit({ isGM } = {}) {
  return isGM === true;
}

/** GMs view all; players view factions tracking an actor they own. */
export function canView({ isGM, ownedActorUuids = [] } = {}, faction) {
  if (isGM) return true;
  const owned = new Set(ownedActorUuids);
  return (faction?.members ?? []).some(m => owned.has(m.actorUuid));
}
