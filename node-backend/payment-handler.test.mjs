import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {runInNewContext} from "node:vm";
import {randomUUID} from "node:crypto";
import {createPaidImageHandler} from "./payment-handler.mjs";

// Exercise the production ledger SQL boundary without a database or real charges.
async function fixture(options={}) {
  const rows=new Map(), statements=[], logs=[];
  const pool={async query(sql,args=[]) {
    statements.push(sql);
    if(sql.startsWith("CREATE") || sql.startsWith("ALTER") || sql==="SELECT 1")return {rows:[],rowCount:0};
    if(sql.startsWith("INSERT")) {
      const [hash,orderId,credentialHash]=args;
      if(rows.has(hash)||[...rows.values()].some(r=>r.request_id===orderId))return {rows:[],rowCount:0};
      rows.set(hash,{status:"processing",request_id:orderId,credential_hash:credentialHash,receipt:null});
      return {rows:[{token_hash:hash}],rowCount:1};
    }
    if(sql.startsWith("SELECT status"))return {rows:rows.has(args[0])?[rows.get(args[0])]:[]};
    if(sql.startsWith("UPDATE")) {
      if(options.saveFails)throw Error("database disconnected");
      Object.assign(rows.get(args[0]),{status:args[1],receipt:args[2]===null?null:JSON.parse(args[2])});
      return {rowCount:1};
    }
    throw Error("Unexpected SQL: "+sql);
  }};
  globalThis.__testPg={Pool:class{constructor(){return pool}}};
  process.env.DATABASE_URL="mock";
  const source=(await readFile(new URL("./payment-ledger.mjs",import.meta.url),"utf8"))
    .replace('import pg from "pg";',"const pg=globalThis.__testPg;");
  const ledger=await import("data:text/javascript;base64,"+Buffer.from(source).toString("base64")+"#"+randomUUID());
  assert.equal(await ledger.initLedger(),true);
  assert.ok(statements.some(sql=>sql.includes("ADD COLUMN IF NOT EXISTS request_id")));
  assert.ok(statements.some(sql=>sql.includes("CREATE UNIQUE INDEX")));
  let verifies=0, settles=0, captured;
  const payments={facilitator:{
    async verifyPermissions(input) {
      verifies++;captured=input;
      if(options.verifyThrows)throw Object.assign(Error("SECRET_TOKEN"),{code:"BCK.X402.0049"});
      return {isValid:!options.invalid,agentRequestId:"request-"+verifies};
    },
    async settlePermissions(input) {
      settles++;assert.equal(input.agentRequestId,"request-"+verifies);
      if(options.settleThrows)throw Object.assign(Error("SECRET_TOKEN"),{code:options.settleCode||"network_error"});
      return options.unconfirmed?{success:false}:{success:true,billingModel:"pay-as-you-go",orderTx:"charge-"+settles,creditsRedeemed:"0"};
    }
  }};
  const handler=createPaidImageHandler({...ledger,payments,
    ledgerReady:options.notReady?async()=>false:ledger.ledgerReady,
    env:{NVM_PLAN_ID:"plan",NVM_AGENT_ID:"agent",NVM_PAYMENT_NETWORK:"visa",ENABLE_SETTLEMENT:"true",ALLOW_X402_V2:"true",...options.env},
    detectAccessTokenVersion:t=>t.startsWith("v3")?3:2,
    buildPaymentRequired:(_plan,config)=>config,svg:"<svg/>",
    logger:{error:(...args)=>logs.push(args)}
  });
  async function request(orderId="00000000-0000-4000-8000-000000000001",token="v2-token") {
    const headers={"payment-signature":token,"idempotency-key":orderId};
    const res={statusCode:200,headers:{},set(k,v){this.headers[k]=v;return this},
      status(s){this.statusCode=s;return this},json(value){this.body=value;return this},
      type(t){this.contentType=t;return this},send(value){this.body=value;return this}};
    await handler({get:k=>headers[k.toLowerCase()]},res);
    return res;
  }
  return {request,rows,logs,counts:()=>({verifies,settles}),captured:()=>captured};
}

