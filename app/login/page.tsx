"use client";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter(), search = useSearchParams();
  const [email, setEmail] = useState(""), [password, setPassword] = useState(""), [error, setError] = useState(""), [pending, setPending] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) { event.preventDefault(); setPending(true); setError(""); const { error: authError } = await createClient().auth.signInWithPassword({ email, password }); if (authError) setError(authError.message); else router.replace(search.get("next") || "/"); setPending(false); }
  return <main className="grid min-h-screen place-items-center bg-slate-100 p-5"><form onSubmit={submit} className="w-full max-w-sm rounded-xl bg-white p-7 shadow-sm"><h1 className="text-xl font-bold text-slate-950">Competitor Ads Report</h1><p className="mt-2 text-sm text-slate-500">Sign in with your invited account.</p><label className="mt-6 block text-sm font-medium">Email<input required type="email" value={email} onChange={event => setEmail(event.target.value)} className="mt-1 w-full" /></label><label className="mt-4 block text-sm font-medium">Password<input required type="password" value={password} onChange={event => setPassword(event.target.value)} className="mt-1 w-full" /></label>{error && <p className="mt-4 text-sm text-rose-700">{error}</p>}<button className="button mt-6 w-full" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</button></form></main>;
}
