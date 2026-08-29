import { eq, sql } from "drizzle-orm";

import type { DatabaseTransaction } from "@/server/db/client";
import { creditEntries, users } from "@/server/db/schema";

export async function lockUserLedger(tx: DatabaseTransaction, userId: string) {
  const [user] = await tx
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId))
    .for("update")
    .limit(1);
  if (!user) throw new Error("USER_NOT_FOUND");
}

export async function getLockedCreditBalance(tx: DatabaseTransaction, userId: string) {
  const [row] = await tx
    .select({ balance: sql<number>`coalesce(sum(${creditEntries.amount}), 0)::int` })
    .from(creditEntries)
    .where(eq(creditEntries.userId, userId));
  return row?.balance ?? 0;
}
