/* Standalone replacement for the claude.ai artifact runtime.
   Exposes window.claude.use('db' | 'user' | 'downloads') on top of Firebase (Firestore + Auth), so app.html logic runs unchanged. */
(() => {
  const cfg = window.FIREBASE_CONFIG, emails = (window.STAFF_EMAILS || []).map(e => e.toLowerCase());
  const STAFF = () => location.hash === '#accountant';
  const bad = !cfg || !cfg.apiKey || /PASTE/.test(cfg.apiKey);
  let auth, fs, ready;
  const $ = id => document.getElementById(id), msg = h => { const a = $('app'); if (a) a.innerHTML = h };
  const init = () => { if (auth) return; firebase.initializeApp(cfg); auth = firebase.auth(); fs = firebase.firestore() };
  const first = () => new Promise(r => { let done = false, off = null; off = auth.onAuthStateChanged(u => { if (done) return; done = true; r(u); if (off) off() }); if (done) off() });
  const staffLogin = () => new Promise(res => {
    msg('<div class="card" style="max-width:360px;margin:30px auto"><h3 style="margin-top:0">Staff sign in</h3><label class="hint">Email</label><input id="se" type="email" autocomplete="username"><label class="hint">Password</label><input id="sp" type="password" autocomplete="current-password"><div id="sx" class="hint" style="color:var(--pr)"></div><button class="p" style="width:100%" id="sb">Sign in</button></div>');
    const go = async () => { try { res((await auth.signInWithEmailAndPassword($('se').value.trim(), $('sp').value)).user) } catch (e) { $('sx').textContent = 'Sign-in failed: ' + (e.code || e.message) } };
    $('sb').onclick = go; $('sp').onkeydown = e => { if (e.key === 'Enter') go() };
  });
  const ensure = () => ready || (ready = (async () => {
    init(); let u = await first();
    if (STAFF()) { if (!u || u.isAnonymous) u = await staffLogin() }
    else if (!u) u = (await auth.signInAnonymously()).user;
    return u;
  })());
  const save = async ({ filename, data }) => {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([data], { type: 'text/plain' }));
    a.download = filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); return 'saved';
  };
  window.claude = { use: async name => {
    if (name === 'downloads') return { save };
    if (bad) { msg('<div class="card">Firebase is not configured yet. Fill in <b>firebase-config.js</b> (see SETUP.md).</div>'); return null }
    try {
      const u = await ensure();
      if (name === 'db') return fs;
      if (name === 'user') return { id: async () => u.uid, canEdit: async () => !!u.email && emails.includes(u.email.toLowerCase()), can: async () => true, isOwner: () => false };
    } catch (e) { console.error('Firebase init/sign-in failed:', e); return null }
    return null;
  } };
})();
