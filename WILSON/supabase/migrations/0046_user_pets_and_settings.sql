-- =========================================================================
-- 0046_user_pets_and_settings.sql — Session 31.
--
-- The pet and personal settings follow the PERSON between computers.
-- Audrey signed into the same account on a second machine and was asked to
-- create a new pet: nothing was broken, the store was simply in the wrong
-- place. src/lib/localData.js is per-device by construction and says so in
-- its own header.
--
-- Idempotent: safe to re-run.
-- ORDERING: depends on 0000 (touch_updated_at), 0001 (platform_operators, the
-- only auth.users self-row precedent this copies). Nothing depends on this one
-- yet.
--
--
-- 🚨 NOT WORKSPACE-SCOPED — THE DELIBERATE INVERSE OF 0045
-- -------------------------------------------------------------------------
-- 0045_otter_quiz_attempts.sql:88-95 wrote down, in advance, that it is per
-- (workspace, user) and that "the pet belongs to the person; a mark belongs to
-- the syllabus it was earned against". This is the other side of that
-- sentence. Audrey settled the scope on 2026-08-04: ONE pet and ONE set of
-- settings per PERSON, everywhere — not per workspace.
--
-- Every instinct in this schema pushes the other way, so the census is
-- recorded here rather than left to be re-derived. MEASURED on wilson-dev,
-- 2026-08-05: of 45 tables carrying policies, 40 scope by
-- current_workspace_id(), 3 scope by neither, and exactly TWO reference
-- auth.uid() without a workspace clause.
--
-- 🚨 AND BOTH OF THOSE TWO ARE A WEAKER PRECEDENT THAN THEY LOOK.
-- `auth_attempt_log` is NOT per-user at all — it carries a workspace_id column
-- and its policy is operator-read; it only matches an auth.uid() text search
-- because the operator check is spelled
-- `EXISTS (SELECT 1 FROM platform_operators po WHERE po.user_id = auth.uid())`
-- (0002:96-104). `platform_operators_self` (0002:85-88) is the genuine article
-- and it is SELECT-ONLY.
--
-- So these are the FIRST per-user INSERT/UPDATE/DELETE policies in the
-- project. There is nothing to copy field-for-field, which is exactly why this
-- header is long.
--
--
-- 🚨 NO has_active_membership GATE, AND THAT IS A CITED HOUSE RULE
-- -------------------------------------------------------------------------
-- Every workspace-scoped table ANDs in has_active_membership(). Omitting it
-- here is not an oversight and not laziness. 0020_admin_grants_and_alignment
-- :18-21 states the exception for precisely this shape: "The self arm of
-- ws_members_select stays open so a deactivated member can still see their own
-- row."
--
-- A pet is a self-row. Gating it on live membership would mean a person who is
-- deactivated, between workspaces, or mid-onboarding silently loses their pet
-- — which is the failure this migration exists to remove, reintroduced by a
-- reflex. `user_id = auth.uid()` alone is the whole predicate.
--
--
-- 🚨 hunger AND happiness ARE STORED, BUT MUST NOT BE WRITTEN ON A TIMER
-- -------------------------------------------------------------------------
-- They are not raw state and they are not derived either: they are a value AT
-- AN ANCHOR. App.jsx recomputes both from elapsed time on load, against
-- `lastUpdatedAt` — so `last_updated_at` below is load-bearing, not
-- bookkeeping.
--
-- ⚠️ The standing plan note said to "store last_fed_at and compute on read".
-- Do not. MEASURED 2026-08-05: `lastFedAt` is written at App.jsx handleFeed
-- and READ BY NOTHING, anywhere in src/ or electron/. The decay anchor has
-- always been `lastUpdatedAt`. Anchoring on last_fed_at would compute decay
-- from a field with no meaning.
--
-- The two-device clobber this is meant to prevent comes from the 30-SECOND
-- WHOLE-OBJECT AUTO-SAVE, not from the columns. With decay recomputed on read
-- and writes limited to real interactions, two signed-in machines stop
-- overwriting each other every half minute. The client change is the other
-- half of this migration and neither works alone.
--
--
-- 🚨 `state` IS DELIBERATELY ABSENT
-- -------------------------------------------------------------------------
-- derivePetState (App.jsx:169-177) is a pure function of form / sleepingSince
-- / hunger / happiness. Storing it would let a row disagree with itself, and
-- the value is recomputed on every read anyway. 22 of the pet's 23 fields are
-- here; `state` is the one that is not.
-- =========================================================================


