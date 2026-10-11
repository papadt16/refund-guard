/* In-memory Firestore mock: node test/server_test.js */
const assert = require('assert'); const api = require('../api/rg.js');
const store = {};
const ref = p => ({ path: p, async get() { const d = store[p]; return { exists: !!d, data: () => d && JSON.parse(JSON.stringify(d)), id: p.split('/')[1] } }, async set(v) { store[p] = JSON.parse(JSON.stringify(v)) }, async update(v) { if (!store[p]) throw new Error('no doc ' + p); Object.assign(store[p], JSON.parse(JSON.stringify(v))) } });
const col = n => ({ doc: id => ref(n + '/' + id), async add(v) { store[n + '/' + Math.random()] = v }, where: (f, o, v) => ({ async get() { return { docs: Object.keys(store).filter(k => k.startsWith(n + '/') && store[k][f] === v).map(k => ({ data: () => store[k] })) } } }), async get() { return { docs: Object.keys(store).filter(k => k.startsWith(n + '/')).map(k => ({ data: () => store[k] })) } } });
api._setDb({ doc: ref, collection: col, async runTransaction(fn) { const tr = { get: r => r.get(), set: (r, v) => r.set(v), update: (r, v) => r.update(v) }; return fn(tr) } });
const cust = { uid: 'u1', email: 'c@x.com', staff: false }, boss = { uid: 's1', email: 'a@x.com', staff: true }, t = (ctx, b) => api.handle(ctx, b);
(async () => {
  await t(cust, { action: 'signup', name: 'Ada <b>' }); assert.equal(store['users/u1'].bal, 100000); assert.equal(store['users/u1'].name, 'Ada b');
  await t(cust, { action: 'signup', name: 'Hack' }); assert.equal(store['users/u1'].name, 'Ada b', 'signup must not overwrite');
  const base = { action: 'transfer', rn: 'bello', rb: 'OPay', ra: '8108080082', amt: 1500 };
  await assert.rejects(t(cust, { ...base, amt: 999999 }), /Insufficient/); await assert.rejects(t(cust, { ...base, ra: '12' }), /10 digits/);
  let r = await t(cust, { ...base, sim: 'ok' }); assert.equal(store['users/u1'].bal, 98500);
  r = await t(cust, { ...base, sim: 'ghost' }); const cs = Object.values(store).filter(v => v.txid === r.txId)[0]; assert.equal(cs.status, 'awaiting'); assert.equal(cs.verdict, 'refund'); assert.equal(store['users/u1'].bal, 97000);
  r = await t(cust, { ...base, sim: 'mismatch' }); assert.equal(store['txs/' + r.txId].status, 'success'); assert.equal(store['users/u1'].bal, 95500);
  r = await t(cust, { ...base, sim: 'clean' }); assert.equal(store['users/u1'].bal, 95500);
  await assert.rejects(t(cust, { action: 'decide', caseId: cs.id, approve: true }), /Staff only/); await assert.rejects(t(cust, { action: 'staff', type: 'freeze', uid: 'u1', frozen: true }), /Staff only/);
  await t(boss, { action: 'decide', caseId: cs.id, approve: true, note: 'ok' }); assert.equal(store['users/u1'].bal, 97000); assert.equal(store['cases/' + cs.id].status, 'refunded'); assert.equal(store['examples/' + cs.id].y, 1);
  await assert.rejects(t(boss, { action: 'decide', caseId: cs.id, approve: true }), /not awaiting/); assert.equal(store['users/u1'].bal, 97000, 'no double refund');
  const d = await t(cust, { action: 'dispute', txId: Object.values(store).find(v => v.sim === 'ok' && v.uid === 'u1').id, reason: 'x' }); assert.ok(d.caseId);
  await assert.rejects(t({ uid: 'u2', staff: false }, { action: 'dispute', txId: cs.txid }), /not found/);
  await t(boss, { action: 'staff', type: 'train' }); assert.ok(store['engine/config'].trainedOn >= 1);
  /* services: airtime, data (price comes from the server catalog), electricity, betting, validation */
  r = await t(cust, { action: 'transfer', kind: 'airtime', rb: 'MTN', ra: '08031234567', amt: 500, sim: 'ok' }); assert.equal(store['txs/' + r.txId].kind, 'airtime'); assert.equal(store['txs/' + r.txId].rn, 'MTN Airtime'); assert.match(r.message, /Payment successful/);
  const bal = store['users/u1'].bal;
  r = await t(cust, { action: 'transfer', kind: 'data', rb: 'MTN', ra: '08031234567', plan: '2GB · 7 days', amt: 1, sim: 'ghost' }); assert.equal(store['txs/' + r.txId].amt, 1000, 'plan price must come from the catalog'); assert.equal(store['users/u1'].bal, bal - 1000);
  const dc = Object.values(store).find(v => v.txid === r.txId); assert.equal(dc.status, 'awaiting'); assert.equal(dc.verdict, 'refund'); assert.ok(dc.logs.some(l => /Service provider/.test(l.m)), 'engine wording for non-bank services');
  r = await t(cust, { action: 'transfer', kind: 'power', rb: 'IKEDC', ra: '45012345678', mt: 'Postpaid', amt: 2000, sim: 'mismatch' }); assert.equal(store['txs/' + r.txId].status, 'success'); assert.equal(store['txs/' + r.txId].plan, 'Postpaid');
  await assert.rejects(t(cust, { action: 'transfer', kind: 'airtime', rb: 'MTN', ra: '0803', amt: 500 }), /11 digits/); await assert.rejects(t(cust, { action: 'transfer', kind: 'airtime', rb: 'Hack', ra: '08031234567', amt: 500 }), /provider/);
  await assert.rejects(t(cust, { action: 'transfer', kind: 'nope', rb: 'x', ra: '1', amt: 1 }), /Unknown service/); await assert.rejects(t(cust, { action: 'transfer', kind: 'airtime', rb: 'MTN', ra: '08031234567', amt: 10 }), /Minimum/);
  r = await t(cust, { action: 'transfer', kind: 'bet', rb: 'Bet9ja', ra: 'ID123456', amt: 1000, sim: 'clean' }); assert.match(r.message, /not debited/);
  await t(boss, { action: 'staff', type: 'freeze', uid: 'u1', frozen: true }); await assert.rejects(t(cust, { ...base }), /frozen/);
  console.log('ALL SERVER TESTS PASSED');
})().catch(e => { console.error('FAIL', e); process.exit(1) });
