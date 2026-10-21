import { Payments, detectAccessTokenVersion } from "@nevermined-io/payments";

// Buyer-side verification smoke test. Does not settle or charge.
const required = ["BUYER_NVM_API_KEY", "BUYER_DELEGATION_ID", "NVM_AGENT_ID", "NVM_PLAN_ID"];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) {
  console.error("Missing environment variables:", missing.join(", "));
  process.exitCode = 1;
} else {
  const payments = Payments.getInstance({
    nvmApiKey: process.env.BUYER_NVM_API_KEY
  });
  const { accessToken, tokenVersion } = await payments.x402.getX402AccessToken(
    process.env.NVM_PLAN_ID,
    process.env.NVM_AGENT_ID,
    {
      scheme: "nvm:card-delegation",
      network: "visa",
      delegationConfig: { delegationId: process.env.BUYER_DELEGATION_ID },
      resource: { url: "/paid-image" },
      httpVerb: "POST",
      tokenVersion: 3
    }
  );
  const detected = accessToken ? detectAccessTokenVersion(accessToken) : null;
  console.log("Requested token v3; SDK returned version:", tokenVersion ?? "missing", "; detected:", detected ?? "unknown");
  if (detected !== 3) {
    console.log("Nevermined Live returned v2. No payment submitted. V2 settlement is not enabled in QC Agent.");
    process.exit(0);
  }
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