-- ── 1. user_pets ─────────────────────────────────────────────────────────
--
-- One row per person, keyed by the user. PRIMARY KEY on user_id (not a
-- surrogate id) is what makes "one pet per person" a database fact rather than
-- a convention the client has to keep. The auth.users FK + ON DELETE CASCADE
-- is copied from platform_operators (0001:97-101), the only self-row table in
-- the schema.

CREATE TABLE IF NOT EXISTS public.user_pets (
  -- Defaulted, not client-supplied, so identity comes from the JWT and the
  -- client cannot file a pet against someone else.
  user_id             UUID PRIMARY KEY DEFAULT auth.uid()
                      REFERENCES auth.users(id) ON DELETE CASCADE,

  name                TEXT        NOT NULL DEFAULT 'Ollie',
  gender              TEXT        NOT NULL DEFAULT 'female',
  -- No CHECK on breed on purpose: the set is open (observed 'otter' and
  -- 'blob') and a wrong allowlist here would refuse a save the user cannot
  -- diagnose.
  breed               TEXT,
  form                TEXT        NOT NULL DEFAULT 'egg',

  -- DOUBLE PRECISION, not INT and not REAL: the decay arithmetic produces
  -- fractions (App.jsx:577-578, perTick 0.5 against rates like 0.67) and JS
  -- numbers are doubles. An integer column would quantise every read; REAL
  -- would drift.
  hunger              DOUBLE PRECISION NOT NULL DEFAULT 0,
  happiness           DOUBLE PRECISION NOT NULL DEFAULT 0,

  difficulty          TEXT        NOT NULL DEFAULT 'medium',
  pet_mode            BOOLEAN     NOT NULL DEFAULT TRUE,

  egg_pet_count       INT         NOT NULL DEFAULT 0,
  egg_hatch_threshold INT         NOT NULL DEFAULT 2,

  born_at             TIMESTAMPTZ,
  evolved_at          TIMESTAMPTZ,
  died_at             TIMESTAMPTZ,
  last_fed_at         TIMESTAMPTZ,
  last_petted_at      TIMESTAMPTZ,
  last_slept_at       TIMESTAMPTZ,
  sleeping_since      TIMESTAMPTZ,

  interaction_count   INT         NOT NULL DEFAULT 0,

  -- 🚨 THE DECAY ANCHOR. Client-supplied, because it is the instant the
  -- client's hunger/happiness numbers were true. Distinct from updated_at
  -- below, which is when the ROW was written — those differ, and conflating
  -- them would make decay depend on network timing.
  last_updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- [{ timestamp, userMsg, botResponse, rating }, ...] — companion chat
  -- ratings. The client caps this at 50 entries (App.jsx handleThumbRating,
  -- `.slice(-50)`); the size CHECK below is a backstop against a runaway
  -- writer, deliberately far above the cap so an ordinary long conversation
  -- can never refuse a save.
  feedback            JSONB       NOT NULL DEFAULT '[]'::jsonb,
  total_thumbs_up     INT         NOT NULL DEFAULT 0,
  total_thumbs_down   INT         NOT NULL DEFAULT 0,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT user_pets_form_chk       CHECK (form IN ('egg','baby','adult','corpse','ghost')),
  CONSTRAINT user_pets_gender_chk     CHECK (gender IN ('male','female')),
  CONSTRAINT user_pets_difficulty_chk CHECK (difficulty IN ('low','medium','high')),
  -- Bounded exactly as the client bounds them: Math.max(0, …) on decay and
  -- Math.min(100, …) on feed/pet (App.jsx:518-519, 672, 722).
  CONSTRAINT user_pets_hunger_chk     CHECK (hunger    >= 0 AND hunger    <= 100),
  CONSTRAINT user_pets_happiness_chk  CHECK (happiness >= 0 AND happiness <= 100),
  CONSTRAINT user_pets_counts_chk     CHECK (egg_pet_count >= 0 AND interaction_count >= 0
                                             AND total_thumbs_up >= 0 AND total_thumbs_down >= 0),
  CONSTRAINT user_pets_feedback_chk   CHECK (jsonb_typeof(feedback) = 'array'),
  CONSTRAINT user_pets_feedback_sz_chk CHECK (pg_column_size(feedback) <= 262144)
);

