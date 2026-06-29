const RU_MONTHS = {
  янв: 1,
  январ: 1,
  фев: 2,
  феврал: 2,
  мар: 3,
  март: 3,
  апр: 4,
  апрел: 4,
  май: 5,
  мая: 5,
  июн: 6,
  июл: 7,
  авг: 8,
  август: 8,
  сен: 9,
  сент: 9,
  сентябр: 9,
  окт: 10,
  октябр: 10,
  ноя: 11,
  ноябр: 11,
  дек: 12,
  декабр: 12,
};

function extractYearFromName(text, defaultYear) {
  const explicit = String(text).match(/\b(20\d{2})\b/);
  return explicit ? Number(explicit[1]) : defaultYear;
}

function parseRussianMonthDate(text, defaultYear) {
  const year = extractYearFromName(text, defaultYear);
  const match = String(text).match(
    /(\d{1,2})\s*(январ[ья]?|феврал[ья]?|марта?|апрел[ья]?|ма[йя]|июн[ья]?|июл[ья]?|августа?|сентябр[ья]?|октябр[ья]?|ноябр[ья]?|декабр[ья]?)/i
  );
  if (!match) return null;

  const day = Number(match[1]);
  const monthKey = match[2].toLowerCase().slice(0, 5);
  const month =
    Object.entries(RU_MONTHS).find(([key]) => monthKey.startsWith(key))?.[1] ??
    null;
  if (!month || day < 1 || day > 31) return null;

  return { day, month, year, confident: true, source: "russian_month" };
}

function parseSlashDate(text, defaultYear) {
  const year = extractYearFromName(text, defaultYear);

  const doubleDateRange = String(text).match(
    /\/(\d{1,2})\.(\d{2})-(\d{1,2})\.(\d{2})(?:\/|\/\/|\s|$)/
  );
  if (doubleDateRange) {
    const day = Number(doubleDateRange[1]);
    const month = Number(doubleDateRange[2]);
    const endMonth = Number(doubleDateRange[4]);
    if (month === endMonth && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return { day, month, year, confident: true, source: "slash_ddmm_range" };
    }
  }

  const rangeMatch = String(text).match(/\/(\d{1,2})-(\d{1,2})\.(\d{2})(?:\/|\/\/|\s|$)/);
  if (rangeMatch) {
    const day = Number(rangeMatch[1]);
    const month = Number(rangeMatch[3]);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      return { day, month, year, confident: true, source: "slash_range_dd_mm" };
    }
  }

  const slashMatch = String(text).match(/\/(\d{1,2})\.(\d{2})(?:\/|\/\/|\s|$)/);
  if (slashMatch) {
    const day = Number(slashMatch[1]);
    const month = Number(slashMatch[2]);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      return { day, month, year, confident: true, source: "slash_dd_mm" };
    }
  }
  return null;
}

function parseEmbeddedDates(text, defaultYear) {
  const year = extractYearFromName(text, defaultYear);
  const parsed = [];

  const fullRanges = [...String(text).matchAll(/(\d{1,2})\.(\d{2})-(\d{1,2})\.(\d{2})/g)];
  for (const match of fullRanges) {
    const day = Number(match[1]);
    const month = Number(match[2]);
    const endMonth = Number(match[4]);
    if (month === endMonth && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      parsed.push({
        day,
        month,
        year,
        confident: true,
        source: "ddmm_range",
      });
    }
  }
  if (parsed.length) return parsed;

  const matches = [...String(text).matchAll(/(\d{1,2})[.\-/](\d{1,2})(?:[.\-/](\d{2,4}))?/g)];
  for (const match of matches) {
    const rangeInMonth = match[0].match(/^(\d{1,2})-(\d{1,2})\.(\d{2})$/);
    if (rangeInMonth) {
      const day = Number(rangeInMonth[1]);
      const month = Number(rangeInMonth[3]);
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        parsed.push({
          day,
          month,
          year,
          confident: true,
          source: "range_dd_mm",
        });
      }
      continue;
    }

    const left = Number(match[1]);
    const right = Number(match[2]);
    const yearPart = match[3] ? Number(match[3]) : year;

    if (match[0].includes("-") && !match[0].includes(".")) {
      continue;
    }

    if (match[0].includes("-") && match[0].includes(".")) {
      const month = right;
      const day = left;
      const yearPart = match[3] ? Number(match[3]) : year;
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31 && yearPart >= 1900) {
        parsed.push({
          day,
          month,
          year: yearPart < 100 ? 2000 + yearPart : yearPart,
          confident: true,
          source: "range_dd_mm",
        });
      }
      continue;
    }

    const day = left;
    const month = right;
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      parsed.push({
        day,
        month,
        year: yearPart < 100 ? 2000 + yearPart : yearPart,
        confident: true,
        source: "dd_mm",
      });
    }
  }

  return parsed;
}

