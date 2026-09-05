export function isTelegramPollingEnabled(value = process.env.TELEGRAM_POLLING) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (raw === '' || raw === '1' || raw === 'true' || raw === 'yes') return true;
  return false;
}