COMMENT ON TABLE public.user_pets IS
  'Session 31: one pet per PERSON, following them between computers. Deliberately NOT workspace-scoped — see the migration header and the contrast drawn in 0045:88-95. hunger and happiness are values at last_updated_at, recomputed from elapsed time on read; they must not be written on a timer or two signed-in machines clobber each other every 30 seconds.';
COMMENT ON COLUMN public.user_pets.last_updated_at IS
  'The decay anchor: the instant hunger and happiness were last true. NOT last_fed_at, which is written by handleFeed and read by nothing.';
COMMENT ON COLUMN public.user_pets.feedback IS
  'Companion chat ratings, capped at 50 entries client-side. total_thumbs_up/down are running totals that survive a reset of this array.';


-- ── 2. user_settings ─────────────────────────────────────────────────────
--
-- The personal half. JSONB here rather than columns — the opposite choice from
-- user_pets above — because the two shapes are different in kind: the pet is a
-- fixed 23-field state machine with invariants worth enforcing, while these are
-- bags of the user's own prose whose key set has already grown once.
--
-- ⚠️ WHAT DELIBERATELY DOES **NOT** LIVE HERE, all MEASURED 2026-08-05:
--   * rabbit.adapterMode + rabbit.activeProjectId — machine state. Carrying
--     adapterMode would point a second computer at a Local Server that holds
--     none of its data.
--   * otter-settings.storageLocation and files-config.defaultRootDir — local
--     filesystem paths. Audrey's is `C:\Users\Audrey\Documents\My_Work`; the
--     same string on another machine names a DIFFERENT folder, so carrying it
--     silently points at the wrong content rather than sharing content.
--   * rabbit.departments — workspace data, edited from Settings AND the Admin
--     Terminal. Per-person copies would give two admins different dropdowns.
--   * companionName — a duplicate of the pet's own name with ZERO readers.
--     The pet's `name` column above is the live one.

CREATE TABLE IF NOT EXISTS public.user_settings (
  user_id                UUID PRIMARY KEY DEFAULT auth.uid()
                         REFERENCES auth.users(id) ON DELETE CASCADE,

  -- { courseOutline, subjectContent, singleSubject, mc, codeId, codeWrite,
  --   companion } — the seven AI prompts the user has edited. `companion`
  --   drives the pet's chat personality, so it is a companion field as much as
  --   an O.T.T.E.R. one.
  prompts                JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- { otter: { systemPromptOverride }, rabbit: { … } } — the agent-skills
  -- store. The one settings value that demonstrably changes what the model is
  -- sent (AgentProvider reads it).
  agent_prompt_overrides JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT user_settings_prompts_chk    CHECK (jsonb_typeof(prompts) = 'object'),
  CONSTRAINT user_settings_overrides_chk  CHECK (jsonb_typeof(agent_prompt_overrides) = 'object'),
  CONSTRAINT user_settings_prompts_sz_chk CHECK (pg_column_size(prompts) <= 262144),
  CONSTRAINT user_settings_ovr_sz_chk     CHECK (pg_column_size(agent_prompt_overrides) <= 262144)
);

COMMENT ON TABLE public.user_settings IS
  'Session 31: personal settings that follow the PERSON between computers — the seven edited AI prompts and the agent system-prompt overrides. Machine-specific values (adapter mode, active project, filesystem paths) and workspace values (departments) are deliberately excluded; see the migration header.';


-- ── 3. updated_at ────────────────────────────────────────────────────────
-- touch_updated_at is LANGUAGE plpgsql and NOT SECURITY DEFINER (0000:318),
-- which is the precondition for FORCE ROW LEVEL SECURITY below.
--
-- fn_audit_touch is deliberately NOT used: it stamps created_by/updated_by,
-- which on a table whose primary key IS the user can only ever repeat user_id.

DROP TRIGGER IF EXISTS trg_user_pets_touch ON public.user_pets;
CREATE TRIGGER trg_user_pets_touch
  BEFORE UPDATE ON public.user_pets
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_user_settings_touch ON public.user_settings;
CREATE TRIGGER trg_user_settings_touch
  BEFORE UPDATE ON public.user_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


