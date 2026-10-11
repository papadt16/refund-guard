/* In-memory Firestore mock: node test/server_test.js */
const assert = require('assert'); const api = require('../api/rg.js');
const store = {}; const J = v => JSON.parse(JSON.stringify(v));
const ref = p => ({ path: p, async get() { const d = store[p]; return { exists: !!d, data: () => d && J(d), id: p.split('/')[1] } }, async set(v) { store[p] = J(v) }, async update(v) { if (!store[p]) throw new Error('no doc ' + p); Object.assign(store[p], J(v)) }, async delete() { delete store[p] } });
const docsOf = (n, f) => Object.keys(store).filter(k => k.startsWith(n + '/') && f(store[k])).map(k => ({ data: () => store[k], ref: ref(k) }));
const col = n => ({ doc: id => ref(n + '/' + id), async add(v) { store[n + '/' + Math.random()] = v }, where: (f, o, v) => ({ async get() { return { docs: docsOf(n, d => d[f] === v) } } }), async get() { return { docs: docsOf(n, () => true) } } });
api._setDb({ doc: ref, collection: col, async runTransaction(fn) { const tr = { get: r => r.get(), set: (r, v) => r.set(v), update: (r, v) => r.update(v) }; return fn(tr) } });
const authCalls = []; api._setAuth({ updateUser: async (u, o) => { if (o.email === 'taken@x.com') throw Object.assign(new Error('x'), { code: 'auth/email-already-exists' }); authCalls.push(['update', u, o.email]) }, deleteUser: async u => authCalls.push(['delete', u]) });
let mails = []; api._setMailer({ sendMail: async m => mails.push(m) });
const mk = (uid, email, staff) => ({ uid, email, staff: !!staff }), ada = mk('u1', 'ada@x.com'), bob = mk('u2', 'bob@x.com'), boss = mk('s1', 'aigbe208@gmail.com', true), t = (c, b) => api.handle(c, b);
const lastCode = () => mails[mails.length - 1].text.match(/Verification code: (\d{6})/)[1];
async function fund(uid, amt) { const r = await t(boss, { action: 'staff', type: 'otp', op: 'adjust', uid, dir: 'credit', amt, reason: 'seed' }); return t(boss, { action: 'staff', type: 'adjust', uid, dir: 'credit', amt, reason: 'seed', otpId: r.otpId, code: lastCode() }) }
(async () => {
  await t(ada, { action: 'signup', name: 'Ada <b>' }); await t(bob, { action: 'signup', name: 'Bob' });
  assert.equal(store['users/u1'].bal, 0, 'new accounts start at zero'); assert.equal(store['users/u1'].name, 'Ada b'); assert.notEqual(store['users/u1'].acct, store['users/u2'].acct, 'unique account numbers');
  await t(ada, { action: 'signup', name: 'Hack' }); assert.equal(store['users/u1'].name, 'Ada b', 'signup must not overwrite');
  const acct = store['users/u1'].acct; assert.equal(store['accts/' + acct].uid, 'u1');
  /* OTP: zero balance, staff-only, wrong code, replay, tampered payload */
  await assert.rejects(t(ada, { action: 'staff', type: 'otp', op: 'adjust', uid: 'u1', amt: 5, reason: 'x' }), /Staff only/);
  const o = await t(boss, { action: 'staff', type: 'otp', op: 'adjust', uid: 'u1', dir: 'credit', amt: 100000, reason: 'seed' }); assert.equal(mails[0].to, 'aigbe208@gmail.com'); assert.ok(!JSON.stringify(o).includes(lastCode()), 'code never returned to the browser');
  await assert.rejects(t(boss, { action: 'staff', type: 'adjust', uid: 'u1', dir: 'credit', amt: 100000, reason: 'seed', otpId: o.otpId, code: '000000' }), /Incorrect/);
  await assert.rejects(t(boss, { action: 'staff', type: 'adjust', uid: 'u1', dir: 'credit', amt: 999999, reason: 'seed', otpId: o.otpId, code: lastCode() }), /different request/);
  await t(boss, { action: 'staff', type: 'adjust', uid: 'u1', dir: 'credit', amt: 100000, reason: 'seed', otpId: o.otpId, code: lastCode() }); assert.equal(store['users/u1'].bal, 100000);
  await assert.rejects(t(boss, { action: 'staff', type: 'adjust', uid: 'u1', dir: 'credit', amt: 100000, reason: 'seed', otpId: o.otpId, code: lastCode() }), /expired or was already used/);
  await fund('u2', 20000); assert.equal(store['users/u2'].bal, 20000);
  const adj = Object.values(store).find(v => v.kind === 'adjust' && v.uid === 'u1'); assert.equal(adj.dir, 'in');
  /* tier limits */
  const base = { action: 'transfer', rn: 'bello', rb: 'OPay', ra: '8108080082', amt: 1500 };
  await assert.rejects(t(ada, { ...base, amt: 60000 }), /Tier 1 limit/); await assert.rejects(t(ada, { ...base, ra: '12' }), /10 digits/);
  let r = await t(ada, { ...base, sim: 'ok' }); assert.equal(store['users/u1'].bal, 98500);
  /* RefundGuard internal transfer + lookup */
  const lk = await t(ada, { action: 'lookup', ra: store['users/u2'].acct }); assert.equal(lk.name, 'BOB'); await assert.rejects(t(ada, { action: 'lookup', ra: acct }), /own account/); await assert.rejects(t(ada, { action: 'lookup', ra: '2000000000' }), /No RefundGuard/);
  const rg = { action: 'transfer', rb: 'RefundGuard', ra: store['users/u2'].acct, rn: 'WRONG NAME', amt: 5000 };
  r = await t(ada, { ...rg, sim: 'ok' }); assert.equal(store['users/u1'].bal, 93500); assert.equal(store['users/u2'].bal, 25000); assert.equal(store['txs/' + r.txId].rn, 'BOB', 'name comes from the server');
  const mir = Object.values(store).find(v => v.mirror && v.uid === 'u2'); assert.equal(mir.dir, 'in'); assert.equal(mir.rn, 'ADA B');
  await assert.rejects(t(ada, { ...rg, ra: acct }), /yourself/); await assert.rejects(t(bob, { action: 'dispute', txId: mir.id }), /cannot be disputed/);
  r = await t(ada, { ...rg, sim: 'ghost' }); const cs = Object.values(store).find(v => v.txid === r.txId); assert.equal(cs.status, 'awaiting'); assert.equal(store['users/u2'].bal, 25000, 'ghost: recipient not credited'); assert.equal(store['users/u1'].bal, 88500);
  r = await t(ada, { ...rg, sim: 'mismatch' }); assert.equal(store['txs/' + r.txId].status, 'success'); assert.equal(store['users/u2'].bal, 30000, 'mismatch: recipient credited, engine corrects');
  await t(boss, { action: 'decide', caseId: cs.id, approve: true, note: 'ok' }); assert.equal(store['users/u1'].bal, 88500 + 5000 - 5000 + 5000 - 5000 + 5000 - 5000 + 0 || store['users/u1'].bal);
  await assert.rejects(t(boss, { action: 'decide', caseId: cs.id, approve: true }), /not awaiting/);
  /* profile: name, email, BVN/NIN uniqueness, photo, tiers */
  await t(ada, { action: 'profile', name: 'Ada Obi', phone: '08012345678' }); assert.equal(store['users/u1'].name, 'Ada Obi');
  await t(ada, { action: 'profile', email: 'new@x.com' }); assert.deepEqual(authCalls[0], ['update', 'u1', 'new@x.com']); await assert.rejects(t(ada, { action: 'profile', email: 'taken@x.com' }), /already in use/);
  await assert.rejects(t(ada, { action: 'profile', bvn: '123' }), /11 digits/); await t(ada, { action: 'profile', bvn: '12345678901' });
  assert.equal(store['users/u1'].bvnOk, true); assert.equal(store['users/u1'].bvnLast4, '8901'); assert.ok(!JSON.stringify(store).includes('12345678901'), 'raw BVN never stored');
  await assert.rejects(t(bob, { action: 'profile', bvn: '12345678901' }), /already linked/);
  await assert.rejects(t(ada, { action: 'upgrade', to: 3 }), /one tier/); await t(ada, { action: 'upgrade', to: 2 }); assert.equal(store['users/u1'].tier, 2);
  await assert.rejects(t(ada, { action: 'upgrade', to: 3 }), /NIN|address|picture/); await t(ada, { action: 'transfer', ...base, amt: 60000, sim: 'ok' });
  await assert.rejects(t(ada, { action: 'profile', photo: 'data:text/html;base64,AAA' }), /smaller image/); await t(ada, { action: 'profile', photo: 'data:image/jpeg;base64,/9j/4AAQ' });
  /* delete needs OTP, frees the account number, removes auth user */
  const d1 = { action: 'staff', type: 'delete', uid: 'u2', reason: 'closed' }, od = await t(boss, { ...d1, type: 'otp', op: 'delete' });
  await assert.rejects(t(boss, { ...d1, otpId: od.otpId, code: '111111' }), /Incorrect/); await t(boss, { ...d1, otpId: od.otpId, code: lastCode() });
  assert.ok(!store['users/u2'] && !store['accts/' + lk.acct]); assert.ok(authCalls.some(c => c[0] === 'delete' && c[1] === 'u2')); await assert.rejects(t(ada, { action: 'lookup', ra: '1' }), /10-digit/);
  await t(boss, { action: 'staff', type: 'freeze', uid: 'u1', frozen: true }); await assert.rejects(t(ada, { ...base }), /frozen/);
  console.log('ALL SERVER TESTS PASSED');
})().catch(e => { console.error('FAIL', e); process.exit(1) });
