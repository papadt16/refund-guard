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
/* PATTERNS(txs,cases,opts?) -> {banks:[{bank,total,failed,rate,flagged}], customers:[{uid,name,disputes,falseClaims,falseRate,refunds,flagged,reason}]}
   txs=[{id,uid,rb,status,caseId}], cases=[{txid,uid,uname,type,status,verdict}]. A transfer counts as failed if it is failed/refunded now OR was auto-flagged (auto-correction later turns it Successful).
   opts defaults: minTx 3, bankRate .4 (flag a bank at 40% failures), minDisputes 3, falseRate .5 (flag a customer when half their disputes were verified delivered / not debited), minRefunds 3. */
const patterns=(txs,cases,o={})=>{const O={minTx:3,bankRate:.4,minDisputes:3,falseRate:.5,minRefunds:3,...o},cs={};cases.forEach(c=>cs[c.txid]=c);
 const failed=t=>t.status==='failed'||t.status==='refunded'||(cs[t.id]&&cs[t.id].type==='auto'),B={};
 txs.forEach(t=>{const b=B[t.rb]=B[t.rb]||{bank:t.rb,total:0,failed:0};b.total++;if(failed(t))b.failed++});
 const banks=Object.values(B).map(b=>({...b,rate:b.failed/b.total,flagged:b.total>=O.minTx&&b.failed/b.total>=O.bankRate})).sort((a,b)=>b.rate-a.rate||b.total-a.total);
 const U={};cases.forEach(c=>{const u=U[c.uid]=U[c.uid]||{uid:c.uid,name:c.uname,disputes:0,falseClaims:0,refunds:0};if(c.type==='customer'){u.disputes++;if(c.verdict==='auto_success'||c.verdict==='no_debit')u.falseClaims++}if(c.status==='refunded')u.refunds++});
 const customers=Object.values(U).map(u=>{const fr=u.disputes?u.falseClaims/u.disputes:0,r=[];if(u.disputes>=O.minDisputes&&fr>=O.falseRate)r.push(u.falseClaims+' of '+u.disputes+' disputes were verified as delivered or not debited');if(u.refunds>=O.minRefunds)r.push(u.refunds+' refunds approved');return{...u,falseRate:fr,flagged:r.length>0,reason:r.join('; ')}}).sort((a,b)=>(b.flagged-a.flagged)||b.falseClaims-a.falseClaims);
 return{banks,customers}};
/* PARSESETTLEMENT(csvText) -> [{ref,sess,amount,status}] with status normalised to SUCCESS | FAILED | REVERSED | UNKNOWN.
   Header row required. Accepted column names: ref/reference/transactionid/txid, session/sessionid, amount/amt, status/state. */
const parseSettlement=text=>{const lines=String(text).split(String.fromCharCode(10)).map(l=>l.trim()).filter(Boolean);if(lines.length<2)return[];
 const sp=l=>{const o=[];let c='',q=false;for(const ch of l){if(ch==='"')q=!q;else if(ch===','&&!q){o.push(c.trim());c=''}else c+=ch}o.push(c.trim());return o};
 const H=sp(lines[0]).map(h=>h.toLowerCase().replace(/[^a-z]/g,'')),ix=(...n)=>H.findIndex(h=>n.includes(h)),ri=ix('ref','reference','transactionid','txid'),si=ix('session','sessionid'),ai=ix('amount','amt'),ti=ix('status','state');
 const norm=v=>{v=String(v||'').toUpperCase();return /SUCC|APPROV|^00$/.test(v)?'SUCCESS':/REVERS/.test(v)?'REVERSED':/FAIL|DECLIN|REJECT/.test(v)?'FAILED':'UNKNOWN'};
 return lines.slice(1).map(l=>{const c=sp(l);return{ref:ri>=0?c[ri]:'',sess:si>=0?c[si]:'',amount:ai>=0?+String(c[ai]).replace(/[^0-9.-]/g,''):NaN,status:norm(ti>=0?c[ti]:'')}})};
/* RECONCILE(rows,txs) -> {summary:{rows,matched,issues,byKind,unreported}, issues:[{kind,ref,txid,uid,amount,reported,detail,action}]}
   rows = parseSettlement() output (what the switch settled), txs = our ledger. kind: ghost_debit | reversal_not_applied | status_mismatch | amount_mismatch | refunded_but_settled | missing_in_ledger.
   reported = a case already exists for it. action: open_case | review_case | correct_to_success | investigate. Reports only; the caller decides what to apply. */
