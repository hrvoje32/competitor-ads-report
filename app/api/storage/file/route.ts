import { NextRequest } from "next/server";
import { downloadFile } from "@/lib/storage";
import { requireUser } from "@/lib/supabase/server";
export const runtime = "nodejs";
export async function GET(request: NextRequest) { try { await requireUser(); const filePath = request.nextUrl.searchParams.get("path"); if (!filePath || filePath.startsWith("/") || filePath.includes("..")) return new Response("Not found.", { status: 404 }); const data = await downloadFile(filePath); return new Response(new Uint8Array(data), { headers: { "Content-Type": "application/octet-stream", "Cache-Control": "private, max-age=60" } }); } catch { return new Response("Not found.", { status: 404 }); } }
