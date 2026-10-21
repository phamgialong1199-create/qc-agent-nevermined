import { Payments, detectAccessTokenVersion } from "@nevermined-io/payments";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const required=["BUYER_NVM_API_KEY","BUYER_DELEGATION_ID"];
const missing=required.filter(k=>!process.env[k]);
if(missing.length){console.error("Missing:",missing.join(", "));process.exit(1);}
const planId=process.env.NVM_PLAN_ID||"16814508917622167141437966878895351233862993416119437544349158173761791276724";
const agentId=process.env.NVM_AGENT_ID||"44328239811039711515836904575110608628918310963073866130678593051453425887088";
try{
  const payments=Payments.getInstance({nvmApiKey:process.env.BUYER_NVM_API_KEY});
  const result=await payments.x402.getX402AccessToken(planId,agentId,{
    scheme:"nvm:card-delegation",network:"visa",
    delegationConfig:{delegationId:process.env.BUYER_DELEGATION_ID},
    resource:{url:"/paid-image"},httpVerb:"POST",tokenVersion:3
  });
  const version=detectAccessTokenVersion(result.accessToken);
  if(version!==2&&version!==3)throw Error("Unsupported token version");
  const path=resolve("QC_X402_TOKEN_LOCAL.txt");
  await writeFile(path,result.accessToken,{mode:0o600,flag:"w"});
  console.log("Token version:",version);
  console.log("Saved token locally:",path);
  console.log("Keep this file private. Do not share it or commit it.");
  console.log("No payment was submitted. The seller must enable settlement separately.");
}catch(error){
  console.error("Token creation failed:",error.message);
  process.exitCode=1;
}
