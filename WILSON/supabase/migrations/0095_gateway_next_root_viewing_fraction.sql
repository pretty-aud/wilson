-- =============================================================================
-- 0095_gateway_next_root_viewing_fraction.sql — the file gateway's cloud
-- side, bundle GW3 (post-overhaul, 2026-10-11): the two halves reconciled.
--
-- GW1 built the cloud's half (0093) and GW2 the gateway program in tandem,
-- without talking; GW2's hand-off ("For GW3") lists where they differ. Two of
-- the differences need the database, and this file is them. Never edit 0093:
-- it is applied on dev and its copy sits in the Desktop kit for staging, so
-- every change to a function 0093 made is a CREATE OR REPLACE here (the GW3
-- brief). 0094 / suite 97 stay reserved; this is 0095 / suite 98.
--
-- A. A NEW OR NEXT ROOT CERTIFICATE AT SYNC (GW2's item 4; the design's §3).
--    The gateway makes its root once, at enrolment, and the cloud offers it
--    for download after the enrolling admin confirms its fingerprint (D25).
--    But a root does not last for ever: a year before its end the gateway
--    makes the NEXT root and offers it beside the old one (§3, "the day it
--    expires"), and whenever an inside address leaves the root's /24s the
--    gateway makes a NEW root at once (GW2's design line 5). GW2's gateway
--    sends either at its next sync (`root_cert_pem` after a start or a new
--    root, `next_root_cert_pem` while one exists); GW1's gateway_sync_apply
--    dropped both, so Settings kept showing and offering the enrolment's
--    root while the gateway signed its leaves with another, and no browser
--    could trust the doors again.
--      * Five columns on gateways: the next root's PEM (the service role's
--        alone, like root_cert_pem), its fingerprint (computed by the
--        database from the PEM, as root_fingerprint is), when it was first
--        reported, and when and by whom it was confirmed.
--      * gateway_sync_apply stores a root the gateway reports that is not the
--        confirmed root in the next-root slot — a replacement already in use
--        as much as the year-ahead next one — and PROMOTES a confirmed next
--        root into the root's place at the sync that reports it in use.
--      * gateway_confirm_root accepts the next root's fingerprint too, from
--        the same admin and with the same words (D25: asked again, as at
--        enrolment); gateway_next_root_certificate serves the next root's
--        PEM once it is confirmed, beside the old one.
--      * Three words for the trail: gateway.next_root_received,
--        gateway.next_root_confirmed, gateway.root_replaced.
--
-- B. A VIEWING'S FRACTION (GW2's item 5; the design's §6).
--    The gateway sends `fraction` (the distinct bytes it served, divided by
--    the clip's size: a scrub back and forth over the first minute stays a
--    small fraction) and `read_in_full`; gateway_events_apply recomputed the
--    fraction as bytes / clip_bytes, so re-reading the same part counted
--    again and a long scrub could read as "in full". Coverage is what *read
--    in full* means to an admin: the gateway's fraction is taken when it
--    sends one (clamped to 0–1), else bytes / clip_bytes as before, and
--    read_in_full is computed HERE from it (≥ 0.9), never taken from the
--    payload (§6: only the viewing's own facts come from the payload, and a
--    verdict is not a fact). `fraction_from` says which.
-- =============================================================================

DO $$
BEGIN
  IF to_regclass('public.gateways') IS NULL OR to_regclass('public.gateway_secrets') IS NULL THEN
    RAISE EXCEPTION '0095 needs 0093 (the file gateway''s cloud side) first';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'gateway_secrets' AND column_name = 'reach_key')
     OR to_regprocedure('public.gateway_sync_apply(uuid,jsonb,inet,jsonb)') IS NULL
     OR to_regprocedure('public.gateway_events_apply(uuid,jsonb)') IS NULL
     OR to_regprocedure('public.gateway_confirm_root(uuid,text)') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_audit_action_chk'
                     AND pg_get_constraintdef(oid) LIKE '%gateway.keys_rotated%') THEN
    RAISE EXCEPTION '0095 needs 0093 in its final shape (after GW1''s review round 2) first';
  END IF;
END $$;


-- =============================================================================
-- A1. The next root's columns
-- =============================================================================

ALTER TABLE public.gateways ADD COLUMN IF NOT EXISTS next_root_cert_pem     TEXT;
ALTER TABLE public.gateways ADD COLUMN IF NOT EXISTS next_root_fingerprint  TEXT;
ALTER TABLE public.gateways ADD COLUMN IF NOT EXISTS next_root_seen_at      TIMESTAMPTZ;
ALTER TABLE public.gateways ADD COLUMN IF NOT EXISTS next_root_confirmed_at TIMESTAMPTZ;
ALTER TABLE public.gateways ADD COLUMN IF NOT EXISTS next_root_confirmed_by UUID;

