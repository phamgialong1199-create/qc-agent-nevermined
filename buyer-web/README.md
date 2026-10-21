# QC Agent buyer portal (separate Vite application)

This is a standalone browser integration prototype. It is NOT deployed to the payment backend, and it does not collect buyer API keys.

## Run
```
cd buyer-web
npm install
npm run build
npm run dev
```

The Nevermined browser connection uses `Payments.getBrowserInstance()` and `connect()`. The official browser SDK docs do not establish that a browser login session can mint Visa card-delegation x402 v2 tokens. Token generation and checkout remain intentionally disabled until that is verified. Never ask customers to enter their secret Nevermined API keys into this page.

Deploy this as a separate static site only after browser build and authentication are verified. The existing Render payment backend is unchanged.
