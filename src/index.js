const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450"><rect width="800" height="450" fill="#102a43"/><circle cx="400" cy="180" r="90" fill="#22d3ee"/><path d="M355 180 L385 210 L450 145" fill="none" stroke="#102a43" stroke-width="17" stroke-linecap="round" stroke-linejoin="round"/><text x="400" y="325" fill="white" font-size="36" font-family="Arial" text-anchor="middle">QC AGENT TEST</text><text x="400" y="365" fill="#a5f3fc" font-size="21" font-family="Arial" text-anchor="middle">Image delivery successful</text></svg>`;
const json = (body,status=200,headers={})=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store",...headers}});
const b64 = (v)=>btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(v))));
export default {
 async fetch(request,env) {
  const url=new URL(request.url);
  if(url.pathname==="/health") return json({ok:true,service:"QC Agent",neverminedConfigured:Boolean(env.NVM_API_KEY&&env.NVM_AGENT_ID&&env.NVM_PLAN_ID),paymentEnabled:env.NVM_ENABLE_LIVE_CHARGES==="true"});
  if(url.pathname==="/payment-preflight") {
    if(!env.NVM_API_KEY||!env.NVM_AGENT_ID||!env.NVM_PLAN_ID) return json({ok:false,error:"Missing runtime bindings"},503);
    // GET only; never send the seller secret or a buyer payment token.
    try {
      const response=await fetch("https://facilitator.live.nevermined.app/",{method:"GET",redirect:"manual",signal:AbortSignal.timeout(8000)});
      return json({ok:true,facilitatorReachable:true,facilitatorHTTPStatus:response.status,planConfigured:true,chargesAttempted:0});
    } catch {
      return json({ok:false,facilitatorReachable:false,chargesAttempted:0},503);
    }
  }
  if(url.pathname==="/preview-image") return new Response(svg,{headers:{"content-type":"image/svg+xml; charset=utf-8","cache-control":"no-store"}});
  if(url.pathname!=="/paid-image") return json({service:"QC Agent",endpoints:["/health","/payment-preflight","/preview-image","/paid-image"]});
  if(request.method!=="POST") return json({error:"Use POST /paid-image"},405,{allow:"POST"});
  if(!env.NVM_API_KEY||!env.NVM_AGENT_ID||!env.NVM_PLAN_ID) return json({error:"Missing server payment configuration"},503);
  const paymentRequired = {
    x402Version: 2,
    error: "Payment required",
    resource: {url: url.origin + "/paid-image", description:"QC Agent test image",mimeType:"image/svg+xml"},
    accepts: [{
      scheme:"nvm:card-delegation",
      network:"offchain",
      planId:env.NVM_PLAN_ID,
      extra:{version:"1",agentId:env.NVM_AGENT_ID}
    }],
    extensions:{}
  };
  const paymentHeaders = {"payment-required":b64(paymentRequired)};
  if(!request.headers.get("payment-signature"))
    return json(paymentRequired,402,paymentHeaders);
  if(env.NVM_ENABLE_LIVE_CHARGES!=="true")
    return json({error:"LIVE_CHARGING_DISABLED",message:"No payment attempt was made."},503);
  // Safe preflight: publish the configured plan without charging or exposing secrets.
  // Nevermined requires a buyer-issued payment-signature token and verified settlement.
  // Do not return the image until the REST verify/settle contract is validated.
  return json({
    error:"PAYMENT_SETTLEMENT_NOT_IMPLEMENTED",
    status:"AWAITING_VERIFIED_X402_INTEGRATION",
    scheme:"nvm:card-delegation",
    planId:env.NVM_PLAN_ID,
    agentId:env.NVM_AGENT_ID,
    priceUSD:1,
    message:"A buyer payment-signature and confirmed Nevermined settlement are required. No charge was attempted."
  },402);
 }
};
