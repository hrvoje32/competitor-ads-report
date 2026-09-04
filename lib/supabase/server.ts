import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { cookies: { getAll() { return cookieStore.getAll(); }, setAll(values) { try { values.forEach(({ name, value, options }) => cookieStore.set(name, value, options)); } catch { /* proxy refreshes sessions */ } } } });
}
export async function requireUser() { const supabase = await createClient(); const { data: { user }, error } = await supabase.auth.getUser(); if (error || !user) throw new Error("Unauthorized."); return user; }
