# QC Agent — Nevermined / Cloudflare Worker

Safe demonstration of an image-delivery API intended for future Nevermined x402 payment integration.

## Endpoints
- `GET /health`: deployment and configuration presence (never reveals secret values).
- `GET /preview-image`: publicly accessible demonstration SVG.
- `GET /paid-image`: HTTP 402 placeholder; **does not charge money and never delivers paid content**.

## Deploy
Install Node.js, then run `npm install` and `npm run deploy` after configuring your own Cloudflare account and Worker name. Alternatively paste `src/index.js` into the existing Cloudflare Worker editor.

## Environment
Configure these in Cloudflare Workers Settings → Variables and Secrets:
- `NVM_API_KEY` — **Secret**, never commit.
- `NVM_AGENT_ID` — variable.
- `NVM_PLAN_ID` — variable.

## Security and status
No real payment integration exists in this version. Nevermined card delegation requires a buyer payment signature, permission verification and settlement, plus idempotency handling. Do not enable Live charging until tested. Never store card numbers, Nevermined API keys or OpenAI keys in GitHub.
