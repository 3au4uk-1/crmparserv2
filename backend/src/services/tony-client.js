import axios from 'axios';
import { getTonyConfig, tonyRequestHeaders } from './tony-auth.js';

/** Fetch a Tony order page by booking number. Returns HTML string, or null when the order does not exist (404). */
export async function fetchTonyOrderHtml(bookingNumber) {
  const { baseUrl } = getTonyConfig();
  const url = `${baseUrl.replace(/\/$/, '')}/orders/orders_edit/?id=${encodeURIComponent(bookingNumber)}`;

  const resp = await axios.get(url, {
    headers: tonyRequestHeaders(),
    timeout: 30000,
    maxRedirects: 5,
    validateStatus: () => true,
  });

  if (resp.status === 404) return null;
  if (resp.status >= 400) {
    throw new Error(`Tony order ${bookingNumber} returned HTTP ${resp.status}`);
  }
  return typeof resp.data === 'string' ? resp.data : String(resp.data);
}
