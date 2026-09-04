import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const databasePath = path.join(process.cwd(), "prisma", "dev.db");
async function rows(table: string) { const { stdout } = await execFileAsync("sqlite3", ["-json", databasePath, "SELECT * FROM \"" + table + "\";"]); return JSON.parse(stdout || "[]"); }
async function main() {
  const data = { exportedAt: new Date().toISOString(), brands: await rows("Brand"), reports: await rows("Report"), brandReports: await rows("BrandReport"), adEvidence: await rows("AdEvidence") };
  await mkdir(path.join(process.cwd(), "migration"), { recursive: true });
  await writeFile(path.join(process.cwd(), "migration", "local-export.json"), JSON.stringify(data, null, 2) + "\n");
  console.log("Exported " + data.brands.length + " brands, " + data.reports.length + " reports, " + data.brandReports.length + " brand reports, and " + data.adEvidence.length + " evidence records.");
}
main().catch(error => { console.error(error); process.exit(1); });
