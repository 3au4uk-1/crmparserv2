/** Build NoteCreateInput for current Twenty API (bodyV2, not legacy body). */
export function buildNoteCreateInput(title, markdown, opportunityId) {
  return {
    title,
    bodyV2: {
      markdown,
      blocknote: null,
    },
    activityTargets: [{ opportunityId }],
  };
}

export function formatItemsAsNoteMarkdown(items) {
  return items
    .map((i) => `- ${i.name} — ${i.price?.toLocaleString('ru-RU')} руб. × ${i.quantity}`)
    .join('\n');
}
