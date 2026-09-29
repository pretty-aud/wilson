#!/usr/bin/env python
"""
Build a single self-contained .sql that runs a pgTAP suite against a HOSTED
Supabase project through `supabase db query --linked --file`, with no Docker
and no pgtap extension required.

How it works (the trap list from MASTER_PLAN §8 / wilson_otter_cloud_traps):
  * `SELECT plan(N)` is KEPT — a suite without a plan raises "test without a
    plan" under real pgTAP, so removing it would make the file diverge from
    what CI runs.
  * EVERY pgTAP function the suite uses is rewritten to append to tapx.out.
    A missed one (has_table bit S11) still runs, still consumes a pgTAP test
    number, but never reaches the collector — so it silently vanishes from
    the pass count. The caller MUST compare collected rows against plan(N).
  * Recording is SECURITY DEFINER via tapx.record so it keeps working after
    the suite does `SET ROLE authenticated`.
  * throws_ok/lives_ok are SECURITY INVOKER: they EXECUTE the probe SQL, so
    it has to run as the CALLER or every RLS probe would pass as postgres.

Usage (run from WILSON/, with the CLI linked to the target project):

    python scripts/tap-hosted.py /tmp/run.sql supabase/tests/rls/34_workspace_ai_keys.sql
    supabase db query --linked --file /tmp/run.sql

Pass a migration BEFORE the suite to test an unapplied migration together
with its suite in one rolled-back transaction — nothing is committed, so
this is the safe way to iterate on a migration against real Postgres:

    python scripts/tap-hosted.py /tmp/run.sql \
        supabase/migrations/0028_operator_console.sql \
        supabase/tests/rls/34_workspace_ai_keys.sql

The final row is the verdict: planned / collected / passed / failed /
failures. `collected` MUST equal `planned` — if it does not, this shim is
missing a pgTAP function the suite calls and the run is lying about
coverage, not merely failing.

Validated (Session 15) against pre-existing suites 17, 24, 25 and 33 with
exact plan/collected/passed parity before it was trusted on new code.

This exists because the machine WILSON is developed on has no Docker, so
`supabase test db` (which needs the local stack) cannot run here — only in
CI. Every session up to S14 rebuilt an ad-hoc version of this file.
"""
import re
import sys

