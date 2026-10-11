/* RefundGuard server: DT Engine runs here, and every balance/status change happens here (Firebase Admin SDK).
   Clients only READ from Firestore; the security rules deny client writes. One endpoint: POST /api/rg {action,...} with a Firebase ID token. */
const A = () => require('firebase-admin'); /* lazy so the logic can be unit-tested without the SDK */
const E = require('../engine/dt_engine.js');
const { NM, CAT, TIERS, chk, vProf, vPrefs, vBen } = require('./_shared.js');
const crypto = require('crypto');
let db = null;
const getDb = () => db || (db = (A().apps.length || A().initializeApp({ credential: A().credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) }), A().firestore()));
const staffList = () => (process.env.STAFF_EMAILS || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
const rid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const clean = v => String(v || '').replace(/[<>&`\\]/g, '').replace(/'/g, '’').replace(/"/g, '”').trim().slice(0, 60);
const bad = (m, c = 400) => Object.assign(new Error(m), { status: c });
const r2 = n => Math.round(n * 100) / 100, SIMS = ['ok', 'ghost', 'mismatch', 'unclear', 'clean'];
const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const HEAD = () => (process.env.HEAD_EMAIL || 'aigbe208@gmail.com').toLowerCase();
let authAdmin = null, mailer = null;
const getAuth = () => authAdmin || A().auth();
const getMailer = () => mailer || (mailer = (() => { if (!process.env.SMTP_USER || !process.env.SMTP_PASS) throw bad('Email is not configured on the server (set SMTP_USER and SMTP_PASS). See SETUP.md.', 503); const port = +(process.env.SMTP_PORT || 465); return require('nodemailer').createTransport({ host: process.env.SMTP_HOST || 'smtp.gmail.com', port, secure: port === 465, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } }) })());
const money = n => '₦' + Number(n).toLocaleString('en-NG', { minimumFractionDigits: 2 });
const dayStart = () => { const d = new Date(Date.now() + 36e5); d.setUTCHours(0, 0, 0, 0); return d.getTime() - 36e5 }; /* start of today in Lagos (UTC+1) */
const aud = m => db.collection('audit').add({ t: Date.now(), m }).catch(() => {});
const getCfg = async () => { const s = await db.doc('engine/config').get(); return { ...E.defaults(), ...(s.exists ? s.data() : {}) } };
async function notify(to, t, cid, type) { try { const m = NM[type](t, cid.slice(0, 7)), id = 'N' + rid(); await db.doc('notifications/' + id).set({ id, uid: to, caseId: cid, txid: t.id || '', type, subject: m[0], sms: m[1], body: m[2], ts: Date.now(), read: false }) } catch (e) {} }

async function runCase(t, type, note) {
  const C = await getCfg(), us = await db.doc('users/' + t.uid).get(), cid = 'C' + rid(), cref = db.doc('cases/' + cid);
  const logs = [{ t: Date.now(), m: 'Case opened via ' + (type === 'auto' ? 'AUTO-DETECTION (status FAILED + debit present)' : 'CUSTOMER DISPUTE' + (note ? ': "' + note + '"' : '')) + '. DT Engine v' + C.version + ' starting (server).', k: '' }];
  const lg = async (m, k) => { logs.push({ t: Date.now(), m, k: k || '' }) };
  await cref.set({ id: cid, txid: t.id, uid: t.uid, uname: us.exists ? us.data().name : '?', amt: t.amt, type, status: 'investigating', opened: Date.now(), logs: [...logs], note: note || '', verdict: null });
  await db.doc('txs/' + t.id).update({ caseId: cid }); await notify(t.uid, t, cid, 'opened');
  const all = (await db.collection('txs').where('uid', '==', t.uid).get()).docs.map(d => d.data()).filter(x => !x.mirror);
  const r = await E.investigate(t, all, C, lg, 0).catch(async e => { await lg('Engine error: ' + (e && e.message || e) + '. Escalating for manual review.', 'e'); return { f: null, p: .5, verdict: 'review' } });
  const out = { f: r.f, p: r.p, verdict: r.verdict, slaDue: Date.now() + C.slaMin * 6e4 };
  if (r.verdict === 'no_debit') { out.status = 'auto'; await lg('No debit was made on this transfer, so there is nothing to refund. Case closed.', 'k'); await notify(t.uid, t, cid, 'nodebit') }
  else if (r.verdict === 'auto_success') { if (t.status === 'failed') await db.doc('txs/' + t.id).update({ status: 'success' }); out.status = 'auto'; await lg(t.status === 'failed' ? 'Money reached beneficiary. Transaction status corrected FAILED -> SUCCESSFUL. No refund due.' : 'Transfer confirmed as delivered to the beneficiary. No refund due.', 'k'); await notify(t.uid, t, cid, 'verified') }
  else { out.status = 'awaiting'; await lg(r.verdict === 'refund' ? 'Escalated to accountant with REFUND recommendation.' : 'Evidence inconclusive. Escalated to accountant for manual review.', 'w'); await notify(t.uid, t, cid, 'escalated') }
  out.logs = [...logs]; await cref.update(out); await aud('DT Engine finished ' + cid + ': ' + r.verdict); return { caseId: cid, ...out };
}

/* Two-step verification for balance adjustments and account deletion: a one-time code goes to the head accountant's email */
const opPayload = b => { const op = b.op || b.type, uid = String(b.uid || ''), reason = clean(b.reason); if (!uid) throw bad('Choose a customer'); if (!reason) throw bad('Enter a reason');
  if (op === 'adjust') { const amt = r2(+b.amt), dir = b.dir === 'debit' ? 'debit' : 'credit'; if (!(amt > 0) || amt > 5e7) throw bad('Enter a valid amount'); return { op, uid, dir, amt, reason } }
  if (op === 'delete') return { op, uid, reason }; throw bad('Unknown operation') };
async function otpFlow(ctx, b) {
  const pl = opPayload(b), uref = db.doc('users/' + pl.uid), us = await uref.get(); if (!us.exists) throw bad('Customer not found', 404); const u = us.data();
  if (pl.op === 'delete' && (pl.uid === ctx.uid || staffList().includes(String(u.email || '').toLowerCase()))) throw bad('Staff accounts cannot be deleted here');
  if (b.type === 'otp') {
    const code = String(crypto.randomInt(100000, 1000000)), id = 'O' + rid(); await db.doc('otps/' + id).set({ h: sha(code + id), ph: sha(JSON.stringify(pl)), exp: Date.now() + 10 * 6e4, tries: 0, used: false, by: ctx.email });
    const what = pl.op === 'adjust' ? (pl.dir === 'credit' ? 'CREDIT ' : 'DEBIT ') + money(pl.amt) + (pl.dir === 'credit' ? ' to ' : ' from ') : 'DELETE the account of ';
    try { await getMailer().sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to: HEAD(), subject: 'RefundGuard verification code: ' + code, text: ctx.email + ' is requesting to ' + what + u.name + ' (' + u.acct + ').\nReason: ' + pl.reason + '\n\nVerification code: ' + code + '\nIt expires in 10 minutes. If you did not expect this request, ignore this email and do not share the code.' }) }
    catch (e) { await db.doc('otps/' + id).delete().catch(() => {}); if (e.status) throw e; console.error(e); throw bad('Could not send the verification email', 502) }
    await aud('OTP requested by ' + ctx.email + ' for ' + pl.op + ' on ' + u.name); const h = HEAD(); return { otpId: id, to: h[0] + '***' + h.slice(h.indexOf('@') - 1), message: 'Code sent' };
  }
  const oref = db.doc('otps/' + String(b.otpId || '')); let fail = null;
  await db.runTransaction(async tr => { const o = await tr.get(oref); if (!o.exists) throw bad('Request a new code'); const d = o.data();
    if (d.used || d.exp < Date.now() || d.tries >= 5 || d.by !== ctx.email) throw bad('This code has expired or was already used. Request a new one.');
    if (d.ph !== sha(JSON.stringify(pl))) throw bad('This code was issued for a different request');
    if (d.h !== sha(String(b.code || '').trim() + o.id)) { tr.update(oref, { tries: d.tries + 1 }); fail = 'Incorrect code'; return } tr.update(oref, { used: true }) });
  if (fail) throw bad(fail);
  if (pl.op === 'adjust') {
    let nb; const id = 'T' + rid();
    await db.runTransaction(async tr => { const s = await tr.get(uref); if (!s.exists) throw bad('Customer not found', 404); const x = s.data(); nb = r2(x.bal + (pl.dir === 'credit' ? pl.amt : -pl.amt)); if (nb < 0) throw bad('Insufficient balance to debit that amount');
      tr.update(uref, { bal: nb }); tr.set(db.doc('txs/' + id), { id, uid: pl.uid, amt: pl.amt, rn: pl.dir === 'credit' ? 'RefundGuard credit' : 'RefundGuard debit', reason: pl.reason, rb: 'RefundGuard', ra: x.acct, kind: 'adjust', dir: pl.dir === 'credit' ? 'in' : 'out', sess: 'ADJ' + Date.now(), ref: rid().slice(0, 11), ts: Date.now(), sim: 'ok', status: 'success', debited: pl.dir === 'debit', caseId: null }) });
    await aud(ctx.email + ' ' + pl.dir + 'ed ' + pl.amt + ' on ' + u.name + ' (' + pl.reason + '), 2-step verified'); return { message: 'Balance updated to ' + money(nb) };
  }
  await db.doc('accts/' + u.acct).delete().catch(() => {}); for (const d of (await db.collection('ids').where('uid', '==', pl.uid).get()).docs) await d.ref.delete();
  try { await getAuth().deleteUser(pl.uid) } catch (e) { if (e.code !== 'auth/user-not-found') console.error(e) }
  await uref.delete(); await aud(ctx.email + ' deleted account ' + u.acct + ' (' + u.name + ': ' + pl.reason + '), 2-step verified'); return { message: 'Account deleted' };
}

async function handle(ctx, b) {
  getDb(); const need = () => { if (!ctx.staff) throw bad('Staff only', 403) };
  switch (b.action) {
    case 'signup': {
      const name = clean(b.name); if (!name) throw bad('Enter your name'); const ref = db.doc('users/' + ctx.uid);
      let made = false;
      for (let i = 0; i < 12 && !made; i++) { /* account numbers are unique: reserve one in accts/{number} atomically */
        const acct = '20' + Math.floor(1e7 + Math.random() * 9e7), aref = db.doc('accts/' + acct);
        await db.runTransaction(async tr => { if ((await tr.get(ref)).exists) { made = true; return } if ((await tr.get(aref)).exists) return;
          tr.set(aref, { uid: ctx.uid }); tr.set(ref, { name, email: ctx.email, acct, bal: 0, tier: 1, frozen: false, created: Date.now() }); made = true });
      }
      if (!made) throw bad('Could not allocate an account number. Try again.', 500);
      await aud('New customer ' + name); return {};
    }
    case 'lookup': {
      const ra = String(b.ra || '').replace(/\D/g, ''); if (ra.length !== 10) throw bad('Enter a 10-digit account number');
      const a = await db.doc('accts/' + ra).get(); if (!a.exists) throw bad('No ' + 'RefundGuard account with that number', 404);
      const u = await db.doc('users/' + a.data().uid).get(); if (!u.exists) throw bad('No RefundGuard account with that number', 404);
      if (a.data().uid === ctx.uid) throw bad('That is your own account number'); return { name: u.data().name.toUpperCase() };
    }
    case 'upgrade': {
      const to = +b.to, ref = db.doc('users/' + ctx.uid), s = await ref.get(); if (!s.exists) throw bad('Create your account first'); const u = s.data(), cur = u.tier || 1;
      if (to !== cur + 1 || to > 3) throw bad('You can only upgrade one tier at a time');
      const miss = to === 2 ? [!u.phone && 'a mobile number', !u.bvnOk && 'a verified BVN'] : [!u.ninOk && 'a verified NIN', !u.address && 'your address', !u.photo && 'a profile picture'];
      const need = miss.filter(Boolean); if (need.length) throw bad('To upgrade to Tier ' + to + ' add ' + need.join(', '));
      await ref.update({ tier: to }); await aud(u.name + ' upgraded to Tier ' + to); return { message: 'Upgraded to Tier ' + to };
    }
    case 'transfer': {
      const v = chk(b.kind || 'bank', b); if (v.err) throw bad(v.err); const { ra, amt, rb } = v; let rn = v.rn; const wd = v.kind === 'bank' ? 'Transfer' : 'Payment';
      const sim = process.env.TEST_MODE === 'off' ? 'ok' : (SIMS.includes(b.sim) ? b.sim : 'ok');
      if (amt > 5e6) throw bad('Amount exceeds the transfer limit');
      let rcv = null; if (v.kind === 'bank' && rb === 'RefundGuard') { const a = await db.doc('accts/' + ra).get(); if (!a.exists) throw bad('No RefundGuard account with that number'); if (a.data().uid === ctx.uid) throw bad('You cannot send money to yourself'); rcv = a.data().uid }
      const uref = db.doc('users/' + ctx.uid), id = 'T' + rid(); let t, u, mirror = null;
      const today = (await db.collection('txs').where('uid', '==', ctx.uid).get()).docs.map(d => d.data()).filter(x => x.ts >= dayStart() && x.debited && x.dir !== 'in' && x.status !== 'refunded').reduce((s, x) => s + x.amt, 0);
      await db.runTransaction(async tr => {
        const s = await tr.get(uref); if (!s.exists) throw bad('Create your account first'); u = s.data();
        let rs = null; if (rcv) { rs = await tr.get(db.doc('users/' + rcv)); if (!rs.exists) throw bad('No RefundGuard account with that number'); rn = rs.data().name.toUpperCase() }
        const tier = u.tier || 1, L = TIERS[tier];
        if (u.frozen) throw bad('Account frozen. Contact the bank.');
        if (amt > L.per) throw bad('Your Tier ' + tier + ' limit is ' + money(L.per) + ' per transaction. Upgrade your account to send more.');
        if (today + amt > L.day) throw bad('This would exceed your Tier ' + tier + ' daily limit of ' + money(L.day) + '.');
        if (amt > u.bal) throw bad('Insufficient balance');
        t = { id, uid: ctx.uid, amt, rn, rb, ra, kind: v.kind, plan: v.plan, nar: v.nar, sess: '1000332' + Date.now() + Math.floor(Math.random() * 1e5), ref: rid().slice(0, 11), ts: Date.now(), sim, status: sim === 'ok' ? 'success' : 'failed', debited: sim !== 'clean', caseId: null };
        if (t.debited) tr.update(uref, { bal: r2(u.bal - amt) }); tr.set(db.doc('txs/' + id), t);
        if (rs && (sim === 'ok' || sim === 'mismatch')) { /* money really lands with the recipient (a 'mismatch' is marked failed on the sender's side, which DT Engine later corrects) */
          tr.update(db.doc('users/' + rcv), { bal: r2(rs.data().bal + amt) });
          mirror = { id: 'T' + rid() + 'i', uid: rcv, amt, rn: u.name.toUpperCase(), rb: 'RefundGuard', ra: u.acct, kind: 'bank', dir: 'in', mirror: true, peer: id, nar: v.nar || '', sess: t.sess, ref: rid().slice(0, 11), ts: t.ts, sim: 'ok', status: 'success', debited: false, caseId: null }; tr.set(db.doc('txs/' + mirror.id), mirror) }
      });
      await aud('Transfer ' + id + ' ' + amt + ' by ' + u.name + ' -> ' + t.status);
      if (t.status === 'failed' && t.debited) { await runCase(t, 'auto'); return { txId: id, message: wd + ' failed. You were debited — DT Engine has flagged it automatically.' } }
      return { txId: id, message: t.status === 'success' ? wd + ' successful' : wd + ' failed. You were not debited.' };
    }
    case 'profile': {
      const v = vProf(b); if (v.err) throw bad(v.err); const r = db.doc('users/' + ctx.uid); if (!(await r.get()).exists) throw bad('Create your account first'); const o = v.o;
      for (const k of ['bvn', 'nin']) if (o[k]) { /* demo verification: format only. Keep last 4 + a hash used to stop one ID being linked to two accounts */
        const raw = o[k], h = sha(k + ':' + raw), iref = db.doc('ids/' + h), x = await iref.get(); if (x.exists && x.data().uid !== ctx.uid) throw bad('This ' + k.toUpperCase() + ' is already linked to another account');
        await iref.set({ uid: ctx.uid, k }); delete o[k]; o[k + 'Ok'] = true; o[k + 'Last4'] = raw.slice(-4); o[k + 'At'] = Date.now() }
      if (o.email) { try { await getAuth().updateUser(ctx.uid, { email: o.email }) } catch (e) { throw bad(e.code === 'auth/email-already-exists' ? 'That email is already in use' : 'Could not update the email') } }
      await r.update(o); return { message: 'Saved' };
    }
    case 'prefs': {
      const v = vPrefs(b); if (v.err) throw bad(v.err); const r = db.doc('users/' + ctx.uid);
      await db.runTransaction(async tr => { const x = await tr.get(r); if (!x.exists) throw bad('Create your account first'); tr.update(r, { prefs: { ...(x.data().prefs || {}), ...v.o } }) }); return { message: 'Saved' }
    }
    case 'ben': {
      const r = db.doc('users/' + ctx.uid), v = b.remove ? null : vBen(b); if (v && v.err) throw bad(v.err);
      await db.runTransaction(async tr => { const x = await tr.get(r); if (!x.exists) throw bad('Create your account first'); let l = x.data().bens || []; l = b.remove ? l.filter(i => i.id !== String(b.remove)) : [v.o, ...l.filter(i => i.id !== v.o.id)].slice(0, 30); tr.update(r, { bens: l }) }); return { message: 'Saved' }
    }
    case 'dispute': {
      const ts = await db.doc('txs/' + String(b.txId)).get(); if (!ts.exists || ts.data().uid !== ctx.uid) throw bad('Transaction not found', 404);
      if (ts.data().dir === 'in' || ts.data().kind === 'adjust') throw bad('This transaction cannot be disputed'); if (ts.data().caseId) throw bad('A case already exists for this transaction'); const r = await runCase(ts.data(), 'customer', clean(b.reason)); return { caseId: r.caseId };
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
      if (b.type === 'otp' || b.type === 'adjust' || b.type === 'delete') return otpFlow(ctx, b);
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
module.exports.handle = handle; module.exports._setDb = d => { db = d }; module.exports._setAuth = a => { authAdmin = a }; module.exports._setMailer = m => { mailer = m };
