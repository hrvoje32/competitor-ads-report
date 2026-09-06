import { mkdir, readFile, stat, unlink, writeFile } from "fs/promises";
import path from "path";
import crypto from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasSupabaseStorageConfig } from "@/lib/env";

export const EVIDENCE_BUCKET = "ad-evidence";
export type StoredFile = { path: string; contentType?: string; upsert?: boolean };
const legacyRoot = path.join(process.cwd(), "public");
const safePath = (value: string) => value.replace(/^\/+/, "").replace(/\\/g, "/");
const isLegacy = (value: string) => value.startsWith("/");
function legacyPath(value: string) { const relative = safePath(value); if (!["uploads/", "reports/", "brands/"].some(prefix => relative.startsWith(prefix))) throw new Error("Invalid local file path."); return path.join(legacyRoot, relative); }
export async function saveFile(file: StoredFile, data: Buffer) {
  const objectPath = safePath(file.path);
  if (hasSupabaseStorageConfig()) { const { error } = await createAdminClient().storage.from(EVIDENCE_BUCKET).upload(objectPath, data, { contentType: file.contentType, upsert: file.upsert ?? false }); if (error) throw new Error("Storage upload failed: " + error.message); return objectPath; }
  const output = path.join(legacyRoot, objectPath); await mkdir(path.dirname(output), { recursive: true }); await writeFile(output, data); return "/" + objectPath;
}
export async function deleteFile(filePath: string | null | undefined) {
  if (!filePath) return;
  if (isLegacy(filePath)) { try { await unlink(legacyPath(filePath)); } catch (error: unknown) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; } return; }
  const { error } = await createAdminClient().storage.from(EVIDENCE_BUCKET).remove([safePath(filePath)]); if (error) throw new Error("Storage delete failed: " + error.message);
}
export async function deleteFiles(filePaths: Array<string | null | undefined>) {
  const paths = [...new Set(filePaths.filter((item): item is string => Boolean(item)))];
  const legacy = paths.filter(isLegacy);
  const remote = paths.filter(item => !isLegacy(item)).map(safePath);
  const legacyResults = await Promise.allSettled(legacy.map(deleteFile));
  const failures: string[] = legacyResults.flatMap((result, index) => result.status === "rejected" ? [`${legacy[index]}: ${result.reason instanceof Error ? result.reason.message : "delete failed"}`] : []);
  const storage = remote.length ? createAdminClient().storage.from(EVIDENCE_BUCKET) : null;
  for (let index = 0; index < remote.length; index += 100) {
    const batch = remote.slice(index, index + 100);
    const { error } = await storage!.remove(batch);
    if (error) failures.push(`${batch.length} stored file(s): ${error.message}`);
  }
  return { deleted: paths.length - failures.length, failures };
}
export async function downloadFile(filePath: string) {
  if (isLegacy(filePath)) return readFile(legacyPath(filePath));
  const { data, error } = await createAdminClient().storage.from(EVIDENCE_BUCKET).download(safePath(filePath));
  if (error || !data) throw new Error("Storage download failed: " + (error?.message ?? "file not found")); return Buffer.from(await data.arrayBuffer());
}
export async function getFileSize(filePath: string) {
  if (isLegacy(filePath)) return (await stat(legacyPath(filePath))).size;
  const objectPath = safePath(filePath);
  const separator = objectPath.lastIndexOf("/");
  const folder = separator >= 0 ? objectPath.slice(0, separator) : "";
  const name = separator >= 0 ? objectPath.slice(separator + 1) : objectPath;
  const { data, error } = await createAdminClient().storage.from(EVIDENCE_BUCKET).list(folder, { limit: 100, search: name });
  if (error) throw new Error("Storage metadata lookup failed: " + error.message);
  const item = data.find(candidate => candidate.name === name);
  const size = Number(item?.metadata?.size);
  if (!item || !Number.isFinite(size)) throw new Error("Stored file size is unavailable.");
  return size;
}
export async function getSignedUrl(filePath: string, expiresIn = 60) {
  if (isLegacy(filePath)) return "/api/storage/file?path=" + encodeURIComponent(filePath);
  const { data, error } = await createAdminClient().storage.from(EVIDENCE_BUCKET).createSignedUrl(safePath(filePath), expiresIn);
  if (error || !data?.signedUrl) throw new Error("Storage signed URL failed: " + (error?.message ?? "unknown error")); return data.signedUrl;
}
export async function fileExists(filePath: string) { try { await downloadFile(filePath); return true; } catch { return false; } }
export function evidenceObjectPath(reportId: string, brandId: string, source: "google" | "meta", extension = "webp") { return "reports/" + reportId + "/" + brandId + "/" + source + "/" + crypto.randomUUID() + "." + extension; }
export function providerMediaObjectPath(reportId: string, brandId: string, source: "google" | "meta", externalId: string, extension = "webp") {
  const safeExternalId = externalId.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 120) || "ad";
  return `reports/${reportId}/${brandId}/${source}/${safeExternalId}.${extension}`;
}
export function brandLogoObjectPath(brandId: string) { return "brands/" + brandId + "/logo/" + crypto.randomUUID() + ".webp"; }
