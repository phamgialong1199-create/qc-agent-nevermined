// QC Agent demonstration only. No Nevermined charge is performed.
const image = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450"><rect width="800" height="450" fill="#102a43"/><circle cx="400" cy="180" r="90" fill="#22d3ee"/><path d="M355 180 L385 210 L450 145" fill="none" stroke="#102a43" stroke-width="17" stroke-linecap="round" stroke-linejoin="round"/><text x="400" y="325" fill="white" font-size="36" font-family="Arial" text-anchor="middle">QC AGENT TEST</text><text x="400" y="365" fill="#a5f3fc" font-size="21" font-family="Arial" text-anchor="middle">Image delivery successful</text></svg>`;
const json = (body,status=200) => new Response(JSON.stringify(body,null,2),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
export default {
  async fetch(request,env) {
    const url=new URL(request.url);
    if(url.pathname==="/health") return json({ok:true,service:"QC Agent",neverminedConfigured:Boolean(env.NVM_API_KEY&&env.NVM_AGENT_ID&&env.NVM_PLAN_ID),paymentEnabled:false});
    if(url.pathname==="/paid-image") return json({error:"Payment Required",status:"INTEGRATION_PENDING",paymentEnabled:false,message:"Nevermined verification and settlement are not yet integrated.",priceUSD:1},402);
    if(url.pathname==="/preview-image") return new Response(image,{headers:{"content-type":"image/svg+xml; charset=utf-8","cache-control":"no-store"}});
    return json({service:"QC Agent",endpoints:["/health","/preview-image","/paid-image"]});
  }
};
