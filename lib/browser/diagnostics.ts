// Never include URL credentials, query values, or fragments in capture diagnostics.
export function safeCaptureUrl(raw: string) {
  try {
    const url = new URL(raw);
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return "[unavailable]";
  }
}

export function safeCaptureText(value: string, requestUrl?: string) {
  let safe = value;
  const secrets = [process.env.META_ACCESS_TOKEN, process.env.APIFY_TOKEN];
  for (const raw of [process.env.BROWSER_WS_ENDPOINT, requestUrl]) {
    if (!raw) continue;
    try {
      const url = new URL(raw);
      secrets.push(url.username, url.password, ...url.searchParams.values());
    } catch { /* Do not log malformed URLs. */ }
  }
  for (const secret of secrets) {
    if (secret && secret.length >= 4) {
      safe = safe.split(secret).join("[redacted]").split(encodeURIComponent(secret)).join("[redacted]");
    }
  }
  return safe
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s<>"']+/gi, safeCaptureUrl)
    .replace(/((?:access_token|token|api_key|authorization)\s*[=:]\s*)[^\s&,;]+/gi, "$1[redacted]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .slice(0, 500);
}
