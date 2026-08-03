-- =============================================================================
-- 0032_rate_card_type.sql  (Session 21)
--
-- rate_cards.type — the column the whole internal-vs-general feature keys on,
-- and which was never added to the cloud schema.
--
-- This is 0015's missing sibling. 0015 (Session 6) fixed exactly this failure
-- for rate_card_entries — "in cloud mode upsertRateCardEntry previously failed
-- with PGRST204 on these fields" — and added member_id/wage/burden/... so the
-- per-person card became real on Supabase. It did not touch the card SHELL,
-- so `type` stayed a local-mode-only field.
--
-- The break, measured:
--   * useRateCard.js writes `type` on all four upsertRateCard call sites
--     (:136 'general', :143 'internal', :158 the untyped-card backfill,
--     :169 'internal') and reads it at :152, :153 and :183.
--   * supabaseAdapter.js:861 upserts through sanitize(card, ['created_at']),
--     a pure DENYLIST — so `type` is passed straight to PostgREST rather than
--     being dropped, and PostgREST rejects the whole insert with PGRST204
--     because the column does not exist.
--   * Net effect, and the one root cause behind two separate reports: the
--     "type column" error on the Rate Card page, and the Internal card being
--     unreachable (:183 falls back to the first card, which is General).
--
-- Design notes:
--
--   * NOT NULL DEFAULT 'general' IS the backfill. On PG 11+ this is a
--     metadata-only change: no table rewrite, and every pre-existing row
--     reads 'general' immediately. Safe on a populated staging/prod.
--     All four callers set `type` explicitly, so nothing passes an explicit
--     NULL that the NOT NULL would newly reject; omission takes the default.
--
--   * DELIBERATELY NO unique index on (workspace_id, type). Because every
--     existing row backfills to 'general', a workspace that already holds two
--     rate cards would violate it and ABORT this migration on staging/prod —
--     a schema change that fails only where there is real data is the worst
--     kind. The client already tolerates duplicates: useRateCard.js:183 picks
--     with .find(), first match wins. If one-card-per-type is ever wanted it
--     needs its own migration that de-duplicates first.
--
--   * The REVOKE block below was NOT in the plan for this migration. It is
--     here because 07_rate_cards.sql grew the standing anon assertion and it
--     FAILED. Measured on wilson-dev, 2026-08-02:
--
--       anon holds DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE,
--       UPDATE on public.rate_cards — and on 26 of the 36 public tables.
--
--     That is migration 0011's blanket grant, still in force on every table
--     no later migration explicitly revoked (the 10 clean ones are 0028's,
--     0030's and 0031's). RLS is enabled AND forced here, so an anon caller
--     still reads zero rows — but that leaves RLS as the ONLY barrier, and
--     TRUNCATE is not subject to RLS at all.
--
--     This migration closes it for the table it already touches, in the 0031
--     pattern. `authenticated` keeps SELECT/INSERT/UPDATE/DELETE — members
--     create the two card shells on first visit and admins edit them, all
--     scoped by the 0004 policies. It loses only the three privileges no
--     PostgREST call can use and that RLS does not constrain.
--
--     Safe because nothing reads rate_cards before sign-in: both access
--     points (supabaseAdapter.js:857, :861) require a workspace_id, and
--     useRateCard.js:117 early-returns without one. So no request changes
--     from "empty result" to 42501.
--
--     The other 25 tables are NOT touched here — that is a sweep of its own
--     and a blanket revoke is how you break a working app. Recorded in
--     docs/OUTSTANDING.md instead.
--
-- Idempotent: safe to re-run.
-- =============================================================================

-- ── 1. column + backfill ─────────────────────────────────────────────────────

ALTER TABLE public.rate_cards
  ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'general';

-- ── 2. closed enum ───────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'rc_type_chk'
       AND conrelid = 'public.rate_cards'::regclass
  ) THEN
    ALTER TABLE public.rate_cards
      ADD CONSTRAINT rc_type_chk
      CHECK (type IN ('general', 'internal'));
  END IF;
END $$;

-- Lookups are always "the general card / the internal card for this
-- workspace" (useRateCard.js:152-153, :183), never a scan by type alone.
CREATE INDEX IF NOT EXISTS rate_cards_workspace_type_idx
  ON public.rate_cards (workspace_id, type);

-- ── 3. the 0011 privilege trap, for this table ───────────────────────────────
-- See the header. anon never legitimately touches rate_cards; authenticated
-- keeps the four DML privileges the 0004 policies scope.

REVOKE ALL ON public.rate_cards FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.rate_cards FROM authenticated;

COMMENT ON COLUMN public.rate_cards.type IS
  'Session 21: which of the two card shells this is — ''general'' (client-facing day rates) or ''internal'' (per-person wage/burden/overhead, admin-only via the 0015 entry policies). Written by useRateCard.js on create; NOT NULL DEFAULT ''general'' so pre-0032 rows and any caller that omits it land on the client-facing card. Not unique per workspace by design — see the header.';
