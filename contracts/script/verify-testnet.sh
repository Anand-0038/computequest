#!/usr/bin/env bash
set -euo pipefail

: "${CAMPAIGN_ESCROW_ADDRESS:?CAMPAIGN_ESCROW_ADDRESS is required}"
: "${VERIFIER_ADDRESS:?VERIFIER_ADDRESS is required}"

if [[ ! "${VERIFIER_ADDRESS}" =~ ^0x[0-9a-fA-F]{40}$ ]]; then
  echo "VERIFIER_ADDRESS_INVALID" >&2
  exit 1
fi

constructor_args="$(cast abi-encode 'constructor(address)' "${VERIFIER_ADDRESS}")"

forge verify-contract \
  "${CAMPAIGN_ESCROW_ADDRESS}" \
  src/CampaignEscrow.sol:CampaignEscrow \
  --root contracts \
  --constructor-args "${constructor_args}" \
  --chain 10143 \
  --verifier sourcify \
  --verifier-url https://sourcify-api-monad.blockvision.org/ \
  --watch