test("same v2 token buys twice with separate orders",async()=>{
  const f=await fixture();
  assert.equal((await f.request("purchase-00000001")).statusCode,200);
  assert.equal((await f.request("purchase-00000002")).statusCode,200);
  assert.deepEqual(f.counts(),{verifies:2,settles:2});
  assert.equal(f.captured().paymentRequired.scheme,"nvm:card-delegation");
  assert.equal(f.captured().paymentRequired.network,"visa");
});
test("settled retry returns receipt and image without another charge",async()=>{
  const f=await fixture(), first=await f.request(), retry=await f.request();
  assert.equal(retry.statusCode,200);
  assert.equal(retry.headers["payment-response"],first.headers["payment-response"]);
  assert.equal(retry.headers["idempotency-replayed"],"true");
  assert.equal(f.counts().settles,1);
});
test("simultaneous identical requests settle at most once",async()=>{
  const f=await fixture(), results=await Promise.all([f.request(),f.request(),f.request()]);
  assert.ok(results.some(r=>r.statusCode===200));
  assert.equal(f.counts().settles,1);
});
test("v3 is single use across orders, but same order can recover receipt",async()=>{
  const f=await fixture();
  assert.equal((await f.request("purchase-00000001","v3-token")).statusCode,200);
  assert.equal((await f.request("purchase-00000001","v3-token")).statusCode,200);
  assert.equal((await f.request("purchase-00000002","v3-token")).statusCode,409);
  assert.equal(f.counts().settles,1);
});
test("changing token on same order cannot charge twice",async()=>{
  const f=await fixture();
  await f.request("purchase-00000001","v2-a");
  assert.equal((await f.request("purchase-00000001","v2-b")).body.error,"ORDER_TOKEN_MISMATCH");
  assert.equal(f.counts().settles,1);
});
test("v3 changed token cannot reuse an existing order",async()=>{
  const f=await fixture();
  await f.request("purchase-00000001","v3-a");
  assert.equal((await f.request("purchase-00000001","v3-b")).statusCode,409);
  assert.equal(f.counts().settles,1);
});
test("uncertain settlement never resubmits or delivers",async()=>{
  for(const options of [{settleThrows:true},{unconfirmed:true},{saveFails:true}]) {
    const f=await fixture(options), first=await f.request(), retry=await f.request();
    assert.equal(first.statusCode,502);
    assert.equal(retry.statusCode,409);
    assert.equal(f.counts().settles,1);
    assert.notEqual(first.body,"<svg/>");
  }
});
test("failed verification is durable and does not settle",async()=>{
  const f=await fixture({invalid:true});
  assert.equal((await f.request()).statusCode,402);
  assert.equal((await f.request()).statusCode,402);
  assert.deepEqual(f.counts(),{verifies:1,settles:0});
});
test("missing/invalid idempotency keys never reach provider",async()=>{
  const f=await fixture();
  for(const key of [undefined,"short","a".repeat(129),"bad!key000000000000"]) {
    assert.equal((await f.request(key===undefined?"":key)).statusCode,400);
  }
  assert.equal(f.counts().verifies,0);
});
test("ledger unavailable and disabled settlement fail closed",async()=>{
  for(const opts of [{notReady:true},{env:{ENABLE_SETTLEMENT:"false"}},{env:{ALLOW_X402_V2:"false"}}]) {
    const f=await fixture(opts);
    assert.equal((await f.request()).statusCode,503);
    assert.equal(f.counts().verifies,0);
  }
});
test("provider error identifies phase without leaking credentials",async()=>{
  const f=await fixture({verifyThrows:true}), r=await f.request();
  assert.equal(r.body.providerCode,"BCK.X402.0049");
  assert.equal(f.logs[0][1].phase,"verify");
  assert.ok(!JSON.stringify(f.logs).includes("SECRET_TOKEN"));
  assert.ok(!JSON.stringify(f.logs).includes("v2-token"));
  assert.equal((await f.request()).statusCode,409);
  assert.equal(f.counts().verifies,1);
});

