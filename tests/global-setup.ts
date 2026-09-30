/**
 * Creates a throwaway SQLite database for the integration tests so they never
 * touch data/twg.db.
 */
import { execSync } from "node:child_process";
import { rmSync } from "node:fs";

export default function setup() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    rmSync(`data/test.db${suffix}`, { force: true });
  }
  execSync("npx prisma db push --skip-generate --accept-data-loss", {
    env: { ...process.env, DATABASE_URL: "file:../data/test.db" },
    stdio: "pipe",
  });
}
