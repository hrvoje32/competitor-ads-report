import { testMetaConnection } from "@/lib/meta-ad-library";
export const runtime = "nodejs";
export async function POST() { try { await testMetaConnection(); return Response.json({ ok: true }); } catch (error) { return Response.json({ ok: false, error: error instanceof Error ? error.message : "Meta connection failed." }, { status: 503 }); } }
