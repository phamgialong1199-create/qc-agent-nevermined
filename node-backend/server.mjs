import express from "express";
import { Payments, buildPaymentRequired, detectAccessTokenVersion } from "@nevermined-io/payments";

const app=express();
app.disable("x-powered-by");
const port=Number(process.env.PORT||3000);
const required=["NVM_API_KEY","NVM_AGENT_ID","NVM_PLAN_ID"];
const missing=required.filter(k=>!process.env[k]);
const payments=missing.length?null:Payments.getInstance({nvmApiKey:process.env.NVM_API_KEY,environment:process.env.NVM_ENV||"sandbox"});
const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450"><rect width="800" height="450" fill="#102a43"/><circle cx="400" cy="180" r="90" fill="#22d3ee"/><path d="M355 180 L385 210 L450 145" fill="none" stroke="#102a43" stroke-width="17" stroke-linecap="round" stroke-linejoin="round"/><text x="400" y="325" fill="white" font-size="36" font-family="Arial" text-anchor="middle">QC AGENT TEST</text></svg>`;
const b64=obj=>Buffer.from(JSON.stringify(obj)).toString("base64");
app.get("/health",(_req,res)=>res.json({ok:true,configured:!missing.length,mode:process.env.NVM_ENV||"sandbox",settlementEnabled:process.env.ENABLE_SETTLEMENT==="true"}));
app.get("/preview-image",(_req,res)=>res.type("image/svg+xml").send(svg));
app.get("/", (_req,res) => res.type("html").send(`<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>QC Agent</title><style>body{font-family:system-ui;background:#0b1e2c;color:white;max-width:720px;margin:8vh auto;padding:24px}a{color:#6ee7f9}section{background:#163347;padding:25px;border-radius:18px}button{padding:12px 18px;border:0;border-radius:10px;background:#3dd5eb;color:#052332;font-weight:700;cursor:pointer}p{line-height:1.6}</style><section><h1>QC Agent</h1><p>Kiểm tra chất lượng nội dung qua API. Gói Nevermined: $1 mỗi lượt.</p><p>Hiện chức năng thu tiền tự động chưa được kích hoạt. Không có khoản phí nào phát sinh từ trang này.</p><p><a href="/preview-image">Xem ảnh mẫu miễn phí</a> · <a href="/health">Kiểm tra hệ thống</a></p><button onclick="alert('Chức năng thanh toán đang được hoàn thiện; chưa nhận thanh toán.')">Dùng QC Agent — $1/lượt</button></section></html>`));

// Non-charging verification endpoint for a buyer token.
// Never logs, stores, or settles the bearer credential.
app.post("/verify-token", async (req, res) => {
  if (!payments) return res.status(503).json({ error: "MISSING_CONFIG" });
  const token = req.get("payment-signature");
  if (!token || token.length > 16384) return res.status(400).json({ error: "MISSING_OR_INVALID_TOKEN" });
  try {
    if (detectAccessTokenVersion(token) !== 3) {
      return res.status(400).json({ error: "V3_TOKEN_REQUIRED" });
    }
    const paymentRequired = buildPaymentRequired(process.env.NVM_PLAN_ID, {
      endpoint: "/paid-image",
      agentId: process.env.NVM_AGENT_ID,
      httpVerb: "POST",
      network: "stripe",
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
    network:"stripe",description:"QC Agent test image"
  });
  const headers={"payment-required":b64(paymentRequired)};
  const token=req.get("payment-signature");
  if(!token) return res.set(headers).status(402).json({error:"PAYMENT_REQUIRED",message:"Buyer must supply a Nevermined x402 v3 payment-signature."});
  if(process.env.ENABLE_SETTLEMENT!=="true") return res.status(503).json({error:"SETTLEMENT_DISABLED"});
  if(process.env.DURABLE_LEDGER_READY!=="true") return res.status(503).json({error:"DURABLE_LEDGER_REQUIRED"});
  if(token.length>16384) return res.status(400).json({error:"TOKEN_TOO_LONG"});
  // v2 tokens are reusable; require a single-use v3 token for this test.
  if(detectAccessTokenVersion(token)!==3) return res.status(402).json({error:"SINGLE_USE_V3_TOKEN_REQUIRED"});
  try {
    const verification=await payments.facilitator.verifyPermissions({
      paymentRequired,x402AccessToken:token,maxAmount:1n
    });
    if(verification?.isValid!==true) return res.status(402).json({error:"PAYMENT_VERIFICATION_FAILED"});
    // Important: durable nonce claim/lock and charge reconciliation must be implemented
    // before enabling DURABLE_LEDGER_READY. Never toggle it without those controls.
    const settlement=await payments.facilitator.settlePermissions({
      paymentRequired,x402AccessToken:token,maxAmount:1n,
      agentRequestId:verification.agentRequest?.agentRequestId
    });
    const charged=settlement?.success===true &&
      (settlement.billingModel==="pay-as-you-go"
        ? Boolean(settlement.orderTx||settlement.transaction)
        : Number(settlement.creditsRedeemed??"0")>0);
    if(!charged) return res.status(502).json({error:"SETTLEMENT_NOT_CONFIRMED_CHECK_TRANSACTION_BEFORE_RETRY"});
    res.set("payment-response",b64(settlement));
    return res.type("image/svg+xml").send(svg);
  }catch(error){
    console.error("Payment error code",error?.code||"unknown");
    return res.status(502).json({error:"PAYMENT_UNCERTAIN_CHECK_NEVERMINED_BEFORE_RETRY"});
  }
});
app.listen(port,()=>console.log("QC Agent Node backend listening",port));