const reconcile=(rows,txs)=>{const byRef={},bySess={};txs.forEach(t=>{byRef[t.ref]=t;bySess[t.sess]=t});const seen=new Set(),I=[];let matched=0;
 const add=(kind,t,r,detail,action)=>I.push({kind,ref:(t&&t.ref)||(r&&r.ref)||'',txid:t?t.id:null,uid:t?t.uid:null,amount:t?t.amt:(r&&r.amount),reported:!!(t&&t.caseId),detail,action});
 rows.forEach(r=>{const t=byRef[r.ref]||bySess[r.sess];if(!t){if(r.status==='SUCCESS')add('missing_in_ledger',null,r,'Settled by the switch but there is no internal record','investigate');return}
  seen.add(t.id);
  if(!isNaN(r.amount)&&Math.abs(r.amount-t.amt)>.005)add('amount_mismatch',t,r,'Settlement '+r.amount+' vs ledger '+t.amt,'investigate');
  else if(r.status==='SUCCESS'&&t.status==='failed')add('status_mismatch',t,r,'Settled as SUCCESS but our status is FAILED'+(t.debited?' and the customer was debited':''),'correct_to_success');
  else if(r.status==='SUCCESS'&&t.status==='refunded')add('refunded_but_settled',t,r,'Customer was refunded but the transfer settled as SUCCESS','investigate');
  else if((r.status==='FAILED'||r.status==='REVERSED')&&t.debited&&t.status!=='refunded')add(r.status==='REVERSED'?'reversal_not_applied':'ghost_debit',t,r,'Settlement says '+r.status+' but the customer was debited and not refunded',t.caseId?'review_case':'open_case');
  else matched++});
 txs.forEach(t=>{if(seen.has(t.id))return;if(t.debited&&t.status==='failed')add('ghost_debit',t,null,'Debited and failed with no settlement entry',t.caseId?'review_case':'open_case')});
 const by={};I.forEach(i=>by[i.kind]=(by[i.kind]||0)+1);return{summary:{rows:rows.length,matched,issues:I.length,byKind:by,unreported:I.filter(i=>!i.reported&&i.uid).length},issues:I}};
/* SAMPLESETTLEMENT(txs) -> CSV text for demos: builds a fake end-of-day file from tx.sim (demo-only, a real bank supplies the real file). */
const sampleSettlement=txs=>['ref,session,amount,status',...txs.filter(t=>t.sim!=='unclear').map(t=>[t.ref,t.sess,t.amt,t.sim==='ok'||t.sim==='mismatch'?'SUCCESS':'FAILED'].join(','))].join(String.fromCharCode(10));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function investigate(tx,all,cfg,log,delay=550,ad=adapters){
 const L=async(m,k)=>{await log(m,k);await wait(delay)};
 const led=await ad.ledger(tx),core=await ad.core(tx);
 await L(led.debited?'CHECK 1 Ledger: debit of '+tx.amt+' found for ref '+tx.ref+'.':'CHECK 1 Ledger: no debit entry.',led.debited?'w':'k');
 if(!led.debited)return{f:{},p:0,verdict:'no_debit'};
 await L('CHECK 2 Core switch status: '+core.status+'.',core.status==='FAILED'?'w':'k');
 const [nip,ben,rev,dup]=await Promise.all([ad.nip(tx),ad.beneficiary(tx),ad.reversal(tx),ad.dup(tx,all)]);
 await L('CHECK 3 NIP status query, session '+tx.sess+': '+(nip.v===1?'APPROVED':nip.v===.5?'PENDING':'NOT FOUND'),nip.v===1?'k':'w');
 await L((tx.kind&&tx.kind!=='bank'?'CHECK 4 Service provider ('+tx.rb+') delivery: ':'CHECK 4 Beneficiary bank ('+tx.rb+') credit: ')+fmt(ben.v),ben.v===1?'k':'w');
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
return{FEATS,defaults,adapters,score,explain,conf,sla,evaluate,patterns,parseSettlement,reconcile,sampleSettlement,investigate,train}})();

if (typeof module !== "undefined") module.exports = DTEngine;
