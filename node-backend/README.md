# Nevermined payment backend

Node.js 20+ / Express using @nevermined-io/payments 1.13.0.

## Configure and run

Run `npm install` and `npm start` inside node-backend. Set NVM_API_KEY,
NVM_AGENT_ID, NVM_PLAN_ID, and DATABASE_URL as appropriate for the seller.
Settlement requires ENABLE_SETTLEMENT=true, an initialized PostgreSQL ledger,
and ALLOW_X402_V2=true for reusable v2 tokens. No enablement flags are changed by
the purchase-id migration. Never commit secrets.

NVM_PAYMENT_NETWORK selects the configured rail (stripe, visa, braintree or a
crypto chain). Card rails now explicitly advertise nvm:card-delegation rather
than the SDK's crypto default. NVM_PAYMENT_SCHEME can override this.
GET /db-health checks the migrated ledger without charging.

## Repeated purchases and retries

POST /paid-image requires:
- payment-signature: the buyer's x402 token.
- Idempotency-Key: a UUID (16–128 letters, digits, underscores or hyphens).
  Create a NEW key only for an intentional NEW purchase; retain and reuse the
  SAME key, token, and endpoint for a network retry.

A valid v2 token can pay for multiple distinct orders, subject to the provider's
delegation budget, expiry and transaction limits. Each order is verified and
settled independently. A v3 token is single-use across orders: obtain a fresh
token for the next purchase. A successful retry returns the saved receipt and
image with Idempotency-Replayed: true, without calling settlement again.

The checkout page generates UUIDs, keeps the pending order ID in sessionStorage
across reloads, and retains a v2 token only in the page's password input for the
next purchase. It never stores that credential in sessionStorage. A v3 token is
cleared after success. On an uncertain payment, checkout retains the same ID.

Clients that previously sent only payment-signature must add Idempotency-Key.
There is deliberately no automatic key generation on the server: that would
turn network retries into additional purchases.

## Persistence and failure handling

Startup adds nullable request_id and credential_hash columns and a unique
request_id index to qc_payments using additive, idempotent DDL. Existing rows
and receipts are preserved. New v2 claims are keyed by purchase UUID and bound
to a credential hash. V3 claims retain the existing global token hash key.

A processing/uncertain claim never automatically expires or re-settles.
Reconcile such orders against Nevermined/provider transactions before manual
recovery; do not delete claims or generate new order IDs as a retry mechanism.
A confirmed charge whose receipt cannot be saved remains blocked for manual
reconciliation. Logs include only order ID, phase and an allowlisted error code,
never bearer credentials or raw provider messages.

## Validation

Run `node --test payment-handler.test.mjs`. Tests exercise the handler,
production ledger code through an in-memory SQL adapter, and checkout script.
They cover repeated purchases, duplicate/concurrent requests, receipt recovery,
single-use v3 tokens, changed credentials, ambiguous provider/database errors,
configuration safeguards, and order persistence across reloads. They make no
live payment requests. PostgreSQL connectivity and the migration must also be
checked on the deployed service.

Protocol reference: https://github.com/nevermined-io/payments/blob/v1.13.0/markdown/x402.md

