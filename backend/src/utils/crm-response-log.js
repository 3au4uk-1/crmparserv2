const SNIPPET_LEN = 300;

function collapse(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

/** Mask secrets that must not appear in parse logs. */
export function maskSensitive(text, secrets = []) {
  let s = String(text ?? '');
  for (const secret of secrets) {
    const value = String(secret ?? '');
    if (value.length < 6) continue;
    if (value === 'undefined' || value === 'null') continue;
    s = s.split(value).join('***');
  }
  s = s.replace(/\b(PHPSESSID|BITRIX_SM_[A-Za-z0-9_]+)=([^;\s"'&]+)/gi, '$1=***');
  s = s.replace(/([?&#](?:hash|token|password|pass|phpsessid)=)[^&\s"'<>]+/gi, '$1***');
  s = s.replace(/\b(password|pass|pwd|token|cal_token|cookie|hash|phpsessid)=([^&\s"'<>]+)/gi, '$1=***');
  s = s.replace(/("(?:password|pass|token|cookie|phpsessid)"\s*:\s*")[^"]*/gi, '$1***');
  s = s.replace(/(<input\b[^>]*\b(?:id|name)=["'](?:password|pass|token|cal_token)["'][^>]*\bvalue=["'])[^"']*/gi, '$1***');
  s = s.replace(/(<input\b[^>]*\bvalue=["'])[^"']*(["'][^>]*\b(?:id|name)=["'](?:password|pass|token|cal_token)["'])/gi, '$1***$2');
  // Phone numbers. Dates and short order ids are left intact.
  s = s.replace(/\+?\d[\d\s().-]{8,}\d/g, '***');
  return s;
}

export function describeCrmResponse({ status, contentType, body, around, secrets } = {}) {
  const raw = body == null ? '' : (typeof body === 'string' ? body : JSON.stringify(body));
  const trimmed = raw.trim();
  let slice = trimmed.slice(0, SNIPPET_LEN);
  if (around) {
    const idx = trimmed.toLowerCase().indexOf(String(around).toLowerCase());
    if (idx >= 0) {
      const start = Math.max(0, idx - 80);
      slice = trimmed.slice(start, start + SNIPPET_LEN);
    }
  }
  const snippet = maskSensitive(collapse(slice), secrets);
  const ctype = contentType ? String(Array.isArray(contentType) ? contentType.join(', ') : contentType) : 'unknown';
  const st = status ?? 'unknown';
  return `status=${st} content-type=${ctype} length=${raw.length} body=${JSON.stringify(snippet)}`;
}

export function crmFailure(scope, message, resp, secrets = []) {
  const diag = describeCrmResponse({
    status: resp?.status,
    contentType: resp?.headers?.['content-type'],
    body: typeof resp?.data === 'string' ? resp.data : resp?.data,
    secrets,
  });
  const err = new Error(`${message} (${diag})`);
  console.error(`[${scope}] ${err.message}`);
  return err;
}
