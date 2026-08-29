export function publicTask(task: {
  id: string;
  prompt: string;
  taskType: string;
  estimatedCost: number;
  status: string;
  result: unknown;
  failureReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: task.id,
    prompt: task.prompt,
    taskType: task.taskType,
    estimatedCost: task.estimatedCost,
    status: task.status,
    result: task.result,
    failureReason: task.failureReason,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

export function publicJob(job: {
  id: string;
  status: string;
  provider: string;
  structuredResult: unknown;
  failureReason: string | null;
  refundedAt: Date | null;
  attemptCount: number;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: job.id,
    status: job.status,
    provider: job.provider,
    structuredResult: job.structuredResult,
    failureReason: job.failureReason,
    refundedAt: job.refundedAt,
    attemptCount: job.attemptCount,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

export function publicQuestSession(session: {
  id: string;
  state: string;
  accumulatedActiveMs: number;
  lastHeartbeatAt: Date | null;
  lastHeartbeatSequence: number;
  lastHeartbeatEligible: boolean;
  lastAttentionReason: string;
  serverStartedAt: Date;
  completionAnsweredAt: Date | null;
  claimedAt: Date | null;
  updatedAt: Date;
}) {
  return {
    id: session.id,
    state: session.state,
    accumulatedActiveMs: session.accumulatedActiveMs,
    lastHeartbeatAt: session.lastHeartbeatAt,
    lastHeartbeatSequence: session.lastHeartbeatSequence,
    lastHeartbeatEligible: session.lastHeartbeatEligible,
    lastAttentionReason: session.lastAttentionReason,
    serverStartedAt: session.serverStartedAt,
    completionAnsweredAt: session.completionAnsweredAt,
    claimedAt: session.claimedAt,
    updatedAt: session.updatedAt,
  };
}

export function publicSettlementResult(settlement: {
  settlementId: string;
  transactionHash: string | null;
  blockNumber: bigint | null;
  status: string;
  taskId: string;
  taskStatus: string;
  balanceAfterCredit?: number;
}) {
  return {
    ...settlement,
    blockNumber: settlement.blockNumber?.toString() ?? null,
  };
}

export function publicSettlementSnapshot(settlement: {
  id: string;
  status: string;
  sessionHash: string;
  transactionHash: string | null;
  blockNumber: bigint | null;
  confirmedAt: Date | null;
}) {
  return {
    ...settlement,
    blockNumber: settlement.blockNumber?.toString() ?? null,
  };
}

export function publicSettlementAttempt(attempt: {
  id: string;
  attemptNumber: number;
  transactionHash: string | null;
  status: string;
  failureReason: string | null;
  blockNumber: bigint | null;
  submittedAt: Date | null;
  confirmedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: attempt.id,
    attemptNumber: attempt.attemptNumber,
    transactionHash: attempt.transactionHash,
    status: attempt.status,
    failureReason: attempt.failureReason,
    blockNumber: attempt.blockNumber?.toString() ?? null,
    submittedAt: attempt.submittedAt,
    confirmedAt: attempt.confirmedAt,
    createdAt: attempt.createdAt,
    updatedAt: attempt.updatedAt,
  };
}