HEADER = r"""
-- ===========================================================================
-- GENERATED pgTAP shim — do not commit. Wraps the suite(s) below so they can
-- run against a hosted project without Docker. Everything rolls back.
-- ===========================================================================
BEGIN;

CREATE SCHEMA IF NOT EXISTS tapx;
CREATE SEQUENCE tapx.seq;
CREATE TABLE tapx.out (n bigint, ok boolean, descr text, detail text);
CREATE TABLE tapx.plans (planned int);

GRANT USAGE ON SCHEMA tapx TO PUBLIC;

-- SECURITY DEFINER so the collector still works once the suite has done
-- SET ROLE authenticated (the suite runs most probes de-privileged).
CREATE OR REPLACE FUNCTION tapx.record(p_ok boolean, p_descr text, p_detail text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER AS $tapx$
DECLARE v bigint;
BEGIN
  v := nextval('tapx.seq');
  INSERT INTO tapx.out VALUES (v, COALESCE(p_ok, false), p_descr, p_detail);
  RETURN (CASE WHEN COALESCE(p_ok, false) THEN 'ok ' ELSE 'not ok ' END) || v || ' - ' || COALESCE(p_descr, '');
END;
$tapx$;
GRANT EXECUTE ON FUNCTION tapx.record(boolean, text, text) TO PUBLIC;

CREATE OR REPLACE FUNCTION tapx.note_plan(p int)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER AS $tapx$
BEGIN
  INSERT INTO tapx.plans VALUES (p);
  RETURN '1..' || p;
END;
$tapx$;
GRANT EXECUTE ON FUNCTION tapx.note_plan(int) TO PUBLIC;

-- ── pgTAP surface, rewritten ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.plan(int)
RETURNS text LANGUAGE sql AS $tapx$ SELECT tapx.note_plan($1); $tapx$;

CREATE OR REPLACE FUNCTION public.ok(boolean, text)
RETURNS text LANGUAGE sql AS $tapx$ SELECT tapx.record($1, $2, NULL); $tapx$;

CREATE OR REPLACE FUNCTION public.ok(boolean)
RETURNS text LANGUAGE sql AS $tapx$ SELECT tapx.record($1, NULL, NULL); $tapx$;

CREATE OR REPLACE FUNCTION public.is(anyelement, anyelement, text)
RETURNS text LANGUAGE sql AS $tapx$
  SELECT tapx.record($1 IS NOT DISTINCT FROM $2, $3,
    CASE WHEN $1 IS NOT DISTINCT FROM $2 THEN NULL
         ELSE 'have: ' || COALESCE($1::text, 'NULL') || '  want: ' || COALESCE($2::text, 'NULL') END);
$tapx$;

CREATE OR REPLACE FUNCTION public.isnt(anyelement, anyelement, text)
RETURNS text LANGUAGE sql AS $tapx$
  SELECT tapx.record($1 IS DISTINCT FROM $2, $3, NULL);
$tapx$;

CREATE OR REPLACE FUNCTION public.has_table(name, name, text)
RETURNS text LANGUAGE sql AS $tapx$
  SELECT tapx.record(
    EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = $1::text AND c.relname = $2::text AND c.relkind IN ('r','p')),
    $3, NULL);
$tapx$;

CREATE OR REPLACE FUNCTION public.has_column(name, name, name, text)
RETURNS text LANGUAGE sql AS $tapx$
  SELECT tapx.record(
    EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = $1::text AND table_name = $2::text AND column_name = $3::text),
    $4, NULL);
$tapx$;

-- Track A (A1, 2026-09-06): the three column-shape probes suite 67 calls.
-- Until now the shim had none of them, so 67_member_full_time.sql aborted the
-- hosted run on every environment ("function col_type_is(...) does not
-- exist") while CI's real pgTAP passed it — the standing rule is to extend the
-- shim rather than weaken the suite (43 and 49 had rewritten the same probes
-- over information_schema to dodge exactly this). Same comparisons real pgTAP
-- makes: the DISPLAYED type (format_type), attnotnull, and the default's
-- deparsed expression. The detail carries what was actually found.
CREATE OR REPLACE FUNCTION public.col_type_is(name, name, name, text, text)
RETURNS text LANGUAGE sql AS $tapx$
  SELECT tapx.record(
    (SELECT format_type(a.atttypid, a.atttypmod) FROM pg_attribute a
       JOIN pg_class c ON c.oid = a.attrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1::text AND c.relname = $2::text AND a.attname = $3::text
        AND a.attnum > 0 AND NOT a.attisdropped) = $4,
    $5,
    'have: ' || COALESCE((SELECT format_type(a.atttypid, a.atttypmod) FROM pg_attribute a
       JOIN pg_class c ON c.oid = a.attrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1::text AND c.relname = $2::text AND a.attname = $3::text
        AND a.attnum > 0 AND NOT a.attisdropped), '(no such column)') || '  want: ' || $4);
$tapx$;

CREATE OR REPLACE FUNCTION public.col_not_null(name, name, name, text)
RETURNS text LANGUAGE sql AS $tapx$
  SELECT tapx.record(
    COALESCE((SELECT a.attnotnull FROM pg_attribute a
       JOIN pg_class c ON c.oid = a.attrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1::text AND c.relname = $2::text AND a.attname = $3::text
        AND a.attnum > 0 AND NOT a.attisdropped), false),
    $4, NULL);
$tapx$;

CREATE OR REPLACE FUNCTION public.col_default_is(name, name, name, text, text)
RETURNS text LANGUAGE sql AS $tapx$
  SELECT tapx.record(
    (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
       JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
       JOIN pg_class c ON c.oid = a.attrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1::text AND c.relname = $2::text AND a.attname = $3::text) = $4,
    $5,
    'have: ' || COALESCE((SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
       JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
       JOIN pg_class c ON c.oid = a.attrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1::text AND c.relname = $2::text AND a.attname = $3::text), '(no default)') || '  want: ' || $4);
$tapx$;

CREATE OR REPLACE FUNCTION public.has_function(text, text, text)
RETURNS text LANGUAGE sql AS $tapx$
  SELECT tapx.record(
    EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = $1 AND p.proname = $2),
    $3, NULL);
$tapx$;

-- Compare TYPE OIDs, the way real pgTAP does. Comparing the rendered
-- identity-argument string does NOT work: pg_get_function_identity_arguments
-- includes PARAMETER NAMES when they are declared ("p_bucket text, ..."),
-- so a perfectly good has_function probe would report missing — a harness
-- that lies in the failing direction, which is how a suite silently loses
-- probes (the S11 has_table bug, inverted).
CREATE OR REPLACE FUNCTION public.has_function(text, text, text[], text)
RETURNS text LANGUAGE sql AS $tapx$
  SELECT tapx.record(
    EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = $1 AND p.proname = $2
               -- Compared as TEXT, not as oid[]: casting the oidvector gives a
               -- ZERO-based array ([0:3]={25,25,23,23}) while array_agg gives a
               -- one-based one, and Postgres array equality compares bounds —
               -- so the oid[] form is always false. proargtypes::text is
               -- '25 25 23 23', and '' for a zero-argument function.
               AND p.proargtypes::text = (
                     SELECT COALESCE(string_agg(t::regtype::oid::text, ' ' ORDER BY ord), '')
                       FROM unnest($3) WITH ORDINALITY AS u(t, ord))),
    $4, NULL);
$tapx$;

CREATE OR REPLACE FUNCTION public.has_trigger(text, text, text, text)
RETURNS text LANGUAGE sql AS $tapx$
  SELECT tapx.record(
    EXISTS (SELECT 1 FROM pg_trigger t
              JOIN pg_class c ON c.oid = t.tgrelid
              JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = $1 AND c.relname = $2 AND t.tgname = $3
               AND NOT t.tgisinternal),
    $4, NULL);
$tapx$;

CREATE OR REPLACE FUNCTION public.has_trigger(name, name, name, text)
RETURNS text LANGUAGE sql AS $tapx$
  SELECT public.has_trigger($1::text, $2::text, $3::text, $4);
$tapx$;

-- SECURITY INVOKER on purpose: the probe SQL must run as the CALLER, or every
-- RLS assertion in the suite would execute as postgres and pass vacuously.
CREATE OR REPLACE FUNCTION public.throws_ok(text, text, text)
RETURNS text LANGUAGE plpgsql AS $tapx$
DECLARE
  got text;
BEGIN
  BEGIN
    EXECUTE $1;
  EXCEPTION WHEN OTHERS THEN
    got := SQLERRM;
    IF $2 IS NULL OR got = $2 THEN
      RETURN tapx.record(true, $3, NULL);
    END IF;
    RETURN tapx.record(false, $3, 'threw: ' || got || '  want: ' || $2);
  END;
  RETURN tapx.record(false, $3, 'no exception raised');
END;
$tapx$;

CREATE OR REPLACE FUNCTION public.throws_ok(text, text)
RETURNS text LANGUAGE sql AS $tapx$ SELECT public.throws_ok($1, $2, NULL::text); $tapx$;

-- Real pgTAP's four-argument form: (sql, errcode, errmsg, description), where
-- errcode is a SQLSTATE. Added for suite 68, which matches by SQLSTATE rather
-- than by message text on purpose — Postgres names the ALPHABETICALLY FIRST
-- matching constraint when it reports a violation, so a message-matched
-- assertion starts failing the day an unrelated constraint sorts earlier.
-- Without this overload such a suite cannot run under the shim at all: it is a
-- hard "function does not exist", not a silent miss.
-- NULL in either of errcode/errmsg means "do not check that one", matching pgTAP.
CREATE OR REPLACE FUNCTION public.throws_ok(text, char(5), text, text)
RETURNS text LANGUAGE plpgsql AS $tapx$
DECLARE
  got   text;
  state text;
BEGIN
  BEGIN
    EXECUTE $1;
  EXCEPTION WHEN OTHERS THEN
    got := SQLERRM; state := SQLSTATE;
    IF ($2 IS NULL OR state = $2) AND ($3 IS NULL OR got = $3) THEN
      RETURN tapx.record(true, $4, NULL);
    END IF;
    RETURN tapx.record(
      false, $4,
      'threw ' || state || ': ' || got ||
      '  want state: ' || COALESCE($2::text, '<any>') ||
      '  want msg: '   || COALESCE($3, '<any>'));
  END;
  RETURN tapx.record(false, $4, 'no exception raised');
END;
$tapx$;

CREATE OR REPLACE FUNCTION public.lives_ok(text, text)
RETURNS text LANGUAGE plpgsql AS $tapx$
BEGIN
  EXECUTE $1;
  RETURN tapx.record(true, $2, NULL);
EXCEPTION WHEN OTHERS THEN
  RETURN tapx.record(false, $2, 'threw: ' || SQLERRM);
END;
$tapx$;

CREATE OR REPLACE FUNCTION public.finish()
RETURNS SETOF text LANGUAGE sql AS $tapx$ SELECT NULL::text WHERE false; $tapx$;

CREATE OR REPLACE FUNCTION public.diag(text)
RETURNS text LANGUAGE sql AS $tapx$ SELECT '# ' || $1; $tapx$;

-- ── suite(s) ───────────────────────────────────────────────────────────────
"""

