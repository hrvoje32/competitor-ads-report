import { mkdir, readFile, unlink, writeFile } from "fs/promises";
import path from "path";
import crypto from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseStorageConfig } from "@/lib/env";

export const EVIDENCE_BUCKET = "ad-evidence";
export type StoredFile = { path: string; contentType?: string };
const legacyRoot = path.join(process.cwd(), "public");
const safePath = (value: string) => value.replace(/^\/+/, "").replace(/\\/g, "/");
const isLegacy = (value: string) => value.startsWith("/uploads/");
function legacyPath(value: string) { const relative = safePath(value); if (!relative.startsWith("uploads/")) throw new Error("Invalid legacy file path."); return path.join(legacyRoot, relative); }
export async function saveFile(file: StoredFile, data: Buffer) {
  const objectPath = safePath(file.path);
  if (hasSupabaseStorageConfig()) { const { error } = await createAdminClient().storage.from(EVIDENCE_BUCKET).upload(objectPath, data, { contentType: file.contentType, upsert: false }); if (error) throw new Error("Storage upload failed: " + error.message); return objectPath; }
  const output = path.join(legacyRoot, objectPath); await mkdir(path.dirname(output), { recursive: true }); await writeFile(output, data); return "/" + objectPath;
}
export async function deleteFile(filePath: string | null | undefined) {
  if (!filePath) return;
  if (isLegacy(filePath)) { try { await unlink(legacyPath(filePath)); } catch (error: unknown) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; } return; }
  const { error } = await createAdminClient().storage.from(EVIDENCE_BUCKET).remove([safePath(filePath)]); if (error) throw new Error("Storage delete failed: " + error.message);
}
export async function downloadFile(filePath: string) {
  if (isLegacy(filePath)) return readFile(legacyPath(filePath));
  const { data, error } = await createAdminClient().storage.from(EVIDENCE_BUCKET).download(safePath(filePath));
  if (error || !data) throw new Error("Storage download failed: " + (error?.message ?? "file not found")); return Buffer.from(await data.arrayBuffer());
}
export async function getSignedUrl(filePath: string, expiresIn = 60) {
  if (isLegacy(filePath)) return "/api/storage/file?path=" + encodeURIComponent(filePath);
  const { data, error } = await createAdminClient().storage.from(EVIDENCE_BUCKET).createSignedUrl(safePath(filePath), expiresIn);
  if (error || !data?.signedUrl) throw new Error("Storage signed URL failed: " + (error?.message ?? "unknown error")); return data.signedUrl;
}
export async function fileExists(filePath: string) { try { await downloadFile(filePath); return true; } catch { return false; } }
export function evidenceObjectPath(year: number, month: number, brandId: string, source: "google" | "meta", extension = "webp") { return "reports/" + year + "-" + String(month).padStart(2, "0") + "/" + brandId + "/" + source + "/" + crypto.randomUUID() + "." + extension; }
export function brandLogoObjectPath(brandId: string) { return "brands/" + brandId + "/logo/" + crypto.randomUUID() + ".webp"; }
