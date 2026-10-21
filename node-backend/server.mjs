import express from "express";
import Redis from "ioredis";
import {initLedger,ledgerReady,claim,priorClaim,finishClaim} from "./payment-ledger.mjs";
import { createHash } from "node:crypto";
import { Payments, buildPaymentRequired, detectAccessTokenVersion } from "@nevermined-io/payments";

const app=express();
await initLedger();
const ledger=process.env.REDIS_URL ? new Redis(process.env.REDIS_URL,{maxRetriesPerRequest:1,enableOfflineQueue:false}) : null;
if(ledger) ledger.on("error",()=>console.error("Payment ledger unavailable"));
app.disable("x-powered-by");
const port=Number(process.env.PORT||3000);
const required=["NVM_API_KEY","NVM_AGENT_ID","NVM_PLAN_ID"];
const missing=required.filter(k=>!process.env[k]);
const payments=missing.length?null:Payments.getInstance({nvmApiKey:process.env.NVM_API_KEY,environment:process.env.NVM_ENV||"sandbox"});
const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450"><rect width="800" height="450" fill="#102a43"/><circle cx="400" cy="180" r="90" fill="#22d3ee"/><path d="M355 180 L385 210 L450 145" fill="none" stroke="#102a43" stroke-width="17" stroke-linecap="round" stroke-linejoin="round"/><text x="400" y="325" fill="white" font-size="36" font-family="Arial" text-anchor="middle">QC AGENT TEST</text></svg>`;
const b64=obj=>Buffer.from(JSON.stringify(obj)).toString("base64");
app.get("/health",(_req,res)=>res.json({ok:true,configured:!missing.length,mode:process.env.NVM_ENV||"sandbox",settlementEnabled:process.env.ENABLE_SETTLEMENT==="true" && Boolean(ledger),ledgerConfigured:Boolean(ledger)}));
app.get("/ledger-health",async(_req,res)=>{
  if(!ledger) return res.status(503).json({ok:false,redisConnected:false,error:"REDIS_NOT_CONFIGURED"});
  try {
    const pong=await ledger.ping();
    if(pong!=="PONG") throw new Error("Redis did not respond");
    let persistence="unverified";
    try {
      const info=await ledger.info("persistence");
      const aof=/aof_enabled:(\\d+)/.exec(info)?.[1];
      const rdb=/rdb_last_save_time:(\\d+)/.exec(info)?.[1];
      persistence=aof==="1"?"aof-enabled":rdb&&Number(rdb)>0?"rdb-info-present":"not-confirmed";
    } catch {}
    return res.json({ok:true,redisConnected:true,persistence,paymentReady:false});
  } catch {
    return res.status(503).json({ok:false,redisConnected:false,error:"REDIS_UNREACHABLE"});
  }
});
app.get("/db-health",async(_req,res)=>res.status(await ledgerReady()?200:503).json({ok:await ledgerReady(),postgresConnected:await ledgerReady()}));
app.get("/preview-image",(_req,res)=>res.type("image/svg+xml").send(svg));
app.get("/",(_req,res)=>res.type("html").send(`<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>QC Agent</title><style>body{font:16px system-ui;background:#0b1e2c;color:white;max-width:680px;margin:7vh auto;padding:22px}section{background:#163347;padding:26px;border-radius:18px}button,input{font:inherit;padding:12px;border-radius:9px}input{box-sizing:border-box;width:100%;margin:12px 0;background:#eaf7fa}button{background:#3dd5eb;border:0;cursor:pointer}a{color:#6ee7f9}#status{white-space:pre-wrap}</style><section><h1>QC Agent — $1/lượt</h1><p>Thanh toán bằng Nevermined x402. Chỉ nhận ảnh sau khi giao dịch được xác nhận.</p><p>Khách sử dụng x402: nhập payment-signature được ứng dụng Nevermined của mình tạo. Không nhập API Key, mật khẩu hoặc thông tin thẻ vào trang này.</p><label for="token">X402 payment-signature</label><input id="token" type="password" autocomplete="off" placeholder="Token x402 v3"><button id="pay">Gửi yêu cầu thanh toán $1</button><p id="status" role="status"></p><div id="result"></div><p><a href="/preview-image">Xem ảnh mẫu miễn phí</a></p></section><script>document.getElementById('pay').onclick=async()=>{const t=document.getElementById('token').value.trim(),s=document.getElementById('status'),b=document.getElementById('pay');if(!t){s.textContent='Cần payment-signature hợp lệ, không phải API Key.';return}b.disabled=true;s.textContent='Đang xử lý. Không thử lại nếu giao dịch không rõ trạng thái.';try{const r=await fetch('/paid-image',{method:'POST',headers:{'payment-signature':t}});if(!r.ok){const e=await r.json();s.textContent='Không giao ảnh: '+(e.error||r.status);return}const blob=await r.blob();document.getElementById('result').replaceChildren(Object.assign(document.createElement('img'),{src:URL.createObjectURL(blob),alt:'QC Agent result',width:600}));s.textContent='Đã nhận ảnh.';}catch(e){s.textContent='Không rõ trạng thái. Kiểm tra Nevermined trước khi thử lại.'}finally{b.disabled=false;document.getElementById('token').value=''}};</script></html>`));

