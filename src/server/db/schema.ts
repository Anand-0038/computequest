import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const taskStatus = pgEnum("task_status", [
  "CREATED",
  "AWAITING_CREDITS",
  "FUNDED",
  "PROCESSING",
  "COMPLETED",
  "FAILED",
]);

export const questState = pgEnum("quest_state", [
  "CREATED",
  "ACTIVE",
  "PAUSED",
  "ATTENTION_VERIFIED",
  "VERIFYING",
  "AUTHORIZED",
  "SETTLING",
  "SETTLED",
  "CREDITED",
  "EXPIRED",
  "REJECTED",
  "ALREADY_CLAIMED",
  "SETTLEMENT_FAILED",
]);

export const settlementStatus = pgEnum("settlement_status", [
  "AUTHORIZED",
  "SUBMITTING",
  "SUBMITTED",
  "CONFIRMED",
  "FAILED",
]);

export const campaignRewardClaimStatus = pgEnum("campaign_reward_claim_status", [
  "RESERVED",
  "CONFIRMED",
]);

export const relayAttemptStatus = pgEnum("relay_attempt_status", [
  "SUBMITTING",
  "SUBMITTED",
  "CONFIRMED",
  "REVERTED",
  "FAILED",
]);

export const creditEntryType = pgEnum("credit_entry_type", [
  "INITIAL_GRANT",
  "QUEST_GRANT",
  "TASK_SPEND",
  "JOB_REFUND",
]);

export const jobStatus = pgEnum("job_status", [
  "FUNDED",
  "PROCESSING",
  "COMPLETED",
  "FAILED",
  "REFUNDED",
]);

export const providerAttemptStatus = pgEnum("provider_attempt_status", [
  "STARTED",
  "SUCCEEDED",
  "FAILED",
]);

export const sponsorInquiryStatus = pgEnum("sponsor_inquiry_status", [
  "RECEIVED",
  "CONTACTED",
  "APPROVED",
  "REJECTED",
]);

export const sponsorCreativeType = pgEnum("sponsor_creative_type", [
  "VIDEO",
  "X_POST",
  "IMAGE",
  "OTHER",
]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
};

export const users = pgTable("users", {
  id: uuid("id").primaryKey(),
  walletAddress: text("wallet_address").unique(),
  ...timestamps,
});

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id),
    prompt: text("prompt").notNull(),
    taskType: text("task_type").notNull().default("PITCH_DECK"),
    estimatedCost: integer("estimated_cost").notNull(),
    status: taskStatus("status").notNull().default("CREATED"),
    result: jsonb("result"),
    failureReason: text("failure_reason"),
    ...timestamps,
  },
  (table) => [index("tasks_user_idx").on(table.userId)],
);

export const campaigns = pgTable("campaigns", {
  id: uuid("id").primaryKey(),
  onchainCampaignId: bigint("onchain_campaign_id", { mode: "bigint" }).unique(),
  creditReward: integer("credit_reward").notNull(),
  onchainRewardWei: bigint("onchain_reward_wei", { mode: "bigint" }).notNull(),
  requiredActiveSeconds: integer("required_active_seconds").notNull(),
  sponsorName: text("sponsor_name").notNull().default("Monad"),
  campaignLabel: text("campaign_label").notNull().default("ECOSYSTEM CAMPAIGN"),
  creativeTitle: text("creative_title").notNull(),
  creativeUrl: text("creative_url").notNull().default("/media/monad-parallel-execution.mp4"),
  creativeDescription: text("creative_description").notNull().default(""),
  destinationUrl: text("destination_url").notNull().default("https://docs.monad.xyz"),
  disclosure: text("disclosure").notNull().default("Independent educational creative. Settlement runs on Monad Testnet."),
  completionQuestion: text("completion_question").notNull(),
  completionAnswerHash: text("completion_answer_hash").notNull(),
  remainingBudget: integer("remaining_budget").notNull(),
  reservedBudget: integer("reserved_budget").notNull().default(0),
  active: boolean("active").notNull().default(true),
  ...timestamps,
});

