const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450"><rect width="800" height="450" fill="#102a43"/><circle cx="400" cy="180" r="90" fill="#22d3ee"/><path d="M355 180 L385 210 L450 145" fill="none" stroke="#102a43" stroke-width="17" stroke-linecap="round" stroke-linejoin="round"/><text x="400" y="325" fill="white" font-size="36" font-family="Arial" text-anchor="middle">QC AGENT TEST</text><text x="400" y="365" fill="#a5f3fc" font-size="21" font-family="Arial" text-anchor="middle">Image delivery successful</text></svg>`;
const json = (body,status=200,headers={})=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store",...headers}});
const b64 = (v)=>btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(v))));
export default {
 async fetch(request,env) {
  const url=new URL(request.url);
  if(url.pathname==="/health") return json({ok:true,service:"QC Agent",neverminedConfigured:Boolean(env.NVM_API_KEY&&env.NVM_AGENT_ID&&env.NVM_PLAN_ID),paymentEnabled:env.NVM_ENABLE_LIVE_CHARGES==="true"});
  if(url.pathname==="/preview-image") return new Response(svg,{headers:{"content-type":"image/svg+xml; charset=utf-8","cache-control":"no-store"}});
  if(url.pathname!=="/paid-image") return json({service:"QC Agent",endpoints:["/health","/preview-image","/paid-image"]});
  if(request.method!=="POST") return json({error:"Use POST /paid-image"},405,{allow:"POST"});
  if(env.NVM_ENABLE_LIVE_CHARGES!=="true") return json({error:"LIVE_CHARGING_DISABLED",message:"Payment integration installed but live charges are disabled."},503);
  if(!env.NVM_API_KEY||!env.NVM_AGENT_ID||!env.NVM_PLAN_ID) return json({error:"Missing server payment configuration"},503);
  // The Nevermined SDK currently pulls Node.js modules that fail at Worker startup.
  // Payment remains fail-closed until a Cloudflare-compatible integration is verified.
  return json({error:"PAYMENT_INTEGRATION_PENDING",message:"Payment validation and settlement are not enabled."},503);
 }
};
