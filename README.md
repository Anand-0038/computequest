# ComputeQuest

ComputeQuest turns verified sponsor attention into compute credits for useful AI work. A user submits a pitch-deck brief; when their ledger balance is insufficient, they complete a server-timed sponsor quest, settle its signed reward on Monad Testnet, and spend the confirmed credits on a schema-validated Gemini generation job.

Status: public hackathon deployment. The escrow and funded campaign are deployed and source-verified on Monad Testnet. A complete local production golden path passed with real Chromium, PostgreSQL, server-timed attention, a confirmed Testnet settlement, and completed Gemini structured output. The Render deployment is live and its public health check observes the hosted database and read-only Monad escrow preflight.

## Architecture

```text
Next.js UI and route handlers
  ├── PostgreSQL / Drizzle: tasks, quest sessions, reward claims, append-only evidence and credit ledger
  ├── Gemini HTTPS API: schema-constrained pitch-deck generation
  └── viem: EIP-712 authorization and Monad Testnet settlement
                       │
                       ▼
              CampaignEscrow.sol
        budget custody + replay protection
```

There is no mock settlement, local-chain success mode, fixture AI output, or hardcoded live data. Missing infrastructure fails visibly.

Completed presentations are rendered as slide previews and can be downloaded as the exact generated structured JSON. ComputeQuest does not claim PPTX or PDF export.

## Current evidence

