import { testGoogleConnection } from "@/lib/google-ads-transparency";
export const runtime = "nodejs";
export async function POST() {
  try {
    const ok = await testGoogleConnection();
    if (!ok) {
      return Response.json({ ok: false, error: "Google connection test returned false." }, { status: 503 });
    }
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Google connection failed." }, { status: 503 });
  }
}
