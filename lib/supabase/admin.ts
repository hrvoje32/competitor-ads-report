import { createClient } from "@supabase/supabase-js";
import { requireServerEnv, env } from "@/lib/env";
export function createAdminClient() { requireServerEnv("SUPABASE_URL", "SUPABASE_SECRET_KEY"); return createClient(env.SUPABASE_URL!, env.SUPABASE_SECRET_KEY!, { auth: { autoRefreshToken: false, persistSession: false } }); }
