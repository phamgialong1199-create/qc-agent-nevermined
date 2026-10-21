import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const base = process.env.QC_AGENT_URL || "https://qc-agent-nevermined.onrender.com";
const file = resolve("QC_X402_TOKEN_LOCAL.txt");
try {
  const token = (await readFile(file, "utf8")).trim();
  if (!token) throw Error("Token file is empty");
  const response = await fetch(new URL("/verify-token", base), {
    method: "POST",
    headers: { "payment-signature": token, "accept": "application/json" },
    signal: AbortSignal.timeout(20000)
  });
  const data = await response.json();
  console.log(JSON.stringify({
    status: response.status,
    verified: data.verified === true,
    settled: false,
    error: data.error || null
  }, null, 2));
  if (data.verified !== true) process.exitCode = 1;
} catch (e) {
  console.error("Verification failed:", e.message);
  process.exitCode = 1;
}
