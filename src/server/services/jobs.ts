import { and, eq, isNull, lt, or, sql } from "drizzle-orm";

import { TASK_COST } from "@/domain/constants";
import { generatePresentation } from "@/server/ai/gemini";
import { getDatabase } from "@/server/db/client";
import { creditEntries, jobs, tasks } from "@/server/db/schema";
import { getLockedCreditBalance, lockUserLedger } from "@/server/services/ledger";

export async function runPresentationJob(input: { taskId: string; userId: string }) {
  const db = getDatabase();
  const now = new Date();
  const staleBefore = new Date(now.getTime() - 2 * 60_000);
  const processingToken = crypto.randomUUID();
  const claimed = await db.transaction(async (tx) => {
    const [task] = await tx
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, input.taskId), eq(tasks.userId, input.userId)))
      .limit(1);
    if (!task) throw new Error("TASK_NOT_FOUND");

    const [job] = await tx.select().from(jobs).where(eq(jobs.taskId, task.id)).limit(1);
    if (!job) throw new Error("TASK_NOT_FUNDED");
    if (job.status === "COMPLETED") return { task, job, execute: false as const };
    if (job.status === "PROCESSING" && job.processingStartedAt && job.processingStartedAt >= staleBefore) {
      return { task, job, execute: false as const };
    }
    if (!["FUNDED", "PROCESSING"].includes(job.status)) throw new Error(`JOB_NOT_RUNNABLE:${job.status}`);

    const [processingJob] = await tx
      .update(jobs)
      .set({
        status: "PROCESSING",
        processingStartedAt: now,
        processingToken,
        attemptCount: sql`${jobs.attemptCount} + 1`,
        updatedAt: now,
      })
      .where(
        and(
          eq(jobs.id, job.id),
          or(
            eq(jobs.status, "FUNDED"),
            and(
              eq(jobs.status, "PROCESSING"),
              or(isNull(jobs.processingStartedAt), lt(jobs.processingStartedAt, staleBefore)),
            ),
          ),
        ),
      )
      .returning();
    if (!processingJob) throw new Error("JOB_ALREADY_CLAIMED");

    await tx.update(tasks).set({ status: "PROCESSING", updatedAt: new Date() }).where(eq(tasks.id, task.id));
    return { task, job: processingJob, execute: true as const };
  });

  if (!claimed.execute) return claimed;

  try {
    const generated = await generatePresentation(claimed.task.prompt);
    const completedJob = await db.transaction(async (tx) => {
      const [job] = await tx
        .update(jobs)
        .set({
          status: "COMPLETED",
          providerRequestId: generated.providerRequestId,
          structuredResult: generated.presentation,
          processingStartedAt: null,
          processingToken: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(jobs.id, claimed.job.id),
            eq(jobs.status, "PROCESSING"),
            eq(jobs.processingToken, processingToken),
          ),
        )
        .returning();
      if (!job) throw new Error("JOB_COMPLETION_STATE_CONFLICT");

      await tx
        .update(tasks)
        .set({ status: "COMPLETED", result: generated.presentation, updatedAt: new Date() })
        .where(eq(tasks.id, claimed.task.id));
      return job;
    });
    return { task: { ...claimed.task, status: "COMPLETED" as const }, job: completedJob, execute: true as const };
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 500) : "GEMINI_JOB_FAILED";
    const refunded = await db.transaction(async (tx) => {
      const [job] = await tx
        .update(jobs)
        .set({
          status: "REFUNDED",
          failureReason: reason,
          refundedAt: new Date(),
          processingStartedAt: null,
          processingToken: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(jobs.id, claimed.job.id),
            eq(jobs.status, "PROCESSING"),
            eq(jobs.processingToken, processingToken),
          ),
        )
        .returning({ id: jobs.id });
      if (!job) return false;
      await lockUserLedger(tx, input.userId);
      await tx
        .insert(creditEntries)
        .values({
          id: crypto.randomUUID(),
          userId: input.userId,
          amount: TASK_COST,
          type: "JOB_REFUND",
          referenceId: claimed.job.id,
          idempotencyKey: `job-refund:${claimed.job.id}`,
        })
        .onConflictDoNothing({ target: creditEntries.idempotencyKey });
      await tx
        .update(tasks)
        .set({ status: "FAILED", failureReason: reason, updatedAt: new Date() })
        .where(eq(tasks.id, input.taskId));
      return true;
    });
    if (!refunded) throw new Error("JOB_LEASE_LOST");
    throw new Error(`JOB_FAILED_AND_REFUNDED:${reason}`);
  }
}

export async function retryRefundedJob(input: { jobId: string; userId: string }) {
  const db = getDatabase();
  return db.transaction(async (tx) => {
    const [record] = await tx
      .select({ job: jobs, task: tasks })
      .from(jobs)
      .innerJoin(tasks, eq(tasks.id, jobs.taskId))
      .where(and(eq(jobs.id, input.jobId), eq(tasks.userId, input.userId)))
      .for("update")
      .limit(1);
    if (!record) throw new Error("JOB_NOT_FOUND");
    if (record.job.status !== "REFUNDED") throw new Error(`JOB_NOT_RETRYABLE:${record.job.status}`);

    await lockUserLedger(tx, input.userId);
    const balance = await getLockedCreditBalance(tx, input.userId);
    if (balance < TASK_COST) throw new Error("RETRY_CREDITS_UNAVAILABLE");

    await tx.insert(creditEntries).values({
      id: crypto.randomUUID(),
      userId: input.userId,
      amount: -TASK_COST,
      type: "TASK_SPEND",
      referenceId: record.job.id,
      idempotencyKey: `job-retry-spend:${record.job.id}:${record.job.attemptCount}`,
    });
    const [job] = await tx
      .update(jobs)
      .set({
        status: "FUNDED",
        failureReason: null,
        refundedAt: null,
        processingStartedAt: null,
        processingToken: null,
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, record.job.id))
      .returning();
    await tx
      .update(tasks)
      .set({ status: "FUNDED", failureReason: null, updatedAt: new Date() })
      .where(eq(tasks.id, record.task.id));
    return { job, taskId: record.task.id };
  });
}
