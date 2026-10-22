# Digital Key Store — Cloudflare Workers + D1

Customer-facing storefront is English-only and requires no account. Admin endpoints require a secret `ADMIN_TOKEN` stored in Cloudflare Worker Secrets, never in GitHub. Payment is disabled by default.

## Setup
1. Connect this repository branch to Cloudflare Workers Git integration. Root directory: `key-store`.
2. Create a D1 database named `qc-key-store` in Cloudflare.
3. Replace `database_id` in wrangler.toml with the real D1 database UUID.
4. Run `npm install`, then `npx wrangler d1 execute qc-key-store --remote --file=schema.sql` with your authorized Cloudflare account.
5. Set Worker secret `ADMIN_TOKEN` to a long random value (minimum 32 characters).
6. Deploy and open `/admin` to upload your private TXT inventory (one key per line). **Never commit TXT files or secret keys to GitHub.**
7. Leave `PAYMENTS_ENABLED=false` until a verified Nevermined payment flow is integrated. There is intentionally no public "mark paid" endpoint and no fake payment bypass.

## Current implementation
- `GET /`: responsive storefront, price/stock, quantity selector.
- `POST /api/orders`: creates a pending order, **does not charge**.
- `GET /api/orders/:id`: shows status only, no keys.
- `GET /admin`: admin upload UI.
- `POST /api/admin/import`: authenticated TXT import (up to 10,000 keys/request, deduped).
- `GET /api/admin/stats`: authenticated stock stats.
- `GET /api/health`: service health.

## Payment integration requirement
A future server-side Nevermined adapter must verify payment, amount, plan and order binding, then atomically mark the order paid and reserve exactly `quantity` distinct keys in D1. A client-supplied payment success flag is NEVER proof. Repeated settlement notifications must be idempotent; no second key allocation for an already-delivered order. Delivery should use an unguessable receipt/session bound to the purchaser, not expose key material in public order lookup. The existing x402 reusable-token experiment has not passed repeated Live settlement tests, so it is not enabled here.

Uploaded 100-item TXT should remain private and be imported only after Cloudflare access is configured. If these strings are hashes rather than usable activation keys, verify they are redeemable before selling.
