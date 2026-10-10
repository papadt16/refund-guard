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

## Customer notifications
Each case stage writes an SMS-style and an email-style message to the `notifications` collection; customers read them in the in-app inbox.
These are in-app only. A real deployment would send them through an SMS gateway and an email service.

## Split of work
- Chat 1 (customer side + engine): customer app, receipts, disputes, notifications, DT Engine.
- Chat 2 (accountant side): the staff section of `app.html` (`ACCOUNTANT SIDE`). Planned: pattern detection, batch reconciliation, richer dashboards.
- Publish edits to the same artifact URL; if two people publish in parallel, last one wins. Always read the live artifact before editing.

## Running
Runs as a claude.ai Artifact (uses its `db`, `user` and `downloads` capabilities); viewers must be signed in as Contributors.
Not a standalone web page: the db layer would need replacing to host elsewhere.
The engine export downloads as `dt_engine.js.txt` (the download feature does not allow `.js`); rename it to `dt_engine.js`.
