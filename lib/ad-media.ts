import sharp from "sharp";
import { assertPublicHttpUrl } from "@/lib/browser/security";
import { providerMediaObjectPath, saveFile } from "@/lib/storage";

const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;
const DOWNLOAD_ATTEMPTS = 3;

class MediaDownloadError extends Error {
  constructor(message: string, readonly retryable = false) { super(message); }
}

async function readLimited(response: Response) {
  const declaredSize = Number(response.headers.get("content-length") || 0);
  if (declaredSize > MAX_DOWNLOAD_BYTES) throw new Error("Media file is larger than 20 MB.");
  if (!response.body) throw new Error("Media response had no body.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_DOWNLOAD_BYTES) {
      await reader.cancel();
      throw new Error("Media file is larger than 20 MB.");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map(chunk => Buffer.from(chunk)));
}

async function downloadOnce(url: string) {
  let current = url;
  for (let redirect = 0; redirect <= 4; redirect++) {
    await assertPublicHttpUrl(current);
    let response: Response;
    try {
      response = await fetch(current, {
        redirect: "manual",
        signal: AbortSignal.timeout(20_000),
        headers: { "User-Agent": "CompetitorAdsReport/1.0" },
      });
    } catch (error) {
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
        throw new MediaDownloadError("Media download timed out after 20 seconds.", true);
      }
      throw new MediaDownloadError(`Media download network error: ${error instanceof Error ? error.message : "request failed"}.`, true);
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new MediaDownloadError("Media redirect did not include a destination.");
      current = new URL(location, current).toString();
      continue;
    }
    if (!response.ok) {
      const status = `${response.status}${response.statusText ? ` ${response.statusText}` : ""}`;
      throw new MediaDownloadError(`Media download returned HTTP ${status}.`, response.status === 408 || response.status === 429 || response.status >= 500);
    }
    const contentType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
    if (contentType && !contentType.startsWith("image/") && !["application/octet-stream", "binary/octet-stream"].includes(contentType)) {
      throw new MediaDownloadError(`Unsupported media content type: ${contentType}.`);
    }
    return readLimited(response);
  }
  throw new MediaDownloadError("Media download exceeded the redirect limit.");
}

async function download(url: string) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt++) {
    try {
      return await downloadOnce(url);
    } catch (error) {
      lastError = error;
      if (!(error instanceof MediaDownloadError) || !error.retryable || attempt === DOWNLOAD_ATTEMPTS) throw error;
      await new Promise(resolve => setTimeout(resolve, attempt * 400));
    }
  }
  throw lastError;
}

export async function downloadAndProcessImage(url: string) {
  const input = await download(url);
  try {
    return await sharp(input, { limitInputPixels: 40_000_000 })
      .rotate()
      .flatten({ background: "#ffffff" })
      .resize({ width: 1920, height: 1920, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82, effort: 4 })
      .toBuffer();
  } catch {
    throw new Error("Downloaded media was not a valid supported image.");
  }
}

function escapeXml(value: string) {
  return value.replace(/[<>&'\"]/g, character => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", "\"": "&quot;" })[character]!);
}

function lines(value: string | null | undefined, maxLength: number, maxLines: number) {
  const words = (value ?? "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const result: string[] = [];
  for (const word of words) {
    const current = result[result.length - 1];
    if (!current || current.length + word.length + 1 > maxLength) result.push(word);
    else result[result.length - 1] = `${current} ${word}`;
    if (result.length > maxLines) break;
  }
  return result.slice(0, maxLines);
}

function tspans(values: string[], x: number, startY: number, lineHeight: number) {
  return values.map((value, index) => `<text x="${x}" y="${startY + index * lineHeight}">${escapeXml(value)}</text>`).join("");
}

export async function googleTextEvidenceCard(input: { headline?: string | null; body?: string | null; displayUrl?: string | null; cta?: string | null }) {
  const headline = lines(input.headline || "Google advertisement", 42, 3);
  const body = lines(input.body, 68, 7);
  const displayUrl = lines(input.displayUrl, 75, 1);
  const cta = lines(input.cta, 35, 1);
  const svg = `<svg width="1400" height="900" xmlns="http://www.w3.org/2000/svg">
    <rect width="1400" height="900" fill="#f7f9fa"/>
    <rect x="65" y="65" width="1270" height="770" rx="28" fill="#ffffff" stroke="#d5dfe3" stroke-width="3"/>
    <style>text{font-family:Arial,sans-serif;fill:#17222d}.label{font-size:24px;font-weight:700;letter-spacing:2px;fill:#64748b}.url{font-size:30px;fill:#13756f}.headline{font-size:55px;font-weight:700}.body{font-size:31px;fill:#344552}.cta{font-size:28px;font-weight:700;fill:#ffffff}</style>
    <text class="label" x="120" y="135">GOOGLE AD</text>
    <g class="url">${tspans(displayUrl, 120, 205, 40)}</g>
    <g class="headline">${tspans(headline, 120, 300, 68)}</g>
    <g class="body">${tspans(body, 120, 520, 44)}</g>
    ${cta.length ? `<rect x="1080" y="710" width="200" height="62" rx="10" fill="#159b93"/><g class="cta">${tspans(cta, 1110, 752, 35)}</g>` : ""}
    <text class="label" x="120" y="790">GOOGLE AD RECONSTRUCTED FROM TRANSPARENCY CENTER DATA</text>
  </svg>`;
  return sharp(Buffer.from(svg)).webp({ quality: 88 }).toBuffer();
}

export async function storeProviderImage(buffer: Buffer, report: { id: string }, brandId: string, source: "GOOGLE" | "META", externalId: string) {
  const path = providerMediaObjectPath(report.id, brandId, source.toLowerCase() as "google" | "meta", externalId);
  await saveFile({ path, contentType: "image/webp", upsert: true }, buffer);
  return { path, byteSize: buffer.length };
}
