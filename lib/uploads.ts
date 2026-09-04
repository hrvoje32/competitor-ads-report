import sharp from "sharp";
import { deleteFile, downloadFile, evidenceObjectPath, saveFile } from "@/lib/storage";

export async function saveLogo(file: File, brandId: string) {
  if (!file || file.size === 0) return undefined;
  if (!file.type.startsWith("image/")) throw new Error("Logo must be an image file.");
  if (file.size > 8 * 1024 * 1024) throw new Error("Logo must be 8 MB or smaller.");
  const buffer = Buffer.from(await file.arrayBuffer());
  const output = await sharp(buffer).resize(600, 600, { fit: "inside", withoutEnlargement: true }).webp({ quality: 88 }).toBuffer();
  return saveFile({ path: `brands/${brandId}/logo/${crypto.randomUUID()}.webp`, contentType: "image/webp" }, output);
}

const allowedImages: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
export type CropValues = { cropX: number; cropY: number; cropWidth: number; cropHeight: number };

export async function saveEvidenceImage(file: File, report: { year: number; month: number }, brandId: string, source: "google" | "meta") {
  if (!file || file.size === 0) throw new Error("Choose at least one image.");
  const extension = allowedImages[file.type];
  if (!extension) throw new Error("Images must be JPG, JPEG, PNG, or WEBP.");
  if (file.size > 15 * 1024 * 1024) throw new Error("Each image must be 15 MB or smaller.");
  return saveFile({ path: evidenceObjectPath(report.year, report.month, brandId, source, extension), contentType: file.type }, Buffer.from(await file.arrayBuffer()));
}

export async function saveEvidenceBuffer(buffer: Buffer, report: { year: number; month: number }, brandId: string, source: "google" | "meta") {
  return saveFile({ path: evidenceObjectPath(report.year, report.month, brandId, source, "png"), contentType: "image/png" }, buffer);
}

export async function deleteLocalUpload(localImagePath: string | null) { await deleteFile(localImagePath); }

export async function deleteReportUploads(_reportId: string) { /* Object deletion is handled per evidence; storage has no report-level local directory. */ }

/** Non-destructively derives a cropped image for future PowerPoint export. */
export async function getCroppedImageBuffer(localImagePath: string, crop?: CropValues | null) {
  const input = await downloadFile(localImagePath);
  if (!crop || crop.cropWidth <= 0 || crop.cropHeight <= 0) return input;
  const image = sharp(input);
  const metadata = await image.metadata();
  const width = metadata.width ?? 0, height = metadata.height ?? 0;
  const left = Math.max(0, Math.min(Math.round(crop.cropX), Math.max(0, width - 1)));
  const top = Math.max(0, Math.min(Math.round(crop.cropY), Math.max(0, height - 1)));
  const cropWidth = Math.max(1, Math.min(Math.round(crop.cropWidth), width - left));
  const cropHeight = Math.max(1, Math.min(Math.round(crop.cropHeight), height - top));
  return image.extract({ left, top, width: cropWidth, height: cropHeight }).toBuffer();
}
