import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";

import { requireDatabaseEnv } from "@/server/env";
import * as schema from "@/server/db/schema";

export type Database = PostgresJsDatabase<typeof schema>;
export type DatabaseTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

let sqlClient: Sql | undefined;
let database: Database | undefined;

export function getDatabase(): Database {
  if (database) return database;

  const env = requireDatabaseEnv();
  sqlClient = postgres(env.DATABASE_URL, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
  });
  database = drizzle(sqlClient, { schema });
  return database;
}

export async function closeDatabase() {
  await sqlClient?.end({ timeout: 5 });
  sqlClient = undefined;
  database = undefined;
}
