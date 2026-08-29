import { and, asc, eq, sql } from "drizzle-orm";

import { TASK_COST, TASK_TYPE } from "@/domain/constants";
import { getDatabase } from "@/server/db/client";
import { creditEntries, jobs, questSessions, settlementAttempts, settlements, tasks } from "@/server/db/schema";
import { getLockedCreditBalance, lockUserLedger } from "@/server/services/ledger";

export async function getCreditBalance(userId: string) {
  const db = getDatabase();
  const [row] = await db
    .select({ balance: sql<number>`coalesce(sum(${creditEntries.amount}), 0)::int` })
    .from(creditEntries)
    .where(eq(creditEntries.userId, userId));
  return row?.balance ?? 0;
}

export async function createPresentationTask(input: { userId: string; prompt: string }) {
  const db = getDatabase();
  const taskId = crypto.randomUUID();

  return db.transaction(async (tx) => {
    await lockUserLedger(tx, input.userId);
    const balance = await getLockedCreditBalance(tx, input.userId);
    const status = balance >= TASK_COST ? "FUNDED" : "AWAITING_CREDITS";

    const [task] = await tx
      .insert(tasks)
      .values({
        id: taskId,
        userId: input.userId,
        prompt: input.prompt,
        taskType: TASK_TYPE,
        estimatedCost: TASK_COST,
        status,
      })
      .returning();

    if (status === "FUNDED") {
      await tx.insert(creditEntries).values({
        id: crypto.randomUUID(),
        userId: input.userId,
        amount: -TASK_COST,
        type: "TASK_SPEND",
        referenceId: taskId,
        idempotencyKey: `task-spend:${taskId}`,
      });
      await tx.insert(jobs).values({
        id: crypto.randomUUID(),
        taskId,
        status: "FUNDED",
        provider: "gemini",
      });
    }

    return { task, balance, shortage: Math.max(0, TASK_COST - balance) };
  });
}

export async function getTaskForUser(taskId: string, userId: string) {
  const db = getDatabase();
  const [task] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)))
    .limit(1);
  if (!task) return null;
  const [job] = await db.select().from(jobs).where(eq(jobs.taskId, task.id)).limit(1);
  const [quest] = await db.select().from(questSessions).where(eq(questSessions.taskId, task.id)).limit(1);
  const [settlement] = quest
    ? await db
        .select({
          id: settlements.id,
          status: settlements.status,
          sessionHash: settlements.sessionHash,
          transactionHash: settlements.transactionHash,
          blockNumber: settlements.blockNumber,
          confirmedAt: settlements.confirmedAt,
        })
        .from(settlements)
        .where(eq(settlements.questSessionId, quest.id))
        .limit(1)
    : [];
  const relayAttempts = settlement
    ? await db
        .select()
        .from(settlementAttempts)
        .where(eq(settlementAttempts.settlementId, settlement.id))
        .orderBy(asc(settlementAttempts.attemptNumber))
    : [];
  const balance = await getCreditBalance(userId);
  return { task, job: job ?? null, quest: quest ?? null, settlement: settlement ?? null, relayAttempts, balance };
}
