import express from "express";
import {readFile} from "node:fs/promises";
import Redis from "ioredis";
import {initLedger,ledgerReady,claim,priorClaim,finishClaim} from "./payment-ledger.mjs";
import { createPaidImageHandler } from "./payment-handler.mjs";
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
app.get("/get-x402",(_req,res)=>res.type("html").send(`<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Lấy token x402 | QC Agent</title><style>body{font:16px system-ui;background:#0b1e2c;color:#fff;max-width:650px;margin:8vh auto;padding:22px}main{background:#163347;padding:26px;border-radius:16px}a{color:#66e5ff}li{margin:12px 0}p{line-height:1.55}</style><main><h1>Lấy token x402</h1><p>Để bảo vệ tài khoản, QC Agent không thu thập Buyer API Key, Delegation ID hoặc mật khẩu của bạn.</p><ol><li>Đăng nhập Nevermined Live bằng tài khoản người mua.</li><li>Mở trang quyền x402 của Nevermined và chọn gói QC Agent nếu được liệt kê.</li><li>Nếu Nevermined cung cấp chức năng tạo token, hãy tạo token x402 cho gói của bạn và sao chép.</li><li>Quay lại QC Agent, dán token vào ô payment-signature rồi xác nhận thanh toán.</li></ol><p><a href="https://nevermined.app/permissions/agent-permissions" target="_blank" rel="noopener noreferrer">Mở trang quyền x402 Nevermined ↗</a></p><p><a href="/">← Quay lại QC Agent</a></p><p><small>Nếu gói không xuất hiện hoặc Nevermined không cho tạo token trên giao diện, không nhập API Key vào website này. Sử dụng ứng dụng khách Nevermined SDK trên máy riêng của bạn.</small></p></main>`));
app.get("/oauth/client.json",async(_req,res)=>{res.set("Cache-Control","public, max-age=300");res.type("application/json").send(await readFile(new URL("./oauth-client.json",import.meta.url),"utf8"));});
app.get(["/oauth/start","/oauth/callback"],async(_req,res)=>{res.set("Cache-Control","no-store");res.type("html").send(await readFile(new URL("./oauth-portal.html",import.meta.url),"utf8"));});
app.get("/preview-image",(_req,res)=>res.type("image/svg+xml").send(svg));
app.get("/",(_req,res)=>res.type("html").send(`<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>QC Agent</title><style>body{font:16px system-ui;background:#0b1e2c;color:white;max-width:680px;margin:7vh auto;padding:22px}section{background:#163347;padding:26px;border-radius:18px}button,input{font:inherit;padding:12px;border-radius:9px}input{box-sizing:border-box;width:100%;margin:12px 0;background:#eaf7fa}button{background:#3dd5eb;border:0;cursor:pointer}a{color:#6ee7f9}#status{white-space:pre-wrap}</style><section><h1>QC Agent — $1/lượt</h1><p>Thanh toán bằng Nevermined x402. Chỉ nhận ảnh sau khi giao dịch được xác nhận.</p><p>Khách sử dụng x402: nhập payment-signature được ứng dụng Nevermined của mình tạo. Không nhập API Key, mật khẩu hoặc thông tin thẻ vào trang này.</p><label for="token">X402 payment-signature</label><input id="token" type="password" autocomplete="off" placeholder="Token x402 v2 hoặc v3"><button id="pay">Gửi yêu cầu thanh toán $1</button><p id="status" role="status"></p><div id="result"></div><p><a href="/get-x402">Hướng dẫn lấy token x402 an toàn</a></p><p><a href="/preview-image">Xem ảnh mẫu miễn phí</a></p></section><script>let orderId=sessionStorage.getItem('qc-pending-order');document.getElementById('pay').textContent=orderId?'Kiểm tra lại đơn đang chờ':'Mua $1';document.getElementById('pay').onclick=async()=>{const t=document.getElementById('token').value.trim(),s=document.getElementById('status'),b=document.getElementById('pay');if(!t){s.textContent='Cần payment-signature hợp lệ, không phải API Key.';return}b.disabled=true;try{if(!orderId){orderId=crypto.randomUUID();sessionStorage.setItem('qc-pending-order',orderId)}s.textContent='Đang xử lý đơn '+orderId+'.';const r=await fetch('/paid-image',{method:'POST',headers:{'payment-signature':t,'Idempotency-Key':orderId}});if(!r.ok){const e=await r.json();s.textContent='Đơn '+orderId+': '+(e.error||r.status)+(e.providerCode?' ('+e.providerCode+')':'')+'. Không tạo đơn mới nếu chưa rõ trạng thái giao dịch.';return}const blob=await r.blob();document.getElementById('result').replaceChildren(Object.assign(document.createElement('img'),{src:URL.createObjectURL(blob),alt:'QC Agent result',width:600}));const v=r.headers.get('x402-token-version');s.textContent='Đã nhận ảnh cho đơn '+orderId+'. '+(v==='3'?'Lấy token mới để mua tiếp.':'Có thể bấm Mua $1 để mua lượt tiếp theo.');sessionStorage.removeItem('qc-pending-order');orderId=null;if(v==='3')document.getElementById('token').value='';}catch(e){s.textContent='Chưa rõ trạng thái đơn '+orderId+'. Kiểm tra Nevermined. Nút kiểm tra lại giữ nguyên mã đơn, không tạo khoản thu mới.'}finally{b.disabled=false;b.textContent=orderId?'Kiểm tra lại đơn đang chờ':'Mua $1'}};</script></html>`));

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
      scheme: process.env.NVM_PAYMENT_SCHEME || (["stripe","visa","braintree"].includes(process.env.NVM_PAYMENT_NETWORK || "stripe") ? "nvm:card-delegation" : "nvm:erc4337"),
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

app.post("/paid-image",createPaidImageHandler({payments,ledgerReady,claim,priorClaim,finishClaim,
  detectAccessTokenVersion,buildPaymentRequired,env:process.env,svg}));
app.listen(port,()=>console.log("QC Agent Node backend listening",port));

