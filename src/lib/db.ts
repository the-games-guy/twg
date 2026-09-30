import { PrismaClient } from "@prisma/client";

/**
 * SQLite in WAL mode: the worker holds long-lived write transactions during a
 * results sync while the web app writes on prediction save. WAL plus a busy
 * timeout turns the resulting contention into a short wait rather than
 * SQLITE_BUSY.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

let pragmasApplied = false;

export async function applyPragmas(): Promise<void> {
  if (pragmasApplied) return;
  pragmasApplied = true;
  // journal_mode and busy_timeout both return a row, so they must go through
  // $queryRaw — $executeRaw rejects any statement that produces results.
  await prisma.$queryRawUnsafe("PRAGMA journal_mode=WAL;");
  await prisma.$queryRawUnsafe("PRAGMA busy_timeout=5000;");
  await prisma.$executeRawUnsafe("PRAGMA foreign_keys=ON;");
}
