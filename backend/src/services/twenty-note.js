/** Build NoteCreateInput for current Twenty API (bodyV2, no activityTargets). */
export function buildNoteCreateInput(title, markdown) {
  return {
    title,
    bodyV2: {
      markdown,
      blocknote: null,
    },
  };
}

/** Link note to opportunity via NoteTarget (morph relation). */
export function buildNoteTargetCreateInput(noteId, opportunityId) {
  return {
    noteId,
    targetOpportunityId: opportunityId,
  };
}

export function formatItemsAsNoteMarkdown(items) {
  return items
    .map((i) => `- ${i.name} — ${i.price?.toLocaleString('ru-RU')} руб. × ${i.quantity}`)
    .join('\n');
}
