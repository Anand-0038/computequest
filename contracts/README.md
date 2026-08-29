# ComputeQuest escrow deployment

This directory contains the production submission contract and its Monad Testnet deployment scripts. Local build and tests are safe; deployment, verification submission, and funding are explicit live actions.

## Boundaries

- `forge test --root contracts` uses only the local EVM test runner.
- `pnpm contracts:preflight:testnet` performs read-only RPC balance and chain checks. It prints addresses and balances, never private keys.
- `pnpm contracts:deploy:testnet` broadcasts a deployment and funded campaign transaction.
- `pnpm contracts:preflight:deployed` performs read-only checks against the deployed escrow and campaign.
- `pnpm contracts:verify:testnet` submits source metadata to the MonadVision Sourcify service.

Do not run the mutating or submission commands until the owner approves the exact accounts, funding amount, and target network.

## Required accounts

Use three roles where practical:

- sponsor: deploys the escrow, owns the campaign, and supplies its native-token budget;
- verifier: signs time-bounded EIP-712 completion receipts from the server;
- relayer: broadcasts settlements and receives the campaign payout used to fund the service.

Shared addresses are reported as a warning because they weaken key separation. Private keys must be supplied only through the process environment or a non-committed shell session.

## 1. Local contract gate

```bash
corepack pnpm contracts:test
forge fmt --check --root contracts
```

## 2. Prepare the deployment environment

Copy the variable names from `.env.contracts.example` into a private shell environment. Never commit the populated file.

The campaign budget is calculated exactly as:

```text
DEMO_ONCHAIN_REWARD_WEI × DEMO_MAX_COMPLETIONS
```

The sponsor preflight requires that budget plus `SPONSOR_DEPLOYMENT_GAS_RESERVE_WEI`. The current `0.2 MON` deployment reserve is deliberately conservative because Monad charges against submitted gas limits. The relayer must meet `RELAYER_MIN_BALANCE_WEI`; the current `0.5 MON` floor covers approximately twenty 220,934-gas settlements at the observed 102 MON-gwei Testnet gas price. Both values remain operator thresholds, not gas-price guarantees, and the live preflight rechecks balances immediately before broadcast.

## 3. Read-only preflight

```bash
corepack pnpm contracts:preflight:testnet
```

This fails unless:

- Foundry is 1.8 or newer;
- RPC chain ID matches `MONAD_CHAIN_ID`/10143;
- sponsor balance covers campaign budget plus the configured deployment reserve;
- relayer balance meets its configured minimum;
- all key strings and economic inputs validate.

The JSON output is safe to review because it contains only derived public addresses, balances, requirements, warnings, and issue codes.

## 4. Owner-approved broadcast

```bash
corepack pnpm contracts:deploy:testnet
```

Record the broadcast transaction hash, deployed `CAMPAIGN_ESCROW_ADDRESS`, and `DEMO_ONCHAIN_CAMPAIGN_ID`. Do not infer success from console output alone; wait for a successful receipt.

## 5. Observed deployment gate

Export the deployed address and campaign ID together with the verifier/relayer settings, then run:

```bash
corepack pnpm contracts:preflight:deployed
```

This must report `ready: true`. It verifies chain ID, bytecode, verifier, campaign activity, reward, capacity, budget, payout recipient, and relayer funding using public reads. It never creates a signed dummy settlement.

## 6. Source verification

```bash
corepack pnpm contracts:verify:testnet
```

After submission, confirm published source on the explorer. A successful CLI request is not enough by itself.

Set `VERIFIER_ADDRESS` from the public address emitted by the deployment preflight. Source verification deliberately does not accept the verifier private key on a command line.

## 7. Render handoff

Only after the observed deployment gate passes, copy these values to Render:

- `MONAD_RPC_URL`
- `MONAD_CHAIN_ID`
- `MONAD_EXPLORER_BASE_URL`
- `CAMPAIGN_ESCROW_ADDRESS`
- `VERIFIER_PRIVATE_KEY`
- `RELAYER_PRIVATE_KEY`
- `RELAYER_MIN_BALANCE_WEI`
- `DEMO_ONCHAIN_CAMPAIGN_ID`
- `DEMO_ONCHAIN_REWARD_WEI`

Render must also receive the database, session, Gemini, campaign UUID, quest timing, and completion-answer values documented in the root `.env.example`. Verify `/api/health` after deployment; it must return HTTP 200 with `status: ready` before the demo flow is accepted.
