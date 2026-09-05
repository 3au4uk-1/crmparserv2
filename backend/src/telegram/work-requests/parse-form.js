export const TOPIC_ROLES = {
  QUOTE: 'QUOTE',
  DESIGN: 'DESIGN',
  REVIEW: 'REVIEW',
};

export const KINDS = {
  QUOTE: 'QUOTE',
  LAYOUT: 'LAYOUT',
  VISUAL: 'VISUAL',
  REVIEW: 'REVIEW',
};

const LOGO_URL_KEY = 'ссылка на логотип / шрифт / брендбук';
const LAYOUTS_URL_KEY = 'ссылка на макеты';

const BLANK_VALUES = new Set(['', '-', 'нет', 'файл']);

export function isBlankFormValue(raw) {
  if (raw == null) return true;
  const normalized = String(raw).trim().toLowerCase();
  return BLANK_VALUES.has(normalized);
}

function collapseSpaces(value) {
  return value.trim().replace(/\s+/g, ' ');
}

export function normalizeFieldKey(raw) {
  let key = collapseSpaces(String(raw)).toLowerCase();
  if (key.startsWith('ссылка на логотип')) {
    key = LOGO_URL_KEY;
  }
  return key;
}

export function parseFormFields(text) {
  const fields = {};
  if (!text) return fields;

  for (const line of String(text).split(/\r?\n/)) {
    const match = line.match(/^([^:]+):\s*(.*)$/);
    if (!match) continue;

    const key = normalizeFieldKey(match[1]);
    fields[key] = match[2];
  }

  return fields;
}

function parseHttpUrl(raw) {
  if (isBlankFormValue(raw)) return null;
  const trimmed = String(raw).trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : null;
}

function hasFileAttachment(attachments) {
  return (attachments ?? []).some(
    (item) => item?.type === 'photo' || item?.type === 'document',
  );
}

function isValidBooking(raw) {
  if (isBlankFormValue(raw)) return false;
  return /^\d{6}$/.test(String(raw).trim());
}

function parseBooking(raw) {
  const trimmed = String(raw ?? '').trim();
  return isValidBooking(trimmed) ? trimmed : null;
}

function fail(missing) {
  return { ok: false, missing };
}

function ok(data) {
  return { ok: true, data };
}

function baseData(overrides = {}) {
  return {
    kind: null,
    brief: null,
    booking: null,
    positionName: null,
    logoOrBrandUrl: null,
    layoutsUrl: null,
    reviewAction: null,
    dealName: null,
    hasCarrier: false,
    ...overrides,
  };
}

function optionalDealName(fields) {
  const raw = fields['сделка'];
  return isBlankFormValue(raw) ? null : String(raw).trim();
}

function requireField(fields, key, label, missing) {
  if (isBlankFormValue(fields[key])) {
    missing.push(label);
  }
}

function parseDesignType(raw) {
  const normalized = collapseSpaces(String(raw ?? '')).toLowerCase();
  if (normalized === 'макет') return KINDS.LAYOUT;
  if (normalized === 'визуализация') return KINDS.VISUAL;
  return null;
}

function parseReviewAction(raw) {
  const normalized = collapseSpaces(String(raw ?? '')).toLowerCase();
  if (normalized === 'проверить') return 'CHECK';
  if (normalized === 'запускаем') return 'LAUNCH';
  return null;
}

function parseQuote(fields) {
  const missing = [];
  requireField(fields, 'что посчитать', 'Что посчитать', missing);
  if (missing.length > 0) return fail(missing);

  return ok(
    baseData({
      kind: KINDS.QUOTE,
      brief: String(fields['что посчитать']).trim(),
      dealName: optionalDealName(fields),
    }),
  );
}

function parseDesign(fields, attachments) {
  const missing = [];
  const designKind = parseDesignType(fields['тип']);
  if (!designKind) {
    missing.push('Тип');
  }

  const bookingRaw = fields['бронь'];
  const booking = parseBooking(bookingRaw);
  if (!booking) {
    missing.push('Бронь — 6 цифр, пример: 123456');
  }

  requireField(fields, 'тз', 'ТЗ', missing);
  requireField(fields, 'название позиции под брендинг', 'Название позиции под брендинг', missing);

  const logoOrBrandUrl = parseHttpUrl(fields[LOGO_URL_KEY]);
  const layoutsUrl = parseHttpUrl(fields[LAYOUTS_URL_KEY]);
  const hasFile = hasFileAttachment(attachments);

  let hasCarrier = false;
  if (designKind === KINDS.LAYOUT) {
    hasCarrier = Boolean(logoOrBrandUrl) || hasFile;
    if (!hasCarrier) {
      missing.push('Нужна ссылка или файл в этом же сообщении.');
    }
  } else if (designKind === KINDS.VISUAL) {
    hasCarrier = Boolean(layoutsUrl) || hasFile;
    if (!hasCarrier) {
      missing.push('Нужна ссылка или файл в этом же сообщении.');
    }
  }

  if (missing.length > 0) return fail(missing);

  return ok(
    baseData({
      kind: designKind,
      brief: String(fields['тз']).trim(),
      booking,
      positionName: String(fields['название позиции под брендинг']).trim(),
      logoOrBrandUrl,
      layoutsUrl,
      dealName: optionalDealName(fields),
      hasCarrier,
    }),
  );
}

function parseReview(fields, attachments) {
  const missing = [];

  const booking = parseBooking(fields['бронь']);
  if (!booking) {
    missing.push('Бронь — 6 цифр, пример: 123456');
  }

  const reviewAction = parseReviewAction(fields['комментарий']);
  if (!reviewAction) {
    missing.push('Комментарий');
  }

  requireField(fields, 'название позиции под брендинг', 'Название позиции под брендинг', missing);

  const layoutsUrl = parseHttpUrl(fields[LAYOUTS_URL_KEY]);
  const hasFile = hasFileAttachment(attachments);
  const hasCarrier = Boolean(layoutsUrl) || hasFile;
  if (!hasCarrier) {
    missing.push('Нужна ссылка или файл в этом же сообщении.');
  }

  if (missing.length > 0) return fail(missing);

  return ok(
    baseData({
      kind: KINDS.REVIEW,
      booking,
      positionName: String(fields['название позиции под брендинг']).trim(),
      layoutsUrl,
      reviewAction,
      dealName: optionalDealName(fields),
      hasCarrier,
    }),
  );
}

export function parseWorkRequestForm({ text, topicRole, attachments = [] }) {
  const fields = parseFormFields(text);

  switch (topicRole) {
    case TOPIC_ROLES.QUOTE:
      return parseQuote(fields);
    case TOPIC_ROLES.DESIGN:
      return parseDesign(fields, attachments);
    case TOPIC_ROLES.REVIEW:
      return parseReview(fields, attachments);
    default:
      return fail(['Неизвестная роль топика']);
  }
}
