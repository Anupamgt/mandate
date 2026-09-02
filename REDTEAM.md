# REDTEAM

| ID | Case | Result | Detail |
|---|---|---|---|
| RT-01 | jailbreak terms vs per-txn cap | **PASS** | PER_TXN_CAP_EXCEEDED |
| RT-02 | proof replay | **PASS** | 409 |
| RT-03 | parallel cap | **PASS** | allow=5 cap=5 |
| RT-04 | bad HMAC | **PASS** | 401 |
| RT-09 | unclassified tool | **PASS** | TOOL_UNCLASSIFIED |
| RT-10 | audit tamper | **PASS** | {"ok":false,"first_break_seq":1} |
| RT-05 | revoke before pay | **PASS** | covered by REST revoke test |
| RT-06 | tampered mandate body | **PASS** | covered by policy MANDATE_SIG_INVALID |
| RT-07 | window expiry | **PASS** | covered by policy WINDOW_EXPIRED |
| RT-08 | exact counterparty | **PASS** | covered by policy COUNTERPARTY_NOT_ALLOWED |
