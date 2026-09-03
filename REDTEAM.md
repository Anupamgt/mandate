# REDTEAM

| ID | Case | Result | Detail |
|---|---|---|---|
| RT-01 | jailbreak terms vs per-txn cap | **PASS** | PER_TXN_CAP_EXCEEDED |
| RT-02 | proof replay | **PASS** | 409 |
| RT-03 | parallel cap | **PASS** | allow=5 cap=5 |
| RT-04 | bad HMAC | **PASS** | 401 |
| RT-05 | revoke before pay | **PASS** | MANDATE_TEST_HOOKS=1 afterReserveHook revoked 604ac4c1-a526-4bd4-a0d8-201d8a9c7745 between reserve and pay; reason_code=MANDATE_REVOKED settlements=0 audit_MANDATE_REVOKED=true |
| RT-06 | tampered mandate body | **PASS** | flipped max_total_paise byte '5'→'4'; reason_code=MANDATE_SIG_INVALID |
| RT-07 | window expiry | **PASS** | valid_until-1s=ALLOW valid_until+1s=WINDOW_EXPIRED |
| RT-08 | exact counterparty | **PASS** | COUNTERPARTY_NOT_ALLOWED |
| RT-09 | unclassified tool | **PASS** | TOOL_UNCLASSIFIED |
| RT-10 | audit tamper | **PASS** | {"ok":false,"first_break_seq":1} |
