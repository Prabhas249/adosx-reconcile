# Decisions

1. **Use SQLite by default instead of a running PostgreSQL server.**
   Rejected requiring reviewers to run PostgreSQL or Docker with matching credentials before starting the app. The brief prioritizes running cleanly from a fresh clone, and using Django ORM with `DecimalField` lets `DATABASES` in `settings.py` switch to PostgreSQL with a settings change.

2. **Store raw text columns, original CSV row numbers (`source_row`), and parsed `DecimalField` or `DateField` columns.**
   Rejected strict typed-only columns that drop or zero out invalid CSV cells at import time. Keeping `raw_total_value`, `raw_value`, and `source_row` alongside `value_parse_error` keeps blank cells like `ENT/2026/4050` and Indian comma strings like `1,25,400.00` intact and lets the inspector trace every disagreement back to its CSV row number.

3. **Keep `SystemBEntry.normalized_record_ref` as an indexed `CharField` instead of a `ForeignKey`.**
   Rejected adding a database foreign key from `SystemBEntry` to `SystemARecord`. Inconsistent exports include orphan entries such as `ENT/2026/4901` (`REC-1999`), which would fail a foreign-key constraint on insert.

4. **Normalize `record_ref` formats (`rec1034`, ` REC - 1070 `, `1112`) during import and preserve colliding source rows.**
   Rejected exact string equality between `record_id` and `record_ref` and rejected silent overwrites when two rows in a file normalize to the same key. Normalizing references matches valid variations on `REC-1034`, `REC-1070`, and `REC-1112`, while `_unique_id` suffixes colliding primary keys with `-DUP-ROW-<row>` and records an import warning alongside unmapped locations and blank values during `import_data`.

5. **Distinguish valid split settlements (`REC-1055`), true duplicate entries (`REC-1042`), and unresolved multi-entry mismatches.**
   Rejected flagging every `record_ref` with multiple System B entries as a duplicate and rejected requiring free-text `"part "` substrings in `label`. In `REC-1055`, the two entries (`71950.93` and `107926.39`) sum to `179877.32` (`None`), whereas `REC-1042` posts the full `112837.06` twice (`DUPLICATE_IN_B`), and multi-entry records whose parsed amounts neither sum to `total_value` nor repeat an identical amount surface as `MULTI_ENTRY_UNRESOLVED`. Money sort keys (`sort_value`) are computed and serialized as fixed-point `Decimal` strings rather than floats.

6. **Flag cross-tenant mismatches (`REC-1077`) via a membership query with redacted cross-org fields, treating `REC-XXXX` as a shared event identifier across the export.**
   Rejected strict per-org-only filtering (which mislabels `REC-1077` as missing in System B for `ORG-A`) and rejected returning `LOC-201` or `ORG-B` identifiers (which leaks tenant data). Querying only matching `normalized_record_ref` IDs where `location` belongs to another org (`.filter(location__isnull=False).exclude(location__org_id=org_id).values_list(...)`) reports `TENANT_MISMATCH` to both orgs while redacting foreign row numbers, locations, and amounts before serialization.

7. **Cut authentication, upload UI, and external UI libraries.**
   Rejected building login flows, browser CSV uploads, and third-party component libraries because the brief scoped them out. Enforcing a mandatory `?org=` query parameter on `/api/disagreements/` and using semantic HTML and CSS custom properties kept the focus on ingestion resilience, tenant isolation, and regression tests.
