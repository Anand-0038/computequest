import { and, eq, isNull, lt, or, sql } from "drizzle-orm";

import { TASK_COST } from "@/domain/constants";
import { GeminiAttemptError, generatePresentation } from "@/server/ai/gemini";
import {
  calculateGeminiPublishedCost,
} from "@/server/ai/provider-pricing";
import { getDatabase } from "@/server/db/client";
import {
  creditEntries,
  jobs,
  providerAttempts,
  providerPricingSnapshots,
  tasks,
} from "@/server/db/schema";
import { requireRuntimeEnv } from "@/server/env";
import { getLockedCreditBalance, lockUserLedger } from "@/server/services/ledger";

export const MAX_PROVIDER_ATTEMPTS = 3;
const PROVIDER_LEASE_MS = 5 * 60_000;

export async function runPresentationJob(input: { taskId: string; userId: string }) {
  const db = getDatabase();
  const env = requireRuntimeEnv();
  const now = new Date();
  const staleBefore = new Date(now.getTime() - PROVIDER_LEASE_MS);
  const processingToken = crypto.randomUUID();
  const claimed = await db.transaction(async (tx) => {
    const [task] = await tx
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, input.taskId), eq(tasks.userId, input.userId)))
      .limit(1);
    if (!task) throw new Error("TASK_NOT_FOUND");

    const [job] = await tx.select().from(jobs).where(eq(jobs.taskId, task.id)).for("update").limit(1);
    if (!job) throw new Error("TASK_NOT_FUNDED");
    if (job.status === "COMPLETED") return { task, job, execute: false as const };
    if (job.status === "PROCESSING" && job.processingStartedAt && job.processingStartedAt >= staleBefore) {
      return { task, job, execute: false as const };
    }
    if (!["FUNDED", "PROCESSING"].includes(job.status)) throw new Error(`JOB_NOT_RUNNABLE:${job.status}`);
    if (job.attemptCount >= MAX_PROVIDER_ATTEMPTS) {
      if (job.status !== "PROCESSING") throw new Error("JOB_ATTEMPT_LIMIT_REACHED");
      const failureReason = "PROVIDER_ATTEMPT_TIMED_OUT_AT_CAP";
      const failedAt = new Date();
      const [failedJob] = await tx
        .update(jobs)
        .set({
          status: "FAILED",
          failureReason,
          processingStartedAt: null,
          processingToken: null,
          updatedAt: failedAt,
        })
        .where(and(eq(jobs.id, job.id), eq(jobs.status, "PROCESSING")))
        .returning();
      if (!failedJob) throw new Error("JOB_RECONCILIATION_STATE_CONFLICT");
      await tx
        .update(providerAttempts)
        .set({
          status: "FAILED",
          pricingStatus: "UNPRICED",
          pricingReason: "USAGE_METADATA_UNAVAILABLE_AFTER_PROCESS_LOSS",
          failureReason,
          completedAt: failedAt,
          updatedAt: failedAt,
        })
        .where(
          and(
            eq(providerAttempts.jobId, job.id),
            eq(providerAttempts.attemptNumber, job.attemptCount),
            eq(providerAttempts.status, "STARTED"),
          ),
        );
      await lockUserLedger(tx, input.userId);
      await tx
        .insert(creditEntries)
        .values({
          id: crypto.randomUUID(),
          userId: input.userId,
          amount: TASK_COST,
          type: "JOB_REFUND",
          referenceId: job.id,
          idempotencyKey: `job-refund:${job.id}:${job.attemptCount}`,
        })
        .onConflictDoNothing({ target: creditEntries.idempotencyKey });
      const [failedTask] = await tx
        .update(tasks)
        .set({ status: "FAILED", failureReason, updatedAt: failedAt })
        .where(eq(tasks.id, task.id))
        .returning();
      return { task: failedTask, job: failedJob, execute: false as const, reconciledAtCap: true as const };
    }

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
    await tx.insert(providerAttempts).values({
      id: crypto.randomUUID(),
      jobId: processingJob.id,
      attemptNumber: processingJob.attemptCount,
      status: "STARTED",
      provider: processingJob.provider,
      requestedModel: env.GEMINI_MODEL,
      startedAt: now,
    });
    return { task, job: processingJob, execute: true as const };
  });

  if ("reconciledAtCap" in claimed) throw new Error("JOB_ATTEMPT_LIMIT_REACHED_CREDITS_REFUNDED");
  if (!claimed.execute) return claimed;

  try {
    const generated = await generatePresentation(claimed.task.prompt);
    const priced = calculateGeminiPublishedCost(generated);
    await db.transaction(async (tx) => {
      if (priced.status === "PRICED") {
        await tx
          .insert(providerPricingSnapshots)
          .values(priced.pricing)
          .onConflictDoNothing({ target: providerPricingSnapshots.id });
      }
      const [attempt] = await tx
        .update(providerAttempts)
        .set({
          status: "SUCCEEDED",
          responseModelVersion: generated.responseModelVersion,
          serviceTier: generated.usage.serviceTier,
          providerRequestId: generated.providerRequestId,
          promptTokenCount: generated.usage.promptTokenCount,
          cachedContentTokenCount: generated.usage.cachedContentTokenCount,
          candidatesTokenCount: generated.usage.candidatesTokenCount,
          toolUsePromptTokenCount: generated.usage.toolUsePromptTokenCount,
          thoughtsTokenCount: generated.usage.thoughtsTokenCount,
          totalTokenCount: generated.usage.totalTokenCount,
          pricingSnapshotId: priced.status === "PRICED" ? priced.pricing.id : null,
          pricingStatus: priced.status,
          pricingReason: priced.status === "UNPRICED" ? priced.reason : null,
          publishedCostUsdMicros: priced.status === "PRICED" ? priced.publishedCostUsdMicros : null,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(providerAttempts.jobId, claimed.job.id),
            eq(providerAttempts.attemptNumber, claimed.job.attemptCount),
            eq(providerAttempts.status, "STARTED"),
          ),
        )
        .returning({ id: providerAttempts.id });
      if (!attempt) throw new Error("PROVIDER_ATTEMPT_STATE_CONFLICT");
    });
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
        .update(providerAttempts)
        .set({ canonical: true, updatedAt: new Date() })
        .where(
          and(
            eq(providerAttempts.jobId, claimed.job.id),
            eq(providerAttempts.attemptNumber, claimed.job.attemptCount),
            eq(providerAttempts.status, "SUCCEEDED"),
          ),
        );

      await tx
        .update(tasks)
        .set({ status: "COMPLETED", result: generated.presentation, updatedAt: new Date() })
        .where(eq(tasks.id, claimed.task.id));
      return job;
    });
    return { task: { ...claimed.task, status: "COMPLETED" as const }, job: completedJob, execute: true as const };
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 500) : "GEMINI_JOB_FAILED";
    const metadata = error instanceof GeminiAttemptError ? error.metadata : null;
    const priced = metadata ? calculateGeminiPublishedCost(metadata) : null;
    const refunded = await db.transaction(async (tx) => {
      if (priced?.status === "PRICED") {
        await tx
          .insert(providerPricingSnapshots)
          .values(priced.pricing)
          .onConflictDoNothing({ target: providerPricingSnapshots.id });
      }
      await tx
        .update(providerAttempts)
        .set({
          status: "FAILED",
          responseModelVersion: metadata?.responseModelVersion ?? null,
          serviceTier: metadata?.usage.serviceTier ?? null,
          providerRequestId: metadata?.providerRequestId ?? null,
          promptTokenCount: metadata?.usage.promptTokenCount ?? null,
          cachedContentTokenCount: metadata?.usage.cachedContentTokenCount ?? null,
          candidatesTokenCount: metadata?.usage.candidatesTokenCount ?? null,
          toolUsePromptTokenCount: metadata?.usage.toolUsePromptTokenCount ?? null,
          thoughtsTokenCount: metadata?.usage.thoughtsTokenCount ?? null,
          totalTokenCount: metadata?.usage.totalTokenCount ?? null,
          pricingSnapshotId: priced?.status === "PRICED" ? priced.pricing.id : null,
          pricingStatus: priced?.status ?? "UNPRICED",
          pricingReason:
            priced?.status === "UNPRICED" ? priced.reason : metadata ? null : "USAGE_METADATA_UNAVAILABLE",
          publishedCostUsdMicros: priced?.status === "PRICED" ? priced.publishedCostUsdMicros : null,
          failureReason: reason,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(providerAttempts.jobId, claimed.job.id),
            eq(providerAttempts.attemptNumber, claimed.job.attemptCount),
            eq(providerAttempts.status, "STARTED"),
          ),
        );
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
          idempotencyKey: `job-refund:${claimed.job.id}:${claimed.job.attemptCount}`,
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
    if (record.job.attemptCount >= MAX_PROVIDER_ATTEMPTS) throw new Error("JOB_RETRY_LIMIT_REACHED");

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
