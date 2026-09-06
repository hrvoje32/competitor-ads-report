"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState(""), [password, setPassword] = useState(""), [error, setError] = useState(""), [pending, setPending] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      const supabase = createClient();
      const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
      if (authError) {
        setError(authError.message);
        return;
      }
      setError("");
      router.push("/");
      router.refresh();
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : "Unable to sign in. Please try again.");
    } finally {
      setPending(false);
    }
  }
  return <main className="grid min-h-screen place-items-center bg-slate-100 p-5"><form onSubmit={submit} className="w-full max-w-sm rounded-xl bg-white p-7 shadow-sm"><h1 className="text-xl font-bold text-slate-950">Competitor Ads Report</h1><p className="mt-2 text-sm text-slate-500">Sign in with your invited account.</p><label className="mt-6 block text-sm font-medium">Email<input required type="email" value={email} onChange={event => setEmail(event.target.value)} className="mt-1 w-full" /></label><label className="mt-4 block text-sm font-medium">Password<input required type="password" value={password} onChange={event => setPassword(event.target.value)} className="mt-1 w-full" /></label>{error && <p role="alert" className="mt-4 text-sm text-rose-700">{error}</p>}<button className="button mt-6 w-full" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</button></form></main>;
}
