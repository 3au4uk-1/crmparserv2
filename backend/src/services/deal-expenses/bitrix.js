const DEAL_ID_RE = /\/crm\/deal\/details\/(\d+)/i;

function normalizeUrl(value) {
  if (!value) return "";
  const text = String(value).trim();
  const match = text.match(/https?:\/\/[^\s"'<>]+/i);
  return match ? match[0].replace(/[?#].*$/, "").replace(/\/+$/, "") : text;
}

function extractDealId(value) {
  const url = normalizeUrl(value);
  const match = url.match(DEAL_ID_RE);
  return match ? match[1] : null;
}

export { extractDealId, normalizeUrl };
