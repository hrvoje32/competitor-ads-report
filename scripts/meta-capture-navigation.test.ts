import assert from "node:assert/strict";
import { mock } from "node:test";
import dns from "node:dns/promises";
import type { Browser, Page, Route } from "playwright";
import { captureRequestPrivacy, metaSnapshotCaptureUrl, metaLibraryFallbackUrl, navigateCreativePage, tokenFreeMetaRedirect } from "../lib/browser/navigation";
import { safeCaptureText } from "../lib/browser/diagnostics";
import { publicMetaSnapshot } from "../lib/meta-ad-library";
import { captureWithBrowser } from "../lib/browser/capture";

const snapshot = "https://www.facebook.com/ads/archive/render_ad/?id=123456789&access_token=private-test-token&tracking=private-value";
const library = "https://www.facebook.com/ads/library/?id=123456789";

function fakePage(statuses: Array<number | Error>) {
  const visited: string[] = [];
  return {
    visited,
    page: { goto: async (url: string) => {
      visited.push(url);
      const result = statuses.shift();
      if (result instanceof Error) throw result;
      assert.notEqual(result, undefined, "No more than the expected navigations are allowed");
      return { status: () => result };
    } } as unknown as Page,
  };
}

async function main() {
  const originalToken = process.env.META_ACCESS_TOKEN;
  delete process.env.META_ACCESS_TOKEN;
  const logs: unknown[][] = [];
  const logger = mock.method(console, "warn", (...args: unknown[]) => logs.push(args));
  try {
    assert.equal(metaLibraryFallbackUrl(snapshot), library);
    for (const invalid of [library, "https://facebook.com.attacker.example/ads/archive/render_ad/?id=123", "https://example.com/ads/archive/render_ad/?id=123", "https://www.facebook.com/ads/archive/render_ad/?id=not-an-ad-id", "https://www.facebook.com/ads/library/?view_all_page_id=123", "invalid"]) {
      assert.equal(metaLibraryFallbackUrl(invalid), undefined);
    }
    for (const status of [404, 410]) {
      const recovered = fakePage([status, 200]);
      await navigateCreativePage(recovered.page, { source: "META", url: snapshot });
      assert.deepEqual(recovered.visited, [snapshot, library]);
    }
    const working = fakePage([200]);
    await navigateCreativePage(working.page, { source: "META", url: snapshot });
    assert.equal(working.visited.length, 1);
    const google = fakePage([404]);
    await assert.rejects(navigateCreativePage(google.page, { source: "GOOGLE", url: snapshot }), /HTTP 404/);
    assert.equal(google.visited.length, 1);
    for (const status of [403, 429, 500]) {
      const failure = fakePage([status]);
      await assert.rejects(navigateCreativePage(failure.page, { source: "META", url: snapshot }), new RegExp(`HTTP ${status}`));
      assert.equal(failure.visited.length, 1, "Do not retry blocking, rate limiting, or server failures");
    }
    const missing = fakePage([404, 404]);
    await assert.rejects(navigateCreativePage(missing.page, { source: "META", url: snapshot }), /snapshot returned HTTP 404.*public Ad Library page also failed/);
    assert.equal(missing.visited.length, 2);
    const forbidden = fakePage([404, 403]);
    await assert.rejects(navigateCreativePage(forbidden.page, { source: "META", url: snapshot }), /snapshot returned HTTP 404.*public Ad Library page also failed \(HTTP 403\)/);
    assert.equal(forbidden.visited.length, 2);
    const timeout = fakePage([404, new Error("Navigation timed out")]);
    await assert.rejects(navigateCreativePage(timeout.page, { source: "META", url: snapshot }), /Navigation timed out/);
    assert.equal(timeout.visited.length, 2);
    const publicMissing = fakePage([404]);
    await assert.rejects(navigateCreativePage(publicMissing.page, { source: "META", url: library }), /HTTP 404/);
    assert.equal(publicMissing.visited.length, 1);

    const token = "fresh-test-meta-token";
    process.env.META_ACCESS_TOKEN = token;
    const stored = publicMetaSnapshot(snapshot)!;
    assert.ok(!stored.includes("access_token"), "Stored links must remain public");
    const authenticated = fakePage([200]);
    await navigateCreativePage(authenticated.page, { source: "META", url: stored });
    const sent = new URL(authenticated.visited[0]);
    assert.equal(sent.origin, "https://www.facebook.com");
    assert.equal(sent.searchParams.get("id"), "123456789");
    assert.equal(sent.searchParams.get("access_token"), token);
    assert.equal(sent.searchParams.has("tracking"), false);
    assert.equal(metaSnapshotCaptureUrl(stored, undefined), stored);
    for (const untrusted of [library, "https://facebook.com.attacker.example/ads/archive/render_ad/?id=123", "http://www.facebook.com/ads/archive/render_ad/?id=123", "https://www.facebook.com:444/ads/archive/render_ad/?id=123", "https://user@www.facebook.com/ads/archive/render_ad/?id=123", "https://www.facebook.com/ads/archive/render_ad/?id=bad", "https://www.facebook.com/login/?id=123"]) {
      assert.equal(metaSnapshotCaptureUrl(untrusted, token), untrusted);
    }
    const googleAuth = fakePage([200]);
    await navigateCreativePage(googleAuth.page, { source: "GOOGLE", url: stored });
    assert.deepEqual(googleAuth.visited, [stored], "Google must never receive Meta authentication");
    const authFallback = fakePage([404, 200]);
    await navigateCreativePage(authFallback.page, { source: "META", url: stored });
    assert.equal(authFallback.visited[1], library, "Public fallback must stay token-free");
    const headers = { referer: sent.toString(), accept: "image/*" };
    assert.deepEqual(captureRequestPrivacy("https://example.com/image.png", headers, token), { block: false, headers: { accept: "image/*" } });
    assert.equal(headers.referer, sent.toString(), "Do not mutate the original headers");
    assert.equal(captureRequestPrivacy(sent.toString(), {}, token).block, false);
    assert.equal(tokenFreeMetaRedirect(`/ads/library/?id=123&access_token=${token}`, sent.toString(), token), "https://www.facebook.com/ads/library/?id=123");
    assert.equal(tokenFreeMetaRedirect(`https://example.com/?access_token=${token}`, sent.toString(), token), "https://example.com/");
    assert.throws(() => tokenFreeMetaRedirect(`https://example.com/${token}`, sent.toString(), token), /unsafe redirect/);
    assert.throws(() => tokenFreeMetaRedirect("javascript:alert(1)", sent.toString(), token), /unsafe redirect/);
    for (const leaked of [`https://example.com/?access_token=${token}`, `https://www.facebook.com/login/?access_token=${token}`, `https://example.com/${token}`, `https://example.com/?access_token=old-token`]) {
      assert.equal(captureRequestPrivacy(leaked, {}, token).block, true);
    }
    assert.ok(!safeCaptureText(`Navigation failed for ${sent}: ${token}`, stored).includes(token));
    assert.ok(!JSON.stringify(logs).includes(token));

    // Exercise the production network handler with mocked DNS and transport.
    // No real Meta/Browserless requests, images, or database writes.
    const dnsMock = mock.method(dns, "lookup", (async () => [{ address: "8.8.8.8", family: 4 }]) as unknown as typeof dns.lookup);
    let handler: (route: Route) => Promise<void>;
    let fetched = false;
    let fulfilled = false;
    let closed = false;
    const fakeBrowser = { newContext: async () => ({
      close: async () => { closed = true; },
      newPage: async () => ({
        route: async (_pattern: string, callback: typeof handler) => { handler = callback; },
        goto: async (url: string) => {
          await handler({
            request: () => ({ url: () => url, headers: () => ({ referer: url }) }),
            fetch: async (options: { maxRedirects: number; headers: Record<string, string> }) => {
              fetched = true;
              assert.equal(options.maxRedirects, 0);
              assert.equal(options.headers.referer, undefined);
              return { headers: () => ({ location: `/ads/library/?id=123&access_token=${token}` }) };
            },
            fulfill: async (options: { headers: Record<string, string> }) => {
              fulfilled = true;
              assert.equal(options.headers["referrer-policy"], "no-referrer");
              assert.equal(options.headers.location, "https://www.facebook.com/ads/library/?id=123");
            },
            abort: async () => { throw new Error("Unexpected abort"); },
          } as unknown as Route);
          return { status: () => 403 };
        },
      }),
    }) } as unknown as Browser;
    try {
      await assert.rejects(captureWithBrowser(fakeBrowser, { source: "META", url: stored }), /HTTP 403/);
      assert.ok(fetched && fulfilled && closed);
    } finally { dnsMock.mock.restore(); }
    assert.ok(!JSON.stringify(logs).includes("private-test-token"));
    assert.ok(!JSON.stringify(logs).includes("private-value"));
    console.log("Meta capture navigation tests passed (mocked pages only).");
  } finally {
    if (originalToken === undefined) delete process.env.META_ACCESS_TOKEN;
    else process.env.META_ACCESS_TOKEN = originalToken;
    logger.mock.restore();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
