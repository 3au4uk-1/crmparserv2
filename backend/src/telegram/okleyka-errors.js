const RETRY_DELAYS_SECONDS = [5, 15, 45, 120, 300];

export function isTransportError(err) {
  const msg = String(err?.message ?? err ?? '');
  if (/download failed: HTTP 5\d\d/i.test(msg)) return false;
  return /TIMEOUT|disconnected|Connection|ECONNRESET|ETIMEDOUT|fetch failed|SOCKS|proxy/i.test(msg);
}

export function classifyOkleykaError(err) {
  const msg = String(err?.message ?? err ?? '');
  const status = Number(err?.status);
  if (status === 400 || status === 503) return 'permanent';
  if (/userbot not configured/i.test(msg)) return 'permanent';
  if (/download failed: HTTP 4\d\d/i.test(msg)) return 'permanent';
  if (isTransportError(err)) return 'transient';
  if (/download failed: HTTP 5\d\d/i.test(msg)) return 'transient';
  if (/TIMEOUT|disconnected|ECONNRESET|ETIMEDOUT|fetch failed|SOCKS|proxy/i.test(msg)) {
    return 'transient';
  }
  return 'permanent';
}

export function retryDelaySeconds(attemptCount) {
  const index = Math.max(0, attemptCount - 1);
  return RETRY_DELAYS_SECONDS[Math.min(index, RETRY_DELAYS_SECONDS.length - 1)];
}
