import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";

import { getCachedMonadPreflight } from "@/server/chain/monad";
import { getDatabase } from "@/server/db/client";
import { inspectRuntimeEnv } from "@/server/env";

export const dynamic = "force-dynamic";

export async function GET() {
  const runtime = inspectRuntimeEnv();

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
        monad: null,
        proofBoundary: "Configuration presence is not database, provider, Testnet, deployment, or funding proof.",
      },
      { status: 503 },
    );
  }

  const [databaseCheck, monadCheck] = await Promise.allSettled([
    getDatabase().execute(sql`select 1 as ready`),
    getCachedMonadPreflight(),
  ]);
  const databaseReady = databaseCheck.status === "fulfilled";
  const monad = monadCheck.status === "fulfilled" ? monadCheck.value : null;
  const ready = databaseReady && Boolean(monad?.ready);

  return NextResponse.json(
    {
      status: ready ? "ready" : "preflight_failed",
      services: {
        database: databaseReady ? "observed_ready" : "unreachable",
        sessionSecurity: "configured_unverified",
        gemini: "configured_unverified",
        monadRpc: monad ? "observed_ready" : "unreachable",
        escrow: monad?.bytecodePresent ? "observed_deployed" : "preflight_failed",
        verifier: monad?.verifierMatches ? "observed_match" : "preflight_failed",
        relayer: monad?.relayerBalanceSufficient ? "observed_funded" : "preflight_failed",
      },
      missing: [],
      monad,
      issues: [
        ...(databaseReady ? [] : ["DATABASE_UNREACHABLE"]),
        ...(monad ? monad.issues : ["MONAD_PREFLIGHT_UNREACHABLE"]),
      ],
      proofBoundary:
        "Ready proves a live database query and read-only Monad escrow preflight. Gemini remains configuration-only until a generation request succeeds.",
    },
    { status: ready ? 200 : 503 },
  );
}
