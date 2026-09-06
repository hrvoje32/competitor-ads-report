import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
export async function POST(request: Request) {
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut();
  if (error) {
    return NextResponse.json({ error: error.message }, {
      status: 500,
      headers: { "Cache-Control": "private, no-store" },
    });
  }
  return NextResponse.redirect(new URL("/login", request.url), {
    status: 303,
    headers: { "Cache-Control": "private, no-store" },
  });
}
