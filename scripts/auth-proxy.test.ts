import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { NextRequest } from "next/server";
import { proxy } from "../proxy";

// Exercise the real SSR cookie adapter with a fake Auth service, never real tokens.
const originalFetch = globalThis.fetch;
const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const originalKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const projectUrl = "https://auth-test.supabase.co";
const cookieName = "sb-auth-test-auth-token";
const user = { id: "test-user", email: "test@example.com", aud: "authenticated" };
let rejectSession = false;
let refreshes = 0;

function session(expired = false) {
  const exp = Math.floor(Date.now() / 1000) + (expired ? -60 : 3600);
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return {
    access_token: `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: user.id, email: user.email, aud: user.aud, exp, iss: `${projectUrl}/auth/v1` })}.${Buffer.from("test-signature").toString("base64url")}`,
    refresh_token: "test-refresh-token",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: exp,
    user,
  };
}

function request(path: string, expired?: boolean) {
  return new NextRequest(`http://localhost:3000${path}`, {
    headers: expired === undefined ? {} : {
      cookie: `${cookieName}=base64-${Buffer.from(JSON.stringify(session(expired))).toString("base64url")}`,
    },
  });
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = projectUrl;
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "test-publishable-key";
  rejectSession = false;
  refreshes = 0;
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    assert.equal(url.origin, projectUrl, "Unexpected network destination");
    if (rejectSession) {
      return Response.json({ code: "refresh_token_not_found", message: "Invalid session" }, { status: 400 });
    }
    if (url.pathname === "/auth/v1/token") {
      refreshes++;
      return Response.json(session());
    }
    assert.equal(url.pathname, "/auth/v1/user");
    return Response.json(user);
  };
});

after(() => {
  globalThis.fetch = originalFetch;
  if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
  if (originalKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  else process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = originalKey;
});

test("logged-out pages and nested routes redirect; APIs return 401", async () => {
  for (const path of ["/", "/brands", "/brands/example/edit", "/reports", "/reports/example", "/login-extra"]) {
    const response = await proxy(request(path));
    assert.equal(response.status, 307);
    assert.equal(response.headers.get("location"), "http://localhost:3000/login");
  }
  for (const path of ["/api/storage/file", "/api/reports/example/export", "/api/google/test-connection"]) {
    assert.equal((await proxy(request(path))).status, 401);
  }
});

test("login and the entire auth route namespace remain public", async () => {
  for (const path of ["/login", "/auth", "/auth/callback", "/auth/debug", "/auth/another-callback"]) {
    assert.equal((await proxy(request(path))).status, 200);
  }
});

test("validated users can access protected pages and APIs", async () => {
  for (const path of ["/", "/brands", "/reports", "/api/storage/file"]) {
    assert.equal((await proxy(request(path, false))).status, 200);
  }
});

test("authenticated login redirects home", async () => {
  const response = await proxy(request("/login", false));
  assert.equal(response.headers.get("location"), "http://localhost:3000/");
});

test("unexpired cookie claims cannot authorize when Auth validation rejects them", async () => {
  rejectSession = true;
  const response = await proxy(request("/brands", false));
  assert.equal(response.headers.get("location"), "http://localhost:3000/login");
});

test("refresh updates incoming cookies, forwarded request, outgoing cookies and cache headers", async () => {
  const incoming = request("/brands", true);
  const oldCookie = incoming.cookies.get(cookieName)?.value;
  const response = await proxy(incoming);
  assert.equal(response.status, 200);
  assert.equal(refreshes, 1);
  assert.notEqual(incoming.cookies.get(cookieName)?.value, oldCookie);
  assert.equal(response.cookies.get(cookieName)?.value, incoming.cookies.get(cookieName)?.value);
  assert.ok(response.headers.get("x-middleware-request-cookie")?.includes(incoming.cookies.get(cookieName)!.value));
  assert.match(response.headers.get("cache-control")!, /no-store/);
  assert.equal(response.headers.get("pragma"), "no-cache");
});

test("login redirect preserves refreshed session cookies", async () => {
  const response = await proxy(request("/login", true));
  assert.equal(response.headers.get("location"), "http://localhost:3000/");
  assert.equal(refreshes, 1);
  assert.ok(response.cookies.get(cookieName)?.value);
  assert.match(response.headers.get("cache-control")!, /no-store/);
  assert.equal(response.headers.get("pragma"), "no-cache");
});

test("invalid refresh tokens cannot authorize and their cookie deletion survives redirects", async () => {
  rejectSession = true;
  const response = await proxy(request("/reports", true));
  assert.equal(response.headers.get("location"), "http://localhost:3000/login");
  assert.equal(response.cookies.get(cookieName)?.maxAge, 0);
});