- Application: lint, TypeScript, 70 default Vitest tests, 15 real PostgreSQL integration tests, and production build pass.
- Contract: 5 Foundry tests cover valid settlement, replay rejection, wrong verifier, expiry, pause, withdrawal, and a viem/Solidity EIP-712 golden vector.
- Browser media: the controlled edge-state gate covers play, pause, buffering, ended, focus, and visibility boundaries. Separately, the unmocked production golden path earned 32,995 ms through the real heartbeat API in Chromium.
- Gemini: the configured `gemini-3.5-flash-lite` provider completed the golden-path pitch deck and persisted a completed job.
- Contract: [`0xe9c37c275C78Bb9259F25e7C47471E54808dC94b`](https://testnet.monadvision.com/address/0xe9c37c275C78Bb9259F25e7C47471E54808dC94b), campaign `1`, deployed and funded with `0.02` Testnet MON. Deployment transaction: [`0x8e4861…d8b67`](https://testnet.monadvision.com/tx/0x8e486125909d392c9a894d7199acb0283160dae32f67ca9b27154a9c5bbd8b67); campaign creation: [`0x4f8120…30726`](https://testnet.monadvision.com/tx/0x4f81205b061cd8386dbca5f2c083ac3f9613ee4a295013324633f93b07830726). Both receipts succeeded, runtime bytecode and campaign state were read back, and Sourcify reports a runtime source match.
- Live settlement proof: [`0x01a795…e48d70`](https://testnet.monadvision.com/tx/0x01a79519e53c58fb849f6179cd212aba8833269b8d630b0e25df75b6abe48d70), receipt status `0x1`, completion count `1`, campaign budget remaining `0.019` Testnet MON.
- Live URL: [https://computequest.onrender.com](https://computequest.onrender.com)

## Setup

Requirements: Node.js 20+, Corepack/pnpm, Foundry 1.8+ for Monad deployment/verification, and PostgreSQL. The current development machine has Foundry 1.8.1, and the contract builds and simulates successfully against Monad Testnet.

```bash
corepack pnpm install
cp .env.example .env.local
corepack pnpm db:migrate
corepack pnpm db:seed
corepack pnpm verify
corepack pnpm dev
```

### Real PostgreSQL integration gate

The ledger and heartbeat services have an opt-in integration suite that runs against PostgreSQL, not an in-memory adapter. Point it at an isolated migrated database:

```bash
DATABASE_URL=postgresql://... corepack pnpm db:migrate
INTEGRATION_DATABASE_URL=postgresql://... corepack pnpm test:integration:postgres
```

The suite truncates its target tables, so never point `INTEGRATION_DATABASE_URL` at a shared, staging, or production database.

The integration gate includes real concurrent transactions. A per-user PostgreSQL row lock serializes every balance decision against task spending, settlement crediting, provider refunds, and refunded-job retries. Tests prove two simultaneous 24 CE tasks fund exactly one job, and that a confirmed settlement racing a new task cannot produce a negative balance.

### Cost and credit accounting

ComputeQuest keeps three units separate:

- CE is an internal, non-transferable product entitlement.
- Monad settlement rewards are recorded in wei.
- Gemini provider cost is recorded in USD micros from a versioned pricing snapshot.

There is no CE-to-MON or MON-to-USD conversion. Each Gemini attempt stores the requested model, returned model version, service tier, token counts, response ID, and a published paid-standard replacement cost when the response can be priced safely. That number is not proof of the amount Google billed; actual billed cost stays null until it is reconciled against Google billing records. Cached, tool-assisted, or unsupported service-tier calls remain explicitly unpriced instead of using the wrong rate.

Provider jobs allow at most three total attempts, including stale-lease recovery. Every failed attempt has its own idempotent CE refund, so retrying cannot silently lose credits or create an unlimited provider-cost loop. If the process loses the final provider result, the expired lease becomes a terminal failed job, the CE spend is refunded, and the UI tells the user to start a new task instead of making an unbounded fourth call. Operators can inspect aggregate usage without exposing prompts:

```bash
DATABASE_URL=postgresql://... corepack pnpm operator:provider-cost-report
```

### Controlled browser media gate

`scripts/test-sponsor-video-browser.py` drives the real UI and shipped MP4 in Chromium. It requires Python Playwright 1.55+, Google Chrome, and Xvfb on a headless Linux machine:

```bash
xvfb-run -a python scripts/test-sponsor-video-browser.py
```

The script controls API responses to reach the quest without misrepresenting local infrastructure as live. Playback, pause, and end are real media-element events; visibility/focus changes are injected browser state and are labeled in the output.

`scripts/test-runtime-readiness-browser.py` makes no API substitutions. Against an intentionally unconfigured local server it verifies the real HTTP 503 readiness boundary, disabled build action, health recheck, deferred session creation, and a 390 px layout without horizontal overflow:

```bash
python scripts/test-runtime-readiness-browser.py
```

Provide every variable in `.env.example`. `CAMPAIGN_ESCROW_DEPLOYMENT_BLOCK` is the public block number from the escrow deployment receipt and bounds paginated event recovery; update it whenever a new escrow is deployed. `GEMINI_API_KEY`, signing keys, and database credentials are server-only and must never use a `NEXT_PUBLIC_` prefix.

The deployment script at `contracts/script/DeployComputeQuest.s.sol` deploys the escrow and creates a funded Testnet campaign in one broadcast. It requires the values documented in `contracts/.env.contracts.example`; do not commit populated key files. Run `corepack pnpm contracts:preflight:testnet` first to verify Foundry, chain ID, derived public roles, campaign funding, and relayer funding without printing keys. Any later redeployment is intentionally manual because it spends faucet-backed Testnet MON and produces a new address and campaign identity.

After deployment, `corepack pnpm contracts:preflight:deployed` must observe the exact escrow and campaign state before Render handoff. `corepack pnpm contracts:verify:testnet` submits the compiler configuration and constructor address to MonadVision's Sourcify endpoint using the public `VERIFIER_ADDRESS`, never a private key CLI argument, and waits for the verification result. Both commands passed against the deployment above.

## Main routes

- `GET /api/health` — configuration, live database query, observed Monad deployment/campaign preflight, and exact proof boundary.
- `POST /api/session` — create or restore a signed HttpOnly anonymous session with an idempotent 4 CE initial grant and return its current ledger balance.
- `POST /api/tasks` — create a fixed-cost pitch-deck task.
- `GET /api/tasks/:taskId` — read persisted task state.
- `POST /api/tasks/:taskId/run` — atomically claim a funded job and call Gemini.
- `POST /api/jobs/:jobId/retry` — re-fund and retry a previously refunded provider job, up to the three-attempt cap, without losing ledger history.
- `POST /api/quests` — create a quest session.
- `POST /api/quests/:sessionId/heartbeat` — accumulate server-authorized active time.
- `POST /api/quests/:sessionId/authorize` — verify duration and completion answer, then sign the EIP-712 receipt.
- `POST /api/quests/:sessionId/settle` — relay, confirm, atomically convert the settlement into credits, and automatically claim the funded Gemini job. Provider failure is returned separately from the already-confirmed settlement and refunds the job spend.

Credits are not granted merely because a transaction is mined. CE budget is reserved atomically before the verifier signs a receipt. The chain adapter then waits until Monad's `finalized` block reaches the settlement block, rechecks the consumed session hash, and converts the reservation into a grant. This prevents an onchain payout from succeeding after the offchain CE budget has already been promised elsewhere.

Settlement submission simulates the call, estimates its Monad gas requirement, applies a ceiling-rounded 10% buffer, rejects estimates that would exceed Monad's 30M transaction limit, and supplies that gas limit explicitly. This matters because Monad charges against the submitted gas limit rather than only the gas ultimately consumed.

Quest attempts expire after 15 minutes. Expiry is persisted server-side, stops heartbeat traffic, and lets the same task restart with a fresh nonce and zero accumulated time; an expired nonce can never be revived.

The Watch Sponsor Quest uses a captioned 40-second Monad promotional video at `public/media/monad-parallel-execution.mp4`, generated reproducibly from the Remotion composition in `video/` by `corepack pnpm media:generate:sponsor`. It uses Monad's official palette and logo geometry, current documentation-backed claims, burned-in Caption JSON, and a subtle generated stereo sound bed. The campaign still requires 30 seconds of verified attention, leaving enough heartbeat margin before the creative ends. Attention mode requires fullscreen and reports video time, duration, playback speed, visibility, focus, buffering, seeking, and Picture-in-Picture state. The server compares video-time movement with its own heartbeat interval before crediting time; a forward seek, rate change, oversized gap, hidden document, lost focus, fullscreen exit, buffering event, or stopped video earns zero for that interval.

The Monad creative is an independent hackathon sample campaign, not an official paid Monad advertisement. Each persisted user can receive at most one successful reward from a campaign. `campaign_reward_claims` separates that invariant from restartable quest attempts: the original verified quest can retry a failed settlement, while a different task cannot claim the same campaign reward.

The current identity is a signed anonymous browser session. Clearing that identity is outside the protection offered by the one-user database constraint, so this build is suitable for a capped Testnet demonstration, not an open cash-backed campaign. A real-money pilot requires durable identity or a closed allowlist before sponsor funds are exposed.

Every accepted heartbeat also writes an append-only `attention_events` record with its server timestamp, proof signals, credited milliseconds, eligibility reason, and SHA-256 event hash. This is auditable server-side evidence, not a claim that a browser can lock the rest of the operating system.

Signed completion receipts have a separate 10-minute onchain lifetime. If an unsubmitted receipt expires, the backend persists a settlement failure without broadcasting it and requires the completion answer again before replacing the signature. A receipt with a submitted or confirmed transaction is never reset by this recovery path.

Every relay claim creates an append-only settlement-attempt record. Reverted and submission-failed attempts retain their transaction hash or failure reason, while the settlement aggregate can safely move to a later attempt. Relayer writes are serialized within one application instance. If the process stops after broadcasting but before saving the hash, the backend recovers it from the indexed `CompletionSettled` event before continuing finalization. `GET /api/tasks/:taskId` returns the sanitized ordered attempt history with JSON-safe block numbers for reload recovery and demo evidence.

The six-stage interface is derived from persisted task, quest, settlement, and job states: Brief → Fund → Attention → Monad settlement → AI working → Result. Completion stops tracking, exits fullscreen, refreshes the persisted task snapshot, removes the finished quest, and reveals the generated result without requiring a manual Escape key or page reload.

The Compute Cell reads the same persisted ledger state instead of animating a decorative balance: it shows the 4 CE starter grant, the 20 CE task gap, the post-spend AI-working state, completion, or a provider refund. If the initial anonymous-session handshake fails transiently, the interface remains disabled and exposes an explicit retry instead of silently creating work without an authenticated ledger owner.

`GET /api/health` returns `ready` only after a live PostgreSQL query and a read-only Monad preflight observe the expected chain ID, deployed escrow bytecode, verifier, active campaign, configured reward, remaining capacity and budget, relayer payout recipient, and a relayer balance above `RELAYER_MIN_BALANCE_WEI`. The preflight never sends a valid signed receipt to an RPC. Quest creation, authorization, and settlement enforce the same cached preflight before mutating state. Gemini remains `configured_unverified` until a real generation succeeds.

`render.yaml` prepares one free Node web service and one free PostgreSQL database in Singapore. Because Render's pre-deploy command is a paid-service feature, the free service runs idempotent migrations and campaign seeding during its build phase, then starts Next.js directly within the free runtime memory limit. Render currently expires free PostgreSQL instances after 30 days; the Blueprint is appropriate for the hackathon, not durable production storage.
