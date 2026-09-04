import { readdir, stat, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
async function walk(dir: string): Promise<Array<{ path: string; bytes: number }>> { try { const entries = await readdir(dir, { withFileTypes: true }); return (await Promise.all(entries.map(async entry => { const value = path.join(dir, entry.name); return entry.isDirectory() ? walk(value) : [{ path: path.relative(process.cwd(), value), bytes: (await stat(value)).size }]; }))).flat(); } catch { return []; } }
async function main() { const files = await walk(path.join(process.cwd(), "public", "uploads")); await mkdir(path.join(process.cwd(), "migration"), { recursive: true }); await writeFile(path.join(process.cwd(), "migration", "local-files-inventory.json"), JSON.stringify({ generatedAt: new Date().toISOString(), files }, null, 2) + "\n"); console.log("Inventoried " + files.length + " local upload files."); }
main().catch(error => { console.error(error); process.exit(1); });
