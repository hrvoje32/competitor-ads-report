import { z } from "zod";
import { findAdvertisers } from "@/lib/google-ads-transparency";
export const runtime = "nodejs";
export async function POST(request: Request) { try { const { query } = z.object({ query: z.string().trim().min(1).max(200) }).parse(await request.json()); return Response.json({ advertisers: await findAdvertisers(query) }); } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Advertiser search failed." }, { status: 400 }); } }
