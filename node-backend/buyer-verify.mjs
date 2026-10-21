import { Payments } from "@nevermined-io/payments";

// Buyer-side verification smoke test. Does not settle or charge.
const required = ["BUYER_NVM_API_KEY", "BUYER_DELEGATION_ID", "NVM_AGENT_ID", "NVM_PLAN_ID"];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) {
  console.error("Missing environment variables:", missing.join(", "));
  process.exitCode = 1;
} else {
  const payments = Payments.getInstance({
    nvmApiKey: process.env.BUYER_NVM_API_KEY,
    environment: "live"
  });
  const { accessToken, tokenVersion } = await payments.x402.getX402AccessToken(
    process.env.NVM_PLAN_ID,
    process.env.NVM_AGENT_ID,
    {
      scheme: "nvm:card-delegation",
      delegationConfig: { delegationId: process.env.BUYER_DELEGATION_ID },
      resource: { url: "/paid-image" },
      httpVerb: "POST",
      tokenVersion: 3
    }
  );
  if (tokenVersion !== 3) throw new Error("Expected a single-use v3 token");
  const endpoint = process.env.BACKEND_URL;
  if (!endpoint) {
    console.log("Token generated. Set BACKEND_URL to test verification. Token not printed.");
  } else {
    const response = await fetch(new URL("/verify-token", endpoint), {
      method: "POST",
      headers: { "payment-signature": accessToken }
    });
    const data = await response.json();
    console.log(JSON.stringify({
      httpStatus: response.status,
      verified: data.verified === true,
      settled: data.settled === true,
      imageDelivered: data.imageDelivered === true,
      error: data.error ?? null
    }));
  }
}
