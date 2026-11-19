Security tests for `schema.sql`. Run them against a plain local Postgres 15+ database, never against your real project:

    psql -d test -f mock_supabase.sql      # stand-ins for Supabase auth, storage and roles
    psql -d test -f ../schema.sql
    psql -d test -f security_tests.sql 2>&1 | grep -E "PASS|FAIL"

All 67 checks should print PASS.
