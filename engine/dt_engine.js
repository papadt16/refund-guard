/* DT Engine, standalone copy. Same code as the <script id="dt-engine"> block in app.html.
   Usage: const r = await DTEngine.investigate(tx, allTxs, DTEngine.defaults(), async (msg, kind) => console.log(msg), 0);
   Pass your own adapters as the 6th argument to use real NIBSS / core-banking calls. */
/* ===== DT ENGINE v1 — dependency-free refund-resolution engine =====
   Flow: detect (failed + debited) -> run checks via ADAPTERS -> feature vector -> logistic confidence score -> verdict.
   p = probability a refund is DUE. verdict: p>=hi 'refund' | p<=lo 'auto_success' | else 'review'. Humans always decide refunds.
   Train: DTEngine.train(examples,cfg) where examples=[{f:{tsq,ben,rev,dup},y:0|1}]. */
const DTEngine=(()=>{
const FEATS=['tsq','ben','rev','dup'],sig=x=>1/(1+Math.exp(-x)),fmt=v=>v===1?'CONFIRMED':v===.5?'PENDING/NO RESPONSE':'NONE';
const defaults=()=>({version:1,bias:2.5,w:{tsq:-3,ben:-3.5,rev:-2,dup:.5},hi:.8,lo:.1,slaMin:30,trainedOn:0});
/* ADAPTERS = the ONLY place the engine touches the outside world. Each may be sync or async (return a value or a Promise).
   Real integration map (shape returned -> what to call):
   ledger(tx)      -> {debited:boolean}               core-banking ledger lookup by tx.ref
   core(tx)        -> {status:'SUCCESS'|'FAILED'}     core switch / transaction-service status
   nip(tx)         -> {v:1|.5|0}  1 approved, .5 pending or no response, 0 not found   e.g. NIBSS NIP transaction status query by session id tx.sess
   beneficiary(tx) -> {v:1|.5|0}  1 credit confirmed, .5 unknown, 0 not credited       beneficiary bank confirmation
   reversal(tx)    -> {v:1|0}     1 a reversal entry already exists                    ledger / GL reversal sweep
   dup(tx,all)     -> {v:1|0}     1 similar transfer recently                          duplicate / fraud screen
   The simulated adapters below read tx.sim, which only exists in this demo. Pass your own set as the 6th argument of investigate(). */
const adapters={
 ledger:tx=>({debited:tx.debited}),
 core:tx=>({status:tx.sim==='ok'?'SUCCESS':'FAILED'}),
 nip:tx=>({v:{ok:1,mismatch:1,ghost:0,clean:0,unclear:.5}[tx.sim]??0}),
 beneficiary:tx=>({v:{ok:1,mismatch:1,ghost:0,clean:0,unclear:.5}[tx.sim]??0}),
 reversal:tx=>({v:0}),
 dup:(tx,all)=>({v:all.filter(x=>x.id!==tx.id&&x.uid===tx.uid&&x.ra===tx.ra&&x.amt===tx.amt&&Math.abs(x.ts-tx.ts)<36e5).length?1:0})};
const score=(f,c)=>sig(c.bias+FEATS.reduce((s,k)=>s+c.w[k]*(f[k]||0),0));
const explain=(f,c)=>[...FEATS.map(k=>({k,v:(f||{})[k]||0,w:c.w[k],c:c.w[k]*((f||{})[k]||0)})),{k:'bias',v:1,w:c.bias,c:c.bias}];
const conf=p=>Math.max(p,1-p);
const sla=(cs,now=Date.now())=>cs.status!=='awaiting'||!cs.slaDue?{state:'none'}:now>cs.slaDue?{state:'overdue',mins:Math.ceil((now-cs.slaDue)/6e4)}:{state:'ok',mins:Math.ceil((cs.slaDue-now)/6e4)};
const evaluate=(ex,c)=>{if(!ex.length)return null;let ok=0,L=0;for(const x of ex){const p=Math.min(1-1e-6,Math.max(1e-6,score(x.f||{},c)));if((p>=.5)===(x.y===1))ok++;L-=x.y===1?Math.log(p):Math.log(1-p)}return{n:ex.length,acc:ok/ex.length,loss:L/ex.length}};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function investigate(tx,all,cfg,log,delay=550,ad=adapters){
 const L=async(m,k)=>{await log(m,k);await wait(delay)};
 const led=await ad.ledger(tx),core=await ad.core(tx);
 await L(led.debited?'CHECK 1 Ledger: debit of '+tx.amt+' found for ref '+tx.ref+'.':'CHECK 1 Ledger: no debit entry.',led.debited?'w':'k');
 if(!led.debited)return{f:{},p:0,verdict:'no_debit'};
 await L('CHECK 2 Core switch status: '+core.status+'.',core.status==='FAILED'?'w':'k');
 const [nip,ben,rev,dup]=await Promise.all([ad.nip(tx),ad.beneficiary(tx),ad.reversal(tx),ad.dup(tx,all)]);
 await L('CHECK 3 NIP status query, session '+tx.sess+': '+(nip.v===1?'APPROVED':nip.v===.5?'PENDING':'NOT FOUND'),nip.v===1?'k':'w');
 await L('CHECK 4 Beneficiary bank ('+tx.rb+') credit: '+fmt(ben.v),ben.v===1?'k':'w');
 await L('CHECK 5 Reversal sweep: '+(rev.v?'reversal found':'no reversal entry within SLA window'),rev.v?'k':'e');
 await L('CHECK 6 Duplicate/fraud screen: '+(dup.v?'similar transfer in last hour':'clear'),dup.v?'w':'k');
 const f={tsq:nip.v,ben:ben.v,rev:rev.v,dup:dup.v},p=score(f,cfg);
 const verdict=p>=cfg.hi?'refund':p<=cfg.lo?'auto_success':'review';
 await L('SCORE p(refund due)='+p.toFixed(3)+' (hi '+cfg.hi+', lo '+cfg.lo+') -> '+verdict.toUpperCase(),verdict==='refund'?'e':verdict==='review'?'w':'k');
 return{f,p,verdict}}
function train(ex,cfg,epochs=300,lr=.3){const c=JSON.parse(JSON.stringify(cfg));if(!ex.length)return c;
 const P=defaults(),lam=.02;/* L2 pull towards the defaults so a few decisions cannot send weights to extremes */
 for(let e=0;e<epochs;e++)for(const x of ex){const err=x.y-score(x.f,c);c.bias+=lr*(err-lam*(c.bias-P.bias));FEATS.forEach(k=>c.w[k]+=lr*(err*(x.f[k]||0)-lam*(c.w[k]-P.w[k])))}
 c.before=evaluate(ex,cfg);c.metrics=evaluate(ex,c);c.version++;c.trainedOn=ex.length;return c}
return{FEATS,defaults,adapters,score,explain,conf,sla,evaluate,investigate,train}})();
if(typeof module!=="undefined")module.exports=DTEngine;
