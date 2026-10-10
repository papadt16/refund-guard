# Refund resolution demo, powered by DT Engine

A simulated banking front end (the bank name is a placeholder: change `const BANK` in `app.html`) where failed-but-debited
transfers are auto-flagged and investigated by **DT Engine**; an accountant makes the final refund decision.
Only the engine carries a brand name: DT Engine.

## Layout
- `app.html` — the whole app (customer app + staff portal). Customer = no hash, staff = `#accountant`.
- `engine/dt_engine.js` — DT Engine, standalone and dependency-free (also embedded in `app.html` as `<script id="dt-engine">`).
- `docs/DATA_CONTRACT.md` — collections and fields shared by both sides.

## DT Engine in 30 seconds
Checks: ledger, core switch status, NIP status query, beneficiary credit, reversal sweep, duplicate/fraud screen.
Evidence -> logistic score `p` = probability a refund is due. `p >= hi` recommend refund, `p <= lo` auto-correct to Successful, else manual review.
Accountant decisions become training examples; `DTEngine.train(examples, cfg)` updates the weights.
The `adapters` object is the swap-point for real NIBSS NIP and core-banking calls.

```js
const DTEngine = require("./engine/dt_engine.js");
const cfg = DTEngine.defaults();
const r = await DTEngine.investigate(tx, allTxs, cfg, async (msg, kind) => console.log(msg));
```

## Split of work
- Chat 1 (customer side + engine): customer app, receipts, disputes, DT Engine.
- Chat 2 (accountant side): the staff section of `app.html` (`/* ACCOUNTANT SIDE */`). Planned: notifications, pattern detection, batch reconciliation, richer dashboards.
- Publish edits to the same artifact URL; if two people publish in parallel, last one wins.

## Running
Runs as a claude.ai Artifact (uses its `db`, `user`, `downloads` capabilities); viewers must be signed in as Contributors.
Not a standalone web page: the db layer would need replacing to host elsewhere.
