const FORMULA_PREFIX = /^[=+\-@\t\r]/;

export function escapeCsvCell(value) {
  const text = String(value ?? "");
  const safeText = FORMULA_PREFIX.test(text) ? `'${text}` : text;
  return `"${safeText.replaceAll('"', '""')}"`;
}
