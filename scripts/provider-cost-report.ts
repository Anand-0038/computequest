import { eq } from "drizzle-orm";

import { closeDatabase, getDatabase } from "@/server/db/client";
import { creditEntries, providerAttempts } from "@/server/db/schema";

async function main() {
  const db = getDatabase();
  const [attempts, refunds] = await Promise.all([
    db.select().from(providerAttempts),
    db.select().from(creditEntries).where(eq(creditEntries.type, "JOB_REFUND")),
  ]);

  const report = {
    boundary: {
      publishedCost: "Versioned published paid-standard replacement cost; not proof of actual billing.",
      actualBilledCost: "Nullable until reconciled against Google billing records.",
      creditUnits: "Internal CE entitlement; no USD or MON conversion is applied.",
    },
    attempts: {
      total: attempts.length,
      started: attempts.filter((attempt) => attempt.status === "STARTED").length,
      succeeded: attempts.filter((attempt) => attempt.status === "SUCCEEDED").length,
      failed: attempts.filter((attempt) => attempt.status === "FAILED").length,
      canonical: attempts.filter((attempt) => attempt.canonical).length,
      priced: attempts.filter((attempt) => attempt.pricingStatus === "PRICED").length,
      unpriced: attempts.filter((attempt) => attempt.pricingStatus === "UNPRICED").length,
    },
    usage: {
      promptTokens: sumNumber(attempts.map((attempt) => attempt.promptTokenCount)),
      candidateTokens: sumNumber(attempts.map((attempt) => attempt.candidatesTokenCount)),
      thinkingTokens: sumNumber(attempts.map((attempt) => attempt.thoughtsTokenCount)),
    },
    usdMicros: {
      publishedReplacementCost: sumBigInt(attempts.map((attempt) => attempt.publishedCostUsdMicros)).toString(),
      actualBilledKnown: sumBigInt(attempts.map((attempt) => attempt.actualBilledCostUsdMicros)).toString(),
      actualBilledUnknownAttempts: attempts.filter((attempt) => attempt.actualBilledCostUsdMicros === null).length,
    },
    refunds: {
      count: refunds.length,
      creditUnits: refunds.reduce((total, refund) => total + refund.amount, 0),
    },
  };

  console.log(JSON.stringify(report, null, 2));
}

function sumNumber(values: Array<number | null>) {
  return values.reduce<number>((total, value) => total + (value ?? 0), 0);
}

function sumBigInt(values: Array<bigint | null>) {
  return values.reduce<bigint>((total, value) => total + (value ?? BigInt(0)), BigInt(0));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "PROVIDER_COST_REPORT_FAILED");
    process.exitCode = 1;
  })
  .finally(closeDatabase);
