#!/bin/zsh
# One-off: convert time_entries.start/end from TIMESTAMP to TIMESTAMPTZ, reading the
# existing values as the UTC they already are. Runs via the Supabase Management API
# (see ../SUPABASE_NOTES.md, "Running setup / DDL"). Takes a throwaway personal
# access token on stdin so it never lands in shell history or a transcript:
#   pbpaste | scripts/fix_timestamp_columns.sh        (token on the clipboard)
# Revoke the token at dashboard -> account -> tokens afterwards.
set -e
REF=gbvfxegdhnwkqklkjkxa
read -r PAT
[[ -z "$PAT" ]] && { echo "no token on stdin" >&2; exit 1; }

run() {
  local body
  body=$(printf '%s' "$1" | python3 -c 'import json,sys; print(json.dumps({"query": sys.stdin.read()}))')
  curl -s -w '\nHTTP %{http_code}\n' "https://api.supabase.com/v1/projects/$REF/database/query" \
    -H "Authorization: Bearer $PAT" -H "Content-Type: application/json" -H "User-Agent: Mozilla/5.0" \
    --data-binary "$body"
}

CHECK="select column_name, data_type from information_schema.columns where table_name='time_entries' and column_name in ('start','end');"
echo "--- before"; run "$CHECK"
echo "--- alter"
run "alter table time_entries alter column \"start\" type timestamptz using \"start\" at time zone 'UTC', alter column \"end\" type timestamptz using \"end\" at time zone 'UTC';"
echo "--- after"; run "$CHECK"
