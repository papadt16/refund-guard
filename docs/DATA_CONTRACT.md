# Data contract (shared db)

Customer and accountant sides are two routes of ONE artifact and share one database.
Do not rename collections or fields without updating both sides.

| Collection | Doc id | Fields |
|---|---|---|
| `users` | viewer uid | name, acct, bal, frozen, email, created, nick, gender, dob (YYYY-MM-DD), phone, address, occupation, prefs{theme(`auto`/`light`/`dark`),hb,sim}, bens[{id (`bank|account`),name,bank,acct}] |
| `txs` | T<id> | id, uid, amt, rn, rb, ra, sess, ref, ts, sim, status (`success`/`failed`/`refunded`), debited, caseId, kind (`bank`/`airtime`/`data`/`power`/`bet`/`tv`; missing = bank), plan (data plan, TV package or meter type), nar (transfer narration) |
| `cases` | C<id> | id, txid, uid, uname, amt, type (`auto`/`customer`), status (`investigating`/`awaiting`/`auto`/`refunded`/`rejected`), opened, slaDue, logs[{t,m,k}], f{tsq,ben,rev,dup} (null if the engine errored), p, verdict (`refund`/`review`/`auto_success`/`no_debit`), note, acctNote, decidedAt |
| `notifications` | N<id> | id, uid, caseId, txid, type (`opened`/`verified`/`escalated`/`refunded`/`rejected`/`nodebit`), subject, sms, body, ts, read |
| `examples` | case id | f, y (1 = refund was due), ts. Written on accountant decision, used to train DT Engine |
| `engine` | `config` | version, bias, w{tsq,ben,rev,dup}, hi, lo, slaMin, trainedOn, metrics{n,acc,loss}, before{n,acc,loss} |
| `audit` | random | t, m |

## Ownership
- Customer side writes: users (own), txs, cases (via DT Engine run), notifications (opened/verified/escalated/nodebit), audit. It only reads its own users/txs/cases/notifications.
- Accountant side writes: cases (decision), users (refund credit, freeze), txs (status -> refunded), notifications (refunded/rejected, through `notify()` in `decide()`), examples, engine/config, audit.

For non-bank services: `rn` = `<provider> <service>` (e.g. `MTN Airtime`), `rb` = provider, `ra` = phone / meter / user ID / smartcard. The catalog and validation (`CAT`, `chk`) live in `app.html` and are copied to `api/_shared.js` by `make_web.py`; the server re-validates and sets the price of plans itself.

## Sync across devices
Everything a customer sees is stored on their account (Firestore, keyed by their Firebase login), so signing in on another device shows the same balance, transactions, cases, messages, profile, beneficiaries and settings (theme, hide-balance, test mode). Profile, preferences and beneficiaries are written through the server actions `profile`, `prefs` and `ben` (validated by `vProf`, `vPrefs`, `vBen` in the shared catalog code).

Service kinds in `txs.kind`: `bank`, `airtime`, `data`, `power`, `tv`, `bet`, `util`, `edu`, `ins`, `gift`, `momo` (plus `adjust` for staff balance changes). `plan` holds the data plan, TV / exam / gift-card package or meter type; plans for TV, education and gift cards belong to the chosen provider and the server sets their price.
