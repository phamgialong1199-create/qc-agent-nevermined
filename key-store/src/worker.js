import { storefront, admin } from './pages.js';

const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const html=(value)=>new Response(value,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'","X-Content-Type-Options":"nosniff"}});
const id=()=>crypto.randomUUID();
function secretMatch(a,b){
 if(!a||!b||a.length!==b.length)return false;
 let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);
 return diff===0;
}
function authorized(req,env){
 const h=req.headers.get('Authorization')||'';
 return typeof env.ADMIN_TOKEN==='string' && env.ADMIN_TOKEN.length>=32 && secretMatch(h,'Bearer '+env.ADMIN_TOKEN);
}
async function stock(db){
 const r=await db.prepare("SELECT COUNT(*) AS n FROM inventory WHERE status='available'").first();
 return Number(r?.n||0);
}
export default {
 async fetch(req,env){
  try{
   if(!env.DB)return json({error:'DATABASE_NOT_CONFIGURED'},503);
   const url=new URL(req.url),p=url.pathname,method=req.method;
   if(p==='/'&&method==='GET')return html(storefront);
   if(p==='/admin'&&method==='GET')return html(admin);
   if(p==='/api/health'&&method==='GET'){
    await env.DB.prepare('SELECT 1').first();
    return json({ok:true,database:true,paymentsEnabled:false});
   }
   if(p==='/api/config'&&method==='GET')return json({
    unitPriceCents:Number(env.UNIT_PRICE_CENTS||500),
    currency:'USD',available:await stock(env.DB),
    paymentsEnabled:false
   });
   if(p==='/api/orders'&&method==='POST'){
    // Explicitly refuse checkout until a verified payment adapter is installed.
    return json({error:'CHECKOUT_NOT_ENABLED',message:'No payment will be collected.'},503);
   }
   if(p==='/api/admin/stats'&&method==='GET'){
    if(!authorized(req,env))return json({error:'UNAUTHORIZED'},401);
    const r=await env.DB.prepare("SELECT status,COUNT(*) AS count FROM inventory GROUP BY status").all();
    const o=await env.DB.prepare("SELECT status,COUNT(*) AS count FROM orders GROUP BY status").all();
    return json({inventory:r.results,orders:o.results});
   }
   if(p==='/api/admin/import'&&method==='POST'){
    if(!authorized(req,env))return json({error:'UNAUTHORIZED'},401);
    const text=await req.text();
    if(text.length>1000000)return json({error:'FILE_TOO_LARGE'},413);
    const lines=text.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
    if(!lines.length||lines.length>10000)return json({error:'INVALID_KEY_COUNT'},400);
    if(lines.some(x=>x.length>512||/[\x00-\x1f\x7f]/.test(x)))return json({error:'INVALID_KEY_FORMAT'},400);
    const unique=[...new Set(lines)];
    let imported=0;
    // Batch insert in manageable D1 transactions. INSERT OR IGNORE prevents duplicates.
    for(let i=0;i<unique.length;i+=100){
     const batch=unique.slice(i,i+100).map(key=>env.DB.prepare('INSERT OR IGNORE INTO inventory(code) VALUES(?)').bind(key));
     const result=await env.DB.batch(batch);
     imported+=result.reduce((sum,x)=>sum+Number(x.meta?.changes||0),0);
    }
    return json({ok:true,received:lines.length,imported,duplicates:lines.length-imported,available:await stock(env.DB)});
   }
   return json({error:'NOT_FOUND'},404);
  }catch(e){
   // Never log request bodies, key values or admin secrets.
   console.error('Store operation failed',e?.name||'Error');
   return json({error:'INTERNAL_ERROR'},500);
  }
 }
};
