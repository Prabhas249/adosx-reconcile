# ADOSX reconciliation tool

A small Django, DRF, and Next.js application that imports dirty CSV exports from System A and System B, identifies real disagreements without dropping broken rows or flagging valid formatting quirks, and isolates every query by tenant (`org_id`).

## How to run

### 1. Backend (Django and SQLite)

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

Run `./verify.sh` from the repository root to execute `ruff` lint and complexity checks, Django tests, TypeScript checks, and the Next.js production build.

## What I built

- **Database models and dirty-safe CSV importer** in [`models.py`](backend/reconcile/models.py), [`importer.py`](backend/reconcile/importer.py), and [`import_data.py`](backend/reconcile/management/commands/import_data.py). Every row from `locations.csv` (5 rows), `system_a.csv` (120 rows), and `system_b.csv` (121 rows) imports with zero dropped rows. Raw string columns sit alongside parsed `Decimal(14, 2)` and `DateField` columns so Indian comma formatting (`1,25,400.00`), blank amounts (`ENT/2026/4050`), blank `actor_id` (`REC-1050`), orphan references (`REC-1999`), and messy references (`rec1034`, ` REC - 1070 `, `1112`) survive intact.
- **Tenant-scoped comparison logic** in [`comparator.py`](backend/reconcile/comparator.py). Every query filters by `org_id`, and requests missing `?org=` fail with HTTP 400. Valid edge cases (`REC-1034`, `REC-1070`, `REC-1112`, and the two-part settlement `REC-1055` summing `71950.93 + 107926.39 = 179877.32`) stay unflagged. Real disagreements found on the dataset are:
  - `MISSING_IN_B`: `REC-1015` (`ORG-A`), `REC-1061` (`ORG-B`)
  - `ORPHAN_IN_B`: `REC-1999` via `ENT/2026/4901` (`ORG-A`)
  - `DUPLICATE_IN_B`: `REC-1042` entered twice (`ORG-A`)
  - `VALUE_MISMATCH`: `REC-1003` (`ORG-B`), `REC-1027`, `REC-1064`, `REC-1088` (`ORG-A`)
  - `UNPARSEABLE_VALUE`: `REC-1050` blank amount in System B (`ORG-B`)
  - `VOIDED_IN_A`: `REC-1019` marked `VOIDED` in System A while active in System B (`ORG-B`)
  - `DATE_MISMATCH`: `REC-1009` date cutoff `2026-03-31` vs `2026-04-02` (`ORG-B`)
  - `TENANT_MISMATCH`: `REC-1077` placed in `LOC-102` (`ORG-A`) by System A and `LOC-201` (`ORG-B`) by System B, reported to both orgs with foreign identifiers redacted.
- **Plain table UI** in [`page.tsx`](frontend/src/app/page.tsx) with an org switcher, reason filter, and value sort showing both parsed and raw values.
- **Automated tests** in [`tests.py`](backend/reconcile/tests.py) with 11 tests covering every disagreement type, both non-error cases, cross-tenant redaction, missing `?org=` rejection, and full CSV import counts.

## What I deliberately did not build

- **Authentication and login.** The brief asked to skip auth, so tenant isolation is enforced via a mandatory `org` query parameter and ORM scoping.
- **CSV upload UI.** Ingestion runs through `python manage.py import_data` so time stayed on schema design, parser durability, and comparison rules.
- **PostgreSQL or Docker setup.** Kept SQLite as the default database so reviewers can boot the project immediately after cloning.
- **Custom CSS or component libraries.** Used a plain HTML table per the brief.

## How I worked with the agent

I used an AI coding agent to scaffold the Django project, importer, comparison module, tests, and Next.js table. Before writing code, I inspected the CSV files directly to list all dirty patterns and edge cases, then audited each generated module and verified every disagreement count against the source rows and `ruff` checks.

### Questions

**a. Name one thing the AI agent got wrong. How did you notice?**  
The first version of the duplicate detector grouped multiple System B entries by `normalized_record_ref` and flagged both `REC-1042` and `REC-1055` as duplicates. Reading the CSV rows directly showed that `REC-1055` (`179877.32` in System A) has two entries (`71950.93` and `107926.39`) whose second label reads `Entry part 2 of 2` and whose sum matches System A to the exact paisa. Filtering strictly per org also initially misclassified cross-tenant `REC-1077` as missing in System B instead of catching the tenant mismatch without leaking `LOC-201`. I fixed both rules and added regression tests for them.

**b. Which part of your submission are you least confident about, and why?**  
The split-payment check in `comparator.py` assumes at least one entry label contains `part ` alongside an exact total match. Real exports might omit that label or miss a third partial payment, which would mislabel an incomplete split as `DUPLICATE_IN_B`. In addition, tenant scoping currently relies on a query parameter rather than an authenticated session token.

**c. If you had a second day, what would you fix first?**  
First, I would distinguish partial-sum mismatches from identical duplicate entries (`REC-1042`) without relying on label text, and add a batch model so repeated imports keep history instead of replacing prior rows. Second, I would add `DATABASE_URL` support for PostgreSQL and an import report for any row whose `location_id` is missing from `locations.csv`.
