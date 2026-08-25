const REMINDER_TIPS = new Set(['BANNERA', 'PODRYAD']);

export function isBannerPodryadReminderItem(item) {
  if (!item) return false;
  if (!REMINDER_TIPS.has(item.tip)) return false;
  return item.stage !== 'OTMENA';
}
