-- =========================================================================
-- 0068_user_pets_stale_write_guard.sql — Track A, bundle A3 (2026-09-07).
--
-- Audrey's ruling 4: "refuse to save an older copy over a newer one; the
-- stale window gets a refresh notice." Live sync (the "Big" option) was NOT
-- chosen, so two open windows still do not learn about each other — but the
-- second one may no longer WIN.
--
-- Idempotent: safe to re-run.
-- ORDERING: depends on 0046 (public.user_pets and its last_updated_at
-- column). Nothing depends on this one.
--
--
-- 🚨 THE COMPARISON IS `last_updated_at`, NOT `updated_at`
-- -------------------------------------------------------------------------
-- 0046 made these two columns deliberately different and its header says why:
--
--   * `updated_at` is the TOUCH column. `trg_user_pets_touch` stamps it with
--     now() on every UPDATE, so NEW.updated_at is always >= OLD.updated_at by
--     construction and a guard on it could never fire. It records when the ROW
--     was written, which depends on network timing.
--
--   * `last_updated_at` is the DECAY ANCHOR: "the instant the client's
--     hunger/happiness numbers were true". It is client-supplied, it is the
--     value App.jsx's applyOfflineDecay measures elapsed time against, and it
--     is therefore the only column that says anything about WHICH COPY of the
--     pet a client is holding.
--
-- So the anchor is the version token, and this trigger is the database half of
-- optimistic concurrency on it.
--
--
-- 🚨 THIS ONLY WORKS BECAUSE THE CLIENT STOPPED STAMPING now() ON EVERY SAVE
-- -------------------------------------------------------------------------
-- MEASURED on the tree this migration ships with: App.jsx's performPetSave
-- used to write `{ ...data, lastUpdatedAt: new Date().toISOString() }` on
-- EVERY save. A stale window's write therefore always carried a fresher anchor
-- than the row it was about to destroy, and this trigger would have been inert
-- — a guard that can never fire, which is worse than no guard because it reads
-- like protection.
--
-- The client half of bundle A3 removes that stamp and makes the anchor travel
-- with the values it describes: it moves when, and only when, hunger or
-- happiness moved (the live decay tick, applyOfflineDecay, feeding, petting,
-- hatching, a thumbs-up that adds happiness). Every other save — Pet Mode,
-- difficulty, Reset History, renaming a hatchling — re-sends the anchor the
-- client is holding, unchanged. That is also what 0046 says the column means,
-- so this is a correction as much as a feature.
--
-- ⚠️ WHAT THIS DOES NOT CATCH, stated so nobody reads it as more than it is.
-- Two timestamps cannot order two writers that have both legitimately moved
-- forward. A second window showing a LIVE pet with Pet Mode on advances its
-- own anchor every 30 seconds from its own decay tick, so its anchor is
-- genuinely newer and its write is accepted. What is caught is every window
-- whose pet has not decayed since it loaded — an egg, a corpse, a ghost, or
-- Pet Mode off, which are exactly the four cases where App.jsx's decay reducer
-- returns the identical object — plus every non-decay save from any window.
-- Audrey's reported case (create an egg on PC A while PC B sits on the old
-- ghost) is in the caught set. Closing the rest needs a revision counter or
-- live sync, and neither was chosen.
--
--
-- 🚨 EQUAL IS ALLOWED, AND THAT IS LOAD-BEARING
-- -------------------------------------------------------------------------
-- `<`, never `<=`. A client that changes difficulty twice without the pet
-- decaying in between re-sends the same anchor both times; refusing the second
-- would break ordinary single-window use, which is the failure mode a
-- concurrency guard is most likely to ship with.
--
--
-- 🚨 A DISTINCT SQLSTATE, BECAUSE THE CLIENT HAS TO TELL THIS APART
-- -------------------------------------------------------------------------
-- On this refusal the client must NOT retry: it marks its copy stale, re-reads
-- the account and shows "Your pet changed on another device — refreshed". On
-- any other error it reports a save failure. Matching on message text is how
-- that distinction rots, so the condition carries its own SQLSTATE, 'WP001'
-- (class 'WP' is unassigned by the standard and by PostgreSQL). supabase-js
-- surfaces it as `error.code`. The message also opens with the stable token
-- `pet_stale_write` so a client that only has the string still has something
-- exact to match — 0009's `RAISE EXCEPTION 'slug_taken'` is the precedent for
-- a machine-readable message.
--
-- The trigger fires for EVERY role, service_role included. That is deliberate:
-- a repair script that means to move the anchor backwards should have to say
-- so (ALTER TABLE ... DISABLE TRIGGER), rather than discovering afterwards
-- that it silently reset somebody's pet.
-- =========================================================================


-- ── 1. The guard ─────────────────────────────────────────────────────────
--
-- LANGUAGE plpgsql and NOT SECURITY DEFINER, matching touch_updated_at
-- (0000:318). A SECURITY DEFINER trigger function on a table with FORCE ROW
-- LEVEL SECURITY is a hole, and this needs no privileges of its own: it reads
-- OLD and NEW and nothing else.

