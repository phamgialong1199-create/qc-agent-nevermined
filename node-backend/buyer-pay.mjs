import { randomUUID } from "node:crypto";
import { Payments } from "@nevermined-io/payments";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { writeFile } from "node:fs/promises";

const base = process.env.QC_AGENT_URL || "https://qc-agent-nevermined.onrender.com";
const io = createInterface({ input: stdin, output: stdout });
const ask = async (label, env) => process.env[env] || (await io.question(label)).trim();
try {
  const buyerKey = await ask("Buyer Nevermined API key: ", "BUYER_NVM_API_KEY");
  const delegationId = await ask("Active card delegation ID: ", "BUYER_DELEGATION_ID");
  const response = await fetch(new URL("/paid-image", base), { method: "POST" });
  if (response.status !== 402) throw Error("Seller did not return an x402 payment challenge");
  const encoded = response.headers.get("payment-required");
  if (!encoded) throw Error("Missing payment-required header");
  const challenge = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  const resource = challenge.resource;
  const accept = challenge.accepts?.find(a => a.scheme === "nvm:card-delegation");
  if (!resource?.url || !accept) throw Error("No card-delegation payment option");
  const planId = process.env.NVM_PLAN_ID || accept.planId || challenge.extensions?.["nvm:payment"]?.planId;
  const agentId = process.env.NVM_AGENT_ID || accept.agentId || challenge.extensions?.["nvm:payment"]?.agentId;
  if (!planId || !agentId) throw Error("Plan/Agent IDs missing from challenge. Supply NVM_PLAN_ID and NVM_AGENT_ID.");
  const payments = Payments.getInstance({ nvmApiKey: buyerKey });
  const result = await payments.x402.getX402AccessToken(planId, agentId, {
    scheme: "nvm:card-delegation",
    delegationConfig: { delegationId },
    resource: { url: resource.url },
    httpVerb: "POST",
    tokenVersion: 3
  });
  if (result.tokenVersion !== 3 || !result.accessToken) throw Error("Single-use token not issued");
  console.log("Nevermined v3 token ready. This token is never printed.");
  const confirmation = await io.question("Submit a real $1 payment request? Type PAY to confirm: ");
  if (confirmation !== "PAY") { console.log("Cancelled; no payment request sent."); process.exit(0); }
  const paid = await fetch(new URL(resource.url, base), {
    method: "POST",
    headers: { "payment-signature": result.accessToken, "Idempotency-Key": randomUUID() }
  });
  if (!paid.ok) {
    const body = await paid.text();
    console.error("Payment not confirmed:", paid.status, body.slice(0, 400));
    console.error("Do not retry until you have checked the buyer transaction history.");
    process.exitCode = 1;
  } else {
    const receipt = paid.headers.get("payment-response");
    if (!receipt) throw Error("Service returned success without payment receipt. Check provider transaction history.");
    await writeFile("qc-agent-result.svg", Buffer.from(await paid.arrayBuffer()));
    console.log("Payment response received; image saved as qc-agent-result.svg.");
    console.log("Verify the charge in Nevermined Purchases and Stripe before treating this as a settled transaction.");
  }
} catch (e) {
  console.error("Stopped:", e.message);
  process.exitCode = 1;
} finally { io.close(); }

