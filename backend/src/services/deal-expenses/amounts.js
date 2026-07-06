function parseAmount(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;

  let text = String(value)
    .replace(/\u00a0/g, " ")
    .replace(/руб\.?/gi, "")
    .replace(/₽/g, "")
    .replace(/р\.?/gi, "")
    .trim();

  if (!text) return null;

  text = text.replace(/\s+/g, "");
  if (text.includes(",") && text.includes(".")) {
    text = text.replace(/,/g, "");
  } else if (text.includes(",")) {
    text = text.replace(",", ".");
  }

  const num = Number(text);
  return Number.isFinite(num) ? num : null;
}

export { parseAmount };