CREATE OR REPLACE FUNCTION public.fn_user_pets_reject_stale_write()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF NEW.last_updated_at < OLD.last_updated_at THEN
    RAISE EXCEPTION
      'pet_stale_write: this copy of the pet is older than the one already saved (% is before %)',
      NEW.last_updated_at, OLD.last_updated_at
      USING ERRCODE = 'WP001',
            HINT = 'Re-read the pet from the account instead of retrying this write.';
  END IF;
  RETURN NEW;
END
$fn$;

COMMENT ON FUNCTION public.fn_user_pets_reject_stale_write() IS
  'Migration 0068: refuses an UPDATE whose last_updated_at (the decay anchor, not the touch column) is older than the stored row''s. Raises SQLSTATE WP001 with a pet_stale_write message so the client can re-read instead of retrying. Equal anchors are allowed: a save that changes nothing about hunger or happiness re-sends the anchor it holds.';

DROP TRIGGER IF EXISTS trg_user_pets_reject_stale_write ON public.user_pets;
CREATE TRIGGER trg_user_pets_reject_stale_write
  BEFORE UPDATE ON public.user_pets
  FOR EACH ROW EXECUTE FUNCTION public.fn_user_pets_reject_stale_write();


-- ── 2. Post-condition ────────────────────────────────────────────────────
--
-- The same reasoning 0046 gives for its own block: the pgTAP suite proves the
-- BEHAVIOUR against one stack in CI, so a mistake that exists only in an
-- applied environment would never reach it. Failing here aborts the migration
-- rather than reporting success.
--
-- ⚠️ These are STRUCTURAL asserts. The behavioural proof — that a backward
-- anchor actually raises, that an equal one does not, and that a refused write
-- leaves the row untouched — is suite 56, where it can be broken on purpose.

DO $post$
DECLARE
  v_def   TEXT;
  v_count INT;
BEGIN
  -- The trigger is attached, BEFORE, on UPDATE, per ROW. Reading pg_trigger
  -- rather than pg_get_triggerdef's text for the timing bits, so a renamed
  -- keyword cannot pass by substring luck.
  SELECT count(*)::int INTO v_count
    FROM pg_trigger
   WHERE tgrelid = 'public.user_pets'::regclass
     AND tgname  = 'trg_user_pets_reject_stale_write'
     AND NOT tgisinternal
     AND (tgtype & 1) = 1    -- FOR EACH ROW
     AND (tgtype & 2) = 2    -- BEFORE
     AND (tgtype & 16) = 16; -- UPDATE
  IF v_count <> 1 THEN
    RAISE EXCEPTION '0068 post-condition failed: trg_user_pets_reject_stale_write is not a BEFORE UPDATE FOR EACH ROW trigger on user_pets (found %)', v_count;
  END IF;

  v_def := pg_get_functiondef('public.fn_user_pets_reject_stale_write()'::regprocedure);

  -- The comparison is the anchor, strictly less-than, and it raises.
  IF v_def NOT LIKE '%NEW.last_updated_at < OLD.last_updated_at%' THEN
    RAISE EXCEPTION '0068 post-condition failed: the guard no longer compares NEW.last_updated_at < OLD.last_updated_at';
  END IF;
  IF v_def LIKE '%<=%' THEN
    RAISE EXCEPTION '0068 post-condition failed: the guard uses <=, which refuses the ordinary re-send of an unchanged anchor';
  END IF;
  IF v_def NOT LIKE '%WP001%' OR v_def NOT LIKE '%pet_stale_write%' THEN
    RAISE EXCEPTION '0068 post-condition failed: the guard lost the SQLSTATE or the message token the client matches on';
  END IF;

  -- 🚨 The touch column must NOT be what is compared. A future edit that
  -- "tidies" last_updated_at into updated_at would produce a guard that can
  -- never fire, and nothing else here would notice.
  IF v_def LIKE '%NEW.updated_at%' OR v_def LIKE '%OLD.updated_at%' THEN
    RAISE EXCEPTION '0068 post-condition failed: the guard reads the touch column updated_at, which trg_user_pets_touch stamps on every write';
  END IF;

  -- Not SECURITY DEFINER — see the note above section 1.
  IF v_def LIKE '%SECURITY DEFINER%' THEN
    RAISE EXCEPTION '0068 post-condition failed: the guard is SECURITY DEFINER on a FORCE RLS table';
  END IF;

  -- 0046's touch trigger must still be there; this migration adds a second
  -- BEFORE UPDATE trigger beside it and must not have replaced it.
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgrelid = 'public.user_pets'::regclass
                    AND tgname = 'trg_user_pets_touch' AND NOT tgisinternal) THEN
    RAISE EXCEPTION '0068 post-condition failed: 0046''s trg_user_pets_touch is gone';
  END IF;

  -- The anchor column itself, since the whole design rests on it.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='user_pets'
                    AND column_name='last_updated_at' AND is_nullable='NO') THEN
    RAISE EXCEPTION '0068 post-condition failed: user_pets.last_updated_at is missing or nullable';
  END IF;

  RAISE NOTICE '0068 post-conditions passed: the stale-write guard is attached to user_pets and compares the decay anchor.';
END $post$;