function parseSheetTabContext(tabName) {
  const text = String(tabName || "").trim();
  const yearMatch = text.match(/\b(20\d{2})\b/);
  const year = yearMatch ? Number(yearMatch[1]) : null;
  const lower = text.toLowerCase();

  let month = null;
  const monthPatterns = [
    ["январ", 1],
    ["феврал", 2],
    ["март", 3],
    ["апрел", 4],
    ["ма[йя]", 5],
    ["июн", 6],
    ["июл", 7],
    ["август", 8],
    ["сент", 9],
    ["октябр", 10],
    ["ноябр", 11],
    ["декабр", 12],
  ];

  for (const [pattern, value] of monthPatterns) {
    if (new RegExp(pattern, "i").test(lower)) {
      month = value;
      break;
    }
  }

  return {
    year,
    month,
    hasYear: year !== null,
    hasMonth: month !== null,
  };
}

function resolveDefaultYear(dealName, filterYear, sheetContext) {
  const yearFromName = extractYearFromName(dealName, filterYear);
  if (String(dealName).match(/\b(20\d{2})\b/)) {
    return yearFromName;
  }
  if (sheetContext?.hasYear) {
    return sheetContext.year;
  }
  return filterYear;
}

function parseDateFromName(name, defaultYear, sheetContext = null) {
  if (!name) {
    return { confident: false, reason: "empty_name" };
  }

  const year = sheetContext
    ? resolveDefaultYear(name, defaultYear, sheetContext)
    : defaultYear;

  const russian = parseRussianMonthDate(name, year);
  if (russian) return russian;

  const slash = parseSlashDate(name, year);
  if (slash) return slash;

  const embedded = parseEmbeddedDates(name, year);
  if (embedded.length === 1) return embedded[0];

  if (embedded.length > 1) {
    const months = [...new Set(embedded.map((d) => d.month))];
    if (months.length === 1) return { ...embedded[0], confident: true };
    return { confident: false, reason: "multiple_dates", candidates: embedded };
  }

  return { confident: false, reason: "date_not_found" };
}

function parseSheetNameDate(text, defaultYear) {
  const sheetContext = parseSheetTabContext(text);
  const year = sheetContext.hasYear ? sheetContext.year : defaultYear;

  const rangeMatch = String(text).match(/(\d{1,2})-(\d{1,2})\.(\d{2})/);
  if (rangeMatch) {
    const month = Number(rangeMatch[3]);
    const day = Number(rangeMatch[1]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return { day, month, year, confident: true, source: "sheet_range" };
    }
  }

  if (sheetContext.hasMonth) {
    return {
      day: 1,
      month: sheetContext.month,
      year,
      confident: true,
      source: "sheet_month_name",
    };
  }

  return null;
}

function parseExcelDate(value, defaultYear) {
  if (value === null || value === undefined || value === "") {
    return { confident: false, reason: "empty_date" };
  }

  if (typeof value === "number" && value > 20000) {
    const epoch = Date.UTC(1899, 11, 30);
    const date = new Date(epoch + value * 86400000);
    return {
      day: date.getUTCDate(),
      month: date.getUTCMonth() + 1,
      year: date.getUTCFullYear(),
      confident: true,
      source: "excel_serial",
    };
  }

  const text = String(value).trim();
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    return {
      year: Number(iso[1]),
      month: Number(iso[2]),
      day: Number(iso[3]),
      confident: true,
      source: "iso",
    };
  }

  return parseDateFromName(text, defaultYear);
}

function matchesMonth(dateInfo, month, year, options = {}) {
  if (!dateInfo || !dateInfo.confident) return null;

  const spillPreviousFromDay = options.spillPreviousFromDay ?? 25;
  const spillNextUntilDay = options.spillNextUntilDay ?? 7;
  const { day, month: dateMonth, year: dateYear } = dateInfo;

  if (dateYear !== year) return false;
  if (dateMonth === month) return true;

  const previousMonth = month === 1 ? 12 : month - 1;
  const previousYear = month === 1 ? year - 1 : year;
  if (dateMonth === previousMonth && dateYear === previousYear && day >= spillPreviousFromDay) {
    return true;
  }

  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  if (dateMonth === nextMonth && dateYear === nextYear && day <= spillNextUntilDay) {
    return true;
  }

  return false;
}

export {
  parseDateFromName,
  parseSheetNameDate,
  parseSheetTabContext,
  parseExcelDate,
  matchesMonth,
};
