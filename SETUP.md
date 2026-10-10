# Deploying RefundGuard (Vercel + Firebase), with server-side engine

Two builds from one source: `app.html` (claude.ai artifact, direct db) and `index.html` (web build: login page, server API, locked rules).
Run `python3 make_web.py` after editing `app.html`; it regenerates `index.html`, `engine/dt_engine.js` and `api/_shared.js`.

## What runs where
- **Browser:** shows data (read-only from Firestore) and calls `/api/rg` for every action.
- **Server (`api/rg.js`, a Vercel function):** DT Engine, transfers, balance changes, case handling, refunds, staff actions. It verifies the user's Firebase login on every call.
- **Firestore rules:** deny all client writes (one exception: marking your own notification as read). Customers can only read their own records.
- **Password recovery:** "Forgot password?" on the login page sends a Firebase reset email.

## 1. Firebase (free Spark plan)
1. Create a project, then **Firestore Database > Create database**.
2. **Authentication > Sign-in method**: enable **Email/Password** only (Anonymous is no longer used).
3. **Authentication > Users > Add user**: create the accountant login (email + password).
4. **Project settings > Your apps > Web**: paste the config into `firebase-config.js` and set `STAFF_EMAILS`.
5. **Firestore > Rules**: paste `firestore.rules` (put the staff email in `staff()`), **Publish**.
6. **Authentication > Templates** (optional): edit the password-reset email wording and sender name.
7. **Project settings > Service accounts > Generate new private key**: downloads a JSON file. Keep it secret; never commit it.

## 2. Vercel
1. Import the GitHub repo (project name lowercase, e.g. `refundguard`). Framework preset: **Other**. No build command.
2. **Settings > Environment Variables** (Production, then redeploy):
   - `FIREBASE_SERVICE_ACCOUNT` = the entire contents of the JSON key file
   - `STAFF_EMAILS` = `accountant@example.com` (comma-separate several)
   - `TEST_MODE` = leave unset for the demo (the "simulate network outcome" dropdown works). Set to `off` to force every transfer to behave normally.
3. If sign-in fails with `auth/unauthorized-domain`, add your `*.vercel.app` domain under **Authentication > Settings > Authorized domains**.

## 3. Use it
Customers sign up on the site. Accountants open `/#accountant` and sign in with the staff email.

## Tests
`node test/server_test.js` runs the server logic against an in-memory database (signup, transfers, refund once only, staff-only actions, ownership checks).

## Still demo-grade
- The 6 checks are simulated (`TEST_MODE` + `adapters`). Real NIBSS/core-banking calls replace them inside `api/rg.js` runs, keeping the return shapes.
- No rate limiting, 2FA or email-verification enforcement yet; transfers have a ₦5,000,000 cap.
- Staff are identified by email list; for many staff use Firebase custom claims instead.
