const OFFICE_PHOTO_TIPS = new Set(['BANNERA', 'PODRYAD']);

export function isOfficePhotoTip(tip) {
  return OFFICE_PHOTO_TIPS.has(tip);
}

export function shouldSkipCancelled({ opportunityStage, lineItemStage }) {
  return opportunityStage === 'OTMENA' || lineItemStage === 'OTMENA';
}

function normalizeTitle(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replaceAll('ё', 'е');
}

/** Calendar slots named for banner crew, not physical banner/подряд units. */
export function isBannerStaffTitle(name) {
  return normalizeTitle(name).includes('баннерщик');
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
