# ADOSX reconciliation tool

A Django, Django REST Framework, and Next.js application that imports inconsistent CSV exports from System A and System B, finds real disagreements without dropping broken rows or flagging valid formatting variations, and restricts every response to a single org (`org_id`).

## How to run

### 1. Backend (Django and SQLite, Python 3.12+)

Requires Python 3.12 or newer and Node.js 20 or newer.

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

### 2. Frontend (Next.js)

In a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### 3. Verification script

Install dev dependencies (`pip install -r backend/requirements-dev.txt`), then run `./verify.sh` from the repository root to run `ruff` lint and complexity checks, Django tests, TypeScript checks, and the Next.js production build.

## What I built

- **Database models and resilient CSV importer** in [`models.py`](backend/reconcile/models.py), [`importer.py`](backend/reconcile/importer.py), and [`import_data.py`](backend/reconcile/management/commands/import_data.py). All rows from `locations.csv` (5 rows), `system_a.csv` (120 rows), and `system_b.csv` (121 rows) import with zero dropped rows. Raw string columns and original CSV line numbers (`source_row`) sit alongside parsed `DecimalField(max_digits=14, decimal_places=2)` and `DateField` columns so Indian comma formatting (`1,25,400.00`), blank amounts (`ENT/2026/4050`), blank `actor_id` (`REC-1050`), orphan references (`REC-1999`), and unformatted references (`rec1034`, ` REC - 1070 `, `1112`) stay intact. Duplicate normalized `record_id` rows in `SystemARecord` keep their true `record_id` (non-unique index) and log an import warning instead of rewriting identifiers, while colliding `SystemBEntry.entry_id` values keep both rows via `_unique_id` (`*-DUP-ROW-<n>`) alongside warnings for unparseable values and unmapped locations.
- **Org-scoped comparison logic and API metadata** in [`comparator.py`](backend/reconcile/comparator.py) and [`views.py`](backend/reconcile/views.py). Every query loads records only for the requested `org_id`, and requests without a valid `?org=` fail with HTTP 400. Valid variations (`REC-1034`, `REC-1070`, `REC-1112`, and the two-part settlement `REC-1055` summing `71950.93 + 107926.39 = 179877.32`) stay unflagged. Multi-entry records distinguish unparseable entries (`UNPARSEABLE_VALUE`), exact split sums (`None`), repeated full-amount postings (`DUPLICATE_IN_B` when at least two entries repeat `total_value`, as in `REC-1042`), and ambiguous or non-matching multi-entry sets (`MULTI_ENTRY_UNRESOLVED`, including repeated partial amounts like `400 + 400` vs `1000`, `1000 + 250` vs `1000`, and duplicate `SystemARecord` rows). When System B's amount equals System A's `base_value` (`REC-1003`, `REC-1027`, `REC-1088`), the detail string notes that System B omitted the adjustment. Money magnitudes (`sort_value`) remain fixed-point `Decimal` strings end-to-end, `TENANT_MISMATCH` redacts foreign org row numbers and amounts before serialization, and `/api/disagreements/` returns unfiltered `total_org_count`, `org_max_sort_value`, and `reason_counts` so KPI summaries and relative magnitude bars stay stable when filtering. The dataset produces these 13 disagreements:
  - `MISSING_IN_B`: `REC-1015` (`ORG-A`), `REC-1061` (`ORG-B`)
  - `ORPHAN_IN_B`: `REC-1999` via `ENT/2026/4901` (`ORG-A`)
  - `DUPLICATE_IN_B`: `REC-1042` entered twice (`ORG-A`)
  - `VALUE_MISMATCH`: `REC-1003` (`ORG-B`), `REC-1027`, `REC-1064`, `REC-1088` (`ORG-A`)
  - `UNPARSEABLE_VALUE`: `REC-1050` blank amount in System B (`ORG-B`)
  - `VOIDED_IN_A`: `REC-1019` has `VOIDED` state in System A while active in System B (`ORG-B`)
  - `DATE_MISMATCH`: `REC-1009` date cutoff `2026-03-31` vs `2026-04-02` (`ORG-B`)
  - `TENANT_MISMATCH`: System A assigns `REC-1077` to `LOC-102` (`ORG-A`) while System B assigns it to `LOC-201` (`ORG-B`). Both orgs see the boundary disagreement with foreign identifiers redacted.
