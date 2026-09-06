const hostnamePattern = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

export function normalizeGoogleDomain(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed.replace(/^\/\//, "")}`;
  const url = new URL(candidate);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Invalid domain protocol.");

  const hostname = url.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  if (!hostnamePattern.test(hostname)) throw new Error("Invalid domain hostname.");
  return hostname;
}
