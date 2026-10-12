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

## Customer app (mobile banking layout)
Bottom navigation: **Home** (balance with hide/show, service tiles, a banner for payments DT Engine is verifying, recent transactions), **History** (filters by status and by service) and **Me** (profile, beneficiaries, security, dark mode, customer service, demo test mode).
Each service tile opens its own full page:
- **To Bank:** account number, bank, recipient name, then amount and narration; Recent and Beneficiaries tabs with search; "Save as beneficiary" on the confirm sheet.
- **Airtime:** network (auto-detected from the number), your own number pre-filled from your profile, recent numbers, amount tiles or a custom amount.
- **Data:** Daily, Weekly, Monthly and 3 Months plan groups.
- **Electricity:** distribution company, prepaid or postpaid, meter number, recent meters, amount tiles.
- **Betting:** company, user ID, amount tiles. **Cable TV:** provider, smartcard, packages per provider.
Every payment shows a confirm sheet first. Nothing is pre-filled except the customer's own details (their mobile number). Receipts adapt to the service (provider wording, electricity token) and keep the dispute button.
Any service can fail while debiting, so all of them feed DT Engine. The demo test mode (Me tab) is demo-only; set `TEST_MODE=off` on the server to disable it.
Profile, preferences and beneficiaries are saved on the account, so they follow the customer to any device (see `docs/DATA_CONTRACT.md`).

## Customer notifications
Each case stage writes an SMS-style and an email-style message to the `notifications` collection; customers read them in the in-app inbox.
These are in-app only. A real deployment would send them through an SMS gateway and an email service.

## Staff portal tabs
Dashboard, Cases, Transactions, Customers, Patterns, Reconciliation, DT Engine, Audit. The portal only opens for people with edit access to the artifact (a screen check only; the db still lets Contributors write).

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
