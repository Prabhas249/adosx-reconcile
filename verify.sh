#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "1. Python lint and complexity check (ruff)"
if [ -x "$ROOT/backend/.venv/bin/ruff" ]; then
  "$ROOT/backend/.venv/bin/ruff" check "$ROOT/backend"
elif command -v ruff >/dev/null 2>&1; then
  ruff check "$ROOT/backend"
else
  echo "ruff not found. Install dev tools with: pip install -r backend/requirements-dev.txt"
  exit 1
fi

echo "2. Django tests"
if [ -x "$ROOT/backend/.venv/bin/python" ]; then
  "$ROOT/backend/.venv/bin/python" "$ROOT/backend/manage.py" test reconcile
elif command -v python3 >/dev/null 2>&1; then
  python3 "$ROOT/backend/manage.py" test reconcile
else
  python "$ROOT/backend/manage.py" test reconcile
fi

echo "3. TypeScript check"
npx --prefix "$ROOT/frontend" tsc --noEmit

echo "4. Next.js production build"
npm --prefix "$ROOT/frontend" run build

echo "All checks passed."
