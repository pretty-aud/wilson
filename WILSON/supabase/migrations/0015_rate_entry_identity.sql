-- =============================================================================
-- 0015_rate_entry_identity.sql  (Session 6)
--
-- rate_card_entries: identity unification + the Session-4 RLS deferral.
--
--   1. Columns the client has written since v0.x but that only existed as
--      schemaless JSON in local mode: member_id, wage, burden, burden_type,
--      overhead, overhead_type, department. In cloud mode upsertRateCardEntry
--      previously failed with PGRST204 on these fields — this makes the
--      internal (per-person) rate card real on Supabase.
--      member_id is CANONICALLY an auth user id (workspace_members.user_id)
--      in cloud mode — the Session-4 orphan-rows fix. FK-less per the 0007
--      convention so standalone/local RABBIT ids remain representable.
--   2. Role-scoped RLS (Session-4 deferral, carried since): per-person wages
--      were readable by any workspace member via PostgREST. Now:
--        SELECT — admin + manager  ('rate_card.view' matrix parity)
--        INSERT/UPDATE/DELETE — admin only ('rate_card.edit' matrix parity)
--      Plain members get an empty entry list; UI shows a permission notice.
--
-- rate_cards (the card shells) keep membership-scoped writes: useRateCard
-- auto-creates the General/Internal cards on first visit for any member,
-- and card names/rows carry no wage data.
--
-- Idempotent: safe to re-run.
-- =============================================================================

-- ── 1. columns ───────────────────────────────────────────────────────────────

ALTER TABLE public.rate_card_entries ADD COLUMN IF NOT EXISTS member_id     UUID;
ALTER TABLE public.rate_card_entries ADD COLUMN IF NOT EXISTS wage          NUMERIC;
ALTER TABLE public.rate_card_entries ADD COLUMN IF NOT EXISTS burden        NUMERIC;
ALTER TABLE public.rate_card_entries ADD COLUMN IF NOT EXISTS burden_type   TEXT DEFAULT 'percent';
ALTER TABLE public.rate_card_entries ADD COLUMN IF NOT EXISTS overhead      NUMERIC;
ALTER TABLE public.rate_card_entries ADD COLUMN IF NOT EXISTS overhead_type TEXT DEFAULT 'percent';
ALTER TABLE public.rate_card_entries ADD COLUMN IF NOT EXISTS department    TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'rce_burden_type_chk'
       AND conrelid = 'public.rate_card_entries'::regclass
  ) THEN
    ALTER TABLE public.rate_card_entries
      ADD CONSTRAINT rce_burden_type_chk
      CHECK (burden_type IS NULL OR burden_type IN ('percent', 'fixed'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'rce_overhead_type_chk'
       AND conrelid = 'public.rate_card_entries'::regclass
  ) THEN
    ALTER TABLE public.rate_card_entries
      ADD CONSTRAINT rce_overhead_type_chk
      CHECK (overhead_type IS NULL OR overhead_type IN ('percent', 'fixed'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS rce_member_idx ON public.rate_card_entries (member_id);

-- ── 2. role-scoped policies ──────────────────────────────────────────────────

DROP POLICY IF EXISTS rce_select ON public.rate_card_entries;
CREATE POLICY rce_select ON public.rate_card_entries
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.rate_cards rc
       WHERE rc.id = rate_card_entries.rate_card_id
         AND rc.workspace_id = public.current_workspace_id()
    )
    AND public.current_app_role() IN ('admin', 'manager')
  );

DROP POLICY IF EXISTS rce_insert ON public.rate_card_entries;
CREATE POLICY rce_insert ON public.rate_card_entries
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.rate_cards rc
       WHERE rc.id = rate_card_id
         AND rc.workspace_id = public.current_workspace_id()
         AND public.has_active_membership(rc.workspace_id)
    )
    AND public.current_app_role() = 'admin'
  );

DROP POLICY IF EXISTS rce_update ON public.rate_card_entries;
CREATE POLICY rce_update ON public.rate_card_entries
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.rate_cards rc
       WHERE rc.id = rate_card_entries.rate_card_id
         AND rc.workspace_id = public.current_workspace_id()
         AND public.has_active_membership(rc.workspace_id)
    )
    AND public.current_app_role() = 'admin'
  );

DROP POLICY IF EXISTS rce_delete ON public.rate_card_entries;
CREATE POLICY rce_delete ON public.rate_card_entries
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.rate_cards rc
       WHERE rc.id = rate_card_entries.rate_card_id
         AND rc.workspace_id = public.current_workspace_id()
         AND public.has_active_membership(rc.workspace_id)
    )
    AND public.current_app_role() = 'admin'
  );

COMMENT ON TABLE public.rate_card_entries IS
  'Rate card line items. member_id (Session 6) canonically holds an auth user id in cloud mode — the internal per-person card keys on workspace_members.user_id. Reads: admin+manager; writes: admin (rate_card.view / rate_card.edit matrix parity).';
