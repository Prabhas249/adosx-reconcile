# Decisions

1. **Use SQLite by default instead of a running PostgreSQL server.**
   Rejected requiring the reviewer to start PostgreSQL or Docker with matching credentials before booting the app. The brief prioritizes running cleanly from a fresh clone, and using Django ORM with `DecimalField` keeps switching `DATABASES` in `settings.py` to PostgreSQL trivial.

2. **Store both raw text columns and parsed `DecimalField` or `DateField` columns.**
   Rejected strict typed-only columns that drop or zero out invalid CSV cells at import time. Keeping `raw_value` and `value_parse_error` ensures blank cells like `ENT/2026/4050` and Indian comma strings like `1,25,400.00` survive import and display their exact source values.

3. **Keep `SystemBEntry.normalized_record_ref` as an indexed `CharField` instead of a `ForeignKey`.**
   Rejected adding a database foreign key from `SystemBEntry` to `SystemARecord`. Dirty exports include orphan entries such as `ENT/2026/4901` (`REC-1999`), which would fail a foreign-key constraint on insert.

4. **Normalize `record_ref` formats (`rec1034`, ` REC - 1070 `, `1112`) during import.**
   Rejected exact string equality between `record_id` and `record_ref`. Those three rows match System A in amount, location, and date once normalized, so flagging them would produce false positives.

5. **Treat split entries summing to System A's total (`REC-1055`) as non-errors.**
   Rejected flagging every `record_ref` with multiple System B entries as a duplicate. In `REC-1055`, the two entries (`71950.93` and `107926.39`, labeled `Entry part 2 of 2`) sum to `179877.32` to the exact paisa, whereas `REC-1042` posts the full `112837.06` twice.

6. **Flag cross-tenant mismatches (`REC-1077`) via a boolean existence check with redacted cross-org fields.**
   Rejected filtering in a blind vacuum (which mislabels `REC-1077` as missing in System B for `ORG-A`) and rejected returning `LOC-201` or `ORG-B` identifiers (which leaks tenant data). Checking `.exclude(location__org_id=org_id).exists()` reports the boundary error for both orgs without returning any foreign fields.

7. **Scope cuts.**
   Skipped authentication, a CSV upload UI, and custom CSS styling, and required `?org=` on the API plus a tenant switcher in Next.js. Authentication and visual polish were explicitly out of scope, so effort stayed on ingestion resilience, tenant boundaries, and regression tests.
