# ADOSX Reconciliation Tool — System A vs System B

A small, tenant-scoped full-stack tool (Django + DRF + Next.js) that imports dirty CSV exports from two non-authoritative systems, detects real disagreements without dropping malformed rows or flagging valid edge cases, and strictly isolates results per tenant (`org_id`).

---

## How to Run (Clean Clone)

### 1. Backend (Django + SQLite)
```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

python manage.py migrate
python manage.py import_data
python manage.py test reconcile -v 2
python manage.py runserver 127.0.0.1:8000
```
*(If using `uv`: `uv venv .venv --python 3.12 && uv pip install --python .venv/bin/python -r requirements.txt`.)*

### 2. Frontend (Next.js)
In a second terminal:
```bash
cd frontend
npm install
npm run dev
```
Open [http://localhost:3000](http://localhost:3000).

---

## What I Built

1. **Schema & Dirty-Safe Importer ([`models.py`](backend/reconcile/models.py), [`importer.py`](backend/reconcile/importer.py), [`import_data.py`](backend/reconcile/management/commands/import_data.py)):**
   - Stores `Location` (`org_id` tenant mapping), `SystemARecord`, and `SystemBEntry` with **raw string copies** alongside parsed `Decimal(14, 2)` and `DateField` values so nothing is silently dropped.
   - Survives Indian comma formatting (`"1,25,400.00"`), blank amounts (`ENT/2026/4050`), blank `actor_id` (`REC-1050`), orphan references (`REC-1999`), and three reference formats (`"rec1034"`, `" REC - 1070 "`, `"1112"`).
   - Imports all **5 locations**, **120 System A records**, and **121 System B entries** cleanly (`0` dropped rows).

2. **Tenant-Scoped Comparison Engine ([`comparator.py`](backend/reconcile/comparator.py)):**
   - Strictly filters every query by `org_id` (returns HTTP `400` if `?org=` is missing or unknown).
   - **Correctly keeps non-errors quiet:** `REC-1034`, `REC-1070`, `REC-1112` (reference format variations) and `REC-1055` (two-part settlement `71950.93 + 107926.39 = 179877.32` labeled `"Entry part 2 of 2"`) are not flagged.
   - **Catches all real disagreements:**
     - `MISSING_IN_B`: `REC-1015` (`ORG-A`), `REC-1061` (`ORG-B`)
     - `ORPHAN_IN_B`: `REC-1999` / `ENT/2026/4901` (`ORG-A`)
     - `DUPLICATE_IN_B`: `REC-1042` (`112837.06` entered twice in `ORG-A`)
     - `VALUE_MISMATCH`: `REC-1003` (`ORG-B`), `REC-1027`, `REC-1064`, `REC-1088` (`ORG-A`)
     - `UNPARSEABLE_VALUE`: `REC-1050` (`ORG-B`, blank value)
     - `VOIDED_IN_A`: `REC-1019` (`ORG-B`, marked `VOIDED` in System A but active in System B)
     - `DATE_MISMATCH`: `REC-1009` (`ORG-B`, `2026-03-31` vs `2026-04-02`)
     - `TENANT_MISMATCH`: `REC-1077` (System A in `ORG-A` / `LOC-102`, System B in `ORG-B` / `LOC-201` — flagged for both orgs with cross-org identifiers strictly redacted).

3. **Plain Working UI ([`page.tsx`](frontend/src/app/page.tsx)):**
   - Tenant switcher (`ORG-A` / `ORG-B`), reason filter dropdown, sort by value (`Highest first`, `Lowest first`, `Record ID`), and plain HTML table displaying both parsed and raw values.

4. **Tests ([`tests.py`](backend/reconcile/tests.py)):**
   - 11 tests covering every disagreement category, both non-error classes (messy refs and split payments), cross-tenant leakage prevention, missing `?org=` rejection, and full-dataset ingestion.

---

## What I Deliberately Did Not Build

- **Authentication / Login:** Skipped per the brief; tenant isolation is enforced at the API/query layer via mandatory `org` scoping.
- **CSV Upload UI / Re-import Button:** Ingestion runs cleanly via `python manage.py import_data` so focus stayed on schema, parser resilience, and comparison accuracy.
- **PostgreSQL / Docker Compose Setup:** Kept SQLite default so the project boots from a clean clone without external services (easy to swap via `DATABASES` in `settings.py`).
- **Custom CSS / Component Library:** Used a plain readable HTML table per the brief.

---

## How I Worked With the Agent

I used an AI coding agent as my pair programmer across schema design, CSV anomaly inspection, Django endpoints, Next.js table wiring, and test generation—while inspecting every row of the three CSVs first and auditing the generated Python and SQL queries line-by-line before committing incrementally.

### Questions

**a. Name one thing the AI agent got wrong. How did you notice?**  
On the first pass over `system_b.csv`, grouping multiple entries by `normalized_record_ref` flagged **both** `REC-1042` and `REC-1055` as `DUPLICATE_IN_B`. By inspecting the raw CSV rows directly, I noticed `REC-1055` (`179,877.32` in System A) had two entries (`71,950.93` + `107,926.39`) whose sum matched System A to the exact paisa and whose second row was explicitly labeled `"Entry part 2 of 2"`. Similarly, filtering `ORG-A` strictly in isolation initially mislabeled cross-tenant `REC-1077` as `MISSING_IN_B` instead of catching the tenant boundary mismatch without leaking `LOC-201`. I fixed both rules and added regression tests for them.

**b. Which part of your submission are you least confident about, and why?**  
The split-payment heuristic in `comparator.py` checks both `summed_b == rec.total_value` and whether an entry label contains `"part "`. In real dealership exports, split settlements might not carry a friendly `"part 2 of 2"` label, or two partial entries could still leave an unrecorded third installment—which would cause my current `len(entries) > 1` check to classify an incomplete split as `DUPLICATE_IN_B`. Also, because `django-cors-headers` allows `localhost:3000` by default in local dev, production deployment would need strict `CORS_ALLOWED_ORIGINS` and real auth-derived `org_id` claims instead of a query parameter.

**c. If you had a second day, what would you fix first?**  
First, I would replace the hardcoded split-payment label check with a clearer status distinction (`PARTIAL_MATCH_MISMATCH` vs `DUPLICATE_IN_B` when amounts are identical like `REC-1042` vs unequal parts) and add a `ReconciliationBatch` table so multiple CSV uploads can be audited over time without overwriting prior runs. Second, I would wire PostgreSQL `DATABASE_URL` support plus a `manage.py` check/import endpoint with row-level import error logs for unmapped `location_id` values.
