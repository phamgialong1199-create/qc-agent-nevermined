# Node.js Nevermined payment backend

This is a separate Node.js/Express server, not a Cloudflare Worker. It uses the official `@nevermined-io/payments` SDK and its documented `buildPaymentRequired(planId, options)`, `verifyPermissions`, and `settlePermissions` calls.

## Status

**Not production ready.** `ENABLE_SETTLEMENT=false` and `DURABLE_LEDGER_READY=false` by default. There is deliberately no way to charge until a persistent, atomic nonce ledger and reconciliation are implemented and verified. Do not set `DURABLE_LEDGER_READY=true` merely to bypass this safeguard.

## Run

1. On a Node.js 20+ host, run `npm install` inside `node-backend`.
2. Configure `NVM_API_KEY` as a secret, and `NVM_AGENT_ID` and `NVM_PLAN_ID` as environment variables.
3. Run `npm start`. Test `GET /health` and `GET /preview-image`.
4. Use a **separate buyer API key** and an existing card delegation to mint a single-use v3 `payment-signature` via `payments.x402.getX402AccessToken(planId, agentId, {delegationConfig:{delegationId},resource:{url:'/paid-image'},httpVerb:'POST',tokenVersion:3})`. Confirm returned `tokenVersion===3`.
5. Before any Live charge, implement and verify atomic nonce tracking, settlement receipt persistence, and recovery after ambiguous failures. Only then enable settlement.

The seller's Nevermined API key must not be used as the buyer's token. Do not share payment tokens in logs or chat. Do not use self-payments to test Stripe payout without provider approval.

The Cloudflare Worker remains a separate demo and is not wired to this backend yet.