-- All five empty, or a PEM whose fingerprint the DATABASE computed (never
-- the gateway's claim), different from the confirmed root's, with the time
-- it was first reported; confirmed or not.
ALTER TABLE public.gateways DROP CONSTRAINT IF EXISTS gateways_next_root_chk;
ALTER TABLE public.gateways ADD CONSTRAINT gateways_next_root_chk CHECK (
  (next_root_cert_pem IS NULL AND next_root_fingerprint IS NULL AND next_root_seen_at IS NULL
     AND next_root_confirmed_at IS NULL AND next_root_confirmed_by IS NULL)
  OR (next_root_fingerprint IS NOT NULL
      AND next_root_fingerprint = public.gateway_pem_fingerprint(next_root_cert_pem)
      AND next_root_fingerprint IS DISTINCT FROM root_fingerprint
      AND next_root_seen_at IS NOT NULL
      AND (next_root_confirmed_at IS NULL) = (next_root_confirmed_by IS NULL)));

-- The admin reads the fingerprint and the two times, never the PEM (the
-- certificate is served by gateway_next_root_certificate after the
-- fingerprint is confirmed, as the root's is). The client guard
-- (fn_gateways_client_guard, 0093) already refuses a client that changes
-- anything but the name, the outside address and the office ranges, so the
-- new columns are the service role's and the RPCs' to write.
GRANT SELECT (next_root_fingerprint, next_root_seen_at, next_root_confirmed_at) ON public.gateways TO authenticated;

COMMENT ON COLUMN public.gateways.next_root_cert_pem IS
  '0095: a root the gateway reported at sync that is not the confirmed root — the next one it made a year before the old one''s end, or a replacement already in use (an inside address left the root''s /24s). Service role only; served by gateway_next_root_certificate once confirmed. Promoted into root_cert_pem at the sync that reports it in use after its fingerprint is confirmed.';
COMMENT ON COLUMN public.gateways.next_root_fingerprint IS
  '0095: SHA-256 (lower-case hex) of the next root''s DER, computed by the database from next_root_cert_pem (gateways_next_root_chk) — never the gateway''s own claim. Shown in Settings so the admin can confirm it (D25, asked again).';
COMMENT ON COLUMN public.gateways.next_root_seen_at IS
  '0095: when the next root was first reported at sync; a changed next root resets it and its confirmation.';
COMMENT ON COLUMN public.gateways.next_root_confirmed_at IS
  '0095: when the admin who made this gateway''s enrolment token confirmed the next root''s fingerprint; until then it is not offered for download.';


-- =============================================================================
-- A2. The trail's three new words
-- =============================================================================

ALTER TABLE public.workspace_audit DROP CONSTRAINT IF EXISTS workspace_audit_action_chk;
ALTER TABLE public.workspace_audit ADD CONSTRAINT workspace_audit_action_chk CHECK (action IN (
    'remote_viewing.on', 'remote_viewing.off',
    'gateway.enrolled', 'gateway.renamed', 'gateway.forgotten', 'gateway.forget_undone',
    'gateway.revoked', 'gateway.token_made', 'gateway.token_cancelled',
    'gateway.root_confirmed', 'gateway.reach_checked', 'gateway.outside_address_changed',
    'gateway.office_ranges_changed', 'gateway.update_failed', 'gateway.keys_rotated',
    'gateway.next_root_received', 'gateway.next_root_confirmed', 'gateway.root_replaced'));


-- =============================================================================
-- A3. gateway_sync_apply, restated whole (0093 §14b) with the next root
-- =============================================================================

CREATE OR REPLACE FUNCTION public.gateway_sync_apply(
  p_gateway UUID, p_report JSONB, p_source INET, p_confirm JSONB)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  g             public.gateways%ROWTYPE;
  v_switch      BOOLEAN;
  v_changed     BOOLEAN := false;
  v_running     BOOLEAN;
  v_throttled   BOOLEAN;
  v_check       JSONB := NULL;
  v_nonce       TEXT;
  v_check_id    UUID;
  v_confirmed   JSONB := '[]'::jsonb;
  v_update_now  BOOLEAN := false;
  v_reach       JSONB;
  v_inside      JSONB;
  v_health      JSONB;
  v_old_update  TEXT;
  v_new_update  TEXT;
  v_port        INT;
  -- 0095 (A): the roots the gateway reports.
  v_root_pem    TEXT := p_report ->> 'root_cert_pem';
  v_next_pem    TEXT := p_report ->> 'next_root_cert_pem';
  v_root_fp     TEXT;
  v_next_fp     TEXT;
  v_cand_pem    TEXT := NULL;
  v_cand_fp     TEXT := NULL;
  v_prev_fp     TEXT;
BEGIN
  IF p_report IS NULL OR jsonb_typeof(p_report) <> 'object' THEN
    RAISE EXCEPTION 'gateway_sync_apply: the report must be an object' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO g FROM public.gateways WHERE public.gateways.id = p_gateway FOR UPDATE;
  IF NOT FOUND OR g.revoked_at IS NOT NULL THEN
    RETURN jsonb_build_object('revoked', true);
  END IF;
  SELECT w.remote_viewing_enabled INTO v_switch FROM public.workspaces w WHERE w.id = g.workspace_id;

  -- Reach per location: this company's locations only, the four words only.
  SELECT COALESCE(jsonb_object_agg(l.id::text, p_report -> 'reach' ->> l.id::text), '{}'::jsonb)
    INTO v_reach
    FROM public.bin_locations l
   WHERE l.workspace_id = g.workspace_id
     AND jsonb_typeof(p_report -> 'reach') = 'object'
     AND (p_report -> 'reach' ->> l.id::text) IN ('reachable', 'not_reachable', 'not_mounted', 'not_connected');
  v_inside := CASE WHEN p_report ? 'inside_addresses'
                   THEN public.gateway_clean_inside_addresses(p_report -> 'inside_addresses')
                   ELSE g.inside_addresses END;
  v_health := CASE WHEN jsonb_typeof(p_report -> 'health') = 'object'
                        AND char_length((p_report -> 'health')::text) <= 15000
                   THEN (p_report -> 'health') || jsonb_build_object('reported_at', now())
                   ELSE g.health END;

  -- R6: a sync from another public address withdraws the published address
  -- until a check passes again, and queues that check (below).
  IF p_source IS NOT NULL AND g.last_sync_source IS NOT NULL AND p_source IS DISTINCT FROM g.last_sync_source THEN
    v_changed := true;
  END IF;

  v_old_update := g.health ->> 'update';
  v_new_update := left(v_health ->> 'update', 128);

  UPDATE public.gateways SET
    last_seen_at     = now(),
    version          = CASE WHEN (p_report ->> 'version') ~ '^[0-9]+\.[0-9]+\.[0-9]+([-+][0-9A-Za-z.+-]{1,40})?$'
                                 AND char_length(p_report ->> 'version') <= 64
                            THEN p_report ->> 'version' ELSE public.gateways.version END,
    hostname         = COALESCE(left(p_report ->> 'hostname', 255), public.gateways.hostname),
    inside_addresses = v_inside,
    outside_open     = COALESCE((v_health -> 'doors' ->> 'outside') LIKE 'open:%', false),
    reach            = v_reach,
    health           = v_health,
    last_sync_source = COALESCE(p_source, public.gateways.last_sync_source),
    reach_ok         = CASE WHEN v_changed THEN NULL ELSE public.gateways.reach_ok END,
    reach_detail     = CASE WHEN v_changed THEN 'source_changed' ELSE public.gateways.reach_detail END
  WHERE public.gateways.id = g.id
  RETURNING * INTO g;

  IF v_new_update LIKE 'failed:%' AND v_new_update IS DISTINCT FROM v_old_update THEN
    INSERT INTO public.workspace_audit (workspace_id, action, gateway_id, details)
    VALUES (g.workspace_id, 'gateway.update_failed', g.id, jsonb_build_object('update', v_new_update));
  END IF;

  -- 0095 (A): a root the cloud has not confirmed, reported at sync.
  --   root_cert_pem is the root the gateway signs its leaves with NOW. After
  --   a start it is the enrolment's (nothing changes); after a replacement
  --   (an inside address left the root's /24s, §3) or a promotion (a month
  --   before the old root's end) it is a root browsers must trust before
  --   anything plays, and D25 asks the admin for its fingerprint again before
  --   it is offered: it lands in the next-root slot until confirmed, and a
  --   confirmed next root reported in use is promoted into the root's place.
  --   next_root_cert_pem is the root the gateway made a year before the old
  --   one's end and will switch to: offered beside the old one, confirmed the
  --   same way, promoted when the gateway reports it in use. A root that is
  --   no certificate (a key, a fragment) fingerprints as NULL and is ignored;
  --   the confirmed root itself, reported again, changes nothing.
  v_root_fp := public.gateway_pem_fingerprint(v_root_pem);
  v_next_fp := public.gateway_pem_fingerprint(v_next_pem);
  IF v_root_fp IS NOT NULL AND v_root_fp IS DISTINCT FROM g.root_fingerprint THEN
    IF v_root_fp = g.next_root_fingerprint AND g.next_root_confirmed_at IS NOT NULL THEN
      -- The confirmed next root is in use: promote it, and say so.
      v_prev_fp := g.root_fingerprint;
      UPDATE public.gateways SET
        root_cert_pem = public.gateways.next_root_cert_pem,
        root_fingerprint = public.gateways.next_root_fingerprint,
        root_confirmed_at = public.gateways.next_root_confirmed_at,
        root_confirmed_by = public.gateways.next_root_confirmed_by,
        next_root_cert_pem = NULL, next_root_fingerprint = NULL, next_root_seen_at = NULL,
        next_root_confirmed_at = NULL, next_root_confirmed_by = NULL
      WHERE public.gateways.id = g.id
      RETURNING * INTO g;
      INSERT INTO public.workspace_audit (workspace_id, action, gateway_id, details)
      VALUES (g.workspace_id, 'gateway.root_replaced', g.id,
              jsonb_build_object('fingerprint', g.root_fingerprint, 'previous', v_prev_fp));
    ELSIF v_root_fp IS DISTINCT FROM g.next_root_fingerprint THEN
      v_cand_pem := v_root_pem;
      v_cand_fp := v_root_fp;
    END IF;
  ELSIF v_next_fp IS NOT NULL AND v_next_fp IS DISTINCT FROM g.root_fingerprint
        AND v_next_fp IS DISTINCT FROM g.next_root_fingerprint THEN
    v_cand_pem := v_next_pem;
    v_cand_fp := v_next_fp;
  END IF;
  IF v_cand_fp IS NOT NULL THEN
    UPDATE public.gateways SET
      next_root_cert_pem = v_cand_pem, next_root_fingerprint = v_cand_fp, next_root_seen_at = now(),
      next_root_confirmed_at = NULL, next_root_confirmed_by = NULL
    WHERE public.gateways.id = g.id
    RETURNING * INTO g;
    INSERT INTO public.workspace_audit (workspace_id, action, gateway_id, details)
    VALUES (g.workspace_id, 'gateway.next_root_received', g.id,
            jsonb_build_object('fingerprint', v_cand_fp, 'in_use', v_cand_fp = v_root_fp));
  END IF;

  -- The reach check (§4; R16: one at a time). A waiting nonce is handed over
  -- now (and at every sync while the check runs); otherwise a check is begun
  -- HERE when one is due, its nonce in this very answer. An automatic check
  -- is knocked on at the NEXT sync, not this one (GW1 review round 2,
  -- finding 8): by then the gateway has had this answer, so one answer lost
  -- on the way cannot read as "not your gateway" and withdraw the address.
  v_running := g.reach_check_id IS NOT NULL AND g.reach_nonce_at > now() - interval '2 minutes';
  v_throttled := g.reach_nonce_at IS NOT NULL AND g.reach_nonce_at > now() - interval '10 minutes';
  IF v_running THEN
    IF g.reach_nonce_delivered_at IS NULL THEN
      UPDATE public.gateways SET reach_nonce_delivered_at = now() WHERE public.gateways.id = g.id
      RETURNING * INTO g;
      IF g.reach_check_auto THEN
        SELECT COALESCE(min((e ->> 'port')::int), 8443) INTO v_port
          FROM jsonb_array_elements(g.inside_addresses) AS e;
        v_check := jsonb_build_object('check_id', g.reach_check_id, 'nonce', g.reach_nonce,
                                      'address', g.outside_address, 'remote_viewing', COALESCE(v_switch, false),
                                      'inside_port', v_port);
      END IF;
    END IF;
  ELSIF g.outside_address IS NOT NULL AND (
           -- R6: a changed source withdrew the address above, at once, and is
           -- owed a check — begun at most every two minutes (GW1 review
           -- round 1, finding 3), so a source that flaps at every sync (two
           -- internet lines balanced per connection, or a forged header
           -- where the platform stamps none) cannot turn the cloud into a
           -- prober every ten seconds. The mark carries the debt, so the
           -- check comes two minutes on even if the source then holds still.
           (g.reach_detail = 'source_changed'
             AND (g.reach_nonce_at IS NULL OR g.reach_nonce_at < now() - interval '2 minutes'))
        OR (NOT v_throttled AND (
                g.reach_checked_at IS NULL
             OR g.reach_checked_at < now() - interval '24 hours'
             OR (COALESCE(v_switch, false) AND g.outside_open AND g.reach_ok IS NOT TRUE)))) THEN
    v_nonce := encode(extensions.gen_random_bytes(16), 'hex');
    v_check_id := gen_random_uuid();
    UPDATE public.gateways
       SET reach_check_id = v_check_id, reach_nonce = v_nonce,
           reach_nonce_at = now(), reach_nonce_delivered_at = NULL, reach_check_auto = true
     WHERE public.gateways.id = g.id
    RETURNING * INTO g;
  END IF;

  -- D22, the catalogue check: the row exists, is this company's, and sits
  -- at that location and path. Answered from the database as the service
  -- role — the one read Appendix C gives it here.
  IF jsonb_typeof(p_confirm) = 'array' AND jsonb_array_length(p_confirm) BETWEEN 1 AND 100 THEN
    SELECT COALESCE(jsonb_agg(DISTINCT f.id), '[]'::jsonb) INTO v_confirmed
      FROM jsonb_array_elements(p_confirm) AS c
      JOIN public.bin_files f
        ON f.id = public.fn_try_uuid(c ->> 'clip')
       AND f.location_id = public.fn_try_uuid(c ->> 'loc')
       AND f.relative_path = (c ->> 'path')
     WHERE f.workspace_id = g.workspace_id;
  END IF;

  IF g.update_check_requested_at IS NOT NULL
     AND g.update_check_requested_at > COALESCE(g.update_check_delivered_at, '-infinity'::timestamptz) THEN
    v_update_now := true;
    UPDATE public.gateways SET update_check_delivered_at = now() WHERE public.gateways.id = g.id;
  END IF;

  RETURN jsonb_build_object(
    'revoked', false,
    'gateway_id', g.id,
    'workspace_id', g.workspace_id,
    'name', g.name,
    'remote_viewing', COALESCE(v_switch, false),
    'outside_address', g.outside_address,
    'office_ranges', g.office_ranges,
    'signing_keys', (SELECT COALESCE(jsonb_agg(jsonb_build_object('kid', k.kid, 'public_key', k.public_key)
                                               ORDER BY k.created_at DESC), '[]'::jsonb)
                       FROM public.gateway_signing_keys k
                      WHERE k.workspace_id = g.workspace_id
                        AND (k.retired_at IS NULL OR k.retired_at > now() - interval '10 minutes')),
    'bin_locations', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', l.id, 'unc_path', l.unc_path)
                                                ORDER BY l.created_at, l.id), '[]'::jsonb)
                        FROM public.bin_locations l WHERE l.workspace_id = g.workspace_id),
    'confirmed', v_confirmed,
    'check_update_now', v_update_now,
    'check_reach_now', g.reach_nonce IS NOT NULL,
    'reach_nonce', g.reach_nonce,
    'background_check', v_check
  );
