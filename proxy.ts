import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          // Server Components must receive the refreshed session on this request.
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
          Object.entries(headers).forEach(([name, value]) => response.headers.set(name, value));
        },
      },
    },
  );
  const { data, error } = await supabase.auth.getClaims();
  const authenticated = !error && Boolean(data?.claims.sub);
  const pathname = request.nextUrl.pathname;
  const isPublic = pathname === "/login" || pathname === "/auth" || pathname.startsWith("/auth/");

  // Never cache an authentication decision or a response that updates a session.
  response.headers.set("Cache-Control", "private, no-store");

  function withSessionCookies(destination: NextResponse) {
    response.cookies.getAll().forEach(cookie => destination.cookies.set(cookie));
    for (const name of ["Cache-Control", "Expires", "Pragma"]) {
      const value = response.headers.get(name);
      if (value) destination.headers.set(name, value);
    }
    return destination;
  }

  if (!authenticated && !isPublic) {
    if (pathname === "/api" || pathname.startsWith("/api/")) {
      return withSessionCookies(NextResponse.json({ error: "Unauthorized." }, { status: 401 }));
    }
    return withSessionCookies(NextResponse.redirect(new URL("/login", request.url)));
  }
  if (authenticated && pathname === "/login") {
    return withSessionCookies(NextResponse.redirect(new URL("/", request.url)));
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
