import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";

import { getCachedMonadPreflight } from "@/server/chain/monad";
import { getDatabase } from "@/server/db/client";
import { inspectRuntimeEnv, requireRuntimeEnv } from "@/server/env";

export const dynamic = "force-dynamic";

export async function GET() {
  const runtime = inspectRuntimeEnv();
  const buildRevision = process.env.RENDER_GIT_COMMIT ?? process.env.GIT_COMMIT_SHA ?? null;

  if (!runtime.configured) {
    return NextResponse.json(
      {
        status: "configuration_required",
        services: {
          database: runtime.missing.includes("DATABASE_URL") ? "missing" : "configured_unverified",
          sessionSecurity: runtime.missing.includes("SESSION_SIGNING_SECRET") ? "missing" : "configured_unverified",
          gemini: runtime.missing.includes("GEMINI_API_KEY") ? "missing" : "configured_unverified",
          monadRpc: runtime.missing.includes("MONAD_RPC_URL") ? "missing" : "configured_unverified",
          escrow: runtime.missing.includes("CAMPAIGN_ESCROW_ADDRESS") ? "missing" : "configured_unverified",
          verifier: runtime.missing.includes("VERIFIER_PRIVATE_KEY") ? "missing" : "configured_unverified",
          relayer: runtime.missing.includes("RELAYER_PRIVATE_KEY") ? "missing" : "configured_unverified",
        },
        missing: runtime.missing,
        buildRevision,
        campaign: null,
        monad: null,
        proofBoundary: "Configuration presence is not database, provider, Testnet, deployment, or funding proof.",
      },
      { status: 503 },
    );
  }

  const env = requireRuntimeEnv();
  const [databaseCheck, monadCheck] = await Promise.allSettled([
    getDatabase().execute(sql`
      select required_active_seconds as "requiredActiveSeconds"
      from campaigns
      where id = ${env.DEMO_CAMPAIGN_ID} and active = true
      limit 1
    `),
    getCachedMonadPreflight(),
  ]);
  const databaseReachable = databaseCheck.status === "fulfilled";
  const campaignRow = databaseReachable
    ? (databaseCheck.value[0] as { requiredActiveSeconds: number } | undefined)
    : undefined;
  const campaignReady = Boolean(campaignRow);
  const durationMatchesConfig = campaignRow?.requiredActiveSeconds === env.DEMO_QUEST_SECONDS;
  const monad = monadCheck.status === "fulfilled" ? monadCheck.value : null;
  const ready = databaseReachable && campaignReady && durationMatchesConfig && Boolean(monad?.ready);

  return NextResponse.json(
    {
      status: ready ? "ready" : "preflight_failed",
      services: {
        database: databaseReachable ? "observed_ready" : "unreachable",
        campaign: campaignReady && durationMatchesConfig ? "observed_match" : "preflight_failed",
        sessionSecurity: "configured_unverified",
        gemini: "configured_unverified",
        monadRpc: monad ? "observed_ready" : "unreachable",
        escrow: monad?.bytecodePresent ? "observed_deployed" : "preflight_failed",
        verifier: monad?.verifierMatches ? "observed_match" : "preflight_failed",
        relayer: monad?.relayerBalanceSufficient ? "observed_funded" : "preflight_failed",
      },
      missing: [],
      buildRevision,
      campaign: campaignRow
        ? {
            databaseId: env.DEMO_CAMPAIGN_ID,
            onchainCampaignId: env.DEMO_ONCHAIN_CAMPAIGN_ID.toString(),
            requiredActiveSeconds: campaignRow.requiredActiveSeconds,
            configuredActiveSeconds: env.DEMO_QUEST_SECONDS,
            durationMatchesConfig,
          }
        : null,
      monad,
      issues: [
        ...(databaseReachable ? [] : ["DATABASE_UNREACHABLE"]),
        ...(databaseReachable && !campaignReady ? ["ACTIVE_CAMPAIGN_NOT_FOUND"] : []),
        ...(campaignReady && !durationMatchesConfig ? ["CAMPAIGN_DURATION_CONFIG_DRIFT"] : []),
        ...(monad ? monad.issues : ["MONAD_PREFLIGHT_UNREACHABLE"]),
      ],
      proofBoundary:
        "Ready proves the active database campaign and duration match runtime configuration plus a read-only Monad escrow preflight. Gemini remains configuration-only until a generation request succeeds.",
    },
    { status: ready ? 200 : 503 },
  );
}
