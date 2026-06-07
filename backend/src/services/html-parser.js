import * as cheerio from 'cheerio';

const EMPTY_RESULT = {
  meta: {
    status: '',
    legalEntity: '',
    invoiceNumber: '',
    budget: null,
    discount: '',
  },
  contact: {
    name: '',
    email: '',
    company: '',
    phone: '',
  },
  event: {
    address: '',
    venueType: '',
    arrivalTime: '',
    readyTime: '',
    workTime: '',
    dismantleTime: '',
  },
  items: [],
};

export function extractField(text, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`${escaped}\\s*:\\s*(.*)`, 'i');
  const match = text.match(regex);
  return match ? match[1].trim() : '';
}

export function parsePrice(value) {
  if (value == null || value === '') {
    return null;
  }
  const normalized = String(value)
    .replace(/\u00a0/g, ' ')
    .replace(/руб\.?/gi, '')
    .replace(/\s/g, '')
    .replace(',', '.');
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function extractPlainText(html) {
  const $ = cheerio.load(html, null, false);
  $('table.table-caption').remove();
  return $.root().text();
}

function parseItemsTable(html) {
  const $ = cheerio.load(html, null, false);
  const items = [];

  $('table.table-caption tr').each((_, row) => {
    const cells = $(row)
      .find('td')
      .map((__, cell) => $(cell).text().trim())
      .get();

    if (cells.length < 4) {
      return;
    }

    const [name, priceRaw, quantity, discountRaw] = cells;
    items.push({
      name,
      price: parsePrice(priceRaw),
      quantity,
      discount: parsePrice(discountRaw) ?? 0,
    });
  });

  return items;
}

export function parseDealDescription(html) {
  if (!html || !html.trim()) {
    return EMPTY_RESULT;
  }

  const text = extractPlainText(html);

  return {
    meta: {
      status: extractField(text, 'Статус сделки'),
      legalEntity: extractField(text, 'Юр. Лицо'),
      invoiceNumber: extractField(text, '№ cчета'),
      budget: parsePrice(extractField(text, 'Бюджет')),
      discount: extractField(text, 'Скидка'),
    },
    contact: {
      name: extractField(text, 'Контактное лицо'),
      email: extractField(text, 'E-Mail'),
      company: extractField(text, 'Компания'),
      phone: extractField(text, 'Контактный телефон'),
    },
    event: {
      address: extractField(text, 'Адрес проведения'),
      venueType: extractField(text, 'Место проведения'),
      arrivalTime: extractField(text, 'Время приезда'),
      readyTime: extractField(text, 'Готовность'),
      workTime: extractField(text, 'Время работы'),
      dismantleTime: extractField(text, 'Время демонтажа'),
    },
    items: parseItemsTable(html),
  };
}
