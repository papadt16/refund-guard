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

## Two-step verification emails (balance adjustments and account deletion)
Adjusting a customer's balance or deleting an account sends a 6-digit code to the head accountant's email (default `aigbe208@gmail.com`). Freezing needs no code.
The server sends the email with SMTP, so add these Vercel environment variables (then redeploy):
- `SMTP_USER` = the Gmail address that sends the codes (can be the same Gmail)
- `SMTP_PASS` = a Gmail **App Password** (Google Account > Security > 2-Step Verification > App passwords). Not your normal password.
- `HEAD_EMAIL` = optional, who receives the codes (defaults to `aigbe208@gmail.com`)
- `SMTP_HOST` / `SMTP_PORT` / `SMTP_FROM` = optional (default `smtp.gmail.com`, `465`, the SMTP user)
Codes expire after 10 minutes, work once, are tied to the exact request, and lock after 5 wrong tries. Without SMTP set, those two actions show "Email is not configured".

## Accounts
- New accounts start with a balance of 0. An accountant funds them with Customers > Adjust balance (code required).
- Account numbers are unique (reserved atomically in the `accts` collection). Choosing **RefundGuard** as the bank looks the number up and fills in the real name; money sent to another RefundGuard account is credited to them.
- Tiers (demo limits): Tier 1 up to N50,000 per transaction and N200,000 per day; Tier 2 (phone + BVN) N200,000 / N1,000,000; Tier 3 (NIN + address + profile picture) N5,000,000 / N10,000,000.
- BVN and NIN are format-checked only (no NIBSS/NIMC call). The server keeps just the last 4 digits and a hash, which stops one ID being linked to two accounts.

## Payments: PIN, fingerprint, password
- **Transaction PIN** (Profile > Payment Settings): 4 digits, stored as a salted scrypt hash in the admin-only `secrets` collection. When "Use PIN for transactions" is on, the server refuses any payment without a valid PIN or fingerprint. Turning it off needs the PIN. 5 wrong tries lock payments for 15 minutes.
- **Fingerprint** uses WebAuthn (the phone's fingerprint, face or screen lock). It needs HTTPS (Vercel is fine) and is registered per domain, so add it again if the domain changes. The server verifies the signature and ties each approval to that exact payment, so it cannot be replayed. Adding or removing it needs the PIN. Only devices that support it show the option.
- **Login password** (Profile > Login Password): re-checks the current password, then sets the new one. The "forgot it?" link emails a reset.
- Optional env var `WEBAUTHN_ORIGIN` (for example `https://refundguard.vercel.app`) pins the expected site address if you use a custom domain behind a proxy.

## DT Engine safeguards
- The engine corrects a status to Successful by itself only when BOTH the switch (NIP) and the beneficiary confirm delivery. Any missing or pending evidence goes to an accountant.
- The core switch status is part of the score, and the reversal check now sees transfers that were already refunded.
- Retraining needs at least 10 accountant decisions, is checked on held-out decisions, and is refused if it would push a fully confirmed delivery towards the refund line. "Roll back last training" restores the previous settings.
- All text read from the database is HTML-escaped before it is shown, and engine settings are readable by staff only. Publish the new `firestore.rules` for that to take effect.
