(dependency-free, exportable). Adapters inside it are the swap-point for real NIP / core-banking calls.
-->
<style>
:root{box-sizing:border-box;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px);--bg:#f4f5f8;--card:#fff;--tx:#1a1a2e;--mu:#6b6f80;--bd:#e3e5ec;--pr:#c8102e;--ok:#12805c;--wa:#b26a00}
@media(prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#14151c;--card:#1e2029;--tx:#eceef5;--mu:#9aa0b4;--bd:#2d303d;--ok:#3ccf9b;--wa:#f0b24a;--pr:#ff6b7f}}
:root[data-theme="dark"]{--bg:#14151c;--card:#1e2029;--tx:#eceef5;--mu:#9aa0b4;--bd:#2d303d;--ok:#3ccf9b;--wa:#f0b24a;--pr:#ff6b7f}
html,body{margin:0}body{background:var(--bg);color:var(--tx);font:14px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}*{box-sizing:border-box}
.top{padding:12px 14px;background:var(--card);border-bottom:1px solid var(--bd);display:flex;gap:8px;align-items:center;flex-wrap:wrap}.logo{font-weight:800;color:var(--pr);margin-right:auto}
button,select,input{font:inherit;color:var(--tx)}button{cursor:pointer;border:1px solid var(--bd);background:var(--card);padding:7px 12px;border-radius:8px}button.p{background:var(--pr);color:#fff;border-color:var(--pr)}button.g{background:var(--ok);color:#fff;border-color:var(--ok)}button.on{background:var(--tx);color:var(--bg)}
input,select{width:100%;padding:9px;border:1px solid var(--bd);border-radius:8px;background:var(--card);margin:3px 0 10px}
.wrap{max-width:960px;margin:0 auto;padding:14px}.card{background:var(--card);border:1px solid var(--bd);border-radius:12px;padding:14px;margin-bottom:12px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}@media(max-width:700px){.grid{grid-template-columns:1fr}}
.bal{background:linear-gradient(135deg,#c8102e,#7a0a1c);color:#fff;border-radius:14px;padding:18px}.bal b{font-size:28px;display:block}
.row{display:flex;justify-content:space-between;gap:10px;padding:9px 0;border-bottom:1px solid var(--bd)}.row:last-child{border:0}.mu,.hint{color:var(--mu)}.hint{font-size:12px}
.tag{display:inline-block;padding:2px 8px;border-radius:99px;font-size:11px;font-weight:600;border:1px solid currentColor}.s-success,.s-refunded,.s-auto{color:var(--ok)}.s-failed,.s-rejected{color:var(--pr)}.s-awaiting,.s-investigating{color:var(--wa)}
.tbl{width:100%;border-collapse:collapse}.tbl th,.tbl td{text-align:left;padding:8px;border-bottom:1px solid var(--bd);vertical-align:top}.tbl th{color:var(--mu);font-size:12px}.tbl tr.c{cursor:pointer}.ov{overflow-x:auto}
.log{font:12px/1.5 ui-monospace,Menlo,Consolas,monospace;background:var(--bg);border-radius:8px;padding:10px;max-height:280px;overflow:auto}.log .w{color:var(--wa)}.log .e{color:var(--pr)}.log .k{color:var(--ok)}
.rcpt{max-width:420px}.steps{display:flex;text-align:center;font-size:11px;margin:8px 0 12px}.steps div{flex:1}.dot{width:12px;height:12px;border-radius:50%;margin:0 auto 4px;background:var(--ok)}.dot.x{background:var(--pr)}
.note{background:var(--bg);padding:10px;border-radius:8px;color:var(--mu);font-size:12px;margin:8px 0}.toast{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(16px + env(safe-area-inset-bottom,0px));background:var(--tx);color:var(--bg);padding:10px 16px;border-radius:10px;z-index:9;max-width:90%}
.modal{position:fixed;inset:0;background:#0008;display:flex;align-items:center;justify-content:center;z-index:8;padding:14px}.modal>div{background:var(--card);border-radius:14px;padding:16px;max-width:560px;width:100%;max-height:90%;overflow:auto}
</style></head><body>
<div class="top"><div class="logo" id="lg">Demo Bank</div><span id="who" class="hint"></span></div><div class="wrap" id="app">Loading…</div><div id="mod"></div>

<script id="dt-engine">
/* ===== DT ENGINE v1 — dependency-free refund-resolution engine =====
   Flow: detect (failed + debited) -> run checks via ADAPTERS -> feature vector -> logistic confidence score -> verdict.
   p = probability a refund is DUE. verdict: p>=hi 'refund' | p<=lo 'auto_success' | else 'review'. Humans always decide refunds.
   Train: DTEngine.train(examples,cfg) where examples=[{f:{tsq,ben,rev,dup},y:0|1}]. */
const DTEngine=(()=>{
const FEATS=['tsq','ben','rev','dup'],sig=x=>1/(1+Math.exp(-x)),fmt=v=>v===1?'CONFIRMED':v===.5?'PENDING/NO RESPONSE':'NONE';
const defaults=()=>({version:1,bias:2.5,w:{tsq:-3,ben:-3.5,rev:-2,dup:.5},hi:.8,lo:.1,slaMin:30,trainedOn:0});
/* ADAPTERS: replace with real NIBSS NIP status query, beneficiary-bank confirmation, core-banking ledger lookups. */
const adapters={
 ledger:tx=>({debited:tx.debited}),
 core:tx=>({status:tx.sim==='ok'?'SUCCESS':'FAILED'}),
 nip:tx=>({v:{ok:1,mismatch:1,ghost:0,clean:0,unclear:.5}[tx.sim]??0}),
 beneficiary:tx=>({v:{ok:1,mismatch:1,ghost:0,clean:0,unclear:.5}[tx.sim]??0}),
 reversal:tx=>({v:0}),
 dup:(tx,all)=>({v:all.filter(x=>x.id!==tx.id&&x.uid===tx.uid&&x.ra===tx.ra&&x.amt===tx.amt&&Math.abs(x.ts-tx.ts)<36e5).length?1:0})};
const score=(f,c)=>sig(c.bias+FEATS.reduce((s,k)=>s+c.w[k]*(f[k]||0),0));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function investigate(tx,all,cfg,log,delay=550){
 const L=async(m,k)=>{await log(m,k);await wait(delay)};
 const led=adapters.ledger(tx),core=adapters.core(tx);
 await L(led.debited?'CHECK 1 Ledger: debit of '+tx.amt+' found for ref '+tx.ref+'.':'CHECK 1 Ledger: no debit entry.',led.debited?'w':'k');
 if(!led.debited)return{f:{},p:0,verdict:'no_debit'};
 await L('CHECK 2 Core switch status: '+core.status+'.',core.status==='FAILED'?'w':'k');
 const nip=adapters.nip(tx),ben=adapters.beneficiary(tx),rev=adapters.reversal(tx),dup=adapters.dup(tx,all);
 await L('CHECK 3 NIP status query, session '+tx.sess+': '+(nip.v===1?'APPROVED':nip.v===.5?'PENDING':'NOT FOUND'),nip.v===1?'k':'w');
 await L('CHECK 4 Beneficiary bank ('+tx.rb+') credit: '+fmt(ben.v),ben.v===1?'k':'w');
 await L('CHECK 5 Reversal sweep: '+(rev.v?'reversal found':'no reversal entry within SLA window'),rev.v?'k':'e');
 await L('CHECK 6 Duplicate/fraud screen: '+(dup.v?'similar transfer in last hour':'clear'),dup.v?'w':'k');
 const f={tsq:nip.v,ben:ben.v,rev:rev.v,dup:dup.v},p=score(f,cfg);
 const verdict=p>=cfg.hi?'refund':p<=cfg.lo?'auto_success':'review';
 await L('SCORE p(refund due)='+p.toFixed(3)+' (hi '+cfg.hi+', lo '+cfg.lo+') -> '+verdict.toUpperCase(),verdict==='refund'?'e':verdict==='review'?'w':'k');
 return{f,p,verdict}}
function train(ex,cfg,epochs=300,lr=.3){const c=JSON.parse(JSON.stringify(cfg));if(!ex.length)return c;
 for(let e=0;e<epochs;e++)for(const x of ex){const err=x.y-score(x.f,c);c.bias+=lr*err;FEATS.forEach(k=>c.w[k]+=lr*err*(x.f[k]||0))}
 c.version++;c.trainedOn=ex.length;return c}
return{FEATS,defaults,adapters,score,investigate,train}})();

if (typeof module !== "undefined") module.exports = DTEngine;
