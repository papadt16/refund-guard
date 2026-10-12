# Refund resolution demo, powered by DT Engine

A simulated banking front end (the bank name is a placeholder: change `const BANK` in `app.html`) where failed-but-debited
transfers are auto-flagged and investigated by **DT Engine**; an accountant makes the final refund decision.
Only the engine carries a brand name: DT Engine.

## Layout
- `app.html` - the whole app (customer app + staff portal). Customer = no hash, staff = `#accountant`.
- `engine/dt_engine.js` - DT Engine, standalone and dependency-free (also embedded in `app.html` as the `dt-engine` script block).
- `docs/DATA_CONTRACT.md` - collections and fields shared by both sides.

## DT Engine in 30 seconds
Checks: ledger, core switch status, NIP status query, beneficiary credit, reversal sweep, duplicate/fraud screen.
Evidence -> logistic score `p` = probability a refund is due. `p >= hi` recommend refund, `p <= lo` auto-correct to Successful, else manual review.
Accountant decisions become training examples; `DTEngine.train(examples, cfg)` updates the weights (with a pull towards the defaults).
The `adapters` object is the swap-point for real NIBSS NIP and core-banking calls. Adapters may be sync or async, and you can pass your own set as the 6th argument of `investigate()`.

```js
const DTEngine = require("./engine/dt_engine.js");
const r = await DTEngine.investigate(tx, allTxs, DTEngine.defaults(), async (msg, kind) => console.log(msg), 0);
```

## Pattern detection and reconciliation (engine functions)
- `DTEngine.patterns(txs, cases)` -> bank/switch failure clusters and customers flagged for refund abuse.
- `DTEngine.parseSettlement(csvText)` -> rows from an end-of-day settlement CSV (header: ref, session, amount, status).
- `DTEngine.reconcile(rows, txs)` -> ghost debits, status mismatches, amount mismatches, missing records. Reports only; the caller applies fixes.
- `DTEngine.sampleSettlement(txs)` -> a fake settlement CSV for demos (uses the demo-only `tx.sim`).
The staff screens that use these (Patterns tab, Reconciliation tab) belong to the accountant side.

## Customer app (redesign)
Bright-red design with four tabs: **Home** (greeting, balance card with hide/show, copy account number, tier badge, Add Money and Transfer, quick services, "Need help with a payment?", recent transactions), **Activity** (search, Successful / Pending / Failed / Refunded pills, Service and month filters, monthly overview, CSV download), **Refund AI** and **Profile** (My Profile, KYC & Tier, Refund Requests, Beneficiaries, Payment Settings with PIN and fingerprint, Security Center, Dark Mode, Messages, Customer Service, Report an Issue, Sign out).
Pages: Transaction Details (status banner, share receipt, Track Refund or Contact Support), Transfer Money (To Bank / To Another User, recents and beneficiaries), Report an Issue (issue type, reference, amount, date), Refund Tracking (four-step timeline from the DT Engine case), Refund Requests, More Services.
Services: To Bank, Airtime, Data (Daily / Weekly / Monthly / 3 Months), Electricity, Cable TV, Betting, Utilities, Education, Insurance, Gift Cards, Mobile Money. Any of them can fail while debiting, so all of them feed DT Engine. Nothing is pre-filled except the customer's own details.
**Refund AI** is a scripted assistant: it explains failed transactions, drafts a report, tracks refund requests and answers FAQs from the customer's own transactions and cases. It is not connected to a language model.
Buttons use a bright red that dims while a request is being processed.
The demo status picker for payments is in the confirm sheet and the server (`TEST_MODE=off` disables it).

## Customer notifications
Each case stage writes an SMS-style and an email-style message to the `notifications` collection; customers read them in the in-app inbox.
These are in-app only. A real deployment would send them through an SMS gateway and an email service.

## Staff portal tabs
Dashboard, Cases, Transactions, Customers, Patterns, Reconciliation, DT Engine, Audit. The portal only opens for people with edit access to the artifact (a screen check only; the db still lets Contributors write).
`accountant_side.js` is the staff section on its own, as a drop-in for another copy of `app.html` (instructions in its header).

## Split of work
- Chat 1 (customer side + engine): customer app, receipts, disputes, notifications, DT Engine.
- Chat 2 (accountant side): the staff section of `app.html` (`ACCOUNTANT SIDE`). Planned: pattern detection, batch reconciliation, richer dashboards.
- Publish edits to the same artifact URL; if two people publish in parallel, last one wins. Always read the live artifact before editing.

## Running
Runs as a claude.ai Artifact (uses its `db`, `user` and `downloads` capabilities); viewers must be signed in as Contributors.
Not a standalone web page: the db layer would need replacing to host elsewhere.
The engine export downloads as `dt_engine.js.txt` (the download feature does not allow `.js`); rename it to `dt_engine.js`.

## Server mode
The web build runs DT Engine and all money movement on the server (`api/rg.js`); the browser only reads. See `SETUP.md`. Tests: `node test/server_test.js`.

## Latest changes
Profile (name, email, phone, BVN, NIN, picture), KYC tiers with limits, PalmPay-style transaction history, RefundGuard as a bank with name lookup and unique account numbers, zero starting balance, accountant balance adjustment and account deletion with emailed one-time codes, sign-out confirmation, test-mode selector moved to the payment confirmation sheet.

Checkout redesign (payment sheet, PIN keypad, fingerprint), Payment Settings (use PIN on/off, set/change PIN, fingerprint), change login password.
