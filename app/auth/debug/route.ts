import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// Temporary local diagnostic. Never return session contents, keys, or tokens.
export async function GET() {
  if (process.env.NODE_ENV !== "development") {
    return new NextResponse(null, { status: 404 });
  }

  const cookieStore = await cookies();
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  const authCookieNames = cookieStore.getAll()
    .map(cookie => cookie.name)
    .filter(name => /^sb-.+-auth-token(?:\.\d+)?$/.test(name));

  return NextResponse.json({
    authenticated: !error && Boolean(user),
    user: !error && user ? { id: user.id, email: user.email } : null,
    projectHost: new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).host,
    cookiesPresent: authCookieNames.length > 0,
    authCookieNames,
  }, { headers: { "Cache-Control": "private, no-store" } });
}
