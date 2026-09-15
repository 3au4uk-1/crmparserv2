import axios from 'axios';
import { getTonyConfig, tonyRequestHeaders } from './tony-auth.js';

const PRODUCT_CATEGORIES = [
  'food', 'products', 'tech', 'personnel', 'services', 'assembly', 'transport', 'expense',
];

function isNotFoundRedirect(location) {
  const loc = String(location || '').toLowerCase();
  return loc.includes('notfound') || loc.includes('not_found') || loc.includes('404');
}

function isLoginRedirect(location) {
  const loc = String(location || '').toLowerCase();
  return loc.includes('login') || loc.includes('auth');
}

function handleRedirectStatus(bookingNumber, status, location) {
  if (status < 300 || status >= 400) return;
  if (isNotFoundRedirect(location)) return null;
  if (isLoginRedirect(location) || !location) {
    throw new Error(`Tony order ${bookingNumber}: session expired (redirected to login)`);
  }
  throw new Error(`Tony order ${bookingNumber}: unexpected redirect (${status} → ${location})`);
}

async function fetchTonyOrderPage(bookingNumber) {
  const { baseUrl } = getTonyConfig();
  const url = `${baseUrl.replace(/\/$/, '')}/orders/orders_edit/?id=${encodeURIComponent(bookingNumber)}`;

  const resp = await axios.get(url, {
    headers: tonyRequestHeaders(),
    timeout: 30000,
    maxRedirects: 0,
    validateStatus: () => true,
  });

  if (resp.status === 404) return null;
  const redirect = handleRedirectStatus(bookingNumber, resp.status, resp.headers?.location);
  if (redirect === null) return null;
  if (resp.status >= 400) {
    const err = new Error(`Tony order ${bookingNumber} returned HTTP ${resp.status}`);
    err.retryable = resp.status === 429 || resp.status >= 500;
    throw err;
  }
  return typeof resp.data === 'string' ? resp.data : String(resp.data);
}

async function fetchTonyAjaxList(src, bookingNumber, actionVar = '') {
  const { baseUrl } = getTonyConfig();
  const url = `${baseUrl.replace(/\/$/, '')}/ajax/${src}.php`;

  const resp = await axios.post(
    url,
    new URLSearchParams({ id: bookingNumber, actionVar }).toString(),
    {
      headers: { ...tonyRequestHeaders(), 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 30000,
      maxRedirects: 0,
      validateStatus: () => true,
    }
  );

  if (resp.status === 404) return '';
  const redirect = handleRedirectStatus(bookingNumber, resp.status, resp.headers?.location);
  if (redirect === null) return '';
  if (resp.status >= 400) {
    const err = new Error(`Tony ${src} ${bookingNumber} returned HTTP ${resp.status}`);
    err.retryable = resp.status === 429 || resp.status >= 500;
    throw err;
  }

  const data = resp.data;
  if (data && typeof data === 'object' && typeof data.html === 'string') {
    return data.html;
  }
  return '';
}

function wrapCategoryTable(dataSrc, category, rowsHtml) {
  if (!rowsHtml?.trim()) return '';
  return `<table data-src="${dataSrc}" data-var="${category}"><tbody>${rowsHtml}</tbody></table>`;
}

async function fetchTonyProductTables(bookingNumber, run) {
  const productJobs = PRODUCT_CATEGORIES.map((category) =>
    run(() => fetchTonyAjaxList('order_products_list', bookingNumber, category)).then((rows) =>
      wrapCategoryTable('order_products_list', category, rows)
    )
  );
  const skladJob = run(() => fetchTonyAjaxList('order_sklad_list', bookingNumber, '')).then((rows) =>
    wrapCategoryTable('order_sklad_list', 'sklad', rows)
  );
  const chunks = await Promise.all([...productJobs, skladJob]);
  return chunks.filter(Boolean).join('');
}

export async function fetchTonyOrderInfo(bookingNumber, { run = (fn) => fn() } = {}) {
  return run(async () => {
    const { baseUrl } = getTonyConfig();
    const url = `${baseUrl.replace(/\/$/, '')}/ajax/order_get_info.php`;
    const resp = await axios.post(
      url,
      new URLSearchParams({ order_id: bookingNumber }).toString(),
      {
        headers: { ...tonyRequestHeaders(), 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 30000,
        maxRedirects: 0,
        validateStatus: () => true,
      }
    );

    if (resp.status === 404) return { ok: false, notFound: true, deleted: false };
    const redirect = handleRedirectStatus(bookingNumber, resp.status, resp.headers?.location);
    if (redirect === null) return { ok: false, notFound: true, deleted: false };
    if (resp.status >= 400) {
      const err = new Error(`Tony order_get_info ${bookingNumber} returned HTTP ${resp.status}`);
      err.retryable = resp.status === 429 || resp.status >= 500;
      throw err;
    }

    const payload = resp.data;
    if (!payload || typeof payload !== 'object' || payload.success !== true || !payload.data) {
      return { ok: false, notFound: false, deleted: false };
    }
    const updatedAt = payload.data.timestamps?.updated_at;
    return {
      ok: true,
      updatedAt: updatedAt == null ? null : String(updatedAt),
      deleted: payload.data.deleted === true,
      notFound: false,
    };
  });
}

/**
 * Fetch a Tony order page by booking number, including AJAX-loaded position tables.
 * Returns HTML string (page shell + category fragments), or null when the order does not exist.
 */
export async function fetchTonyOrderHtml(bookingNumber, { run = (fn) => fn() } = {}) {
  const pageHtml = await run(() => fetchTonyOrderPage(bookingNumber));
  if (!pageHtml) return null;

  const productTables = await fetchTonyProductTables(bookingNumber, run);
  return pageHtml + productTables;
}
