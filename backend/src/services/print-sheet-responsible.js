export function formatPersonName(name) {
  if (!name) return '';
  if (typeof name === 'string') return name.trim();
  const parts = [name.firstName, name.lastName].filter(Boolean);
  return parts.join(' ').trim();
}

export function formatResponsibleFromUpdatedBy(updatedBy, workspaceMemberById = {}) {
  if (!updatedBy) return '';

  const memberId = updatedBy.workspaceMemberId;
  if (memberId && workspaceMemberById[memberId]) {
    return formatPersonName(workspaceMemberById[memberId].name);
  }

  return formatPersonName(updatedBy.name);
}

export function buildWorkspaceMemberMap(members) {
  const map = {};
  for (const member of members) {
    if (member?.id) map[member.id] = member;
  }
  return map;
}