-- ── 4. RLS ───────────────────────────────────────────────────────────────
--
-- Own row only, on every verb, with NO admin bypass and no workspace clause.
-- A company admin cannot read an employee's pet or their prompt text, and that
-- is intentional: this is the most personal data in the product and none of it
-- is a business record.
--
-- Never FOR ALL: a broad FOR ALL arm ORs with every narrow arm beside it and
-- silently wins (0029; it cost S15 a CRITICAL).
--
-- DELETE is policed rather than omitted so a person can discard their own pet
-- and start over. UPDATE carries no separate WITH CHECK — Postgres reuses
-- USING, which is the safe direction; a WITH CHECK weaker than its USING is
-- the hole.

ALTER TABLE public.user_pets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_pets FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_pets_select ON public.user_pets;
DROP POLICY IF EXISTS user_pets_insert ON public.user_pets;
DROP POLICY IF EXISTS user_pets_update ON public.user_pets;
DROP POLICY IF EXISTS user_pets_delete ON public.user_pets;

CREATE POLICY user_pets_select ON public.user_pets
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY user_pets_insert ON public.user_pets
  FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY user_pets_update ON public.user_pets
  FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY user_pets_delete ON public.user_pets
  FOR DELETE USING (user_id = auth.uid());

ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_settings FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_settings_select ON public.user_settings;
DROP POLICY IF EXISTS user_settings_insert ON public.user_settings;
DROP POLICY IF EXISTS user_settings_update ON public.user_settings;
DROP POLICY IF EXISTS user_settings_delete ON public.user_settings;

CREATE POLICY user_settings_select ON public.user_settings
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY user_settings_insert ON public.user_settings
  FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY user_settings_update ON public.user_settings
  FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY user_settings_delete ON public.user_settings
  FOR DELETE USING (user_id = auth.uid());


-- ── 5. Privileges ────────────────────────────────────────────────────────
--
-- 0033 disarmed 0011's ALTER DEFAULT PRIVILEGES, so a table created after it
-- is not born exposed — but a policy-only check passes happily while a
-- privilege hole is wide open (S21 found 25 such tables), so the revoke is
-- asserted rather than assumed. PUBLIC is named as well as anon because an
-- object can carry a bare =X/postgres aclitem and naming only anon would be a
-- silent no-op reporting success (the S22 grantee lesson).
--
-- The GRANT is explicit rather than inherited from 0033's defaults. 0045 omits
-- it and works; 0041 and 0044 both issue it. ⚠️ 0045's own header claims
-- "neither 0041 nor 0044 issues a GRANT" — that sentence is factually wrong
-- (0041:336-337 and 0044:323-324 both do) and is not followed here.

REVOKE ALL ON public.user_pets FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_pets TO authenticated;
GRANT ALL ON public.user_pets TO service_role;

REVOKE ALL ON public.user_settings FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_settings TO authenticated;
GRANT ALL ON public.user_settings TO service_role;


-- ── 6. Post-condition ────────────────────────────────────────────────────
--
-- 🚨 This block is the only check in the change that runs against dev, staging
-- AND prod. The pgTAP suite proves the same properties, but pgTAP runs in CI
-- against one stack — so a privilege or policy mistake that only exists in an
-- applied environment would never reach it. Failing here aborts the migration
-- instead of reporting success.

DO $post$
DECLARE
  v_bad TEXT;
BEGIN
  SELECT string_agg(format('%s holds %s on %s', grantee, privilege_type, table_name), '; ')
    INTO v_bad
    FROM information_schema.role_table_grants
   WHERE table_schema = 'public'
     AND table_name IN ('user_pets','user_settings')
     AND grantee IN ('anon','PUBLIC');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '0046 post-condition: anon/PUBLIC must hold nothing — %', v_bad;
  END IF;

  SELECT string_agg(format('%s.%s', tablename, policyname), '; ')
    INTO v_bad
    FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename IN ('user_pets','user_settings')
     AND cmd = 'ALL';
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '0046 post-condition: no FOR ALL policy is permitted — %', v_bad;
  END IF;

  SELECT string_agg(format('%s has %s policies', tablename, n), '; ')
    INTO v_bad
    FROM (
      SELECT tablename, count(*) AS n
        FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename IN ('user_pets','user_settings')
       GROUP BY tablename
    ) q
   WHERE n <> 4;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '0046 post-condition: each table needs exactly 4 policies — %', v_bad;
  END IF;

  SELECT string_agg(c.relname::text, '; ')
    INTO v_bad
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname IN ('user_pets','user_settings')
     AND NOT (c.relrowsecurity AND c.relforcerowsecurity);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '0046 post-condition: RLS must be ENABLED and FORCED — %', v_bad;
  END IF;
END
$post$;
