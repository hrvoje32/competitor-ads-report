import assert from "node:assert/strict";
import { mock } from "node:test";
import type { Page } from "playwright";
import { metaLibraryFallbackUrl, navigateCreativePage } from "../lib/browser/navigation";

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
    const timeout = fakePage([404, new Error("Navigation timed out")]);
    await assert.rejects(navigateCreativePage(timeout.page, { source: "META", url: snapshot }), /Navigation timed out/);
    assert.equal(timeout.visited.length, 2);
    const publicMissing = fakePage([404]);
    await assert.rejects(navigateCreativePage(publicMissing.page, { source: "META", url: library }), /HTTP 404/);
    assert.equal(publicMissing.visited.length, 1);
    assert.ok(!JSON.stringify(logs).includes("private-test-token"));
    assert.ok(!JSON.stringify(logs).includes("private-value"));
    console.log("Meta capture navigation tests passed (mocked pages only).");
  } finally {
    logger.mock.restore();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