- **Responsive table UI, row inspector, and Knowledge Base** in [`page.tsx`](frontend/src/app/page.tsx), [`reconcile.ts`](frontend/src/lib/reconcile.ts), [`ui.tsx`](frontend/src/components/ui.tsx), [`InspectorDrawer.tsx`](frontend/src/components/InspectorDrawer.tsx), [`KnowledgeBaseDrawer.tsx`](frontend/src/components/KnowledgeBaseDrawer.tsx), and [`globals.css`](frontend/src/app/globals.css) with a segmented org switcher, INR (`₹`) `en-IN` lakh formatting, stacked multi-entry raw lines, clickable column sort headers synced with the `Sort by` menu, search and reason filters, copyable record IDs, focus-trapped Source Provenance inspector and Rule-Based Audit Q&A, and a CSV-grounded rules drawer.
- **Automated tests** in [`tests.py`](backend/reconcile/tests.py) with 23 unit and API tests covering every disagreement reason in `REASON_LABELS` (including same-org `LOCATION_MISMATCH` and `MULTI_ENTRY_UNRESOLVED`), both non-error cases, repeated partials vs full duplicates, `base_value` mismatch hints, unmapped locations, duplicate `record_id` preservation without synthetic rewriting, consistent `replace=False` append behavior across both CSVs, cross-tenant provenance redaction, `/api/orgs/`, `/api/disagreements/` unfiltered summary stability, query parameter validation, `Decimal`-precision value sorting with null amounts, and the exact disagreement set per org on the full CSV import.

## What I did not build

- **Authentication and login.** The brief asked to skip auth, so [`views.py`](backend/reconcile/views.py) enforces org scoping through a mandatory `org` query parameter and ORM filters, and `/api/orgs/` supplies the org switcher list.
- **CSV upload UI.** Ingestion runs through `python manage.py import_data` so I could focus on schema design, parser resilience, and comparison rules.
- **PostgreSQL or Docker setup.** I kept SQLite as the default database so reviewers can run the app immediately after cloning.
- **External UI component libraries.** I used semantic HTML and CSS custom properties with zero frontend runtime dependencies beyond React and Next.js.

## How I worked with the agent

I used an AI coding agent to scaffold the Django project, importer, comparator, tests, and Next.js table. Before writing code, I inspected the CSV files directly to catalog every formatting quirk and edge case, then audited each generated module and checked every disagreement count against the source rows and `ruff` checks.

### Questions

**a. Name one thing the AI agent got wrong. How did you notice?**  
In the cross-tenant membership query in `comparator.py`, the agent initially wrote `.exclude(location__org_id=org_id)` without `.filter(location__isnull=False)`. In Django ORM, excluding a foreign-key attribute also matches rows where `location` is `NULL`, which would misclassify an unmapped-location row as `TENANT_MISMATCH` instead of `MISSING_IN_B`. The agent also initially classified every non-matching multi-entry sum in `_reconcile_multi_entry` as `DUPLICATE_IN_B` (even when two partial entries had different amounts that failed to sum to System A's total), used `update_or_create` in `importer.py` in a way that overwrote colliding normalized keys in the same file, and claimed every disagreement reason was tested while `LOCATION_MISMATCH` had no unit test. I caught these by auditing `comparator.py`, `importer.py`, and `tests.py` against `REASON_LABELS` and writing tests for unmapped locations, unresolved partial settlements (`MULTI_ENTRY_UNRESOLVED`), duplicate-key row preservation, and `LOCATION_MISMATCH`.

**b. Which part of your submission are you least confident about, and why?**  
Cross-tenant detection (`TENANT_MISMATCH` on `REC-1077`) assumes `record_id` (`REC-XXXX`) is a globally unique event identifier across organizations rather than a sequence generated independently per tenant. In the provided dataset (`REC-1001` through `REC-1120` shared across `ORG-A` and `ORG-B`), `REC-1077` is a single event recorded under `LOC-102` in System A and `LOC-201` in System B. If two independent tenants could ever generate the same `REC-1077` identifier for unrelated transactions, matching by `normalized_record_ref` across orgs without a shared global UUID or timestamp and amount correlation could raise a false cross-tenant alert. Org scoping also relies on a query parameter rather than an authenticated session token.

**c. If you had a second day, what would you fix first?**  
First, I would add an `ImportBatch` model and store source rows per import batch (keyed by `(batch_id, source_row)`) so repeated imports preserve full historical audit trails instead of replacing prior rows, and quarantine rows whose `location_id` is missing from `locations.csv` into an unmapped-records queue. Second, I would replace the `?org=` query parameter with signed session or JWT tenant middleware and add `DATABASE_URL` support for PostgreSQL.
