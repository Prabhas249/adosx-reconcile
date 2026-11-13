# Architecture & Scope Decisions

1. **SQLite by default instead of requiring a live PostgreSQL server**
   - *Rejected:* Requiring the reviewer to start PostgreSQL or Docker with matching credentials before booting the app.
   - *Reasoning:* Evaluation prioritizes running cleanly from a fresh clone; Django ORM + `DecimalField` means switching `DATABASES` in `settings.py` to PostgreSQL takes two minutes in production.

2. **Store both `raw_*` text columns and parsed `DecimalField` / `DateField` values**
   - *Rejected:* Strict typed columns that cast during CSV read and drop or null-out failures silently.
   - *Reasoning:* Keeping `raw_value` and `value_parse_error` ensures dirty rows like `ENT/2026/4050` (blank `value`) and `ENT/2026/4064` (`"1,25,400.00"`) survive import and show exact raw values in the UI.

3. **Keep `SystemBEntry.normalized_record_ref` as an indexed `CharField`, not a `ForeignKey`**
   - *Rejected:* Adding a database-level foreign key from `SystemBEntry` to `SystemARecord`.
   - *Reasoning:* Orphan entries such as `ENT/2026/4901 -> REC-1999` have no parent in System A and would crash a foreign-key import.

4. **Normalize `record_ref` formats (`rec1034`, ` REC - 1070 `, `1112`) during import**
   - *Rejected:* Exact string matching on `record_id == record_ref`.
   - *Reasoning:* All three are valid formatting quirks in System B whose amounts, locations, and dates agree with System A, so flagging them would create false positives.

5. **Treat multi-part settlements summing to System A's total (`REC-1055`) as non-errors**
   - *Rejected:* Flagging every `record_ref` with more than one System B row as a duplicate.
   - *Reasoning:* `REC-1055` (`71950.93 + 107926.39 = 179877.32`, labeled `"Entry part 2 of 2"`) reconciles to the exact paisa, whereas `REC-1042` posts the full `112837.06` twice and is a true duplicate.

6. **Flag cross-tenant mismatch (`REC-1077`) via existence check with redacted cross-org details**
   - *Rejected:* Either filtering in a vacuum (which mislabels `REC-1077` as `MISSING_IN_B` for `ORG-A`) or returning the other org's `LOC-201` / `LOC-102` ID in the payload (which leaks tenant data).
   - *Reasoning:* Checking `.exclude(location__org_id=org_id).exists()` detects the boundary error for both orgs without exposing any location ID, record value, or org identifier from across the tenant line.

7. **Scope cut: require `?org=` query parameter + Next.js org switcher instead of auth, CSV upload UI, or CSS frameworks**
   - *Rejected:* Building session login, file upload forms, and styled component libraries.
   - *Reasoning:* Authentication and visual polish were explicitly out of scope, so time went into ingestion durability, tenant boundary checks, and unit tests.
