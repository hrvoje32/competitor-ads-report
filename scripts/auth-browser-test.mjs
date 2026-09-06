import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { chromium } from "playwright";

const require = createRequire(import.meta.url);
require("@next/env").loadEnvConfig(process.cwd(), true);
const baseUrl = process.env.AUTH_TEST_BASE_URL || "http://localhost:3000";
const email = process.env.AUTH_TEST_EMAIL;
const password = process.env.AUTH_TEST_PASSWORD;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();
page.setDefaultTimeout(15000);
const passed = label => console.log(`PASS ${label}`);
const path = () => new URL(page.url()).pathname;
const authCookies = async () => (await context.cookies(baseUrl))
  .filter(cookie => /^sb-.+-auth-token(?:\.\d+)?$/.test(cookie.name));

async function checkPage(urlPath, heading) {
  await page.goto(`${baseUrl}${urlPath}`);
  assert.equal(path(), urlPath);
  await page.getByRole("heading", { name: heading, exact: true }).waitFor();
  await page.reload();
  assert.equal(path(), urlPath);
  await page.getByRole("heading", { name: heading, exact: true }).waitFor();
}

async function signIn() {
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  const authResult = page.waitForResponse(response =>
    response.url().startsWith(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/token`));
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  assert.equal((await authResult).status(), 200, "Supabase rejected the test login");
  await page.waitForURL(`${baseUrl}/`);
  assert.ok((await authCookies()).length > 0, "Browser auth cookies missing");
  assert.equal(await page.locator('form [role="alert"]').count(), 0);
}

try {
  await page.goto(`${baseUrl}/login`);
  await page.getByRole("button", { name: "Sign in", exact: true }).waitFor();
  assert.equal((await authCookies()).length, 0);
  passed("A: logged-out /login loads without session cookies");

  for (const urlPath of ["/", "/brands", "/brands/example/edit", "/reports", "/reports/example"]) {
    await page.goto(`${baseUrl}${urlPath}`);
    assert.equal(path(), "/login");
  }
  passed("logged-out protected pages and nested routes redirect to /login");
  for (const urlPath of ["/api/storage/file", "/api/reports/example/export", "/api/google/test-connection"]) {
    assert.equal((await context.request.get(`${baseUrl}${urlPath}`)).status(), 401);
  }
  passed("logged-out protected APIs return 401");

  const debug = await context.request.get(`${baseUrl}/auth/debug`);
  assert.equal(debug.status(), 200);
  assert.deepEqual(await debug.json(), {
    authenticated: false, user: null,
    projectHost: new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host,
    cookiesPresent: false, authCookieNames: [],
  });
  passed("development debug endpoint confirms server project and absent session");

  await page.getByLabel("Email", { exact: true }).fill("auth-negative-test@example.invalid");
  await page.getByLabel("Password", { exact: true }).fill("intentionally-invalid-password");
  const invalidResponse = page.waitForResponse(response =>
    response.url().startsWith(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/token`));
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const rejected = await invalidResponse;
  const authError = await rejected.json();
  assert.ok(rejected.status() >= 400);
  await page.locator('form [role="alert"]').waitFor();
  assert.equal(await page.locator('form [role="alert"]').textContent(), authError.msg || authError.message || authError.error_description);
  assert.equal(path(), "/login");
  assert.equal((await authCookies()).length, 0);
  passed("failed password sign-in visibly shows Supabase error and stays on /login");

  if (!email || !password) {
    console.log("BLOCKED B–M: set AUTH_TEST_EMAIL and AUTH_TEST_PASSWORD in .env.local for real-user sign-in, refresh and sign-out verification.");
    process.exitCode = 2;
  } else {
    await signIn();
    passed("B–C: real password login succeeds, creates cookies and redirects home");
    await checkPage("/", "Dashboard");
    passed("D–E: dashboard renders and remains authenticated after refresh");
    await checkPage("/brands", "Brands");
    passed("F–G: /brands renders directly and after refresh");
    await checkPage("/reports", "Monthly reports");
    passed("H–I: /reports renders directly and after refresh");

    const server = await (await context.request.get(`${baseUrl}/auth/debug`)).json();
    assert.equal(server.authenticated, true);
    assert.equal(server.cookiesPresent, true);
    assert.equal(server.user.email.toLowerCase(), email.toLowerCase());
    console.log(JSON.stringify({ serverUser: server.user, projectHost: server.projectHost, cookiesPresent: true }));
    await page.goto(`${baseUrl}/login`);
    assert.equal(path(), "/");
    passed("authenticated /login redirects home");

    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await page.waitForURL(`${baseUrl}/login`);
    assert.equal((await authCookies()).length, 0);
    passed("J: sign-out clears browser auth cookies");
    await page.goto(`${baseUrl}/brands`);
    assert.equal(path(), "/login");
    passed("K: /brands redirects to /login after sign-out");
    await signIn();
    await checkPage("/", "Dashboard");
    passed("L–M: second password login and refreshed session work");

    // End the isolated test browser's session instead of leaving it active.
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await page.waitForURL(`${baseUrl}/login`);
  }
} catch (error) {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
