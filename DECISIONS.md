# Decisions

1. **Use SQLite by default instead of a running PostgreSQL server.**
   Rejected requiring reviewers to run PostgreSQL or Docker with matching credentials before starting the app. The brief prioritizes running cleanly from a fresh clone, and using Django ORM with `DecimalField` lets `DATABASES` in `settings.py` switch to PostgreSQL with a settings change.

2. **Store both raw text columns and parsed `DecimalField` or `DateField` columns.**
   Rejected strict typed-only columns that drop or zero out invalid CSV cells at import time. Keeping `raw_total_value` on `SystemARecord` and `raw_value` on `SystemBEntry` alongside `value_parse_error` keeps blank cells like `ENT/2026/4050` and Indian comma strings like `1,25,400.00` intact and displays the original source values.

3. **Keep `SystemBEntry.normalized_record_ref` as an indexed `CharField` instead of a `ForeignKey`.**
   Rejected adding a database foreign key from `SystemBEntry` to `SystemARecord`. Inconsistent exports include orphan entries such as `ENT/2026/4901` (`REC-1999`), which would fail a foreign-key constraint on insert.

4. **Normalize `record_ref` formats (`rec1034`, ` REC - 1070 `, `1112`) during import and report import anomalies.**
   Rejected exact string equality between `record_id` and `record_ref` and rejected silent overwrites when two rows normalize to the same key. Normalizing references matches valid variations on `REC-1034`, `REC-1070`, and `REC-1112`, while collecting import warnings surfaces duplicate keys, unmapped locations, and blank values during `import_data`.

5. **Treat multiple System B entries whose parsed amounts sum to System A's total (`REC-1055`) as a valid split payment.**
   Rejected flagging every `record_ref` with multiple System B entries as a duplicate and rejected requiring free-text `"part "` substrings in `label`. In `REC-1055`, the two entries (`71950.93` and `107926.39`) sum to `179877.32`, whereas true duplicates (`REC-1042`) post the full `112837.06` twice (`225674.12`).

6. **Flag cross-tenant mismatches (`REC-1077`) via a membership query with redacted cross-org fields.**
   Rejected strict per-org-only filtering (which mislabels `REC-1077` as missing in System B for `ORG-A`) and rejected returning `LOC-201` or `ORG-B` identifiers (which leaks tenant data). Querying only matching `normalized_record_ref` IDs where `location` belongs to another org (`.filter(location__isnull=False).exclude(location__org_id=org_id).values_list(...)`) reports `TENANT_MISMATCH` to both orgs without returning any foreign fields.

7. **Keep a plain HTML table and an unauthenticated org switcher instead of custom UI widgets, auth, or upload screens.**
   Rejected building login flows, browser CSV uploads, client-side search, and slide-over drawers because the brief explicitly scoped them out and asked for a plain table. Enforcing a mandatory `?org=` query parameter on `/api/disagreements/` and keeping the frontend to 290 lines of TSX and 286 lines of CSS kept the focus on ingestion resilience, tenant isolation, and regression tests.
