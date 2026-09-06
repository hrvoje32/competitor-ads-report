import { PrismaClient } from "@prisma/client";

function databaseUrl() {
  const value = process.env.DATABASE_URL;
  if (!value) return undefined;
  try {
    const url = new URL(value);
    // Supabase's transaction pooler uses port 6543. Prisma must disable named
    // prepared statements for transaction-pooled connections.
    if (url.port === "6543" && !url.searchParams.has("pgbouncer")) {
      url.searchParams.set("pgbouncer", "true");
    }
    return url.toString();
  } catch {
    return value;
  }
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
const url = databaseUrl();
export const prisma = globalForPrisma.prisma ?? new PrismaClient(url ? { datasources: { db: { url } } } : undefined);
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
