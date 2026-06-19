import * as cheerio from 'cheerio';

const CATEGORY_TABLE_SELECTOR = 'table[data-src="order_products_list"]';

const EMPTY = {
  items: [],
  dates: {
    loadDate: '', loadTime: '', eventBegin: '', eventEnd: '',
    deinstallDate: '', deinstallTime: '', workTimeBegin: '', workTimeEnd: '',
  },
  address: '',
  budget: 0,
};

function parseNum(value) {
  if (value == null || value === '') return null;
  const normalized = String(value)
    .replace(/\u00a0/g, '')
    .replace(/\s/g, '')
    .replace(',', '.');
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseTonyOrder(html) {
  if (!html || !String(html).trim()) {
    return { ...EMPTY, dates: { ...EMPTY.dates } };
  }

  const $ = cheerio.load(html);
  const items = [];

  $(CATEGORY_TABLE_SELECTOR).each((_, tbl) => {
    const $tbl = $(tbl);
    const category = $tbl.attr('data-var') || '';
    $tbl.find('tr[data-id]').each((__, tr) => {
      const $tr = $(tr);
      const name =
        ($tr.find('.custom_name_value').attr('value') || '').trim() ||
        $tr.find('.custom_name_title').first().text().trim();
      if (!name) return;

      const price = parseNum($tr.attr('data-price')) ?? parseNum($tr.find('.price_value').attr('value'));
      const quantity = ($tr.find('.orders_custom_edit').attr('value') || '').trim();
      const discount = parseNum($tr.find('.discount_value').attr('value')) ?? 0;
      const sum = parseNum($tr.attr('data-sum')) ?? 0;

      items.push({ name, price, quantity, discount, sum, category });
    });
  });

  const val = (name) => ($(`[name="${name}"]`).attr('value') || '').trim();

  const dates = {
    loadDate: val('date_install'),
    loadTime: val('date_install_time'),
    eventBegin: val('date_event_begin'),
    eventEnd: val('date_event_end'),
    deinstallDate: val('date_deinstall'),
    deinstallTime: val('date_deinstall_time'),
    workTimeBegin: val('work_time_begin'),
    workTimeEnd: val('work_time_end'),
  };

  const address = ($('input[name="client_address"]').attr('value') || '').trim();
  const budget = items.reduce((sum, i) => sum + (i.sum || 0), 0);

  return { items, dates, address, budget };
}
