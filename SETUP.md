# Deploying RefundGuard on Vercel with a shared Firebase database

The claude.ai artifact build (`app.html`) uses claude.ai's own database and sign-in. `index.html` is the standalone build:
same app, with `platform.js` swapping those for Firebase (Firestore + Auth). Regenerate it with `python3 make_web.py` after editing `app.html`.

## 1. Firebase (free Spark plan)
1. https://console.firebase.google.com > **Add project** (turn Google Analytics off).
2. **Build > Firestore Database > Create database** (production mode, pick a nearby region).
3. **Build > Authentication > Get started > Sign-in method**: enable **Anonymous** and **Email/Password**.
4. **Authentication > Users > Add user**: create the accountant login (email + password). Use the same email below.
5. **Project settings > General > Your apps > Web (`</>`)**: register an app, copy the config values into `firebase-config.js`, and set `STAFF_EMAILS`.
6. **Firestore Database > Rules**: paste `firestore.rules` (put the same staff email in the `staff()` function) > **Publish**.

## 2. GitHub + Vercel
1. Commit everything (`index.html`, `platform.js`, `firebase-config.js`, `firestore.rules`...) and push to `main`.
2. In Vercel, import the repo. Project name must be lowercase, e.g. `refundguard`. No build settings are needed (static site).
3. If sign-in fails with `auth/unauthorized-domain`, add your `*.vercel.app` domain under **Authentication > Settings > Authorized domains**.

## 3. Use it
- Customers: open the site. Each browser gets its own anonymous account (clearing browser data starts a new one).
- Accountant: open `/#accountant` and sign in with the staff email and password.

## Limits (demo-grade)
- DT Engine runs in the customer's browser, so a technical customer could tamper with their own balance or cases. The rules stop them touching anyone else's data and from reading staff data. A real version moves the engine and refunds to server code (Cloud Functions or your own backend).
- Anonymous accounts have no recovery. Add email or phone sign-in for real customers.
