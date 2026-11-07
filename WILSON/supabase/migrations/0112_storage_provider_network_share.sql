-- =============================================================================
-- 0112_storage_provider_network_share.sql — M.O.T.H. Session 1 (MO1): the
-- provider value for a file that lives on a company's office server
-- (docs/design/MOTH_DESIGN.md §1.4 "0112").
--
-- This file adds the enum value and nothing else. A value added in a transaction
-- cannot be used until that transaction has committed, so nothing here or in any
-- file applied with it may use it: 0114 to 0117 are rehearsed only after this
-- has been applied and committed, and every guard written before 0117 compares
-- the provider as text. No suite of its own: the label probe and every probe that
-- uses the value are in suites 115 and 118, which run only after this commit.
-- =============================================================================

ALTER TYPE public.storage_provider ADD VALUE IF NOT EXISTS 'network_share';

-- Reading the catalogue is not using the value.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname = 'public'
       AND t.typname = 'storage_provider'
       AND e.enumlabel = 'network_share'
  ) THEN
    RAISE EXCEPTION '0112 post-condition: storage_provider has no network_share label';
  END IF;
END $$;
