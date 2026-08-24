import { CRM_TIMEZONE } from '../../utils/crm-dates.js';

function crmHour(now) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CRM_TIMEZONE,
    hour: 'numeric',
    hour12: false,
  }).formatToParts(now);
  return Number(parts.find((p) => p.type === 'hour')?.value);
}

export function isEveningTick(now, hour) {
  return crmHour(now) === Number(hour);
}

export function shouldCatchUp({ loadDateYmd, todayYmd, tomorrowYmd, now, hour }) {
  if (loadDateYmd === todayYmd) return true;
  if (loadDateYmd === tomorrowYmd && crmHour(now) >= Number(hour)) return true;
  return false;
}