END;
$$;


-- =============================================================================
-- A4. gateway_confirm_root, restated whole (0093 §13b): the next root's
--     fingerprint too, from the same admin, with the same words (D25)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.gateway_confirm_root(p_gateway UUID, p_fingerprint TEXT)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_ws    UUID := public.fn_gateway_require_admin();
  v_g     public.gateways%ROWTYPE;
  v_fp    TEXT;
  v_label TEXT;
  v_at    TIMESTAMPTZ := now();
BEGIN
  SELECT * INTO v_g FROM public.gateways g
   WHERE g.id = p_gateway AND g.workspace_id = v_ws AND g.revoked_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That gateway is not in this company''s list.' USING ERRCODE = 'P0002';
  END IF;
  IF v_g.created_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Only the admin who made this gateway''s enrolment token can confirm its fingerprint: they are the one who saw it printed.'
      USING ERRCODE = '42501';
  END IF;
  -- Nothing left to confirm: the root is confirmed and no next root waits.
  IF v_g.root_confirmed_at IS NOT NULL AND v_g.next_root_fingerprint IS NULL THEN
    RETURN v_g.root_confirmed_at;
  END IF;
  IF v_g.root_fingerprint IS NULL THEN
    RAISE EXCEPTION 'This gateway sent WILSON no certificate, so there is no fingerprint to confirm.' USING ERRCODE = '55000';
  END IF;
  v_fp := lower(regexp_replace(COALESCE(p_fingerprint, ''), '[\s:]', '', 'g'));
  IF v_fp !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'A certificate fingerprint is 64 letters and digits (0–9 and a–f), with or without colons between the pairs.'
      USING ERRCODE = '22023';
  END IF;
  SELECT COALESCE(wm.display_name, wm.username) INTO v_label
    FROM public.workspace_members wm WHERE wm.workspace_id = v_ws AND wm.user_id = auth.uid();
  IF v_fp = v_g.root_fingerprint THEN
    IF v_g.root_confirmed_at IS NOT NULL THEN
      RETURN v_g.root_confirmed_at;
    END IF;
    UPDATE public.gateways SET root_confirmed_at = v_at, root_confirmed_by = auth.uid() WHERE public.gateways.id = p_gateway;
    INSERT INTO public.workspace_audit (workspace_id, action, actor_user_id, actor_label, gateway_id, details)
    VALUES (v_ws, 'gateway.root_confirmed', auth.uid(), left(v_label, 200), p_gateway,
            jsonb_build_object('fingerprint', v_g.root_fingerprint));
    RETURN v_at;
  END IF;
  -- 0095: the next root, asked for again as at enrolment.
  IF v_g.next_root_fingerprint IS NOT NULL AND v_fp = v_g.next_root_fingerprint THEN
    IF v_g.next_root_confirmed_at IS NOT NULL THEN
      RETURN v_g.next_root_confirmed_at;
    END IF;
    UPDATE public.gateways SET next_root_confirmed_at = v_at, next_root_confirmed_by = auth.uid() WHERE public.gateways.id = p_gateway;
    INSERT INTO public.workspace_audit (workspace_id, action, actor_user_id, actor_label, gateway_id, details)
    VALUES (v_ws, 'gateway.next_root_confirmed', auth.uid(), left(v_label, 200), p_gateway,
            jsonb_build_object('fingerprint', v_g.next_root_fingerprint));
    RETURN v_at;
  END IF;
  RAISE EXCEPTION 'That fingerprint does not match the certificate this gateway sent WILSON. Copy it again from the installer''s last screen or the container''s first log lines; if you did not install this gateway, choose Forget.'
    USING ERRCODE = '22023';
