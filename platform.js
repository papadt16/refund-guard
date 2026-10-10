/* Standalone runtime for the web build: Firebase Auth (email + password, with password reset) + Firestore (read-only from the browser)
   + window.api() for every change, which runs on the server (api/rg.js). Exposes window.claude.use('db'|'user'|'downloads') so app.html runs unchanged. */
(() => {
  const cfg = window.FIREBASE_CONFIG, emails = (window.STAFF_EMAILS || []).map(e => e.toLowerCase());
  const STAFF = () => location.hash === '#accountant', bad = !cfg || !cfg.apiKey || /PASTE/.test(cfg.apiKey);
  const $ = id => document.getElementById(id), msg = h => { const a = $('app'); if (a) a.innerHTML = h };
  let auth, fs, ready; window.API_MODE = true;
  const init = () => { if (auth) return; firebase.initializeApp(cfg); auth = firebase.auth(); fs = firebase.firestore() };
  const first = () => new Promise(r => { let done = false, off = null; off = auth.onAuthStateChanged(u => { if (done) return; done = true; r(u); if (off) off() }); if (done) off() });
  window.api = async (action, body) => {
    const u = auth && auth.currentUser; if (!u) throw new Error('Please sign in again');
    const r = await fetch('/api/rg', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + await u.getIdToken() }, body: JSON.stringify({ action, ...body }) });
    const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Request failed (' + r.status + ')'); return j;
  };
  const ERR = { 'auth/invalid-credential': 'Incorrect email or password.', 'auth/wrong-password': 'Incorrect email or password.', 'auth/user-not-found': 'Incorrect email or password.', 'auth/invalid-email': 'Enter a valid email address.', 'auth/email-already-in-use': 'An account with this email already exists. Try signing in.', 'auth/weak-password': 'Password must be at least 6 characters.', 'auth/too-many-requests': 'Too many attempts. Wait a few minutes or reset your password.', 'auth/network-request-failed': 'Network problem. Check your connection.', 'auth/operation-not-allowed': 'Email/password sign-in is not enabled in Firebase.' };
  const CSS = `<style>.au{display:grid;grid-template-columns:1fr 1fr;max-width:880px;margin:20px auto;background:var(--card);border:1px solid var(--bd);border-radius:18px;overflow:hidden;min-height:500px;box-shadow:0 10px 40px #0002}.au-b{background:linear-gradient(150deg,#c8102e,#5c0716);color:#fff;padding:36px;display:flex;flex-direction:column;justify-content:space-between}.au-b h1{margin:0 0 10px;font-size:30px;letter-spacing:-.5px}.au-b p{opacity:.9;margin:0}.au-b ul{padding:0;list-style:none;margin:0}.au-b li{margin:10px 0;display:flex;gap:10px;opacity:.95}.au-f{padding:36px;display:flex;flex-direction:column;justify-content:center}.au-f h2{margin:0 0 4px;font-size:22px}.au-t{display:flex;gap:4px;background:var(--bg);padding:4px;border-radius:10px;margin:14px 0 16px}.au-t button{flex:1;border:0;background:none;padding:8px;border-radius:8px;font-weight:600;color:var(--mu)}.au-t button.on{background:var(--card);color:var(--tx);box-shadow:0 1px 4px #0002}.au-f label{font-size:12px;font-weight:600;color:var(--mu)}.au-p{position:relative}.au-p button{position:absolute;right:6px;top:6px;border:0;background:none;font-size:12px;color:var(--mu);padding:4px 8px}.au-m{min-height:20px;font-size:13px;margin:2px 0 10px}.au-m.e{color:var(--pr)}.au-m.i{color:var(--ok)}.au-l{background:none;border:0;color:var(--pr);padding:0;font-size:13px;text-align:left}.au-lg{display:none;font-weight:800;color:var(--pr);font-size:20px;margin-bottom:10px}@media(max-width:720px){.au{grid-template-columns:1fr;margin:0;border-radius:0;border:0;min-height:100vh;box-shadow:none}.au-b{display:none}.au-lg{display:block}.au-f{padding:24px}}</style>`;
  const authScreen = staffMode => new Promise(res => {
    let mode = 'in', note = '', kind = '', busy = false;
    const draw = () => {
      const sp = mode === 'up', rs = mode === 'reset';
      msg(CSS + `<div class="au"><div class="au-b"><div><h1>RefundGuard</h1><p>${staffMode ? 'Staff portal for accountants' : 'AI-assisted refund resolution'}</p></div><ul>${staffMode ? '<li>🔍 Review cases flagged by DT Engine</li><li>🧾 Read the full evidence log</li><li>✅ Make the final refund decision</li>' : '<li>⚡ Failed transfer? We flag it automatically</li><li>🔍 DT Engine checks where your money went</li><li>💸 Refunds decided by a real accountant</li>'}</ul><p style="font-size:12px;opacity:.7">Demo environment · no real money</p></div>
      <div class="au-f"><div class="au-lg">RefundGuard</div><h2>${rs ? 'Reset your password' : staffMode ? 'Staff sign in' : sp ? 'Create your account' : 'Welcome back'}</h2><div class="hint">${rs ? 'We will email you a link to set a new password.' : staffMode ? 'Authorised accountants only.' : sp ? 'It takes less than a minute.' : 'Sign in to continue.'}</div>
      ${rs || staffMode ? '' : `<div class="au-t"><button class="${sp ? '' : 'on'}" id="t-in">Sign in</button><button class="${sp ? 'on' : ''}" id="t-up">Create account</button></div>`}<div style="height:${rs || staffMode ? 14 : 0}px"></div>
      <form id="af" novalidate>${sp ? '<label>Full name</label><input id="an" autocomplete="name" placeholder="e.g. Ada Obi">' : ''}<label>Email</label><input id="ae" type="email" autocomplete="username" placeholder="you@example.com">
      ${rs ? '' : `<label>Password</label><div class="au-p"><input id="ap" type="password" autocomplete="${sp ? 'new-password' : 'current-password'}" placeholder="${sp ? 'At least 6 characters' : 'Your password'}"><button type="button" id="sh">Show</button></div>`}
      <div class="au-m ${kind}" id="am">${note}</div><button class="p" style="width:100%;padding:11px" id="ab">${rs ? 'Send reset link' : sp ? 'Create account' : 'Sign in'}</button></form>
      <div style="margin-top:14px;display:flex;justify-content:space-between">${rs ? '<button class="au-l" id="bk">← Back to sign in</button>' : '<button class="au-l" id="fg">Forgot password?</button>'}<span></span></div></div></div>`);
      const f = $('af'), on = (id, fn) => { const e = $(id); if (e) e.onclick = fn };
      on('t-in', () => { mode = 'in'; note = ''; draw() }); on('t-up', () => { mode = 'up'; note = ''; draw() }); on('fg', () => { mode = 'reset'; note = ''; draw() }); on('bk', () => { mode = 'in'; note = ''; draw() });
      on('sh', () => { const p = $('ap'); p.type = p.type === 'password' ? 'text' : 'password'; $('sh').textContent = p.type === 'password' ? 'Show' : 'Hide' });
      f.onsubmit = async e => {
        e.preventDefault(); if (busy) return; const em = $('ae').value.trim(), pw = $('ap') ? $('ap').value : '', nm = $('an') ? $('an').value.trim() : '';
        const m = (t, k) => { $('am').textContent = t; $('am').className = 'au-m ' + k };
        if (!em) return m('Enter your email.', 'e'); if (!rs && !pw) return m('Enter your password.', 'e'); if (sp && !nm) return m('Enter your name.', 'e');
        busy = true; $('ab').disabled = true; $('ab').textContent = 'Please wait…';
        try {
          if (rs) { try { await auth.sendPasswordResetEmail(em) } catch (x) { if (x.code === 'auth/invalid-email') throw x } note = 'If an account exists for ' + em + ', a reset link is on its way. Check your inbox and spam folder.'; kind = 'i'; mode = 'in'; busy = false; draw(); return }
          if (sp) { const c = await auth.createUserWithEmailAndPassword(em, pw); try { await c.user.sendEmailVerification() } catch (x) {} await window.api('signup', { name: nm }); res(c.user) }
          else res((await auth.signInWithEmailAndPassword(em, pw)).user);
        } catch (x) { busy = false; note = ERR[x.code] || x.message || 'Something went wrong.'; kind = 'e'; draw() }
      };
    };
    draw();
  });
  const topBar = () => { const t = document.querySelector('.top'); if (!t || $('so')) return; const b = document.createElement('button'); b.id = 'so'; b.textContent = 'Sign out'; b.onclick = () => auth.signOut().then(() => location.reload()); t.appendChild(b) };
  const ensure = () => ready || (ready = (async () => {
    init(); let u = await first(); if (u && u.isAnonymous) { await auth.signOut(); u = null }
    if (!u) u = await authScreen(STAFF()); topBar(); return u;
  })());
  const save = async ({ filename, data }) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([data], { type: 'text/plain' })); a.download = filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); return 'saved' };
  window.claude = { use: async name => {
    if (name === 'downloads') return { save };
    if (bad) { msg('<div class="card">Firebase is not configured yet. Fill in <b>firebase-config.js</b> (see SETUP.md).</div>'); return null }
    try {
      const u = await ensure(); if (name === 'db') return fs;
      if (name === 'user') return { id: async () => u.uid, canEdit: async () => !!u.email && emails.includes(u.email.toLowerCase()), can: async () => true, isOwner: () => false };
    } catch (e) { console.error('Firebase init/sign-in failed:', e); return null }
    return null;
  } };
})();
