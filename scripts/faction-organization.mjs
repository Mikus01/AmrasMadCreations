function requireGM(user) {
  if (user?.isGM !== true) throw new Error("Only a GM can manage faction organization.");
}

function copyRoles(faction) {
  return (faction.roles ?? []).map(role => ({ ...role }));
}

function copyMembers(faction) {
  return (faction.organizationalMembers ?? []).map(member => ({ ...member }));
}

function requireRole(faction, roleId) {
  const role = (faction.roles ?? []).find(candidate => candidate.id === roleId);
  if (!role) throw new Error(`Unknown faction role: ${roleId}`);
  return role;
}

function makeId() {
  const crypto = globalThis.crypto;
  if (crypto?.randomUUID) return crypto.randomUUID();
  return `role-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Add a named organizational role. Roles are ordered and have no parent links. */
export function addRole(faction, { id = makeId(), name } = {}, user) {
  requireGM(user);
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (!trimmed) throw new Error("Faction role name is required.");
  if (!id || (faction.roles ?? []).some(role => role.id === id)) {
    throw new Error("Faction role id must be unique.");
  }
  return { ...faction, roles: [...copyRoles(faction), { id, name: trimmed }] };
}

/** Rename an existing role. */
export function renameRole(faction, roleId, name, user) {
  requireGM(user);
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (!trimmed) throw new Error("Faction role name is required.");
  requireRole(faction, roleId);
  return {
    ...faction,
    roles: (faction.roles ?? []).map(role => role.id === roleId
      ? { ...role, name: trimmed }
      : { ...role })
  };
}

/** Move a role to the requested zero-based position in the ordered role list. */
export function moveRole(faction, roleId, index, user) {
  requireGM(user);
  const roles = copyRoles(faction);
  const from = roles.findIndex(role => role.id === roleId);
  if (from < 0) throw new Error(`Unknown faction role: ${roleId}`);
  if (!Number.isInteger(index)) throw new Error("Role position must be an integer.");
  const [role] = roles.splice(from, 1);
  const to = Math.max(0, Math.min(index, roles.length));
  roles.splice(to, 0, role);
  return { ...faction, roles };
}

/**
 * Delete a role. Populated roles must be reassigned to another existing role.
 * A populated last role cannot be deleted.
 */
export function deleteRole(faction, roleId, reassignRoleId = null, user) {
  requireGM(user);
  requireRole(faction, roleId);
  const members = copyMembers(faction);
  const affected = members.filter(member => member.roleId === roleId);
  let nextMembers = members;
  if (affected.length) {
    const remainingRoles = (faction.roles ?? []).filter(role => role.id !== roleId);
    if (!remainingRoles.length) throw new Error("Cannot delete the last role while it has members.");
    if (!reassignRoleId || reassignRoleId === roleId ||
      !remainingRoles.some(role => role.id === reassignRoleId)) {
      throw new Error("Choose another role for this role's members.");
    }
    nextMembers = members.map(member => member.roleId === roleId
      ? { ...member, roleId: reassignRoleId }
      : member);
  }
  return {
    ...faction,
    roles: (faction.roles ?? []).filter(role => role.id !== roleId).map(role => ({ ...role })),
    organizationalMembers: nextMembers
  };
}

/** Assign or reassign an Actor to exactly one role in this faction. */
export function assignMember(faction, actorUuid, roleId, user) {
  requireGM(user);
  if (typeof actorUuid !== "string" || !actorUuid.trim()) throw new Error("Actor UUID is required.");
  requireRole(faction, roleId);
  const members = copyMembers(faction);
  const existing = members.find(member => member.actorUuid === actorUuid);
  const organizationalMembers = existing
    ? members.map(member => member.actorUuid === actorUuid ? { ...member, roleId } : member)
    : [...members, { actorUuid, roleId }];
  return { ...faction, organizationalMembers };
}

/** Remove an Actor's organizational membership without touching renown. */
export function removeMember(faction, actorUuid, user) {
  requireGM(user);
  return {
    ...faction,
    organizationalMembers: (faction.organizationalMembers ?? [])
      .filter(member => member.actorUuid !== actorUuid)
      .map(member => ({ ...member }))
  };
}

/** Move an existing organizational member to another role; same-role drops are no-ops. */
export function moveMember(faction, actorUuid, roleId, user) {
  requireGM(user);
  requireRole(faction, roleId);
  const member = (faction.organizationalMembers ?? []).find(candidate => candidate.actorUuid === actorUuid);
  if (!member) throw new Error(`Actor is not an organizational member: ${actorUuid}`);
  if (member.roleId === roleId) return faction;
  return {
    ...faction,
    organizationalMembers: copyMembers(faction).map(candidate => candidate.actorUuid === actorUuid
      ? { ...candidate, roleId }
      : candidate)
  };
}