END;
$$;


-- =============================================================================
-- A5. Download the new certificate: the next root's PUBLIC certificate, after
--     its fingerprint is confirmed and not before (D25 in the database). The
--     old root stays served by gateway_root_certificate until the gateway
--     reports the new one in use and it is promoted.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.gateway_next_root_certificate(p_gateway UUID)
RETURNS TEXT
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_ws UUID := public.fn_gateway_require_admin();
  v_g  public.gateways%ROWTYPE;
BEGIN
  SELECT * INTO v_g FROM public.gateways g
   WHERE g.id = p_gateway AND g.workspace_id = v_ws AND g.revoked_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That gateway is not in this company''s list.' USING ERRCODE = 'P0002';
  END IF;
  IF v_g.next_root_cert_pem IS NULL THEN
    RAISE EXCEPTION 'This gateway has not sent WILSON a new certificate.' USING ERRCODE = 'P0002';
  END IF;
  IF v_g.next_root_confirmed_at IS NULL THEN
    RAISE EXCEPTION 'Confirm the new certificate''s fingerprint first: WILSON offers it only after the admin who installed this gateway has confirmed it is theirs.'
      USING ERRCODE = '55000';
  END IF;
  RETURN v_g.next_root_cert_pem;
END;
$$;

REVOKE ALL ON FUNCTION public.gateway_next_root_certificate(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gateway_next_root_certificate(UUID) TO authenticated;


-- =============================================================================
-- B. gateway_events_apply, restated whole (0093 §14c) with the fraction
-- =============================================================================

CREATE OR REPLACE FUNCTION public.gateway_events_apply(p_gateway UUID, p_rows JSONB)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  g             public.gateways%ROWTYPE;
  r             JSONB;
  v_accepted    JSONB := '[]'::jsonb;
  v_rejected    JSONB := '[]'::jsonb;
  v_vid         UUID;
  v_clip        UUID;
  v_sub         UUID;
  v_jti_text    TEXT;
  v_jti         UUID;
  v_started     TIMESTAMPTZ;
  v_ended       TIMESTAMPTZ;
  v_incomplete  BOOLEAN;
  v_project     UUID;
  v_name        TEXT;
  v_file_ws     UUID;
  v_found       BOOLEAN;
  v_label       TEXT;
  v_mint        public.gateway_ticket_mints%ROWTYPE;
  v_unverified  BOOLEAN;
  v_bytes       BIGINT;
  v_clip_bytes  BIGINT;
  v_fraction    NUMERIC;
  v_fraction_in NUMERIC;
  v_ranges      BIGINT;
  v_first       BIGINT;
  v_last        BIGINT;
  v_src         INET;
  v_srcs        JSONB;
  v_details     JSONB;
  v_reason      TEXT;
  v_shared      BOOLEAN;
BEGIN
  SELECT * INTO g FROM public.gateways WHERE public.gateways.id = p_gateway;
  IF NOT FOUND OR g.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'gateway_events_apply: no live gateway %', p_gateway USING ERRCODE = '42501';
  END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) > 200 THEN
    RAISE EXCEPTION 'gateway_events_apply: at most 200 rows in an array' USING ERRCODE = '22023';
  END IF;

  FOR r IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    v_vid := CASE WHEN jsonb_typeof(r) = 'object' THEN public.fn_try_uuid(r ->> 'viewing_id') END;
    IF v_vid IS NULL THEN
      v_rejected := v_rejected || jsonb_build_array(jsonb_build_object(
        'viewing_id', CASE WHEN jsonb_typeof(r) = 'object' THEN left(r ->> 'viewing_id', 64) END,
        'reason', 'malformed'));
      CONTINUE;
    END IF;
    v_reason := NULL;
    v_fraction_in := NULL;
    BEGIN
      v_clip := public.fn_try_uuid(r ->> 'clip');
      v_sub := public.fn_try_uuid(r ->> 'sub');
      v_jti_text := r ->> 'ticket_jti';
      IF v_clip IS NULL OR v_sub IS NULL OR v_jti_text IS NULL OR v_jti_text !~ '^[0-9a-f]{32}$' THEN
        v_reason := 'malformed';
      END IF;
      IF v_reason IS NULL THEN
        v_jti := v_jti_text::uuid;
        v_started := (r ->> 'started_at')::timestamptz;
        v_ended := (r ->> 'ended_at')::timestamptz;
        v_incomplete := COALESCE((r ->> 'incomplete')::boolean, false);
        v_bytes := COALESCE((r ->> 'bytes')::bigint, 0);
        v_clip_bytes := (r ->> 'clip_bytes')::bigint;
        v_ranges := COALESCE((r ->> 'range_count')::bigint, 0);
        v_first := (r ->> 'first_offset')::bigint;
        v_last := (r ->> 'last_offset')::bigint;
        v_shared := (r ->> 'shared_url')::boolean;
        -- 0095 (B): the gateway's own fraction — the distinct bytes it served,
        -- over the clip's size (its coverage) — when it sends one; absent or
        -- null means none, and one that is no number refuses the row.
        v_fraction_in := CASE WHEN jsonb_typeof(r -> 'fraction') IN ('number', 'string') THEN (r ->> 'fraction')::numeric END;
        IF v_started IS NULL
           OR v_started < g.created_at - interval '5 minutes'
           OR v_started > now() + interval '5 minutes'
           OR (v_ended IS NOT NULL AND (v_ended < v_started OR v_ended > now() + interval '5 minutes'))
           OR (v_ended IS NULL AND NOT v_incomplete) THEN
          v_reason := 'time';
        ELSIF v_bytes < 0 OR v_bytes > 1000000000000000 OR v_ranges < 0
           OR (v_clip_bytes IS NOT NULL AND v_clip_bytes <= 0)
           OR (v_first IS NOT NULL AND v_first < 0) OR (v_last IS NOT NULL AND v_last < 0) THEN
          v_reason := 'malformed';
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_reason := 'malformed';
    END;

    IF v_reason IS NULL THEN
      -- The clip: this company's, from the catalogue or from its mint.
      SELECT f.project_id, f.display_name, f.workspace_id INTO v_project, v_name, v_file_ws
        FROM public.bin_files f WHERE f.id = v_clip;
      v_found := FOUND;
      SELECT * INTO v_mint FROM public.gateway_ticket_mints m WHERE m.jti = v_jti;
      IF v_found AND v_file_ws IS DISTINCT FROM g.workspace_id THEN
        v_reason := 'unknown_clip';
      ELSIF NOT v_found THEN
        IF v_mint.jti IS NOT NULL AND v_mint.bin_file_id = v_clip AND v_mint.workspace_id = g.workspace_id
           AND v_mint.project_id IS NOT NULL THEN
          v_project := v_mint.project_id;
          v_name := v_mint.file_name;
        ELSE
          v_reason := 'unknown_clip';
        END IF;
      END IF;
    END IF;

    IF v_reason IS NULL THEN
      -- The viewer: a membership row in this company, active or not (a
      -- removed member keeps their row, so a viewing before a removal still
      -- names them).
      SELECT COALESCE(wm.display_name, wm.username) INTO v_label
        FROM public.workspace_members wm WHERE wm.workspace_id = g.workspace_id AND wm.user_id = v_sub;
      IF NOT FOUND THEN
        v_reason := 'unknown_viewer';
      END IF;
    END IF;

    IF v_reason IS NULL THEN
      IF v_mint.jti IS NOT NULL THEN
        IF v_mint.gateway_id <> g.id OR v_mint.user_id <> v_sub OR v_mint.bin_file_id <> v_clip THEN
          v_reason := 'mint_mismatch';
        ELSE
          -- GW1 review round 2, finding 3: a ticket vouches only for viewings
          -- inside its stream's life — from two minutes before it was minted
          -- (the clocks' skew) to four hours and five minutes after (a stream
          -- is renewed for four hours at most, §5) — and for 250 of them at
          -- most (a new row needs a minute without a request or five
          -- minutes of play, D7, so the longest stream writes fewer). Outside
          -- that the row is written flagged: the gateway's word. Counted
          -- under the ticket's own lock, so two batches cannot both see 249.
          PERFORM pg_advisory_xact_lock(hashtextextended('gateway_jti:' || v_jti_text, 0));
          v_unverified := v_started < v_mint.minted_at - interval '2 minutes'
                       OR v_started > v_mint.minted_at + interval '4 hours 5 minutes'
                       OR (SELECT count(*) FROM public.file_events e
                            WHERE e.event = 'viewed_remote' AND e.details ->> 'ticket_jti' = v_jti_text) >= 250;
        END IF;
      ELSIF v_started >= now() - interval '30 days'
            AND NOT EXISTS (SELECT 1 FROM public.gateway_ticket_mints m
                             WHERE m.gateway_id = g.id AND m.user_id = v_sub AND m.bin_file_id = v_clip) THEN
        v_reason := 'never_minted';
      ELSE
        v_unverified := true;
      END IF;
    END IF;

    IF v_reason IS NOT NULL THEN
      v_rejected := v_rejected || jsonb_build_array(jsonb_build_object('viewing_id', v_vid, 'reason', v_reason));
      CONTINUE;
    END IF;

    -- The viewing's own facts, every string truncated, addresses parsed.
    BEGIN
      v_src := (r ->> 'source_address')::inet;
    EXCEPTION WHEN OTHERS THEN
      v_src := NULL;
    END;
    SELECT COALESCE(jsonb_agg(a), '[]'::jsonb) INTO v_srcs
      FROM (SELECT DISTINCT host(public.fn_gateway_try_inet(x #>> '{}')) AS a
              FROM jsonb_array_elements(CASE WHEN jsonb_typeof(r -> 'source_addresses') = 'array'
                                             THEN r -> 'source_addresses' ELSE '[]'::jsonb END) AS x
             WHERE jsonb_typeof(x) = 'string' AND public.fn_gateway_try_inet(x #>> '{}') IS NOT NULL
             LIMIT 4) s;
    -- 0095 (B): coverage is what "read in full" means to an admin. The
    -- gateway's fraction when it sent one (clamped to 0–1), else the bytes it
    -- served over the clip's size as 0093 counted it; read_in_full is
    -- computed HERE (≥ 0.9) and never taken from the payload.
    v_fraction := CASE WHEN v_fraction_in IS NOT NULL THEN round(least(1, greatest(0, v_fraction_in)), 3)
                       WHEN v_clip_bytes IS NOT NULL AND v_clip_bytes > 0 THEN round(v_bytes::numeric / v_clip_bytes, 3) END;
    v_details := jsonb_build_object(
      'viewing_id', v_vid,
      'gateway_id', g.id,
      'gateway_name', left(g.name, 80),
      'started_at', v_started,
      'ended_at', v_ended,
      'bytes', v_bytes,
      'clip_bytes', v_clip_bytes,
      'fraction', v_fraction,
      'fraction_from', CASE WHEN v_fraction_in IS NOT NULL THEN 'coverage' WHEN v_fraction IS NOT NULL THEN 'bytes' END,
      'read_in_full', COALESCE(v_fraction >= 0.9, false),
      'range_count', v_ranges,
      'first_offset', v_first,
      'last_offset', v_last,
      'source_address', host(v_src),
      'source_addresses', v_srcs,
      'shared_url', COALESCE(v_shared, false) OR jsonb_array_length(v_srcs) > 1,
      -- GW1 review round 1, finding 4: `via` is shown to admins beside the
      -- viewer's address, so a gateway's free text must not speak there in
      -- WILSON's voice ("via the office VPN"): the vendor's word from a
      -- short list, anything else 'other', none for a direct viewing.
      -- Round 2: GW2's gateway (built before round 1's list) says 'direct'
      -- for a direct viewing and 'local_proxy' for the NAS's reverse proxy;
      -- both are read in the list's terms.
      'via', CASE WHEN lower(btrim(COALESCE(r ->> 'via', ''))) IN ('', 'direct') THEN NULL
                  WHEN lower(btrim(r ->> 'via')) IN ('cloudflare', 'tailscale', 'ngrok', 'nas_proxy')
                       THEN lower(btrim(r ->> 'via'))
                  WHEN lower(btrim(r ->> 'via')) = 'local_proxy' THEN 'nas_proxy'
                  ELSE 'other' END,
      'user_agent', left(r ->> 'user_agent', 64),
      'ticket_jti', v_jti_text,
      'unverified_mint', v_unverified,
      'incomplete', v_incomplete);
    -- One row's failure refuses that row, never the batch: a batch that kept
    -- failing would be retried by the journal forever.
    BEGIN
      INSERT INTO public.file_events
        (workspace_id, project_id, file_id, file_name, event, subject, size_bytes,
         actor_user_id, actor_label, details, created_at, external_id)
      VALUES (g.workspace_id, v_project, v_clip, left(v_name, 500), 'viewed_remote', 'bin_file', v_bytes,
              v_sub, left(v_label, 200), v_details, v_started, g.id::text || ':' || v_vid::text)
      ON CONFLICT (external_id) WHERE external_id IS NOT NULL DO NOTHING;
    EXCEPTION WHEN OTHERS THEN
      v_rejected := v_rejected || jsonb_build_array(jsonb_build_object('viewing_id', v_vid, 'reason', 'refused'));
      CONTINUE;
    END;
    v_accepted := v_accepted || jsonb_build_array(v_vid);
  END LOOP;

  RETURN jsonb_build_object('accepted', v_accepted, 'rejected', v_rejected);
END;
$$;


-- =============================================================================
-- C. Post-conditions
-- =============================================================================

DO $$
DECLARE
  v_pem TEXT := '-----BEGIN CERTIFICATE-----' || chr(10)
    || encode(decode('30' || repeat('5e', 90), 'hex'), 'base64') || chr(10) || '-----END CERTIFICATE-----';
BEGIN
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'gateways'
         AND column_name IN ('next_root_cert_pem', 'next_root_fingerprint', 'next_root_seen_at',
                             'next_root_confirmed_at', 'next_root_confirmed_by')) <> 5 THEN
    RAISE EXCEPTION '0095 post-condition failed: the next root''s five columns are missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gateways_next_root_chk'
                  AND pg_get_constraintdef(oid) LIKE '%gateway_pem_fingerprint(next_root_cert_pem)%') THEN
    RAISE EXCEPTION '0095 post-condition failed: gateways_next_root_chk must hold the fingerprint to the PEM';
  END IF;
  IF has_column_privilege('authenticated', 'public.gateways', 'next_root_cert_pem', 'SELECT')
     OR NOT has_column_privilege('authenticated', 'public.gateways', 'next_root_fingerprint', 'SELECT')
     OR NOT has_column_privilege('authenticated', 'public.gateways', 'next_root_confirmed_at', 'SELECT')
     OR has_column_privilege('authenticated', 'public.gateways', 'next_root_fingerprint', 'UPDATE') THEN
    RAISE EXCEPTION '0095 post-condition failed: the next root''s grants (the fingerprint and the times readable, the PEM not, nothing writable)';
  END IF;
  IF to_regprocedure('public.gateway_next_root_certificate(uuid)') IS NULL
     OR NOT has_function_privilege('authenticated', 'public.gateway_next_root_certificate(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.gateway_next_root_certificate(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '0095 post-condition failed: gateway_next_root_certificate is missing or wrongly granted';
  END IF;
  IF pg_get_functiondef('public.gateway_sync_apply(uuid,jsonb,inet,jsonb)'::regprocedure) NOT LIKE '%next_root_cert_pem%'
     OR pg_get_functiondef('public.gateway_sync_apply(uuid,jsonb,inet,jsonb)'::regprocedure) NOT LIKE '%gateway.root_replaced%'
     OR pg_get_functiondef('public.gateway_confirm_root(uuid,text)'::regprocedure) NOT LIKE '%gateway.next_root_confirmed%'
     OR pg_get_functiondef('public.gateway_events_apply(uuid,jsonb)'::regprocedure) NOT LIKE '%fraction_from%' THEN
    RAISE EXCEPTION '0095 post-condition failed: a function kept its 0093 body';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_audit_action_chk'
                  AND pg_get_constraintdef(oid) LIKE '%gateway.next_root_received%'
                  AND pg_get_constraintdef(oid) LIKE '%gateway.next_root_confirmed%'
                  AND pg_get_constraintdef(oid) LIKE '%gateway.root_replaced%'
                  AND pg_get_constraintdef(oid) LIKE '%gateway.keys_rotated%') THEN
    RAISE EXCEPTION '0095 post-condition failed: the trail''s vocabulary is missing a word';
  END IF;
  IF public.gateway_pem_fingerprint(v_pem) !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION '0095 post-condition failed: gateway_pem_fingerprint no longer fingerprints a certificate';
  END IF;
  RAISE NOTICE '0095 OK: the next root''s five columns under their CHECK and grants; gateway_sync_apply stores a reported root the admin has not confirmed and promotes a confirmed one in use; gateway_confirm_root takes the next root''s fingerprint; gateway_next_root_certificate serves it once confirmed; gateway_events_apply takes the gateway''s fraction (clamped) and computes read_in_full itself; three new words in the trail';
END $$;
