export function text(value: unknown) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  return undefined;
}

export function textArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map(text).filter((item): item is string => Boolean(item));
}

export function uniqueUrls(...values: unknown[]) {
  const urls = values.flatMap(value => Array.isArray(value) ? value : [value])
    .map(text)
    .filter((item): item is string => Boolean(item))
    .filter(item => /^https?:\/\//i.test(item));
  return [...new Set(urls)];
}

export function parsedDate(value: unknown) {
  const raw = text(value);
  if (!raw) return undefined;
  const valueDate = new Date(raw);
  return Number.isNaN(valueDate.getTime()) ? undefined : valueDate;
}

export function firstText(...values: unknown[]) {
  for (const value of values) {
    const direct = text(value);
    if (direct) return direct;
    const first = textArray(value)[0];
    if (first) return first;
  }
  return undefined;
}

export function nestedRecords(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
}