// Non-charging verification endpoint for a buyer token.
// Never logs, stores, or settles the bearer credential.
app.post("/verify-token", async (req, res) => {
  if (!payments) return res.status(503).json({ error: "MISSING_CONFIG" });
  const token = req.get("payment-signature");
  if (!token || token.length > 16384) return res.status(400).json({ error: "MISSING_OR_INVALID_TOKEN" });
  try {
    const version = detectAccessTokenVersion(token);
    if (version !== 2 && version !== 3) {
      return res.status(400).json({ error: "UNSUPPORTED_X402_TOKEN_VERSION" });
    }
    const paymentRequired = buildPaymentRequired(process.env.NVM_PLAN_ID, {
      endpoint: "/paid-image",
      agentId: process.env.NVM_AGENT_ID,
      httpVerb: "POST",
      network: process.env.NVM_PAYMENT_NETWORK || "stripe",
      description: "QC Agent test image"
    });
    const verification = await payments.facilitator.verifyPermissions({
      paymentRequired,
      x402AccessToken: token,
      maxAmount: 1n
    });
    return res.status(verification?.isValid === true ? 200 : 402).json({
      verified: verification?.isValid === true,
      settled: false,
      imageDelivered: false,
      error: verification?.isValid === true ? null : "INVALID_PERMISSION"
    });
  } catch (error) {
    console.error("Verification error code:", error?.code || "unknown");
    return res.status(502).json({ error: "VERIFY_FAILED", verified: false, settled: false });
  }
});

app.post("/paid-image",async(req,res)=>{
  if(!payments) return res.status(503).json({error:"MISSING_CONFIG"});
  const paymentRequired=buildPaymentRequired(process.env.NVM_PLAN_ID,{
    endpoint:"/paid-image",agentId:process.env.NVM_AGENT_ID,httpVerb:"POST",
    network:process.env.NVM_PAYMENT_NETWORK||"stripe",description:"QC Agent test image"
  });
  const headers={"payment-required":b64(paymentRequired)};
  const token=req.get("payment-signature");
  if(!token) return res.set(headers).status(402).json({error:"PAYMENT_REQUIRED",message:"Buyer must supply a Nevermined x402 payment-signature."});
  if(process.env.ENABLE_SETTLEMENT!=="true") return res.status(503).json({error:"SETTLEMENT_DISABLED"});
  if(!await ledgerReady()) return res.status(503).json({error:"POSTGRES_LEDGER_NOT_READY"});
  if(token.length>16384) return res.status(400).json({error:"TOKEN_TOO_LONG"});
  // Live Nevermined currently returns v2 for some card delegations.
  // A v2 token is reusable, so NEVER settle it without a durable ledger and
  // explicit opt-in. Redis Free with persistence disabled is not sufficient.
  const tokenVersion=detectAccessTokenVersion(token);
  if(tokenVersion!==2 && tokenVersion!==3)
    return res.status(402).json({error:"UNSUPPORTED_X402_TOKEN_VERSION"});
  if(tokenVersion===2 && process.env.ALLOW_X402_V2!=="true")
    return res.status(503).json({error:"V2_REQUIRES_DURABLE_REPLAY_PROTECTION"});
  let hash;
  try{
    const attempt=await claim(token);hash=attempt.hash;
    if(!attempt.newClaim){
      const prior=await priorClaim(hash);
      return res.status(409).json({error:prior?.status==="settled"?"PAYMENT_ALREADY_SETTLED":"PAYMENT_STATUS_UNCERTAIN_DO_NOT_RETRY"});
    }
    const verification=await payments.facilitator.verifyPermissions({paymentRequired,x402AccessToken:token,maxAmount:1n});
    if(verification?.isValid!==true){
      await finishClaim(hash,"rejected");
      return res.status(402).json({error:"PAYMENT_VERIFICATION_FAILED"});
    }
    const settlement=await payments.facilitator.settlePermissions({
      paymentRequired,x402AccessToken:token,maxAmount:1n,
      agentRequestId:verification.agentRequest?.agentRequestId
    });
    const charged=settlement?.success===true &&
      (settlement.billingModel==="pay-as-you-go"
        ? Boolean(settlement.orderTx||settlement.transaction)
        : Number(settlement.creditsRedeemed??"0")>0);
    if(!charged)return res.status(502).json({error:"SETTLEMENT_NOT_CONFIRMED_CHECK_TRANSACTION_BEFORE_RETRY"});
    await finishClaim(hash,"settled",settlement);
    res.set("payment-response",b64(settlement));
    return res.type("image/svg+xml").send(svg);
  }catch(error){
    console.error("Payment error code",error?.code||"unknown");
    return res.status(502).json({error:"PAYMENT_UNCERTAIN_CHECK_NEVERMINED_BEFORE_RETRY"});
  }
});
app.listen(port,()=>console.log("QC Agent Node backend listening",port));
