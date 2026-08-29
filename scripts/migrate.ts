import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { requireDatabaseEnv } from "../src/server/env";

async function main() {
  const env = requireDatabaseEnv();
  const sql = postgres(env.DATABASE_URL, {
    max: 1,
    connect_timeout: 10,
    idle_timeout: 10,
    prepare: false,
  });

  try {
    await migrate(drizzle(sql), { migrationsFolder: "./drizzle" });
    console.log("ComputeQuest database migrations complete.");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

void main();