FOOTER = r"""
-- ── verdict ────────────────────────────────────────────────────────────────
-- The suite leaves the session as `authenticated` (that is the point of it),
-- so de-auth before reading the collector — otherwise the summary itself
-- trips RLS/table privileges and the whole run reports as an error.
SELECT set_config('request.jwt.claims', '', true);
RESET ROLE;

-- collected MUST equal planned. A pgTAP call the shim forgot to rewrite still
-- runs and still burns a test number, but never reaches tapx.out — which is
-- exactly how a suite silently loses probes (the S11 has_table bug).
SELECT
  (SELECT sum(planned) FROM tapx.plans)                        AS planned,
  (SELECT count(*)     FROM tapx.out)                          AS collected,
  (SELECT count(*)     FROM tapx.out WHERE ok)                 AS passed,
  (SELECT count(*)     FROM tapx.out WHERE NOT ok)             AS failed,
  (SELECT COALESCE(string_agg('#' || n || ' ' || COALESCE(descr, '(no description)')
            || COALESCE('  [' || detail || ']', ''), E'\n' ORDER BY n), '')
     FROM tapx.out WHERE NOT ok)                               AS failures;

ROLLBACK;
"""


def strip_wrapper(sql: str) -> str:
    """Drop the suite's own BEGIN/COMMIT/ROLLBACK — the harness owns the txn."""
    out = []
    for line in sql.splitlines():
        if re.fullmatch(r"\s*(BEGIN|COMMIT|ROLLBACK)\s*;\s*", line, re.I):
            continue
        # SELECT * FROM finish(); is a no-op here but harmless; keep it out
        # so it cannot emit rows that confuse the final SELECT.
        if re.fullmatch(r"\s*SELECT\s+\*\s+FROM\s+finish\(\)\s*;\s*", line, re.I):
            continue
        out.append(line)
    return "\n".join(out)


def main() -> None:
    if len(sys.argv) < 3:
        sys.exit("usage: tap_harness.py <out.sql> <suite.sql> [...]")
    out_path = sys.argv[1]
    parts = [HEADER]
    for path in sys.argv[2:]:
        with open(path, encoding="utf-8") as fh:
            parts.append("\n-- >>> %s\n" % path)
            parts.append(strip_wrapper(fh.read()))
    parts.append(FOOTER)
    # Explicit utf-8: the suites carry box-drawing characters and the default
    # Windows console codec (cp1252) cannot encode them.
    with open(out_path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(parts))


if __name__ == "__main__":
    main()
