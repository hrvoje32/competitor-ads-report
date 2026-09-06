import { lookup } from "node:dns/promises";
import net from "node:net";

function isPrivateIp(ip: string) {
  const version = net.isIP(ip);
  if (version === 4) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127);
  }
  if (version === 6) {
    const normalized = ip.toLowerCase();
    return normalized === "::1" ||
      normalized.startsWith("fe80:") ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("::ffff:127.") ||
      normalized.startsWith("::ffff:10.") ||
      normalized.startsWith("::ffff:192.168.") ||
      normalized.startsWith("::ffff:172.");
  }
  return true;
}

export async function assertPublicHttpUrl(raw: string) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Creative capture URL is invalid.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Creative capture only supports public HTTP URLs.");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || (net.isIP(host) !== 0 && isPrivateIp(host))) {
    throw new Error("Creative capture refused a private network address.");
  }
  const records = await lookup(host, { all: true });
  if (!records.length || records.some(record => isPrivateIp(record.address))) {
    throw new Error("Creative capture refused a private network address.");
  }
  return url;
}
