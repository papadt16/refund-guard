# Data contract (shared db)

Customer and accountant sides are two routes of ONE artifact and share one database.
Do not rename collections or fields without updating both sides.

| Collection | Doc id | Fields |
|---|---|---|
| `users` | viewer uid | name, acct, bal, frozen |
| `txs` | T<id> | id, uid, amt, rn, rb, ra, sess, ref, ts, sim, status (`success`/`failed`/`refunded`), debited, caseId |
| `cases` | C<id> | id, txid, uid, uname, amt, type (`auto`/`customer`), status (`investigating`/`awaiting`/`auto`/`refunded`/`rejected`), opened, slaDue, logs[{t,m,k}], f{tsq,ben,rev,dup} (null if the engine errored), p, verdict (`refund`/`review`/`auto_success`/`no_debit`), note, acctNote, decidedAt |
| `notifications` | N<id> | id, uid, caseId, txid, type (`opened`/`verified`/`escalated`/`refunded`/`rejected`/`nodebit`), subject, sms, body, ts, read |
| `examples` | case id | f, y (1 = refund was due), ts. Written on accountant decision, used to train DT Engine |
| `engine` | `config` | version, bias, w{tsq,ben,rev,dup}, hi, lo, slaMin, trainedOn, metrics{n,acc,loss}, before{n,acc,loss} |
| `audit` | random | t, m |

## Ownership
- Customer side writes: users (own), txs, cases (via DT Engine run), notifications (opened/verified/escalated/nodebit), audit. It only reads its own users/txs/cases/notifications.
- Accountant side writes: cases (decision), users (refund credit, freeze), txs (status -> refunded), notifications (refunded/rejected, through `notify()` in `decide()`), examples, engine/config, audit.