export const questSessions = pgTable(
  "quest_sessions",
  {
    id: uuid("id").primaryKey(),
    campaignId: uuid("campaign_id").notNull().references(() => campaigns.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    taskId: uuid("task_id").notNull().references(() => tasks.id),
    nonce: text("nonce").notNull(),
    serverStartedAt: timestamp("server_started_at", { withTimezone: true }).notNull(),
    accumulatedActiveMs: bigint("accumulated_active_ms", { mode: "number" }).notNull().default(0),
    lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true }),
    lastHeartbeatSequence: integer("last_heartbeat_sequence").notNull().default(0),
    lastHeartbeatEligible: boolean("last_heartbeat_eligible").notNull().default(false),
    lastMediaTimeMs: bigint("last_media_time_ms", { mode: "number" }),
    lastAttentionReason: text("last_attention_reason").notNull().default("VIDEO_NOT_PLAYING"),
    state: questState("state").notNull().default("CREATED"),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    completionAnsweredAt: timestamp("completion_answered_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("quest_nonce_unique").on(table.nonce),
    uniqueIndex("quest_task_unique").on(table.taskId),
  ],
);

export const attentionEvents = pgTable(
  "attention_events",
  {
    id: uuid("id").primaryKey(),
    questSessionId: uuid("quest_session_id").notNull().references(() => questSessions.id),
    sequence: integer("sequence").notNull(),
    serverTimestamp: timestamp("server_timestamp", { withTimezone: true }).notNull(),
    mediaTimeMs: bigint("media_time_ms", { mode: "number" }).notNull(),
    durationMs: bigint("duration_ms", { mode: "number" }).notNull(),
    playbackRateMilli: integer("playback_rate_milli").notNull(),
    documentVisible: boolean("document_visible").notNull(),
    windowFocused: boolean("window_focused").notNull(),
    fullscreen: boolean("fullscreen").notNull(),
    pictureInPicture: boolean("picture_in_picture").notNull(),
    buffering: boolean("buffering").notNull(),
    mediaPlaying: boolean("media_playing").notNull(),
    eligible: boolean("eligible").notNull(),
    reason: text("reason").notNull(),
    creditedMs: bigint("credited_ms", { mode: "number" }).notNull(),
    eventHash: text("event_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("attention_event_session_sequence_unique").on(table.questSessionId, table.sequence),
    index("attention_event_session_idx").on(table.questSessionId),
  ],
);

export const settlements = pgTable(
  "settlements",
  {
    id: uuid("id").primaryKey(),
    questSessionId: uuid("quest_session_id").notNull().references(() => questSessions.id),
    sessionHash: text("session_hash").notNull(),
    receipt: jsonb("receipt").notNull(),
    signature: text("signature").notNull(),
    transactionHash: text("transaction_hash"),
    chainId: integer("chain_id").notNull(),
    status: settlementStatus("status").notNull().default("AUTHORIZED"),
    blockNumber: bigint("block_number", { mode: "bigint" }),
    authorizedAt: timestamp("authorized_at", { withTimezone: true }).notNull(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    failureReason: text("failure_reason"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("settlement_quest_unique").on(table.questSessionId),
    uniqueIndex("settlement_session_hash_unique").on(table.sessionHash),
    uniqueIndex("settlement_transaction_hash_unique").on(table.transactionHash),
  ],
);

export const campaignRewardClaims = pgTable(
  "campaign_reward_claims",
  {
    id: uuid("id").primaryKey(),
    campaignId: uuid("campaign_id").notNull().references(() => campaigns.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    questSessionId: uuid("quest_session_id").notNull().references(() => questSessions.id),
    settlementId: uuid("settlement_id").references(() => settlements.id),
    status: campaignRewardClaimStatus("status").notNull().default("RESERVED"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("campaign_reward_claim_campaign_user_unique").on(table.campaignId, table.userId),
    uniqueIndex("campaign_reward_claim_quest_unique").on(table.questSessionId),
    uniqueIndex("campaign_reward_claim_settlement_unique").on(table.settlementId),
  ],
);

export const settlementAttempts = pgTable(
  "settlement_attempts",
  {
    id: uuid("id").primaryKey(),
    settlementId: uuid("settlement_id").notNull().references(() => settlements.id),
    attemptNumber: integer("attempt_number").notNull(),
    transactionHash: text("transaction_hash"),
    status: relayAttemptStatus("status").notNull().default("SUBMITTING"),
    failureReason: text("failure_reason"),
    blockNumber: bigint("block_number", { mode: "bigint" }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("settlement_attempt_number_unique").on(table.settlementId, table.attemptNumber),
    uniqueIndex("settlement_attempt_transaction_hash_unique").on(table.transactionHash),
    index("settlement_attempt_settlement_idx").on(table.settlementId),
  ],
);

export const creditEntries = pgTable(
  "credit_entries",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id),
    amount: integer("amount").notNull(),
    type: creditEntryType("type").notNull(),
    referenceId: uuid("reference_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("credit_idempotency_unique").on(table.idempotencyKey),
    index("credit_user_idx").on(table.userId),
  ],
);

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey(),
    taskId: uuid("task_id").notNull().references(() => tasks.id),
    status: jobStatus("status").notNull().default("FUNDED"),
    provider: text("provider").notNull(),
    providerRequestId: text("provider_request_id"),
    attemptCount: integer("attempt_count").notNull().default(0),
    processingStartedAt: timestamp("processing_started_at", { withTimezone: true }),
    processingToken: text("processing_token"),
    structuredResult: jsonb("structured_result"),
    failureReason: text("failure_reason"),
    refundedAt: timestamp("refunded_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [uniqueIndex("job_task_unique").on(table.taskId)],
);

export const providerPricingSnapshots = pgTable("provider_pricing_snapshots", {
  id: text("id").primaryKey(),
  provider: text("provider").notNull(),
  requestedModel: text("requested_model").notNull(),
  serviceTier: text("service_tier").notNull(),
  currency: text("currency").notNull(),
  inputMicrosPerMillionTokens: bigint("input_micros_per_million_tokens", { mode: "bigint" }).notNull(),
  outputMicrosPerMillionTokens: bigint("output_micros_per_million_tokens", { mode: "bigint" }).notNull(),
  sourceUrl: text("source_url").notNull(),
  effectiveAt: timestamp("effective_at", { withTimezone: true }).notNull(),
  retrievedAt: timestamp("retrieved_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const providerAttempts = pgTable(
  "provider_attempts",
  {
    id: uuid("id").primaryKey(),
    jobId: uuid("job_id").notNull().references(() => jobs.id),
    attemptNumber: integer("attempt_number").notNull(),
    status: providerAttemptStatus("status").notNull().default("STARTED"),
    provider: text("provider").notNull(),
    requestedModel: text("requested_model").notNull(),
    responseModelVersion: text("response_model_version"),
    serviceTier: text("service_tier"),
    providerRequestId: text("provider_request_id"),
    promptTokenCount: integer("prompt_token_count"),
    cachedContentTokenCount: integer("cached_content_token_count"),
    candidatesTokenCount: integer("candidates_token_count"),
    toolUsePromptTokenCount: integer("tool_use_prompt_token_count"),
    thoughtsTokenCount: integer("thoughts_token_count"),
    totalTokenCount: integer("total_token_count"),
    pricingSnapshotId: text("pricing_snapshot_id").references(() => providerPricingSnapshots.id),
    pricingStatus: text("pricing_status"),
    pricingReason: text("pricing_reason"),
    publishedCostUsdMicros: bigint("published_cost_usd_micros", { mode: "bigint" }),
    actualBilledCostUsdMicros: bigint("actual_billed_cost_usd_micros", { mode: "bigint" }),
    canonical: boolean("canonical").notNull().default(false),
    failureReason: text("failure_reason"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("provider_attempt_job_number_unique").on(table.jobId, table.attemptNumber),
    uniqueIndex("provider_attempt_request_unique").on(table.providerRequestId),
    index("provider_attempt_job_idx").on(table.jobId),
  ],
);

export const sponsorInquiries = pgTable(
  "sponsor_inquiries",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id),
    clientRequestId: uuid("client_request_id").notNull(),
    companyName: text("company_name").notNull(),
    contactName: text("contact_name").notNull(),
    contactEmail: text("contact_email").notNull(),
    companyWebsite: text("company_website").notNull(),
    destinationUrl: text("destination_url").notNull(),
    creativeType: sponsorCreativeType("creative_type").notNull(),
    creativeUrl: text("creative_url").notNull(),
    campaignTitle: text("campaign_title").notNull(),
    description: text("description").notNull(),
    status: sponsorInquiryStatus("status").notNull().default("RECEIVED"),
    reviewNotes: text("review_notes"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("sponsor_inquiry_user_request_unique").on(table.userId, table.clientRequestId),
    index("sponsor_inquiry_status_created_idx").on(table.status, table.createdAt),
  ],
);