test("Visa definitive decline is persisted and returned as 402 without repeat settlement",async()=>{
  const f=await fixture({settleThrows:true,settleCode:"BCK.X402.0049"});
  const first=await f.request(), retry=await f.request();
  for(const r of [first,retry]) {
    assert.equal(r.statusCode,402);
    assert.equal(r.body.error,"PAYMENT_DECLINED");
    assert.equal(r.body.paymentCaptured,false);
    assert.equal(r.body.retryable,false);
  }
  assert.equal(f.counts().settles,1);
  assert.equal([...f.rows.values()][0].status,"declined");
});
test("ambiguous .0048 stays blocked and never claims that no charge occurred",async()=>{
  const f=await fixture({settleThrows:true,settleCode:"BCK.X402.0048"});
  const first=await f.request();
  assert.equal(first.statusCode,502);
  assert.equal(first.body.error,"PAYMENT_UNCERTAIN_CHECK_NEVERMINED_BEFORE_RETRY");
  assert.equal(first.body.paymentCaptured,undefined);
  assert.equal((await f.request()).statusCode,409);
  assert.equal(f.counts().settles,1);
});
test("decline with unavailable ledger returns decline but retains a blocking claim",async()=>{
  const f=await fixture({settleThrows:true,settleCode:"BCK.X402.0049",saveFails:true});
  assert.equal((await f.request()).body.error,"PAYMENT_DECLINED");
  assert.equal((await f.request()).statusCode,409);
  assert.equal(f.counts().settles,1);
});

test("browser makes a new order after success and retains the order after network failure",async()=>{
  const source=await readFile(new URL("./server.mjs",import.meta.url),"utf8");
  const script=source.match(/<script>(.*?)<\/script>/s)[1];
  const elements={token:{value:"v2-token"},status:{},pay:{},result:{replaceChildren(){}}};
  const stored=new Map(), requests=[];
  let fail=false;
  const context={
    sessionStorage:{getItem:k=>stored.get(k)||null,setItem:(k,v)=>stored.set(k,v),removeItem:k=>stored.delete(k)},
    document:{getElementById:id=>elements[id],createElement:()=>({})},
    crypto:{randomUUID},URL:{createObjectURL:()=>"blob:mock"},
    async fetch(url,options) {
      requests.push(options.headers["Idempotency-Key"]);
      if(fail)throw Error("network timeout");
      return {ok:true,blob:async()=>({}),headers:{get:()=> "2"}};
    }
  };
  runInNewContext(script,context);
  await elements.pay.onclick();
  await elements.pay.onclick();
  assert.notEqual(requests[0],requests[1]);
  assert.equal(elements.token.value,"v2-token");
  fail=true;
  await elements.pay.onclick();
  const pending=requests[2];
  assert.equal(stored.get("qc-pending-order"),pending);
  // Simulate reloading the page and then retrying the interrupted request.
  runInNewContext(script,{...context});
  fail=false;
  await elements.pay.onclick();
  assert.equal(requests[3],pending);
  assert.equal(stored.size,0);
});

test("checkout shows definitive decline and clears only the declined pending order",async()=>{
  const source=await readFile(new URL("./server.mjs",import.meta.url),"utf8");
  const script=source.match(/<script>(.*?)<\/script>/s)[1];
  const elements={token:{value:"v2-token"},status:{},pay:{},result:{}};
  const stored=new Map();
  let requests=0;
  runInNewContext(script,{
    sessionStorage:{getItem:k=>stored.get(k)||null,setItem:(k,v)=>stored.set(k,v),removeItem:k=>stored.delete(k)},
    document:{getElementById:id=>elements[id]},
    crypto:{randomUUID},
    async fetch() {requests++;return {ok:false,json:async()=>({
      error:"PAYMENT_DECLINED",paymentCaptured:false,message:"Visa đã từ chối thanh toán."
    })};}
  });
  await elements.pay.onclick();
  assert.ok(elements.status.textContent.includes("Visa đã từ chối"));
  assert.equal(elements.token.value,"");
  assert.equal(stored.size,0);
  await elements.pay.onclick();
  assert.equal(requests,1);
});
