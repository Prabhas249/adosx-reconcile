# ADOSX reconciliation tool

A Django, Django REST Framework, and Next.js application that imports inconsistent CSV exports from System A and System B, finds real disagreements without dropping broken rows or flagging valid formatting variations, and restricts every response to a single org (`org_id`).

## How to run

### 1. Backend (Django and SQLite, Python 3.12+)

Requires Python 3.12 or newer (for `django==6.1.3` and `asgiref==3.13.0`) and Node.js 20 or newer.

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

- **Database models and resilient CSV importer** in [`models.py`](backend/reconcile/models.py), [`importer.py`](backend/reconcile/importer.py), and [`import_data.py`](backend/reconcile/management/commands/import_data.py). All rows from `locations.csv` (5 rows), `system_a.csv` (120 rows), and `system_b.csv` (121 rows) import with zero dropped rows. Raw string columns sit alongside parsed `DecimalField(max_digits=14, decimal_places=2)` and `DateField` columns so Indian comma formatting (`1,25,400.00`), blank amounts (`ENT/2026/4050`), blank `actor_id` (`REC-1050`), orphan references (`REC-1999`), and unformatted references (`rec1034`, ` REC - 1070 `, `1112`) stay intact.
- **Org-scoped comparison logic** in [`comparator.py`](backend/reconcile/comparator.py). Every query loads records only for the requested `org_id`, and requests without a valid `?org=` fail with HTTP 400. Valid variations (`REC-1034`, `REC-1070`, `REC-1112`, and the two-part settlement `REC-1055` summing `71950.93 + 107926.39 = 179877.32`) stay unflagged. The dataset produces these 13 disagreements:
  - `MISSING_IN_B`: `REC-1015` (`ORG-A`), `REC-1061` (`ORG-B`)
  - `ORPHAN_IN_B`: `REC-1999` via `ENT/2026/4901` (`ORG-A`)
  - `DUPLICATE_IN_B`: `REC-1042` entered twice (`ORG-A`)
  - `VALUE_MISMATCH`: `REC-1003` (`ORG-B`), `REC-1027`, `REC-1064`, `REC-1088` (`ORG-A`)
  - `UNPARSEABLE_VALUE`: `REC-1050` blank amount in System B (`ORG-B`)
  - `VOIDED_IN_A`: `REC-1019` has `VOIDED` state in System A while active in System B (`ORG-B`)
  - `DATE_MISMATCH`: `REC-1009` date cutoff `2026-03-31` vs `2026-04-02` (`ORG-B`)
  - `TENANT_MISMATCH`: System A assigns `REC-1077` to `LOC-102` (`ORG-A`) while System B assigns it to `LOC-201` (`ORG-B`). Both orgs see the boundary disagreement with foreign identifiers redacted.
- **Responsive table UI and row inspector** in [`page.tsx`](frontend/src/app/page.tsx) and [`globals.css`](frontend/src/app/globals.css) with a segmented org switcher, search box, reason filter, sort control, copyable record IDs, and a keyboard-accessible detail drawer showing parsed and raw CSV values.
- **Automated tests** in [`tests.py`](backend/reconcile/tests.py) with 17 unit and API tests covering every disagreement reason in `REASON_LABELS` (including same-org `LOCATION_MISMATCH`), both non-error cases, unmapped locations, cross-tenant redaction, `/api/orgs/`, query parameter validation, value sorting with null amounts, and full CSV import counts.

## What I did not build

- **Authentication and login.** The brief asked to skip auth, so [`views.py`](backend/reconcile/views.py) enforces org scoping through a mandatory `org` query parameter and ORM filters.
- **CSV upload UI.** Ingestion runs through `python manage.py import_data` so I could focus on schema design, parser resilience, and comparison rules.
- **PostgreSQL or Docker setup.** I kept SQLite as the default database so reviewers can run the app immediately after cloning.
- **Custom CSS or component libraries.** I used a plain HTML table per the brief.

## How I worked with the agent

I used an AI coding agent to scaffold the Django project, importer, comparator, tests, and Next.js table. Before writing code, I inspected the CSV files directly to catalog every formatting quirk and edge case, then audited each generated module and checked every disagreement count against the source rows and `ruff` checks.

### Questions

**a. Name one thing the AI agent got wrong. How did you notice?**  
The first version of the duplicate detector grouped multiple System B entries by `normalized_record_ref` and flagged both `REC-1042` and `REC-1055` as duplicates. Reading the CSV rows directly showed that `REC-1055` (`179877.32` in System A) has two entries (`71950.93` and `107926.39`) whose second label reads `Entry part 2 of 2` and whose sum matches System A (`179877.32`). Filtering strictly per org also initially misclassified cross-tenant `REC-1077` as missing in System B instead of catching the tenant mismatch without leaking `LOC-201`. I fixed both rules and added regression tests for them.

**b. Which part of your submission are you least confident about, and why?**  
The split-payment check in `comparator.py` assumes at least one entry label contains `part ` alongside an exact total match. Real exports might omit that label or drop a partial entry, which would report an incomplete split as `DUPLICATE_IN_B`. Org scoping also relies on a query parameter rather than an authenticated session token.

**c. If you had a second day, what would you fix first?**  
First, I would separate partial-sum mismatches from identical duplicate entries (`REC-1042`) without relying on label text, and add an import-batch model so repeated imports keep history instead of replacing prior rows. Second, I would add `DATABASE_URL` support for PostgreSQL and an import report flagging rows whose `location_id` is missing from `locations.csv`.

