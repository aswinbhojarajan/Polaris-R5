#!/usr/bin/env bash
set -euo pipefail

# A private temporary cluster, never DATABASE_URL or the application database.
# Refuse to attach to/reuse another server, even one listening locally.
for tool in initdb pg_ctl pg_isready pdftotext; do
  command -v "$tool" >/dev/null || { echo "Required native-search test tool missing: $tool" >&2; exit 1; }
done
files=("$@")
if [ "${#files[@]}" -eq 0 ]; then
  files=(
    server/tests/native-web-search.test.ts
    server/tests/native-web-search-admission.test.ts
    server/tests/native-web-search-store.test.ts
    server/tests/native-web-search-scoring.test.ts
    server/tests/native-web-search-routes.test.ts
    server/tests/pilot-budget.test.ts
    server/tests/native-web-search-production-budget.test.ts
  )
fi
for file in "${files[@]}"; do
  case "$file" in
    server/tests/native-web-search*.test.ts|server/tests/pilot-budget.test.ts) ;;
    *) echo "Unsupported native-search test file: $file" >&2; exit 1 ;;
  esac
  test -f "$file" || { echo "Missing test file: $file" >&2; exit 1; }
done
if pg_isready -h 127.0.0.1 -p 55432 >/dev/null 2>&1; then
  echo "Port 55432 is already serving PostgreSQL. Stop your own test instance first; no existing database was used." >&2
  exit 1
fi
cluster="$(mktemp -d /tmp/polaris-native-search-test.XXXXXX)"
cleanup() {
  pg_ctl -D "$cluster" -m fast stop >/dev/null 2>&1 || true
  rm -rf "$cluster"
}
trap cleanup EXIT
initdb -D "$cluster" -A trust -U polaris --no-locale >/dev/null
pg_ctl -D "$cluster" -l "$cluster/server.log" -o "-p 55432 -h 127.0.0.1 -k $cluster" start >/dev/null
test_url="postgresql://polaris@127.0.0.1:55432/postgres"
env -u OPENAI_API_KEY -u ANTHROPIC_API_KEY -u GOOGLE_API_KEY -u PERPLEXITY_API_KEY \
  -u DEFAULT_ADMIN_PASSWORD -u SAMPLE_USER_PASSWORD -u GITHUB_TOKEN -u SESSION_SECRET -u TEST_AUTH_BYPASS \
  DATABASE_URL="$test_url" NATIVE_SEARCH_TEST_DATABASE_URL="$test_url" AEO_MODE=off \
  npx drizzle-kit push --force
env -u OPENAI_API_KEY -u ANTHROPIC_API_KEY -u GOOGLE_API_KEY -u PERPLEXITY_API_KEY \
  -u DEFAULT_ADMIN_PASSWORD -u SAMPLE_USER_PASSWORD -u GITHUB_TOKEN -u SESSION_SECRET -u TEST_AUTH_BYPASS \
  DATABASE_URL="$test_url" NATIVE_SEARCH_TEST_DATABASE_URL="$test_url" AEO_MODE=off NODE_ENV=test \
  npx tsx --test --test-reporter=spec \
    "${files[@]}"
