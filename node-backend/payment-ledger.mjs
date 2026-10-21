import pg from "pg";
import {createHash} from "node:crypto";
const pool=process.env.DATABASE_URL?new pg.Pool({connectionString:process.env.DATABASE_URL,max:4,connectionTimeoutMillis:5000}):null;
let ready=false;
export async function initLedger(){
 if(!pool)return false;
 try{
 await pool.query("CREATE TABLE IF NOT EXISTS qc_payments(token_hash text PRIMARY KEY,status text NOT NULL,receipt jsonb,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now())");
 ready=true;return true;
 }catch(e){console.error("Postgres initialization failed",e.code||"unknown");return false;}
}
export async function ledgerReady(){if(!ready||!pool)return false;try{await pool.query("SELECT 1");return true;}catch{return false;}}
export async function claim(token){
 const hash=createHash("sha256").update(token).digest("hex");
 const r=await pool.query("INSERT INTO qc_payments(token_hash,status) VALUES($1,'processing') ON CONFLICT DO NOTHING RETURNING token_hash",[hash]);
 return {hash,newClaim:r.rowCount===1};
}
export async function priorClaim(hash){const r=await pool.query("SELECT status,receipt FROM qc_payments WHERE token_hash=$1",[hash]);return r.rows[0]||null;}
export async function finishClaim(hash,status,receipt=null){
 await pool.query("UPDATE qc_payments SET status=$2,receipt=$3::jsonb,updated_at=now() WHERE token_hash=$1",[hash,status,receipt===null?null:JSON.stringify(receipt)]);
}
