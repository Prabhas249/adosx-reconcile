# Decisions

1. **Use SQLite by default instead of a running PostgreSQL server.**
   Rejected requiring reviewers to run PostgreSQL or Docker with matching credentials before starting the app. The brief prioritizes running cleanly from a fresh clone, and using Django ORM with `DecimalField` lets `DATABASES` in `settings.py` switch to PostgreSQL with a settings change.

2. **Store both raw text columns and parsed `DecimalField` or `DateField` columns.**
   Rejected strict typed-only columns that drop or zero out invalid CSV cells at import time. Keeping `raw_total_value` on `SystemARecord` and `raw_value` on `SystemBEntry` alongside `value_parse_error` keeps blank cells like `ENT/2026/4050` and Indian comma strings like `1,25,400.00` intact and displays the original source values.

3. **Keep `SystemBEntry.normalized_record_ref` as an indexed `CharField` instead of a `ForeignKey`.**
   Rejected adding a database foreign key from `SystemBEntry` to `SystemARecord`. Inconsistent exports include orphan entries such as `ENT/2026/4901` (`REC-1999`), which would fail a foreign-key constraint on insert.

4. **Normalize `record_ref` formats (`rec1034`, ` REC - 1070 `, `1112`) during import.**
   Rejected exact string equality between `record_id` and `record_ref`. Those three rows match System A in amount, location, and date once normalized, so flagging them would produce false positives.

5. **Treat split entries summing to System A's total (`REC-1055`) as non-errors.**
   Rejected flagging every `record_ref` with multiple System B entries as a duplicate. In `REC-1055`, the two entries (`71950.93` and `107926.39`, labeled `Entry part 2 of 2`) sum to `179877.32`, whereas `REC-1042` posts `112837.06` twice.

6. **Flag cross-tenant mismatches (`REC-1077`) via a membership query with redacted cross-org fields.**
   Rejected strict per-org-only filtering (which mislabels `REC-1077` as missing in System B for `ORG-A`) and rejected returning `LOC-201` or `ORG-B` identifiers (which leaks tenant data). Querying only matching `normalized_record_ref` IDs where `location` belongs to another org (`.filter(location__isnull=False).exclude(location__org_id=org_id).values_list(...)`) reports `TENANT_MISMATCH` to both orgs without returning any foreign fields.

7. **Cut authentication, upload UI, and custom styling.**
   Rejected building login flows, browser CSV uploads, and a component library because the brief scoped them out. Enforcing a mandatory `?org=` query parameter on the API and keeping a plain HTML table kept work focused on ingestion resilience, tenant isolation, and regression tests.

