/* RefundGuard server: DT Engine runs here, and every balance/status change happens here (Firebase Admin SDK).
   Clients only READ from Firestore; the security rules deny client writes. One endpoint: POST /api/rg {action,...} with a Firebase ID token. */
const A = () => require('firebase-admin'); /* lazy so the logic can be unit-tested without the SDK */
const E = require('../engine/dt_engine.js');
const { NM } = require('./_shared.js');
let db = null;
const getDb = () => db || (db = (A().apps.length || A().initializeApp({ credential: A().credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) }), A().firestore()));
const staffList = () => (process.env.STAFF_EMAILS || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
const rid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const clean = v => String(v || '').replace(/[<>&`\\]/g, '').replace(/'/g, '’').replace(/"/g, '”').trim().slice(0, 60);
const bad = (m, c = 400) => Object.assign(new Error(m), { status: c });
const r2 = n => Math.round(n * 100) / 100, SIMS = ['ok', 'ghost', 'mismatch', 'unclear', 'clean'];
const aud = m => db.collection('audit').add({ t: Date.now(), m }).catch(() => {});
const getCfg = async () => { const s = await db.doc('engine/config').get(); return { ...E.defaults(), ...(s.exists ? s.data() : {}) } };
async function notify(to, t, cid, type) { try { const m = NM[type](t, cid.slice(0, 7)), id = 'N' + rid(); await db.doc('notifications/' + id).set({ id, uid: to, caseId: cid, txid: t.id || '', type, subject: m[0], sms: m[1], body: m[2], ts: Date.now(), read: false }) } catch (e) {} }

async function runCase(t, type, note) {
  const C = await getCfg(), us = await db.doc('users/' + t.uid).get(), cid = 'C' + rid(), cref = db.doc('cases/' + cid);
  const logs = [{ t: Date.now(), m: 'Case opened via ' + (type === 'auto' ? 'AUTO-DETECTION (status FAILED + debit present)' : 'CUSTOMER DISPUTE' + (note ? ': "' + note + '"' : '')) + '. DT Engine v' + C.version + ' starting (server).', k: '' }];
  const lg = async (m, k) => { logs.push({ t: Date.now(), m, k: k || '' }) };
  await cref.set({ id: cid, txid: t.id, uid: t.uid, uname: us.exists ? us.data().name : '?', amt: t.amt, type, status: 'investigating', opened: Date.now(), logs: [...logs], note: note || '', verdict: null });
  await db.doc('txs/' + t.id).update({ caseId: cid }); await notify(t.uid, t, cid, 'opened');
  const all = (await db.collection('txs').where('uid', '==', t.uid).get()).docs.map(d => d.data());
  const r = await E.investigate(t, all, C, lg, 0).catch(async e => { await lg('Engine error: ' + (e && e.message || e) + '. Escalating for manual review.', 'e'); return { f: null, p: .5, verdict: 'review' } });
  const out = { f: r.f, p: r.p, verdict: r.verdict, slaDue: Date.now() + C.slaMin * 6e4 };
  if (r.verdict === 'no_debit') { out.status = 'auto'; await lg('No debit was made on this transfer, so there is nothing to refund. Case closed.', 'k'); await notify(t.uid, t, cid, 'nodebit') }
  else if (r.verdict === 'auto_success') { if (t.status === 'failed') await db.doc('txs/' + t.id).update({ status: 'success' }); out.status = 'auto'; await lg(t.status === 'failed' ? 'Money reached beneficiary. Transaction status corrected FAILED -> SUCCESSFUL. No refund due.' : 'Transfer confirmed as delivered to the beneficiary. No refund due.', 'k'); await notify(t.uid, t, cid, 'verified') }
  else { out.status = 'awaiting'; await lg(r.verdict === 'refund' ? 'Escalated to accountant with REFUND recommendation.' : 'Evidence inconclusive. Escalated to accountant for manual review.', 'w'); await notify(t.uid, t, cid, 'escalated') }
  out.logs = [...logs]; await cref.update(out); await aud('DT Engine finished ' + cid + ': ' + r.verdict); return { caseId: cid, ...out };
}

async function handle(ctx, b) {
  getDb(); const need = () => { if (!ctx.staff) throw bad('Staff only', 403) };
  switch (b.action) {
    case 'signup': {
      const name = clean(b.name); if (!name) throw bad('Enter your name'); const ref = db.doc('users/' + ctx.uid);
      await db.runTransaction(async tr => { if ((await tr.get(ref)).exists) return; tr.set(ref, { name, email: ctx.email, acct: '20' + Math.floor(1e7 + Math.random() * 9e7), bal: 100000, frozen: false, created: Date.now() }) });
      await aud('New customer ' + name); return {};
    }
    case 'transfer': {
      const rn = clean(b.rn).toUpperCase(), ra = String(b.ra || '').replace(/\D/g, ''), amt = r2(+b.amt), rb = clean(b.rb);
      const sim = process.env.TEST_MODE === 'off' ? 'ok' : (SIMS.includes(b.sim) ? b.sim : 'ok');
      if (!rn || !rb || !(amt > 0)) throw bad('Fill all fields'); if (ra.length !== 10) throw bad('Account number must be 10 digits'); if (amt > 5e6) throw bad('Amount exceeds the transfer limit');
      const uref = db.doc('users/' + ctx.uid), id = 'T' + rid(); let t, u;
      await db.runTransaction(async tr => {
        const s = await tr.get(uref); if (!s.exists) throw bad('Create your account first'); u = s.data();
        if (u.frozen) throw bad('Account frozen. Contact the bank.'); if (amt > u.bal) throw bad('Insufficient balance');
        t = { id, uid: ctx.uid, amt, rn, rb, ra, sess: '1000332' + Date.now() + Math.floor(Math.random() * 1e5), ref: rid().slice(0, 11), ts: Date.now(), sim, status: sim === 'ok' ? 'success' : 'failed', debited: sim !== 'clean', caseId: null };
        if (t.debited) tr.update(uref, { bal: r2(u.bal - amt) }); tr.set(db.doc('txs/' + id), t);
      });
      await aud('Transfer ' + id + ' ' + amt + ' by ' + u.name + ' -> ' + t.status);
      if (t.status === 'failed' && t.debited) { await runCase(t, 'auto'); return { txId: id, message: 'Transfer failed. You were debited — DT Engine has flagged it automatically.' } }
      return { txId: id, message: t.status === 'success' ? 'Transfer successful' : 'Transfer failed. You were not debited.' };
    }
    case 'dispute': {
      const ts = await db.doc('txs/' + String(b.txId)).get(); if (!ts.exists || ts.data().uid !== ctx.uid) throw bad('Transaction not found', 404);
      if (ts.data().caseId) throw bad('A case already exists for this transaction'); const r = await runCase(ts.data(), 'customer', clean(b.reason)); return { caseId: r.caseId };
    }
    case 'decide': {
      need(); const id = String(b.caseId), y = !!b.approve, note = clean(b.note), cref = db.doc('cases/' + id); let c, t;
      await db.runTransaction(async tr => {
        const cs = await tr.get(cref); if (!cs.exists) throw bad('Case not found', 404); c = cs.data();
        if (c.status !== 'awaiting') throw bad('This case is not awaiting a decision');
        const tref = db.doc('txs/' + c.txid), uref = db.doc('users/' + c.uid), [ts, us] = await Promise.all([tr.get(tref), tr.get(uref)]); t = ts.data();
        if (y) { tr.update(uref, { bal: r2(us.data().bal + c.amt) }); tr.update(tref, { status: 'refunded' }) }
        tr.update(cref, { status: y ? 'refunded' : 'rejected', acctNote: note, decidedBy: ctx.email, decidedAt: Date.now(), logs: [...c.logs, { t: Date.now(), m: 'ACCOUNTANT DECISION (' + ctx.email + '): ' + (y ? 'REFUND APPROVED, ' + c.amt + ' credited' : 'REFUND REJECTED') + (note ? ' — ' + note : ''), k: y ? 'k' : 'e' }] });
        if (c.f) tr.set(db.doc('examples/' + id), { f: c.f, y: y ? 1 : 0, ts: Date.now() });
      });
      await notify(c.uid, t, id, y ? 'refunded' : 'rejected'); await aud('Case ' + id + (y ? ' refunded' : ' rejected') + ' by ' + ctx.email); return {};
    }
    case 'staff': {
      need(); const C = await getCfg();
      if (b.type === 'freeze') { await db.doc('users/' + String(b.uid)).update({ frozen: !!b.frozen }); await aud((b.frozen ? 'Froze ' : 'Unfroze ') + b.uid); return {} }
      if (b.type === 'reset') { await db.doc('engine/config').set(E.defaults()); await aud('DT Engine reset to defaults'); return { message: 'Reset to defaults' } }
      if (b.type === 'cfg') { const hi = +b.hi, lo = +b.lo, sl = Math.round(+b.sl); if (!(lo > 0 && lo < hi && hi < 1) || !(sl >= 1)) throw bad('Need 0 < low < high < 1 and an SLA of at least 1 minute'); await db.doc('engine/config').set({ ...C, hi, lo, slaMin: sl }); await aud('DT Engine settings: high ' + hi + ', low ' + lo + ', SLA ' + sl + 'm'); return { message: 'Engine settings saved' } }
      if (b.type === 'train') { const ex = (await db.collection('examples').get()).docs.map(d => d.data()); if (!ex.length) throw bad('No decisions to learn from yet'); const c = E.train(ex.map(e => ({ f: e.f, y: e.y })), C); await db.doc('engine/config').set(c); await aud('DT Engine retrained on ' + c.trainedOn + ' examples'); return { message: 'DT Engine retrained on ' + c.trainedOn + ' examples (v' + c.version + ')' } }
      if (b.type === 'recon') {
        const ts = await db.doc('txs/' + String(b.txid)).get(); if (!ts.exists) throw bad('Transaction not found', 404); const t = ts.data();
        if (b.action === 'correct_to_success') { if (t.status !== 'failed') throw bad('Only failed transactions can be corrected'); await db.doc('txs/' + t.id).update({ status: 'success' }); await aud('Reconciliation: ' + t.ref + ' corrected to Successful'); return { message: 'Status corrected to Successful' } }
        if (b.action === 'open_case') { if (t.caseId) throw bad('A case already exists'); await runCase(t, 'auto'); return { message: 'Case opened. DT Engine has checked it.' } }
      }
      throw bad('Unknown staff action');
    }
  }
  throw bad('Unknown action');
}

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') throw bad('POST only', 405); getDb();
    const tok = await A().auth().verifyIdToken((req.headers.authorization || '').replace(/^Bearer /, '')), email = (tok.email || '').toLowerCase();
    const out = await handle({ uid: tok.uid, email, staff: staffList().includes(email) }, req.body || {}); res.status(200).json({ ok: true, ...out });
  } catch (e) { const code = e.status || (/^auth\//.test(e.code || '') ? 401 : 500); if (code === 500) console.error(e); res.status(code).json({ error: code === 500 ? 'Server error' : e.message }) }
};
module.exports.handle = handle; module.exports._setDb = d => { db = d };
