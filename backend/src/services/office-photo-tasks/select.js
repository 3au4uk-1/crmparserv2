const OFFICE_PHOTO_TIPS = new Set(['BANNERA', 'PODRYAD']);

export function isOfficePhotoTip(tip) {
  return OFFICE_PHOTO_TIPS.has(tip);
}

export function shouldSkipCancelled({ opportunityStage, lineItemStage }) {
  return opportunityStage === 'OTMENA' || lineItemStage === 'OTMENA';
}

export function needsOfficePhotoTask({
  tip,
  loadDateYmd,
  tomorrowYmd,
  todayYmd,
  hasOpenTask,
}) {
  if (!isOfficePhotoTip(tip)) return false;
  if (hasOpenTask) return false;
  if (!loadDateYmd) return false;
  return loadDateYmd === tomorrowYmd || loadDateYmd === todayYmd;
}
