-- =============================================================================
-- 0093_file_gateway.sql — the WILSON file gateway's cloud side, bundle GW1
-- (post-overhaul, 2026-10-10).
--
-- The design is docs/design/GATEWAY_DESIGN.md (BC4, 2026-10-09, two review
-- rounds); this file is its Appendix B, written and proved, with the
-- departures listed under DECISIONS below. The gateway is a small program a
-- company installs on one computer inside its own network; a browser plays a
-- clip that stays on the company's share by asking the cloud for a two-minute
-- ticket and handing that ticket to the gateway, which serves the bytes. This
-- migration is the cloud's half: who enrolled which gateway and with what
-- credential, the keys that sign the tickets, the record of every ticket, the
-- audit of every viewing from outside the office, the admin's own audit, and
-- the admin's switch made safe against a demoted admin.
--
-- HER RULINGS THAT SHAPE THIS FILE (docs/design/GATEWAY_QUESTIONS.md, verbatim)
-- -----------------------------------------------------------------------
--   G2  "It registers itself with the cloud (Recommended)": the gateway
--       enrols with a one-use token an admin makes here; the web app learns
--       its address from gateways_visible, never from a person typing it.
--   G3  "The company exposes it themselves (Recommended)": the cloud only
--       CHECKS reach (gateway-reach) and publishes an outside address once a
--       check found the enrolled gateway there.
--   G4+G5 "Project people past the Bins gate; bin clips only (Recommended)":
--       gateway_clips_for_tickets is the Bins gate itself, evaluated AS THE
--       CALLER (SECURITY INVOKER over bin_files' and bin_locations' RLS).
--   G6  "Only reads from outside the network": file_events gains the
--       'viewed_remote' row, written by gateway-events and read by a LIVE
--       workspace admin only (D6). Office viewing writes nothing.
--   B5a The switch is a workspace admin's; D23 makes that a live row check.
--
-- WHAT THIS ADDS (in file order)
-- ------------------------------
--   1. is_live_workspace_admin(ws) — the live row, not the token's claim
--   2. the pure validators the CHECKs call (office ranges, outside address,
--      inside addresses, the PEM's fingerprint)
--   3. public.workspace_audit — the switch's own row (BC1 deferred it) and
--      the gateway's lifecycle, admins only
--   4. the switch: a BEFORE UPDATE live-admin trigger and an AFTER UPDATE
--      audit trigger on workspaces.remote_viewing_enabled
--   5. public.gateways — one row per enrolled gateway; admins read and write
--      three columns; members read gateways_visible instead
--   6. public.gateway_secrets — the credential's SHA-256 and the reach key,
--      service role only
--   7. public.gateway_enrolment_tokens — 24 h, single use, admins see and
--      cancel them; the token itself is never stored
--   8. public.gateway_signing_keys — the cloud's Ed25519 keys per workspace,
--      the private half encrypted under WILSON_GATEWAY_KEY_SECRET
--   9. public.gateway_ticket_mints — every ticket signed, kept thirty days
--  10. file_events: subject, external_id, the 'viewed_remote' term, and
--      file_events_select restated with one conjunct
--  11. gateway_clips_for_tickets(p_ids) — the read gate, as the caller
--  12. gateways_visible — the definer view a browser reads
--  13. the admin's RPCs (make a token, confirm the fingerprint, download the
--      certificate, forget and undo, ask for an update check, rotate the
--      ticket keys)
--  14. the service role's RPCs behind the five Edge Functions (enrol, sync,
--      events, the signing key, the reach check)
--  15. the sweep, scheduled every five minutes
--  16. post-conditions
--
-- DECISIONS THIS FILE MADE, AND WHY (each is in GW1's hand-off)
-- -------------------------------------------------------------
--   * The WIRE overrides Appendix B where they differ (the controller fixed
--     the wire after the design): a signing key's public half is STANDARD
--     base64 of the raw 32 bytes (Appendix B's comment said base64url), and
--     a jti is 32 lower-case hex characters, kept in a UUID column (Postgres
--     reads 32 hex digits as a uuid; 128 random bits fit exactly).
--   * The live-admin trigger fires BEFORE UPDATE WHEN the value changes, not
--     BEFORE UPDATE OF the column: an UPDATE OF trigger does not fire when an
--     earlier trigger, not the statement, changed the column. It is named to
--     sort LAST among workspaces' BEFORE UPDATE triggers, so it judges the
--     final row, and §16 pins that order.
--   * The admin's actions are SECURITY DEFINER RPCs that check the live row
--     themselves (gateway_make_enrolment_token and the rest): Appendix B
--     gives tokens "INSERT by the function only" and no function among the
--     five is the admin's, so the token is made in SQL from pgcrypto's
--     gen_random_bytes. Rename, the outside address and the office ranges
--     stay plain admin UPDATEs (column grants + RLS), as Appendix B says.
--   * gateways_visible publishes a gateway only after the enrolling admin
--     confirmed its fingerprint (root_confirmed_at), not merely its download:
--     a gateway enrolled with a stolen token is never offered to a member's
--     browser, whose tickets it would otherwise receive (§10 row 3 narrowed).
--     The outside address also needs a sync within 60 s (D15: no cloud for
--     60 s closes the outside door, so the cloud stops publishing it too).
--   * The root certificate is NOT readable by a column grant: an admin
--     downloads it through gateway_root_certificate(), which refuses until
--     the fingerprint is confirmed (D25 in the database, not only the UI).
--   * workspace_audit has four actions Appendix B's list lacked:
--     gateway.outside_address_changed (§10 row 23 requires the row),
--     gateway.root_confirmed, gateway.forget_undone and gateway.keys_rotated.
--   * GW1's two review rounds changed what the design's text predates (its
--     review history says each): the reach check is proved, not echoed —
--     nonce_proof, an HMAC keyed by a reach key of its own
--     (gateway_secrets.reach_key = SHA-256 of 'wilson-reach-key:' and the
--     credential, set at enrolment), never by the credential's hash, which
--     every gateway call looks up in a request URL; a ticket vouches for a
--     viewing only inside its stream's life and for 250 rows; a check that
--     could not run leaves reach_ok as it was, and an automatic check knocks
--     one sync after its nonce went out; a gateway's name is cleaned of
--     control and direction characters and its version is a version; an
--     admin rotates the ticket keys (gateway_rotate_signing_key, §5).
--   * Forget is undoable for one minute: it sets revoked_at at once (every
--     function refuses the gateway from that instant); the credential's row
--     is deleted by the sweep once the minute has passed ('gateway.revoked').
--   * gateway-events derives in SQL (gateway_events_apply), one transaction
--     per batch, so suite 96 proves the derivations themselves. A missing
--     mint is flagged unverified_mint (R4); a viewing for a pair that was
--     NEVER minted inside the thirty days is refused, and a viewing can never
--     start before its gateway was enrolled, so the aged-out arm cannot be
--     used to backdate a forged viewing past the mint log of a new gateway.
--   * gateway_ticket_mints also snapshots the clip's project and name, so a
--     viewing of a clip removed between play and flush is still written.
--
-- ORDERING — depends on:
--   0001 workspaces, workspace_members, pgcrypto; 0008 has_active_membership,
--   current_workspace_id, current_app_role; 0020 workspaces_admin_update;
--   0027 file_events; 0028 fn_rate_limit_hit (the functions' limiter); 0037
--   can_access_project_money; 0042 fn_try_uuid; 0074 file_events.is_financial;
--   0091 bin_files, bin_locations, workspaces.remote_viewing_enabled,
--   rabbit_remote_viewing_enabled; 0092 can_access_project_legal,
--   file_event_is_legal and the CURRENT file_events_select, restated whole.
-- The pre-flight refuses to run without them, and refuses if
-- file_events_select is not 0092's (or this file's own, on a re-run).
--
-- Numbers: 0093 / suite 96 (confirmed free by the controller, 2026-10-09).
-- 0094 / suite 97 are RESERVED for aligning 0091's unc_path CHECK (BC3's
-- deferral) and are not this bundle's. Next free after this: 0095 / suite 98.
-- Idempotent: IF NOT EXISTS, CREATE OR REPLACE, DROP-then-CREATE for
-- policies, triggers and constraints; cron.schedule upserts by name.
-- 🚨 RE-RUN THIS FILE after any replay of 0092 (which recreates
-- file_events_select without this file's conjunct) or of 0020 / 0048 (which
-- recreate nothing here, but say so in their own headers).
-- =============================================================================


-- =============================================================================
-- 0. PRE-FLIGHT — refuse to run on a target that lacks what this file calls
-- =============================================================================
DO $$
DECLARE
  v_qual TEXT;
BEGIN
  IF to_regclass('public.bin_files') IS NULL OR to_regclass('public.bin_locations') IS NULL THEN
    RAISE EXCEPTION '0093 pre-flight failed: public.bin_files / public.bin_locations are missing — apply 0091 first';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'workspaces'
                    AND column_name = 'remote_viewing_enabled') THEN
    RAISE EXCEPTION '0093 pre-flight failed: workspaces.remote_viewing_enabled is missing — apply 0091 first';
  END IF;
  IF to_regprocedure('public.rabbit_remote_viewing_enabled(uuid)') IS NULL THEN
    RAISE EXCEPTION '0093 pre-flight failed: public.rabbit_remote_viewing_enabled(uuid) is missing — apply 0091 first';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'file_events'
                    AND column_name = 'is_financial') THEN
    RAISE EXCEPTION '0093 pre-flight failed: file_events.is_financial is missing — apply 0074 first';
  END IF;
  IF to_regprocedure('public.can_access_project_money(uuid)') IS NULL THEN
    RAISE EXCEPTION '0093 pre-flight failed: public.can_access_project_money(uuid) is missing — apply 0037 first';
  END IF;
  IF to_regprocedure('public.can_access_project_legal(uuid)') IS NULL
     OR to_regprocedure('public.file_event_is_legal(text, text)') IS NULL THEN
    RAISE EXCEPTION '0093 pre-flight failed: the Legal gate is missing — apply 0092 first (file_events_select is restated from its 0092 body)';
  END IF;
  IF to_regprocedure('public.fn_try_uuid(text)') IS NULL THEN
    RAISE EXCEPTION '0093 pre-flight failed: public.fn_try_uuid(text) is missing — apply 0042 first';
  END IF;
  IF to_regprocedure('public.fn_rate_limit_hit(text, text, integer, integer)') IS NULL THEN
    RAISE EXCEPTION '0093 pre-flight failed: public.fn_rate_limit_hit is missing — apply 0028 first (the gateway functions'' limiter)';
  END IF;
  IF to_regprocedure('extensions.gen_random_bytes(integer)') IS NULL THEN
    RAISE EXCEPTION '0093 pre-flight failed: extensions.gen_random_bytes is missing — pgcrypto must live in the extensions schema (the enrolment token and the reach nonce need it)';
  END IF;
  -- 🚨 THE 0062 LESSON AS A GUARD. §10 restates file_events_select with every
  -- arm it has TODAY. Had a migration after 0092 added an arm, restating
  -- 0092's text would silently drop it — the shape of 0062's live privilege
  -- escalation. So the live policy must be exactly 0092's (a first run) or
  -- exactly this file's (a re-run), or nothing happens.
  SELECT qual INTO v_qual FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'file_events' AND policyname = 'file_events_select';
  IF v_qual IS DISTINCT FROM '((workspace_id = current_workspace_id()) AND has_active_membership(workspace_id) AND (can_read_project_topic(project_id) OR (current_app_role() = ''admin''::text)) AND ((NOT is_financial) OR (current_app_role() = ''admin''::text) OR COALESCE(can_access_project_money(project_id), false) OR (file_event_is_legal(old_path, new_path) AND COALESCE(can_access_project_legal(project_id), false))))'
     AND v_qual IS DISTINCT FROM '((workspace_id = current_workspace_id()) AND has_active_membership(workspace_id) AND (can_read_project_topic(project_id) OR (current_app_role() = ''admin''::text)) AND ((NOT is_financial) OR (current_app_role() = ''admin''::text) OR COALESCE(can_access_project_money(project_id), false) OR (file_event_is_legal(old_path, new_path) AND COALESCE(can_access_project_legal(project_id), false))) AND ((event <> ''viewed_remote''::text) OR is_live_workspace_admin(workspace_id)))' THEN
    RAISE EXCEPTION '0093 pre-flight failed: file_events_select is neither 0092''s policy nor this file''s (it reads %): a later migration changed it, so restate ITS arms in §10 before running this', COALESCE(v_qual, '<missing>');
  END IF;
END $$;


-- =============================================================================
-- 1. is_live_workspace_admin — the live row, not the token's claim (F21, D23)
-- =============================================================================
-- A demoted or deactivated admin's sign-in token keeps saying 'admin' for up
-- to an hour (the TPN-AUTH-008 shape). Everything this file gives admins only
-- asks THIS, never current_app_role(): the switch's trigger, the remote-viewing
-- rows, the gateways table, the tokens, the audit. SECURITY DEFINER so it can
-- read workspace_members whatever the caller may; it answers only about the
-- CALLER (auth.uid()), so it is no oracle about anyone else.

CREATE OR REPLACE FUNCTION public.is_live_workspace_admin(ws UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT ws IS NOT NULL AND auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.workspace_members wm
     WHERE wm.workspace_id = ws
       AND wm.user_id = auth.uid()
       AND wm.is_active
       AND wm.app_role = 'admin'
  );
$$;

REVOKE ALL ON FUNCTION public.is_live_workspace_admin(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_live_workspace_admin(UUID) TO authenticated, service_role;

COMMENT ON FUNCTION public.is_live_workspace_admin(UUID) IS
  '0093 (D23, review round 1 F21): true when the CALLER has a live, active workspace_members row with app_role = ''admin'' in ws — the row, never the token''s claim, so a demoted or deactivated admin stops at once. Read by the switch''s trigger, file_events_select''s viewed_remote conjunct and every gateway policy and admin RPC.';


-- =============================================================================
-- 2. THE PURE VALIDATORS the CHECKs and the RPCs call
-- =============================================================================
-- Each is IMMUTABLE and answers false (never raises) for anything malformed,
-- so a CHECK refuses with 23514 rather than a cast error. A CHECK runs its
-- functions with the WRITER's privileges, so an admin's UPDATE needs EXECUTE
-- on the two the gateways CHECKs call — granted to authenticated, and safe:
-- they read nothing.

-- 2a. The office ranges (D21): at most eight, each a CIDR in its canonical
--     spelling, private (RFC 1918 or unique-local fc00::/7) and no wider
--     than a /16 (IPv4) or a /48 (IPv6: a site's ULA prefix, RFC 4193 — the
--     design's "/16" read for the address family where a /16 would be most
--     of the private space). No duplicates.
CREATE OR REPLACE FUNCTION public.gateway_office_ranges_ok(p_ranges JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE SET search_path = public
AS $$
DECLARE
  v_elem JSONB;
  v_text TEXT;
  v_cidr CIDR;
  v_seen TEXT[] := ARRAY[]::TEXT[];
BEGIN
  IF p_ranges IS NULL OR jsonb_typeof(p_ranges) <> 'array' OR jsonb_array_length(p_ranges) > 8 THEN
    RETURN false;
  END IF;
  FOR v_elem IN SELECT value FROM jsonb_array_elements(p_ranges) LOOP
    IF jsonb_typeof(v_elem) <> 'string' THEN RETURN false; END IF;
    v_text := v_elem #>> '{}';
    IF v_text IS NULL OR char_length(v_text) > 49 THEN RETURN false; END IF;
    BEGIN
      v_cidr := v_text::cidr;
    EXCEPTION WHEN OTHERS THEN
      RETURN false;
    END;
    IF v_cidr::text <> v_text THEN RETURN false; END IF;
    IF family(v_cidr) = 4 THEN
      IF masklen(v_cidr) < 16
         OR NOT (v_cidr <<= '10.0.0.0/8'::cidr OR v_cidr <<= '172.16.0.0/12'::cidr OR v_cidr <<= '192.168.0.0/16'::cidr) THEN
        RETURN false;
      END IF;
    ELSE
      IF masklen(v_cidr) < 48 OR NOT (v_cidr <<= 'fc00::/7'::cidr) THEN
        RETURN false;
      END IF;
    END IF;
    IF v_text = ANY (v_seen) THEN RETURN false; END IF;
    v_seen := v_seen || v_text;
  END LOOP;
  RETURN true;
END;
$$;

-- 2b. A public address literal: what an outside address may be, when it is
--     a literal. Loopback, private, link-local, CGNAT, multicast, reserved,
--     documentation and the IPv6 transition ranges (which embed an IPv4
--     address the check would not see) are all refused.
CREATE OR REPLACE FUNCTION public.gateway_is_public_ip(p INET)
RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE SET search_path = public
AS $$
  SELECT p IS NOT NULL
     AND masklen(p) = CASE WHEN family(p) = 4 THEN 32 ELSE 128 END
     AND CASE WHEN family(p) = 4 THEN NOT (
              p <<= '0.0.0.0/8'::inet OR p <<= '10.0.0.0/8'::inet OR p <<= '100.64.0.0/10'::inet
           OR p <<= '127.0.0.0/8'::inet OR p <<= '169.254.0.0/16'::inet OR p <<= '172.16.0.0/12'::inet
           OR p <<= '192.0.0.0/24'::inet OR p <<= '192.0.2.0/24'::inet OR p <<= '192.88.99.0/24'::inet
           OR p <<= '192.168.0.0/16'::inet OR p <<= '198.18.0.0/15'::inet OR p <<= '198.51.100.0/24'::inet
           OR p <<= '203.0.113.0/24'::inet OR p <<= '224.0.0.0/4'::inet OR p <<= '240.0.0.0/4'::inet)
         ELSE NOT (
              p <<= '::/96'::inet OR p <<= '::1/128'::inet OR p <<= '::ffff:0:0/96'::inet
           OR p <<= '64:ff9b::/96'::inet OR p <<= '64:ff9b:1::/48'::inet OR p <<= '100::/64'::inet
           OR p <<= '2001::/32'::inet OR p <<= '2001:db8::/32'::inet OR p <<= '2002::/16'::inet
           OR p <<= 'fc00::/7'::inet OR p <<= 'fe80::/10'::inet OR p <<= 'ff00::/8'::inet)
         END;
$$;

-- 2c. The outside address an admin sets: exactly { host, port }; the port
--     1–65535; the host a public address literal in its canonical spelling,
--     or a lower-case DNS name of two or more labels that is not a local,
--     reserved or Supabase name. This is the first line only: gateway-reach
--     resolves a name and refuses it unless every address is public (§10
--     row 16), and nothing is published before a check finds the gateway.
CREATE OR REPLACE FUNCTION public.gateway_outside_address_ok(p_address JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE SET search_path = public
AS $$
DECLARE
  v_host TEXT;
  v_port NUMERIC;
  v_ip   INET;
BEGIN
  IF p_address IS NULL OR jsonb_typeof(p_address) <> 'object' THEN RETURN false; END IF;
  IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_address) AS k) IS DISTINCT FROM ARRAY['host', 'port'] THEN
    RETURN false;
  END IF;
  IF jsonb_typeof(p_address -> 'host') <> 'string' OR jsonb_typeof(p_address -> 'port') <> 'number' THEN
    RETURN false;
  END IF;
  v_host := p_address ->> 'host';
  v_port := (p_address ->> 'port')::numeric;
  IF v_port <> trunc(v_port) OR v_port < 1 OR v_port > 65535 THEN RETURN false; END IF;
  IF char_length(v_host) < 1 OR char_length(v_host) > 253 THEN RETURN false; END IF;
  IF v_host ~ '^[0-9a-f:.]+$' AND v_host ~ '[:.]' THEN
    BEGIN
      v_ip := v_host::inet;
    EXCEPTION WHEN OTHERS THEN
      v_ip := NULL;
    END;
    IF v_ip IS NOT NULL THEN
      RETURN host(v_ip) = v_host AND public.gateway_is_public_ip(v_ip);
    END IF;
  END IF;
  RETURN v_host ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$'
     AND v_host !~ '\.(local|localhost|internal|intranet|lan|home|corp|localdomain|home\.arpa|invalid|test|example|onion)$'
     AND v_host !~ '(^|\.)supabase\.(co|in|net|com)$';
END;
$$;

-- 2d. One inside address: a private literal (RFC 1918 or fc00::/7) in its
--     canonical spelling, or the computer's own one-label name, or that name
--     under .local (mDNS) — §2's interface rule as the cloud can check it.
--     A public name or a public address is never an inside address: a
--     member's browser probes these, and must never be sent out of the
--     office by one.
CREATE OR REPLACE FUNCTION public.gateway_inside_host_ok(p_host TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE SET search_path = public
AS $$
DECLARE
  v_ip INET;
BEGIN
  IF p_host IS NULL OR char_length(p_host) < 1 OR char_length(p_host) > 253 THEN RETURN false; END IF;
  IF p_host ~ '^[0-9a-f:.]+$' AND p_host ~ '[:.]' THEN
    BEGIN
      v_ip := p_host::inet;
    EXCEPTION WHEN OTHERS THEN
      v_ip := NULL;
    END;
    IF v_ip IS NOT NULL THEN
      RETURN host(v_ip) = p_host
         AND masklen(v_ip) = CASE WHEN family(v_ip) = 4 THEN 32 ELSE 128 END
         AND (v_ip <<= '10.0.0.0/8'::inet OR v_ip <<= '172.16.0.0/12'::inet
              OR v_ip <<= '192.168.0.0/16'::inet OR v_ip <<= 'fc00::/7'::inet);
    END IF;
  END IF;
  RETURN p_host ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.local)?$';
END;
$$;

-- 2e. The inside addresses as a whole: at most sixteen { host, port }.
CREATE OR REPLACE FUNCTION public.gateway_inside_addresses_ok(p_addresses JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE SET search_path = public
AS $$
DECLARE
  v_elem JSONB;
  v_port NUMERIC;
BEGIN
  IF p_addresses IS NULL OR jsonb_typeof(p_addresses) <> 'array' OR jsonb_array_length(p_addresses) > 16 THEN
    RETURN false;
  END IF;
  FOR v_elem IN SELECT value FROM jsonb_array_elements(p_addresses) LOOP
    IF jsonb_typeof(v_elem) <> 'object' THEN RETURN false; END IF;
    IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(v_elem) AS k) IS DISTINCT FROM ARRAY['host', 'port'] THEN
      RETURN false;
    END IF;
    IF jsonb_typeof(v_elem -> 'host') <> 'string' OR jsonb_typeof(v_elem -> 'port') <> 'number' THEN
      RETURN false;
    END IF;
    IF NOT public.gateway_inside_host_ok(v_elem ->> 'host') THEN RETURN false; END IF;
    v_port := (v_elem ->> 'port')::numeric;
    IF v_port <> trunc(v_port) OR v_port < 1 OR v_port > 65535 THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END;
$$;

-- 2e'. The same, as a filter: the entries the CHECK would admit, the rest
--      DROPPED (an enrolment or a sync is never refused for one odd address);
--      names lower-cased, duplicates removed, sixteen at most. What
--      gateway_enrol_apply and gateway_sync_apply store.
CREATE OR REPLACE FUNCTION public.gateway_clean_inside_addresses(p_addresses JSONB)
RETURNS JSONB
LANGUAGE plpgsql IMMUTABLE SET search_path = public
AS $$
DECLARE
  v_elem JSONB;
  v_host TEXT;
  v_port TEXT;
  v_out  JSONB := '[]'::jsonb;
  v_seen TEXT[] := ARRAY[]::TEXT[];
BEGIN
  IF p_addresses IS NULL OR jsonb_typeof(p_addresses) <> 'array' THEN
    RETURN '[]'::jsonb;
  END IF;
  FOR v_elem IN SELECT value FROM jsonb_array_elements(p_addresses) LOOP
    EXIT WHEN jsonb_array_length(v_out) >= 16;
    CONTINUE WHEN jsonb_typeof(v_elem) <> 'object';
    CONTINUE WHEN COALESCE(jsonb_typeof(v_elem -> 'host'), '') <> 'string';
    CONTINUE WHEN COALESCE(jsonb_typeof(v_elem -> 'port'), '') <> 'number';
    v_host := lower(v_elem ->> 'host');
    v_port := v_elem ->> 'port';
    CONTINUE WHEN v_port !~ '^[0-9]{1,5}$';
    CONTINUE WHEN v_port::int < 1 OR v_port::int > 65535;
    CONTINUE WHEN NOT public.gateway_inside_host_ok(v_host);
    CONTINUE WHEN (v_host || ':' || v_port) = ANY (v_seen);
    v_seen := v_seen || (v_host || ':' || v_port);
    v_out := v_out || jsonb_build_array(jsonb_build_object('host', v_host, 'port', v_port::int));
  END LOOP;
  RETURN v_out;
END;
$$;

-- 2f. The root certificate's fingerprint: SHA-256 of the DER, lower-case hex
--     — what `openssl x509 -fingerprint -sha256` and a browser's certificate
--     viewer print, colons aside. NULL unless the text is exactly ONE
--     certificate block whose body decodes to a DER SEQUENCE: a PEM that
--     carries a private key, or two blocks, has no fingerprint and cannot be
--     stored (the gateways CHECK). Computed HERE, from the PEM the cloud
--     holds, so the fingerprint an admin confirms is the certificate's own
--     and never a number the gateway merely claimed.
CREATE OR REPLACE FUNCTION public.gateway_pem_fingerprint(p_pem TEXT)
RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE SET search_path = public
AS $$
DECLARE
  v_body TEXT;
  v_der  BYTEA;
BEGIN
  IF p_pem IS NULL OR char_length(p_pem) > 16384 THEN RETURN NULL; END IF;
  IF p_pem !~ '^\s*-----BEGIN CERTIFICATE-----\s+[A-Za-z0-9+/=\s]+-----END CERTIFICATE-----\s*$' THEN
    RETURN NULL;
  END IF;
  v_body := regexp_replace(regexp_replace(p_pem, '-----(BEGIN|END) CERTIFICATE-----', '', 'g'), '\s', '', 'g');
  BEGIN
    v_der := decode(v_body, 'base64');
  EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
  END;
  IF v_der IS NULL OR length(v_der) < 64 OR get_byte(v_der, 0) <> 48 THEN RETURN NULL; END IF;
  RETURN encode(sha256(v_der), 'hex');
END;
$$;

-- 2g. A gateway's name as people read it (GW1 review round 2, finding 2).
--     The gateway proposes its own name at enrolment and the name is set in
--     sentences an admin acts on (the new-gateway notice, Forget's question,
--     the viewings), so it may not reorder or hide what is around it:
--     control characters become spaces; the invisible and direction-
--     changing ones (zero-width, the bidi embeddings, overrides and
--     isolates, the BOM) are dropped; runs of white space become one;
--     trimmed; 80 characters at most. The gateways CHECK holds every name
--     to its own cleaned form, and the enrolment and the client guard clean
--     what they write.
CREATE OR REPLACE FUNCTION public.gateway_clean_name(p TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE SET search_path = public
AS $$
  SELECT btrim(left(btrim(regexp_replace(regexp_replace(regexp_replace(COALESCE(p, ''),
           '[\u0001-\u001f\u007f-\u009f\u2028\u2029]', ' ', 'g'),
           '[\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]', '', 'g'),
           '[[:space:]]+', ' ', 'g')), 80));
$$;

REVOKE ALL ON FUNCTION public.gateway_office_ranges_ok(JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.gateway_is_public_ip(INET) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.gateway_outside_address_ok(JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.gateway_inside_host_ok(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.gateway_inside_addresses_ok(JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.gateway_pem_fingerprint(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.gateway_clean_inside_addresses(JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.gateway_clean_name(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gateway_office_ranges_ok(JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.gateway_is_public_ip(INET) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.gateway_outside_address_ok(JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.gateway_inside_host_ok(TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.gateway_inside_addresses_ok(JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.gateway_pem_fingerprint(TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.gateway_clean_inside_addresses(JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.gateway_clean_name(TEXT) TO authenticated, service_role;

COMMENT ON FUNCTION public.gateway_office_ranges_ok(JSONB) IS
  '0093 (D21): the office ranges an admin declares — at most eight canonical CIDRs, each private (10/8, 172.16/12, 192.168/16, fc00::/7) and no wider than a /16 (IPv4) or a /48 (IPv6), no duplicates. False, never an error, for anything else. The CHECK on gateways.office_ranges.';
COMMENT ON FUNCTION public.gateway_is_public_ip(INET) IS
  '0093: true for a single public unicast address — false for loopback, private, link-local, CGNAT, multicast, reserved, documentation and the IPv6 transition ranges that embed an IPv4 address.';
COMMENT ON FUNCTION public.gateway_outside_address_ok(JSONB) IS
  '0093: an outside address is exactly { host, port }: a public address literal in its canonical spelling, or a lower-case DNS name that is not local, reserved or a Supabase host; the port 1–65535. The first line only — gateway-reach resolves names and refuses any non-public answer (§10 row 16).';
COMMENT ON FUNCTION public.gateway_inside_host_ok(TEXT) IS
  '0093: an inside address is a private literal (RFC 1918 or fc00::/7) in its canonical spelling, a one-label host name, or that name under .local — never a public name or address, which a member''s browser would otherwise be sent out of the office to probe.';
COMMENT ON FUNCTION public.gateway_inside_addresses_ok(JSONB) IS
  '0093: at most sixteen { host, port } objects, each host passing gateway_inside_host_ok. The CHECK on gateways.inside_addresses.';
COMMENT ON FUNCTION public.gateway_clean_inside_addresses(JSONB) IS
  '0093: the inside addresses a gateway reported, filtered to what gateway_inside_host_ok admits (names lower-cased, ports 1–65535, no duplicates, sixteen at most) — an odd entry is dropped, never fatal. Used by gateway_enrol_apply and gateway_sync_apply.';
COMMENT ON FUNCTION public.gateway_clean_name(TEXT) IS
  '0093 (GW1 review round 2): a gateway''s name as people read it — control characters as spaces, the zero-width, bidi and BOM characters dropped, white space collapsed, trimmed, 80 characters at most. The gateways CHECK holds every name to its cleaned form.';
COMMENT ON FUNCTION public.gateway_pem_fingerprint(TEXT) IS
  '0093 (D25): SHA-256 of the DER of exactly one PEM certificate block, lower-case hex; NULL for anything else (a private key, two blocks, a body that is not a DER SEQUENCE). The fingerprint an admin confirms is computed from the stored PEM, never taken from the gateway''s word.';


-- =============================================================================
-- 3. workspace_audit — the switch's own row and the gateway's lifecycle
-- =============================================================================
-- BC1 deferred the switch's audit; this is it, and the gateway's lifecycle
-- joins it. No FK on workspace_id: rows outlive the workspace (0028's
-- reasoning). Read by a live admin of the workspace; written only by the
-- triggers and SECURITY DEFINER RPCs below and by the gateway functions as
-- the service role.

CREATE TABLE IF NOT EXISTS public.workspace_audit (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id   UUID NOT NULL,
  action         TEXT NOT NULL,
  actor_user_id  UUID,
  actor_label    TEXT,
  gateway_id     UUID,
  details        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT workspace_audit_details_chk CHECK (
    jsonb_typeof(details) = 'object' AND char_length(details::text) <= 4000),
  CONSTRAINT workspace_audit_actor_label_chk CHECK (actor_label IS NULL OR char_length(actor_label) <= 200)
);

CREATE INDEX IF NOT EXISTS workspace_audit_workspace_idx ON public.workspace_audit (workspace_id, created_at DESC);

-- The vocabulary, dropped and added (GW1 review round 2 added
-- gateway.keys_rotated, and wilson-dev holds an earlier list).
ALTER TABLE public.workspace_audit DROP CONSTRAINT IF EXISTS workspace_audit_action_chk;
ALTER TABLE public.workspace_audit ADD CONSTRAINT workspace_audit_action_chk CHECK (action IN (
    'remote_viewing.on', 'remote_viewing.off',
    'gateway.enrolled', 'gateway.renamed', 'gateway.forgotten', 'gateway.forget_undone',
    'gateway.revoked', 'gateway.token_made', 'gateway.token_cancelled',
    'gateway.root_confirmed', 'gateway.reach_checked', 'gateway.outside_address_changed',
    'gateway.office_ranges_changed', 'gateway.update_failed', 'gateway.keys_rotated'));

COMMENT ON TABLE public.workspace_audit IS
  '0093: the company''s own audit — the remote-viewing switch (remote_viewing.on / .off, with who) and the file gateway''s lifecycle (enrolled, renamed, outside address changed, office ranges changed, root confirmed, forgotten and undone, revoked, tokens made and cancelled, reach checked, update failed). Read by a LIVE workspace admin only (is_live_workspace_admin); written only by triggers, SECURITY DEFINER RPCs and the gateway functions. No FK: rows outlive the workspace.';

ALTER TABLE public.workspace_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_audit FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workspace_audit_select ON public.workspace_audit;
CREATE POLICY workspace_audit_select ON public.workspace_audit
  FOR SELECT USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.is_live_workspace_admin(workspace_id)
  );

REVOKE ALL ON public.workspace_audit FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.workspace_audit TO authenticated;
GRANT ALL ON public.workspace_audit TO service_role;

COMMENT ON POLICY workspace_audit_select ON public.workspace_audit IS
  '0093: a live admin of the workspace reads its audit; nobody else, and no client writes it.';


-- =============================================================================
-- 4. THE SWITCH — a live admin flips it, and every flip is written down
-- =============================================================================
-- workspaces_admin_update (0020) admits an UPDATE when the TOKEN says admin.
-- A demoted admin's token says so for up to an hour (F21); a platform
-- operator passes workspaces_operator_update (0029). Neither may flip the
-- switch: a CLIENT (a session with a sign-in, or a client role) needs a live
-- admin row of the workspace. Only a session with no sign-in and no client
-- role — the service role, a migration, the dashboard — is exempt, and no
-- operator is: no operator flow flips this column, and if one is ever wanted
-- it is an explicit carve-out here, not an accident (review round 2, R9).

CREATE OR REPLACE FUNCTION public.fn_workspaces_remote_viewing_live_admin()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF (auth.uid() IS NOT NULL OR COALESCE(current_setting('role', true), '') IN ('authenticated', 'anon'))
     AND NOT public.is_live_workspace_admin(NEW.id) THEN
    RAISE EXCEPTION 'Only a workspace admin can change whether files may be viewed from outside the office network.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_workspaces_remote_viewing_live_admin() FROM PUBLIC, anon, authenticated;

-- WHEN the value changes, not OF the column (DECISIONS): the name sorts last
-- among workspaces' BEFORE UPDATE triggers, so this judges the final row.
DROP TRIGGER IF EXISTS trg_workspaces_remote_viewing_live_admin ON public.workspaces;
CREATE TRIGGER trg_workspaces_remote_viewing_live_admin
  BEFORE UPDATE ON public.workspaces
  FOR EACH ROW
  WHEN (OLD.remote_viewing_enabled IS DISTINCT FROM NEW.remote_viewing_enabled)
  EXECUTE FUNCTION public.fn_workspaces_remote_viewing_live_admin();

CREATE OR REPLACE FUNCTION public.fn_workspaces_remote_viewing_audit()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_label TEXT;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    SELECT COALESCE(wm.display_name, wm.username) INTO v_label
      FROM public.workspace_members wm
     WHERE wm.workspace_id = NEW.id AND wm.user_id = auth.uid();
  END IF;
  INSERT INTO public.workspace_audit (workspace_id, action, actor_user_id, actor_label, details)
  VALUES (NEW.id,
          CASE WHEN NEW.remote_viewing_enabled THEN 'remote_viewing.on' ELSE 'remote_viewing.off' END,
          auth.uid(), left(v_label, 200),
          jsonb_build_object('was', OLD.remote_viewing_enabled, 'now', NEW.remote_viewing_enabled));
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_workspaces_remote_viewing_audit() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_workspaces_remote_viewing_audit ON public.workspaces;
CREATE TRIGGER trg_workspaces_remote_viewing_audit
  AFTER UPDATE ON public.workspaces
  FOR EACH ROW
  WHEN (OLD.remote_viewing_enabled IS DISTINCT FROM NEW.remote_viewing_enabled)
  EXECUTE FUNCTION public.fn_workspaces_remote_viewing_audit();

COMMENT ON FUNCTION public.fn_workspaces_remote_viewing_live_admin() IS
  '0093 (D23, review round 1 F21): BEFORE UPDATE on workspaces when remote_viewing_enabled changes — a client (a sign-in, or a client role) needs a LIVE admin row of the workspace, whatever its token says; a demoted admin and a platform operator are refused with 42501 and the switch''s own sentence. Only a session with no sign-in and no client role (the service role, a migration) is exempt.';
COMMENT ON FUNCTION public.fn_workspaces_remote_viewing_audit() IS
  '0093: AFTER UPDATE on workspaces when remote_viewing_enabled changes — writes remote_viewing.on or .off to workspace_audit with auth.uid() and the member''s label (BC1 deferred this row).';


-- =============================================================================
-- 5. gateways — one row per enrolled gateway; no secret column
-- =============================================================================
-- Admins read the table and change three columns (name, outside_address,
-- office_ranges); members read gateways_visible (§12), never the table, so
-- the view's masking of the outside address cannot be routed around (F4).
-- No client INSERT or DELETE: gateway-enrol creates the row (service role)
-- and Forget sets revoked_at (gateway_forget). The reach_* columns are the
-- reach check's (§4 of the design): one check at a time (reach_check_id),
-- its nonce handed to the gateway at its next sync (reach_nonce, never
-- readable by a client) and the address published only while reach_ok.

CREATE TABLE IF NOT EXISTS public.gateways (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id               UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name                       TEXT NOT NULL,
  platform                   TEXT NOT NULL,
  version                    TEXT NOT NULL,
  hostname                   TEXT,
  inside_addresses           JSONB NOT NULL DEFAULT '[]'::jsonb,
  outside_address            JSONB,
  outside_open               BOOLEAN NOT NULL DEFAULT false,
  root_cert_pem              TEXT,
  root_fingerprint           TEXT,
  root_confirmed_at          TIMESTAMPTZ,
  root_confirmed_by          UUID,
  reach                      JSONB NOT NULL DEFAULT '{}'::jsonb,
  health                     JSONB NOT NULL DEFAULT '{}'::jsonb,
  office_ranges              JSONB NOT NULL DEFAULT '[]'::jsonb,
  reach_ok                   BOOLEAN,
  reach_checked_at           TIMESTAMPTZ,
  reach_detail               TEXT,
  reach_result               JSONB NOT NULL DEFAULT '{}'::jsonb,
  reach_check_id             UUID,
  reach_nonce                TEXT,
  reach_nonce_at             TIMESTAMPTZ,
  reach_nonce_delivered_at   TIMESTAMPTZ,
  reach_check_auto           BOOLEAN NOT NULL DEFAULT false,
  last_sync_source           INET,
  update_check_requested_at  TIMESTAMPTZ,
  update_check_delivered_at  TIMESTAMPTZ,
  created_by                 UUID,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at               TIMESTAMPTZ,
  revoked_at                 TIMESTAMPTZ,
  revoked_by                 UUID,

  CONSTRAINT gateways_id_workspace_key UNIQUE (id, workspace_id),
  CONSTRAINT gateways_platform_chk CHECK (platform IN ('windows', 'container')),
  CONSTRAINT gateways_hostname_chk CHECK (hostname IS NULL OR char_length(hostname) <= 255),
  CONSTRAINT gateways_inside_addresses_chk CHECK (public.gateway_inside_addresses_ok(inside_addresses)),
  CONSTRAINT gateways_outside_address_chk CHECK (outside_address IS NULL OR public.gateway_outside_address_ok(outside_address)),
  CONSTRAINT gateways_office_ranges_chk CHECK (public.gateway_office_ranges_ok(office_ranges)),
  CONSTRAINT gateways_reach_chk CHECK (jsonb_typeof(reach) = 'object' AND char_length(reach::text) <= 8000),
  CONSTRAINT gateways_health_chk CHECK (jsonb_typeof(health) = 'object' AND char_length(health::text) <= 16000),
  CONSTRAINT gateways_reach_result_chk CHECK (jsonb_typeof(reach_result) = 'object' AND char_length(reach_result::text) <= 4000),
  CONSTRAINT gateways_reach_detail_chk CHECK (reach_detail IS NULL OR char_length(reach_detail) <= 40),
  CONSTRAINT gateways_root_chk CHECK (
    (root_cert_pem IS NULL AND root_fingerprint IS NULL)
    OR (root_fingerprint IS NOT NULL AND root_fingerprint = public.gateway_pem_fingerprint(root_cert_pem))),
  CONSTRAINT gateways_root_confirmed_chk CHECK (root_confirmed_at IS NULL OR root_fingerprint IS NOT NULL),
  CONSTRAINT gateways_reach_nonce_chk CHECK (reach_nonce IS NULL OR reach_nonce ~ '^[0-9a-f]{32}$')
);

CREATE INDEX IF NOT EXISTS gateways_workspace_idx ON public.gateways (workspace_id) WHERE revoked_at IS NULL;

-- GW1 review round 2 changed three things on a table wilson-dev already
-- holds, so each is made here in a form that runs on a fresh database and
-- on dev's: the automatic check's mark (finding 8), the name held to its
-- cleaned form and the version to a version's shape (finding 2: the
-- gateway chooses both, and both are shown in sentences).
ALTER TABLE public.gateways ADD COLUMN IF NOT EXISTS reach_check_auto BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.gateways DROP CONSTRAINT IF EXISTS gateways_name_chk;
ALTER TABLE public.gateways ADD CONSTRAINT gateways_name_chk
  CHECK (char_length(name) BETWEEN 1 AND 80 AND name = public.gateway_clean_name(name));
ALTER TABLE public.gateways DROP CONSTRAINT IF EXISTS gateways_version_chk;
ALTER TABLE public.gateways ADD CONSTRAINT gateways_version_chk
  CHECK (version ~ '^[0-9]+\.[0-9]+\.[0-9]+([-+][0-9A-Za-z.+-]{1,40})?$' AND char_length(version) <= 64);

COMMENT ON TABLE public.gateways IS
  '0093: one row per enrolled file gateway (GATEWAY_DESIGN.md §2). Read by a LIVE workspace admin (the column grants leave out the root certificate, which gateway_root_certificate() serves after the fingerprint is confirmed, and the reach nonce, which only the service role reads); an admin changes name, outside_address and office_ranges only; members read gateways_visible instead. Created by gateway-enrol and refreshed by gateway-sync (service role); revoked by gateway_forget.';
COMMENT ON COLUMN public.gateways.inside_addresses IS
  '[{ host, port }] — private literals, the host''s one-label name or its .local name (gateway_inside_host_ok); reported at enrolment and every sync.';
COMMENT ON COLUMN public.gateways.outside_address IS
  '{ host, port } set by an admin, or NULL. Changing it clears reach_ok and cancels any running check (fn_gateways_client_guard): a new address is published to browsers only after a check finds this gateway there (review round 1, F16).';
COMMENT ON COLUMN public.gateways.root_fingerprint IS
  'SHA-256 (lower-case hex) of the root certificate''s DER, computed by the database from root_cert_pem (gateways_root_chk) — never the gateway''s own claim.';
COMMENT ON COLUMN public.gateways.root_confirmed_at IS
  'When the admin who made this gateway''s enrolment token confirmed the fingerprint the installer or the container''s log printed (D25, review round 2 R10). Until then the gateway is not in gateways_visible and its certificate is not offered.';
COMMENT ON COLUMN public.gateways.last_sync_source IS
  'The company''s public address as the cloud saw the last sync. A sync from another address clears reach_ok and queues a reach check (review round 2, R6).';
COMMENT ON COLUMN public.gateways.reach_nonce IS
  'The running reach check''s nonce (32 hex), handed to the gateway at every sync while the check runs; only the enrolled gateway can answer /v1/health with its proof (nonce_proof, an HMAC keyed by gateway_secrets.reach_key; GW1 review round 1). Service role only; cleared when the check finishes.';
COMMENT ON COLUMN public.gateways.reach_check_auto IS
  'True while the running check is the cloud''s own (daily, the switch, a changed source): gateway_sync_apply hands it to gateway-sync to probe at the sync AFTER the one whose answer first carried the nonce (GW1 review round 2, finding 8). False for an admin''s check, which gateway-reach probes itself.';

-- 5a. The client guard: a client changes three columns, nothing else; a new
--     outside address clears the reach state. Not SECURITY DEFINER, so
--     current_user is the role that ran the UPDATE: 'authenticated' over
--     PostgREST, the function owner inside this file's own RPCs.
CREATE OR REPLACE FUNCTION public.fn_gateways_client_guard()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public
AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    IF (to_jsonb(NEW) - ARRAY['name', 'outside_address', 'office_ranges'])
       IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['name', 'outside_address', 'office_ranges']) THEN
      RAISE EXCEPTION 'Only a gateway''s name, its outside address and the office ranges can be changed here.'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  -- The name as people read it (GW1 review round 2, finding 2).
  NEW.name := public.gateway_clean_name(NEW.name);
  IF NEW.outside_address IS DISTINCT FROM OLD.outside_address THEN
    -- reach_checked_at too: the last check was of ANOTHER address, and a
    -- NULL here is what makes the next sync begin a check at once
    -- (measured on dev, GW1: without it a new address waited a day).
    NEW.reach_ok := NULL;
    NEW.reach_checked_at := NULL;
    NEW.reach_detail := 'address_changed';
    NEW.reach_result := '{}'::jsonb;
    NEW.reach_check_id := NULL;
    NEW.reach_nonce := NULL;
    NEW.reach_nonce_at := NULL;
    NEW.reach_nonce_delivered_at := NULL;
    NEW.reach_check_auto := false;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_gateways_client_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_gateways_client_guard ON public.gateways;
CREATE TRIGGER trg_gateways_client_guard
  BEFORE UPDATE ON public.gateways
  FOR EACH ROW EXECUTE FUNCTION public.fn_gateways_client_guard();

-- 5b. The admin's changes are written down.
CREATE OR REPLACE FUNCTION public.fn_gateways_audit()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_label TEXT;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    SELECT COALESCE(wm.display_name, wm.username) INTO v_label
      FROM public.workspace_members wm
     WHERE wm.workspace_id = NEW.workspace_id AND wm.user_id = auth.uid();
  END IF;
  IF NEW.name IS DISTINCT FROM OLD.name THEN
    INSERT INTO public.workspace_audit (workspace_id, action, actor_user_id, actor_label, gateway_id, details)
    VALUES (NEW.workspace_id, 'gateway.renamed', auth.uid(), left(v_label, 200), NEW.id,
            jsonb_build_object('from', left(OLD.name, 80), 'to', left(NEW.name, 80)));
  END IF;
  IF NEW.outside_address IS DISTINCT FROM OLD.outside_address THEN
    INSERT INTO public.workspace_audit (workspace_id, action, actor_user_id, actor_label, gateway_id, details)
    VALUES (NEW.workspace_id, 'gateway.outside_address_changed', auth.uid(), left(v_label, 200), NEW.id,
            jsonb_build_object('from', OLD.outside_address, 'to', NEW.outside_address));
  END IF;
  IF NEW.office_ranges IS DISTINCT FROM OLD.office_ranges THEN
    INSERT INTO public.workspace_audit (workspace_id, action, actor_user_id, actor_label, gateway_id, details)
    VALUES (NEW.workspace_id, 'gateway.office_ranges_changed', auth.uid(), left(v_label, 200), NEW.id,
            jsonb_build_object('from', OLD.office_ranges, 'to', NEW.office_ranges));
  END IF;
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_gateways_audit() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_gateways_audit ON public.gateways;
CREATE TRIGGER trg_gateways_audit
  AFTER UPDATE OF name, outside_address, office_ranges ON public.gateways
  FOR EACH ROW EXECUTE FUNCTION public.fn_gateways_audit();

COMMENT ON FUNCTION public.fn_gateways_client_guard() IS
  '0093: BEFORE UPDATE on gateways — a client role changes name, outside_address and office_ranges only (42501 otherwise, the belt under the column grants); the name is trimmed; a changed outside address clears reach_ok and cancels any running check, so it is published only after a check finds the gateway there (F16).';
COMMENT ON FUNCTION public.fn_gateways_audit() IS
  '0093: AFTER UPDATE OF name, outside_address, office_ranges — writes gateway.renamed / .outside_address_changed / .office_ranges_changed with the admin and the before and after.';

ALTER TABLE public.gateways ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gateways FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS gateways_select ON public.gateways;
CREATE POLICY gateways_select ON public.gateways
  FOR SELECT USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.is_live_workspace_admin(workspace_id)
  );

DROP POLICY IF EXISTS gateways_update ON public.gateways;
CREATE POLICY gateways_update ON public.gateways
  FOR UPDATE USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.is_live_workspace_admin(workspace_id)
  ) WITH CHECK (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.is_live_workspace_admin(workspace_id)
  );

REVOKE ALL ON public.gateways FROM PUBLIC, anon, authenticated;
GRANT SELECT (id, workspace_id, name, platform, version, hostname, inside_addresses, outside_address,
              outside_open, root_fingerprint, root_confirmed_at, root_confirmed_by, reach, health,
              office_ranges, reach_ok, reach_checked_at, reach_detail, reach_result, reach_check_id,
              last_sync_source, update_check_requested_at, created_by, created_at, last_seen_at,
              revoked_at, revoked_by)
  ON public.gateways TO authenticated;
GRANT UPDATE (name, outside_address, office_ranges) ON public.gateways TO authenticated;
GRANT ALL ON public.gateways TO service_role;

COMMENT ON POLICY gateways_select ON public.gateways IS
  '0093 (F4): a LIVE admin of the workspace reads its gateways. A member reads gateways_visible, a definer view that masks the outside address — never the table.';
COMMENT ON POLICY gateways_update ON public.gateways IS
  '0093: a LIVE admin changes name, outside_address and office_ranges (the column grants and fn_gateways_client_guard pin the rest).';


-- =============================================================================
-- 6. gateway_secrets — the credential's hash and the reach key, service role only
-- =============================================================================
-- The workspace_storage_secrets shape: RLS on, no policy, no client grant.
-- The credential itself (wgc_ + 43 base64url) is returned once by
-- gateway-enrol and never stored; this is its SHA-256 (hex), looked up by
-- every gateway call. Forget deletes it a minute later (the sweep).

CREATE TABLE IF NOT EXISTS public.gateway_secrets (
  gateway_id       UUID PRIMARY KEY REFERENCES public.gateways(id) ON DELETE CASCADE,
  credential_hash  TEXT NOT NULL UNIQUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT gateway_secrets_hash_chk CHECK (credential_hash ~ '^[0-9a-f]{64}$')
);

COMMENT ON TABLE public.gateway_secrets IS
  '0093: one row per gateway — SHA-256 (hex) of its credential (wgc_…), the only proof a gateway call carries, and its reach key. Service role only: RLS enabled and forced, no policy, no client grant. Deleted by gateway_sweep a minute after Forget (gateway.revoked).';

-- The reach key (GW1 review round 2, finding 1): the reach check's proof is
-- an HMAC keyed by THIS, never by credential_hash. credential_hash is the
-- lookup key every gateway call sends as a request-URL filter, which the
-- platform's request logs keep; a key it is looked up by must not also be
-- a key that proves "this is your gateway". The gateway derives the same
-- value from its credential (SHA-256 of 'wilson-reach-key:' and the
-- credential, lower-case hex); the cloud is handed it once, at enrolment,
-- and never sends it anywhere. A gateway enrolled before this column has
-- none: its checks read "not your gateway" until it is enrolled again.
ALTER TABLE public.gateway_secrets ADD COLUMN IF NOT EXISTS reach_key TEXT;
ALTER TABLE public.gateway_secrets DROP CONSTRAINT IF EXISTS gateway_secrets_reach_key_chk;
ALTER TABLE public.gateway_secrets ADD CONSTRAINT gateway_secrets_reach_key_chk
  CHECK (reach_key IS NULL OR reach_key ~ '^[0-9a-f]{64}$');
COMMENT ON COLUMN public.gateway_secrets.reach_key IS
  'SHA-256 (lower-case hex) of ''wilson-reach-key:'' and the credential: the key of the reach check''s nonce_proof (GW1 review round 2). Set by gateway_enrol_apply; read by gateway-reach and gateway-sync by gateway_id, never in a URL.';

ALTER TABLE public.gateway_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gateway_secrets FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON public.gateway_secrets FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.gateway_secrets TO service_role;


-- =============================================================================
-- 7. gateway_enrolment_tokens — 24 h, single use, made and cancelled by admins
-- =============================================================================
-- The token (wgt_ + 32 base32) is made by gateway_make_enrolment_token() and
-- shown once; only its SHA-256 is stored. gateway-enrol spends it in ONE
-- UPDATE … RETURNING (F14). An admin sees the pending ones and cancels them
-- (a client DELETE, pending only); the hash is not in the column grants.

CREATE TABLE IF NOT EXISTS public.gateway_enrolment_tokens (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  token_hash    TEXT NOT NULL UNIQUE,
  created_by    UUID NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '24 hours'),
  used_at       TIMESTAMPTZ,
  gateway_id    UUID REFERENCES public.gateways(id) ON DELETE SET NULL,
  CONSTRAINT gateway_enrolment_tokens_hash_chk CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT gateway_enrolment_tokens_life_chk CHECK (expires_at > created_at AND expires_at <= created_at + interval '24 hours'),
  CONSTRAINT gateway_enrolment_tokens_used_chk CHECK (gateway_id IS NULL OR used_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS gateway_enrolment_tokens_pending_idx
  ON public.gateway_enrolment_tokens (workspace_id) WHERE used_at IS NULL;

COMMENT ON TABLE public.gateway_enrolment_tokens IS
  '0093 (§2): a gateway''s enrolment token — 24 hours, single use, SHA-256 (hex) of the whole string stored, the token itself shown once by gateway_make_enrolment_token() and never kept. A live admin reads the pending ones and cancels them; gateway-enrol (service role) spends one in a single UPDATE … RETURNING.';

-- 7a. A cancel is written down (a client DELETE only; the sweep's deletions
--     have no sign-in and are housekeeping, not decisions).
CREATE OR REPLACE FUNCTION public.fn_gateway_enrolment_tokens_cancel_audit()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_label TEXT;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    SELECT COALESCE(wm.display_name, wm.username) INTO v_label
      FROM public.workspace_members wm
     WHERE wm.workspace_id = OLD.workspace_id AND wm.user_id = auth.uid();
    INSERT INTO public.workspace_audit (workspace_id, action, actor_user_id, actor_label, details)
    VALUES (OLD.workspace_id, 'gateway.token_cancelled', auth.uid(), left(v_label, 200),
            jsonb_build_object('token_id', OLD.id, 'made_at', OLD.created_at));
  END IF;
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_gateway_enrolment_tokens_cancel_audit() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_gateway_enrolment_tokens_cancel_audit ON public.gateway_enrolment_tokens;
CREATE TRIGGER trg_gateway_enrolment_tokens_cancel_audit
  AFTER DELETE ON public.gateway_enrolment_tokens
  FOR EACH ROW EXECUTE FUNCTION public.fn_gateway_enrolment_tokens_cancel_audit();

ALTER TABLE public.gateway_enrolment_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gateway_enrolment_tokens FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS gateway_enrolment_tokens_select ON public.gateway_enrolment_tokens;
CREATE POLICY gateway_enrolment_tokens_select ON public.gateway_enrolment_tokens
  FOR SELECT USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.is_live_workspace_admin(workspace_id)
  );

DROP POLICY IF EXISTS gateway_enrolment_tokens_delete ON public.gateway_enrolment_tokens;
CREATE POLICY gateway_enrolment_tokens_delete ON public.gateway_enrolment_tokens
  FOR DELETE USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND public.is_live_workspace_admin(workspace_id)
    AND used_at IS NULL
  );

REVOKE ALL ON public.gateway_enrolment_tokens FROM PUBLIC, anon, authenticated;
GRANT SELECT (id, workspace_id, created_by, created_at, expires_at, used_at, gateway_id)
  ON public.gateway_enrolment_tokens TO authenticated;
GRANT DELETE ON public.gateway_enrolment_tokens TO authenticated;
GRANT ALL ON public.gateway_enrolment_tokens TO service_role;

COMMENT ON POLICY gateway_enrolment_tokens_select ON public.gateway_enrolment_tokens IS
  '0093: a live admin sees the company''s tokens (the pending list) — never the hash, which the column grants leave out.';
COMMENT ON POLICY gateway_enrolment_tokens_delete ON public.gateway_enrolment_tokens IS
  '0093: a live admin cancels a PENDING token (Cancel in Settings); a used token stays as the record of which gateway it enrolled.';


-- =============================================================================
-- 8. gateway_signing_keys — the cloud's ticket keys; the private half sealed
-- =============================================================================
-- Ed25519 per workspace (D1). The private half is PKCS#8 encrypted with
-- AES-256-GCM under the Edge secret WILSON_GATEWAY_KEY_SECRET — the bucket
-- secrets' envelope (storageSecretCrypto.ts), its own master key — so a
-- nightly dump carries ciphertext only. The public half is the wire's form,
-- STANDARD base64 of the raw 32 bytes (DECISIONS). At most one current key
-- per workspace; the previous one stays acceptable for ten minutes after a
-- rotation (gateway-sync hands it out for that long).

CREATE TABLE IF NOT EXISTS public.gateway_signing_keys (
  workspace_id            UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  kid                     TEXT NOT NULL,
  public_key              TEXT NOT NULL,
  private_key_ciphertext  TEXT NOT NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  retired_at              TIMESTAMPTZ,
  PRIMARY KEY (workspace_id, kid),
  CONSTRAINT gateway_signing_keys_kid_chk CHECK (kid ~ '^[a-z0-9]{1,16}$'),
  CONSTRAINT gateway_signing_keys_public_chk CHECK (public_key ~ '^[A-Za-z0-9+/]{43}=$'),
  CONSTRAINT gateway_signing_keys_ciphertext_chk CHECK (char_length(private_key_ciphertext) BETWEEN 40 AND 4096)
);

CREATE UNIQUE INDEX IF NOT EXISTS gateway_signing_keys_one_current
  ON public.gateway_signing_keys (workspace_id) WHERE retired_at IS NULL;

COMMENT ON TABLE public.gateway_signing_keys IS
  '0093 (D1, §5 step 4): each workspace''s Ed25519 ticket-signing keys. public_key is standard base64 of the raw 32 bytes (the wire); private_key_ciphertext is base64(iv ‖ AES-256-GCM(PKCS#8) ‖ tag) under WILSON_GATEWAY_KEY_SECRET. At most one current key per workspace (gateway_signing_keys_one_current); rotated after a year; a retired key is still handed to gateways for ten minutes. Service role only.';

ALTER TABLE public.gateway_signing_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gateway_signing_keys FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON public.gateway_signing_keys FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.gateway_signing_keys TO service_role;


-- =============================================================================
-- 9. gateway_ticket_mints — every ticket the cloud signed, kept thirty days
-- =============================================================================
-- So gateway-events can refuse a viewing for a viewer and clip that were
-- never minted (F3) and flag one whose mint has aged out (R4). jti is the
-- wire's 32 hex in a uuid column (DECISIONS). The clip's project and name
-- are snapshotted, so a viewing of a clip removed before the gateway's
-- journal reached the cloud is still written. No FKs: rows outlive their
-- subjects. Service role only.

CREATE TABLE IF NOT EXISTS public.gateway_ticket_mints (
  jti           UUID PRIMARY KEY,
  workspace_id  UUID NOT NULL,
  gateway_id    UUID NOT NULL,
  user_id       UUID NOT NULL,
  bin_file_id   UUID NOT NULL,
  project_id    UUID,
  file_name     TEXT,
  minted_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT gateway_ticket_mints_file_name_chk CHECK (file_name IS NULL OR char_length(file_name) <= 500)
);

CREATE INDEX IF NOT EXISTS gateway_ticket_mints_lookup
  ON public.gateway_ticket_mints (gateway_id, user_id, bin_file_id, minted_at DESC);
CREATE INDEX IF NOT EXISTS gateway_ticket_mints_age
  ON public.gateway_ticket_mints (minted_at);

COMMENT ON TABLE public.gateway_ticket_mints IS
  '0093 (review round 1 F3, round 2 R4): one row per ticket gateway-ticket signed — jti (the wire''s 32 hex, as a uuid), workspace, gateway, viewer, clip, and the clip''s project and name at mint time. gateway-events refuses a viewing whose jti names another viewer, clip or gateway, and one for a pair never minted in the window; a viewing whose mint aged out is written flagged unverified_mint. Kept thirty days (gateway_sweep). Service role only.';

ALTER TABLE public.gateway_ticket_mints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gateway_ticket_mints FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON public.gateway_ticket_mints FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.gateway_ticket_mints TO service_role;


-- =============================================================================
-- 10. file_events — the remote-viewing row
-- =============================================================================
-- subject says what file_id names ('file' for the files table, as every row
-- before this one; 'bin_file' for a viewing). external_id is
-- '<gateway_id>:<viewing_id>', the prefix taken by gateway_events_apply from
-- the CREDENTIAL's row and pinned by a CHECK against details.gateway_id, so
-- a retried batch writes nothing twice and no gateway can collide with or
-- pre-claim another's rows (F9).

ALTER TABLE public.file_events ADD COLUMN IF NOT EXISTS subject TEXT NOT NULL DEFAULT 'file';
ALTER TABLE public.file_events ADD COLUMN IF NOT EXISTS external_id TEXT;

COMMENT ON COLUMN public.file_events.subject IS
  '0093: what file_id names — ''file'' (public.files, every event before 0093) or ''bin_file'' (public.bin_files, the viewed_remote row). FileAuditDrawer reads it.';
COMMENT ON COLUMN public.file_events.external_id IS
  '0093: ''<gateway_id>:<viewing_id>'' on a viewed_remote row — the gateway''s id from its credential, never from the payload (F9); unique, so a retried batch writes nothing twice. NULL on every other event.';

-- The vocabulary: 0073's discovery-based drop (any CHECK on file_events whose
-- definition mentions 'uploaded'), then the one constraint with every
-- existing term and 'viewed_remote'. MEASURED before this file was written
-- (2026-10-10): dev's constraint is 0073's eight terms; 16 rows.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.file_events'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%uploaded%'
  LOOP
    EXECUTE format('ALTER TABLE public.file_events DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE public.file_events
  ADD CONSTRAINT file_events_event_check CHECK (event IN
    ('uploaded', 'downloaded', 'moved', 'relinked', 'trashed', 'restored',
     'purged',
     'upload_abandoned',
     -- 0093: written by gateway_events_apply, and only by it.
     'viewed_remote'));

ALTER TABLE public.file_events DROP CONSTRAINT IF EXISTS file_events_subject_chk;
ALTER TABLE public.file_events
  ADD CONSTRAINT file_events_subject_chk CHECK (subject IN ('file', 'bin_file'));

ALTER TABLE public.file_events DROP CONSTRAINT IF EXISTS file_events_viewed_remote_shape_chk;
ALTER TABLE public.file_events
  ADD CONSTRAINT file_events_viewed_remote_shape_chk CHECK (
    (event = 'viewed_remote') = (subject = 'bin_file')
    AND (event = 'viewed_remote') = (external_id IS NOT NULL));

ALTER TABLE public.file_events DROP CONSTRAINT IF EXISTS file_events_external_id_chk;
ALTER TABLE public.file_events
  ADD CONSTRAINT file_events_external_id_chk CHECK (
    external_id IS NULL
    OR (external_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        AND split_part(external_id, ':', 1) = (details ->> 'gateway_id')));

CREATE UNIQUE INDEX IF NOT EXISTS file_events_external_id_key
  ON public.file_events (external_id) WHERE external_id IS NOT NULL;
-- The rows one ticket vouches for, counted by gateway_events_apply (GW1
-- review round 2, finding 3).
CREATE INDEX IF NOT EXISTS file_events_viewed_remote_jti
  ON public.file_events ((details ->> 'ticket_jti')) WHERE event = 'viewed_remote';
CREATE INDEX IF NOT EXISTS file_events_viewed_remote_idx
  ON public.file_events (workspace_id, created_at DESC) WHERE event = 'viewed_remote';
CREATE INDEX IF NOT EXISTS file_events_viewed_remote_file_idx
  ON public.file_events (file_id, created_at DESC) WHERE event = 'viewed_remote';

-- file_events_select — 0092's policy, EVERY arm restated verbatim (the pre-
-- flight proved it is 0092's), and one conjunct added: a viewed_remote row is
-- a LIVE admin's (D6, G6; F21 — the row, not the token's claim, so a demoted
-- admin stops seeing them at once). The 0062 lesson: a rewritten policy drops
-- whatever arm it does not restate, so §16 compares the whole text.
DROP POLICY IF EXISTS file_events_select ON public.file_events;
CREATE POLICY file_events_select ON public.file_events
  FOR SELECT USING (
    workspace_id = public.current_workspace_id()
    AND public.has_active_membership(workspace_id)
    AND (
      -- Anyone who can read the project can read its files' history.
      public.can_read_project_topic(project_id)
      -- Admin arm: proof-of-deletion must stay readable after the project
      -- is purged (can_read_project_topic is false once the row is gone).
      OR public.current_app_role() = 'admin'
    )
    -- Track C / 0074 — the money arm. 0092 (Legal 1): a financial row — its
    -- purged certificate included — is for a workspace admin, the project's
    -- managers (can_access_project_money), or, for a Legal file's, the Legal
    -- audience (can_access_project_legal). No other reader, no event.
    AND (
      NOT is_financial
      OR public.current_app_role() = 'admin'
      OR COALESCE(public.can_access_project_money(project_id), false)
      OR (public.file_event_is_legal(old_path, new_path)
          AND COALESCE(public.can_access_project_legal(project_id), false))
    )
    -- 0093 (G6, D6) — a viewing from outside the office is a LIVE admin's.
    AND (event <> 'viewed_remote' OR public.is_live_workspace_admin(workspace_id))
  );

COMMENT ON POLICY file_events_select ON public.file_events IS
  'Track C / 0074 restating 0027, then 0088, 0092 and 0093: project readers and workspace admins read the stream; a financial row (is_financial — an invoice, receipt or Legal file), its purged certificate INCLUDED, is read only by a workspace admin, the project''s managers (can_access_project_money) or — for a Legal file''s (file_event_is_legal) — the Legal audience (can_access_project_legal); a viewed_remote row (a viewing through the file gateway''s outside door, 0093) only by a LIVE workspace admin (is_live_workspace_admin). Every arm is in this one definition — re-run 0093 after any replay of 0027, 0074, 0088 or 0092.';


-- =============================================================================
-- 11. gateway_clips_for_tickets — the read gate, evaluated AS THE CALLER
-- =============================================================================
-- SECURITY INVOKER (the S33 rule, as storage-presign's predicates): called by
-- gateway-ticket with a client carrying the caller's own token, so
-- bin_files_select (project visibility, private projects through the
-- projects hop) and bin_locations_select (membership) do the gating — a row
-- the caller cannot see is simply absent, answered as "missing", the same as
-- a row that does not exist (no oracle). Reading a clip is exactly being able
-- to read its catalogue row (G4, B6). rabbit_remote_viewing_enabled answers
-- the switch per row as rv.

CREATE OR REPLACE FUNCTION public.gateway_clips_for_tickets(p_ids UUID[])
RETURNS TABLE (bin_file_id UUID, project_id UUID, workspace_id UUID, location_id UUID, unc_path TEXT,
               relative_path TEXT, is_sequence BOOLEAN, extension TEXT, mime_type TEXT, file_name TEXT,
               remote_viewing BOOLEAN)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public
AS $$
BEGIN
  IF p_ids IS NULL OR cardinality(p_ids) = 0 THEN
    RETURN;
  END IF;
  IF cardinality(p_ids) > 100 THEN
    RAISE EXCEPTION 'At most 100 clips can be asked for at once.' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  SELECT f.id, f.project_id, f.workspace_id, f.location_id, l.unc_path, f.relative_path, f.is_sequence,
         f.extension, f.mime_type, f.display_name, public.rabbit_remote_viewing_enabled(f.project_id)
    FROM public.bin_files f
    JOIN public.bin_locations l ON l.id = f.location_id AND l.workspace_id = f.workspace_id
   WHERE f.id = ANY (p_ids);
END;
$$;

REVOKE ALL ON FUNCTION public.gateway_clips_for_tickets(UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gateway_clips_for_tickets(UUID[]) TO authenticated, service_role;

COMMENT ON FUNCTION public.gateway_clips_for_tickets(UUID[]) IS
  '0093 (G4, G5; the S33 rule): the clips of p_ids the CALLER may read — SECURITY INVOKER over bin_files'' and bin_locations'' RLS, so an invisible clip (a private project, another company) is absent exactly as a missing one is. With each: the location''s unc_path, the relative path, whether it is a sequence, the extension and media type the row holds, its name, and the switch (remote_viewing). At most 100 ids. gateway-ticket calls it with the caller''s own token.';


-- =============================================================================
-- 12. gateways_visible — the one thing a member's browser reads (F4)
-- =============================================================================
-- A DEFINER view (security_invoker off; owned by the migrating role, which
-- bypasses RLS) that filters by the caller's live membership ITSELF and masks
-- the columns, because the table is admins only. security_barrier, so no
-- function in a caller's WHERE runs before the filter. Published: a gateway
-- of the caller's workspace that is not revoked AND whose fingerprint the
-- enrolling admin confirmed (DECISIONS). The outside address appears only
-- when the switch is on, the gateway reports its outside door open, the last
-- reach check found THIS gateway there, and it synced within 60 s. The
-- office ranges, the root, the nonce and the company's public address stay
-- admin-only (review round 2, R19).

CREATE OR REPLACE VIEW public.gateways_visible
WITH (security_invoker = false, security_barrier = true)
AS
  SELECT g.id, g.workspace_id, g.name, g.platform, g.version, g.inside_addresses, g.reach,
         g.last_seen_at, g.root_fingerprint,
         CASE WHEN w.remote_viewing_enabled
                   AND g.outside_open
                   AND g.reach_ok IS TRUE
                   AND g.last_seen_at > now() - interval '60 seconds'
              THEN g.outside_address END AS outside_address
    FROM public.gateways g
    JOIN public.workspaces w ON w.id = g.workspace_id
   WHERE g.revoked_at IS NULL
     AND g.root_confirmed_at IS NOT NULL
     AND g.workspace_id = public.current_workspace_id()
     AND public.has_active_membership(g.workspace_id);

REVOKE ALL ON public.gateways_visible FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.gateways_visible TO authenticated, service_role;

COMMENT ON VIEW public.gateways_visible IS
  '0093 (§2, §9 point 6, F4): the gateways a member''s browser may probe — of the caller''s workspace, live, fingerprint confirmed — with the outside address only while the switch is on, the outside door is reported open, the last reach check found this gateway there and it synced within 60 s. A definer view with its own membership filter and security_barrier; the table behind it is admins only.';


-- =============================================================================
-- 13. THE ADMIN'S RPCs — each checks the LIVE row itself
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_gateway_require_admin()
RETURNS UUID
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_ws UUID := public.current_workspace_id();
BEGIN
  IF auth.uid() IS NULL OR v_ws IS NULL
     OR NOT public.has_active_membership(v_ws)
     OR NOT public.is_live_workspace_admin(v_ws) THEN
    RAISE EXCEPTION 'Only a workspace admin can manage the file gateway.' USING ERRCODE = '42501';
  END IF;
  RETURN v_ws;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_gateway_require_admin() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.fn_gateway_require_admin() IS
  '0093: the admin RPCs'' first line — the caller''s workspace when they are a LIVE admin of it, else 42501 with one sentence. Called only from inside this file''s SECURITY DEFINER RPCs.';

-- 13a. Add a gateway: the token, shown once (§2 step 1). Five pending at most.
CREATE OR REPLACE FUNCTION public.gateway_make_enrolment_token()
RETURNS TABLE (id UUID, token TEXT, expires_at TIMESTAMPTZ)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_ws     UUID := public.fn_gateway_require_admin();
  v_bytes  BYTEA;
  v_token  TEXT := 'wgt_';
  v_id     UUID;
  v_exp    TIMESTAMPTZ;
  v_label  TEXT;
  i        INT;
BEGIN
  -- GW1 review round 1, note 7: the count and the insert under one lock per
  -- company, so concurrent calls cannot each see four and make a sixth.
  PERFORM pg_advisory_xact_lock(hashtextextended('gateway_tokens:' || v_ws::text, 0));
  IF (SELECT count(*) FROM public.gateway_enrolment_tokens t
       WHERE t.workspace_id = v_ws AND t.used_at IS NULL AND t.expires_at > now()) >= 5 THEN
    RAISE EXCEPTION 'This company already has five unused gateway tokens. Cancel one before making another.'
      USING ERRCODE = '54000';
  END IF;
  -- 32 characters of RFC 4648 base32: each byte mod 32 is uniform because
  -- 256 is a multiple of 32, so the token carries exactly 160 random bits.
  v_bytes := extensions.gen_random_bytes(32);
  FOR i IN 0..31 LOOP
    v_token := v_token || substr('ABCDEFGHIJKLMNOPQRSTUVWXYZ234567', (get_byte(v_bytes, i) % 32) + 1, 1);
  END LOOP;
  INSERT INTO public.gateway_enrolment_tokens (workspace_id, token_hash, created_by)
  VALUES (v_ws, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), auth.uid())
  RETURNING gateway_enrolment_tokens.id, gateway_enrolment_tokens.expires_at INTO v_id, v_exp;
  SELECT COALESCE(wm.display_name, wm.username) INTO v_label
    FROM public.workspace_members wm WHERE wm.workspace_id = v_ws AND wm.user_id = auth.uid();
  INSERT INTO public.workspace_audit (workspace_id, action, actor_user_id, actor_label, details)
  VALUES (v_ws, 'gateway.token_made', auth.uid(), left(v_label, 200),
          jsonb_build_object('token_id', v_id, 'expires_at', v_exp));
  RETURN QUERY SELECT v_id, v_token, v_exp;
END;
$$;

-- 13b. Confirm the fingerprint the installer printed (D25, R10): only the
--      admin who made the token — the one who saw it printed.
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
  IF v_g.root_confirmed_at IS NOT NULL THEN
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
  IF v_fp <> v_g.root_fingerprint THEN
    RAISE EXCEPTION 'That fingerprint does not match the certificate this gateway sent WILSON. Copy it again from the installer''s last screen or the container''s first log lines; if you did not install this gateway, choose Forget.'
      USING ERRCODE = '22023';
  END IF;
  UPDATE public.gateways SET root_confirmed_at = v_at, root_confirmed_by = auth.uid() WHERE public.gateways.id = p_gateway;
  SELECT COALESCE(wm.display_name, wm.username) INTO v_label
    FROM public.workspace_members wm WHERE wm.workspace_id = v_ws AND wm.user_id = auth.uid();
  INSERT INTO public.workspace_audit (workspace_id, action, actor_user_id, actor_label, gateway_id, details)
  VALUES (v_ws, 'gateway.root_confirmed', auth.uid(), left(v_label, 200), p_gateway,
          jsonb_build_object('fingerprint', v_g.root_fingerprint));
  RETURN v_at;
END;
$$;

-- 13c. Download certificate: the root's PUBLIC certificate, after the
--      fingerprint is confirmed and not before (D25 in the database).
CREATE OR REPLACE FUNCTION public.gateway_root_certificate(p_gateway UUID)
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
  IF v_g.root_confirmed_at IS NULL OR v_g.root_cert_pem IS NULL THEN
    RAISE EXCEPTION 'Confirm this gateway''s fingerprint first: WILSON offers its certificate only after the admin who installed it has confirmed it is theirs.'
      USING ERRCODE = '55000';
  END IF;
  RETURN v_g.root_cert_pem;
END;
$$;

-- 13d. Forget (§2): revoked at once; undoable for a minute; the credential's
--      row deleted by the sweep after that.
CREATE OR REPLACE FUNCTION public.gateway_forget(p_gateway UUID)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_ws    UUID := public.fn_gateway_require_admin();
  v_g     public.gateways%ROWTYPE;
  v_label TEXT;
BEGIN
  SELECT * INTO v_g FROM public.gateways g WHERE g.id = p_gateway AND g.workspace_id = v_ws FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That gateway is not in this company''s list.' USING ERRCODE = 'P0002';
  END IF;
  IF v_g.revoked_at IS NOT NULL THEN
    RETURN v_g.revoked_at;
  END IF;
  UPDATE public.gateways
     SET revoked_at = now(), revoked_by = auth.uid(),
         reach_check_id = NULL, reach_nonce = NULL, reach_nonce_delivered_at = NULL
   WHERE public.gateways.id = p_gateway;
  SELECT COALESCE(wm.display_name, wm.username) INTO v_label
    FROM public.workspace_members wm WHERE wm.workspace_id = v_ws AND wm.user_id = auth.uid();
  INSERT INTO public.workspace_audit (workspace_id, action, actor_user_id, actor_label, gateway_id, details)
  VALUES (v_ws, 'gateway.forgotten', auth.uid(), left(v_label, 200), p_gateway,
          jsonb_build_object('name', v_g.name, 'hostname', v_g.hostname, 'platform', v_g.platform));
  RETURN now();
END;
$$;

CREATE OR REPLACE FUNCTION public.gateway_unforget(p_gateway UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_ws    UUID := public.fn_gateway_require_admin();
  v_label TEXT;
BEGIN
  UPDATE public.gateways g
     SET revoked_at = NULL, revoked_by = NULL
   WHERE g.id = p_gateway AND g.workspace_id = v_ws
     AND g.revoked_at IS NOT NULL AND g.revoked_at > now() - interval '60 seconds'
     AND EXISTS (SELECT 1 FROM public.gateway_secrets s WHERE s.gateway_id = g.id);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This gateway was forgotten more than a minute ago, so it cannot come back: enrol it again with a new token.'
      USING ERRCODE = '55000';
  END IF;
  SELECT COALESCE(wm.display_name, wm.username) INTO v_label
    FROM public.workspace_members wm WHERE wm.workspace_id = v_ws AND wm.user_id = auth.uid();
  INSERT INTO public.workspace_audit (workspace_id, action, actor_user_id, actor_label, gateway_id, details)
  VALUES (v_ws, 'gateway.forget_undone', auth.uid(), left(v_label, 200), p_gateway, '{}'::jsonb);
  RETURN true;
END;
$$;

-- 13e. Check now (§8): the gateway hears it at its next sync.
CREATE OR REPLACE FUNCTION public.gateway_request_update_check(p_gateway UUID)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_ws UUID := public.fn_gateway_require_admin();
BEGIN
  UPDATE public.gateways g SET update_check_requested_at = now()
   WHERE g.id = p_gateway AND g.workspace_id = v_ws AND g.revoked_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That gateway is not in this company''s list.' USING ERRCODE = 'P0002';
  END IF;
  RETURN now();
END;
$$;

-- 13f. Rotate the ticket keys (§5 step 4, §10 row 21; GW1 review round 2,
--      finding 6): the company's current signing key is retired now; the
--      next ticket is signed with a new one (gateway-ticket makes it), and
--      the retired key is still handed to the gateways for ten minutes, so
--      a ticket minted a moment ago still plays. Under the key's own lock,
--      so it cannot race a key being made. Written down.
CREATE OR REPLACE FUNCTION public.gateway_rotate_signing_key()
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_ws    UUID := public.fn_gateway_require_admin();
  v_n     INT;
  v_label TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('gateway_signing_keys:' || v_ws::text, 0));
  UPDATE public.gateway_signing_keys SET retired_at = now()
   WHERE workspace_id = v_ws AND retired_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  SELECT COALESCE(wm.display_name, wm.username) INTO v_label
    FROM public.workspace_members wm WHERE wm.workspace_id = v_ws AND wm.user_id = auth.uid();
  INSERT INTO public.workspace_audit (workspace_id, action, actor_user_id, actor_label, details)
  VALUES (v_ws, 'gateway.keys_rotated', auth.uid(), left(v_label, 200), jsonb_build_object('retired', v_n));
  RETURN jsonb_build_object('retired', v_n, 'at', now());
END;
$$;

REVOKE ALL ON FUNCTION public.gateway_make_enrolment_token() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.gateway_confirm_root(UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.gateway_root_certificate(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.gateway_forget(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.gateway_unforget(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.gateway_request_update_check(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.gateway_rotate_signing_key() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gateway_make_enrolment_token() TO authenticated;
GRANT EXECUTE ON FUNCTION public.gateway_confirm_root(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.gateway_root_certificate(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.gateway_forget(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.gateway_unforget(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.gateway_request_update_check(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.gateway_rotate_signing_key() TO authenticated;

COMMENT ON FUNCTION public.gateway_make_enrolment_token() IS
  '0093 (§2 step 1): a LIVE admin makes an enrolment token — wgt_ + 32 base32 characters (160 bits from pgcrypto), answered ONCE with its id and expiry; only its SHA-256 is stored; at most five pending per company; written to workspace_audit (gateway.token_made).';
COMMENT ON FUNCTION public.gateway_confirm_root(UUID, TEXT) IS
  '0093 (D25, review round 2 R10): the admin who made the gateway''s token confirms the fingerprint the installer or the container''s log printed (case and colons ignored); a match sets root_confirmed_at, which publishes the gateway in gateways_visible and unlocks gateway_root_certificate. Anyone else is refused (42501); a mismatch is refused with a sentence (22023).';
COMMENT ON FUNCTION public.gateway_root_certificate(UUID) IS
  '0093 (D25): the gateway''s root certificate (PUBLIC part, PEM) for a live admin to install on office computers — only after the fingerprint is confirmed (55000 before).';
COMMENT ON FUNCTION public.gateway_forget(UUID) IS
  '0093 (§2): Forget — sets revoked_at at once (no ticket is minted for it again, its addresses leave gateways_visible, its next sync is 401) and cancels any running check; undoable for a minute (gateway_unforget); its credential''s row is deleted by gateway_sweep after that.';
COMMENT ON FUNCTION public.gateway_unforget(UUID) IS
  '0093: undoes Forget within 60 seconds, while the credential''s row still exists; 55000 after.';
COMMENT ON FUNCTION public.gateway_request_update_check(UUID) IS
  '0093 (§8): Check now — the gateway is told check_update_now at its next sync.';
COMMENT ON FUNCTION public.gateway_rotate_signing_key() IS
  '0093 (§5, §10 row 21; GW1 review round 2): Rotate the ticket keys — a LIVE admin retires the company''s current signing key; the next ticket is signed with a new one, the retired key is handed to gateways for ten more minutes; written to workspace_audit (gateway.keys_rotated). Answers {retired, at}.';


-- =============================================================================
-- 14. THE SERVICE ROLE'S RPCs — behind the five Edge Functions
-- =============================================================================
-- Each is SECURITY DEFINER, executable by service_role ONLY. The functions
-- verify the caller first (a gateway credential's hash, or a member's token)
-- and pass what they verified; these do the database's part in one
-- transaction. The S33 rule holds: the Bins gate is never evaluated here —
-- gateway_clips_for_tickets runs as the caller — and the service role
-- answers only what Appendix C gives it (the catalogue confirmation and the
-- audit's attributions).

-- 14a. gateway-enrol: spend the token in ONE statement (F14), create the
--      gateway, store the credential's hash and the reach key, write the
--      audit row. (GW1 review round 2 added p_reach_key; the earlier
--      signature is dropped so no caller can enrol without one.)
DROP FUNCTION IF EXISTS public.gateway_enrol_apply(TEXT, TEXT, JSONB, INET);
CREATE OR REPLACE FUNCTION public.gateway_enrol_apply(
  p_token_hash TEXT, p_credential_hash TEXT, p_gateway JSONB, p_source INET, p_reach_key TEXT)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tok     RECORD;
  v_id      UUID;
  v_name    TEXT;
  v_label   TEXT;
  v_ws_name TEXT;
  v_pem     TEXT := p_gateway ->> 'root_cert_pem';
BEGIN
  IF p_token_hash !~ '^[0-9a-f]{64}$' OR p_credential_hash !~ '^[0-9a-f]{64}$'
     OR p_reach_key IS NULL OR p_reach_key !~ '^[0-9a-f]{64}$' OR p_reach_key = p_credential_hash
     OR p_gateway IS NULL OR jsonb_typeof(p_gateway) <> 'object' THEN
    RAISE EXCEPTION 'gateway_enrol_apply: malformed arguments' USING ERRCODE = '22023';
  END IF;
  -- THE spend: one UPDATE … RETURNING is the token's only check (F14), so
  -- two calls racing on one token enrol one gateway, not two — the row lock
  -- makes the second wait and then find used_at set.
  UPDATE public.gateway_enrolment_tokens t
     SET used_at = now()
   WHERE t.token_hash = p_token_hash AND t.used_at IS NULL AND t.expires_at > now()
  RETURNING t.id, t.workspace_id, t.created_by INTO v_tok;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'token');
  END IF;
  -- Ten live gateways per company at most (D17 allows several). RAISED, not
  -- returned, so the transaction — the spend with it — rolls back and the
  -- token stays usable once one is forgotten. Counted under one lock per
  -- company (GW1 review round 1, note 7), so two enrolments racing on two
  -- tokens cannot both see nine.
  PERFORM pg_advisory_xact_lock(hashtextextended('gateway_enrol:' || v_tok.workspace_id::text, 0));
  IF (SELECT count(*) FROM public.gateways g WHERE g.workspace_id = v_tok.workspace_id AND g.revoked_at IS NULL) >= 10 THEN
    RAISE EXCEPTION 'This company already has ten gateways. Forget one before enrolling another.'
      USING ERRCODE = '54000';
  END IF;
  v_name := public.gateway_clean_name(p_gateway ->> 'name');
  IF v_name = '' THEN v_name := 'Gateway'; END IF;
  INSERT INTO public.gateways (workspace_id, name, platform, version, hostname, inside_addresses,
                               root_cert_pem, root_fingerprint, created_by, last_seen_at, last_sync_source)
  VALUES (v_tok.workspace_id, v_name, p_gateway ->> 'platform', p_gateway ->> 'version',
          left(p_gateway ->> 'hostname', 255),
          public.gateway_clean_inside_addresses(p_gateway -> 'inside_addresses'),
          v_pem, public.gateway_pem_fingerprint(v_pem),
          v_tok.created_by, now(), p_source)
  RETURNING public.gateways.id INTO v_id;
  UPDATE public.gateway_enrolment_tokens SET gateway_id = v_id WHERE public.gateway_enrolment_tokens.id = v_tok.id;
  INSERT INTO public.gateway_secrets (gateway_id, credential_hash, reach_key) VALUES (v_id, p_credential_hash, p_reach_key);
  SELECT COALESCE(wm.display_name, wm.username) INTO v_label
    FROM public.workspace_members wm WHERE wm.workspace_id = v_tok.workspace_id AND wm.user_id = v_tok.created_by;
  INSERT INTO public.workspace_audit (workspace_id, action, actor_user_id, actor_label, gateway_id, details)
  VALUES (v_tok.workspace_id, 'gateway.enrolled', v_tok.created_by, left(v_label, 200), v_id,
          jsonb_build_object('name', v_name, 'platform', p_gateway ->> 'platform',
                             'version', left(p_gateway ->> 'version', 64),
                             'hostname', left(p_gateway ->> 'hostname', 255),
                             'fingerprint', public.gateway_pem_fingerprint(v_pem),
                             'source', host(p_source), 'token_id', v_tok.id));
  SELECT w.name INTO v_ws_name FROM public.workspaces w WHERE w.id = v_tok.workspace_id;
  RETURN jsonb_build_object('ok', true, 'gateway_id', v_id, 'workspace_id', v_tok.workspace_id,
                            'workspace_name', v_ws_name);
END;
$$;

-- 14b. gateway-sync: the heartbeat. The report is the function's sanitised
--      copy; this applies it, compares the source address (R6), hands out a
--      waiting reach nonce, begins a check when one is due, answers the
--      catalogue confirmation (D22) and returns the gateway's instructions.
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

-- 14c. gateway-events: every attribution derived here (F3), never taken from
--      the payload: the gateway and company from the credential's row, the
--      clip's project and name from bin_files (or, for a clip removed since,
--      from its mint), the viewer's label from workspace_members. Refused: a
--      clip or viewer not of this company, a jti that names another viewer,
--      clip or gateway, a pair never minted inside the thirty days, a time
--      outside the gateway's life. Flagged: a viewing whose own mint is
--      missing or aged out (R4). Idempotent by external_id (F9).
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
          -- is renewed for four hours at most, §5) — and for fewer than 250
          -- of them (a new row needs a minute without a request or five
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
    v_fraction := CASE WHEN v_clip_bytes IS NOT NULL AND v_clip_bytes > 0
                       THEN round(v_bytes::numeric / v_clip_bytes, 3) END;
    v_details := jsonb_build_object(
      'viewing_id', v_vid,
      'gateway_id', g.id,
      'gateway_name', left(g.name, 80),
      'started_at', v_started,
      'ended_at', v_ended,
      'bytes', v_bytes,
      'clip_bytes', v_clip_bytes,
      'fraction', v_fraction,
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

-- A NULL-on-failure inet parse, for the addresses a payload carries.
CREATE OR REPLACE FUNCTION public.fn_gateway_try_inet(p TEXT)
RETURNS INET
LANGUAGE plpgsql IMMUTABLE SET search_path = public
AS $$
BEGIN
  IF p IS NULL OR char_length(p) > 45 THEN RETURN NULL; END IF;
  RETURN p::inet;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

-- 14d. The signing key: the current one, or this new one stored in its place
--      when there is none or it is older than the rotation age. Under an
--      advisory lock per workspace, so two first mints make ONE key and the
--      loser signs with the winner's.
CREATE OR REPLACE FUNCTION public.gateway_signing_key_current(p_workspace UUID, p_rotate_after_seconds INTEGER)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT jsonb_build_object('kid', k.kid, 'public_key', k.public_key,
                            'private_key_ciphertext', k.private_key_ciphertext, 'created_at', k.created_at)
    FROM public.gateway_signing_keys k
   WHERE k.workspace_id = p_workspace AND k.retired_at IS NULL
     AND k.created_at > now() - make_interval(secs => p_rotate_after_seconds);
$$;

CREATE OR REPLACE FUNCTION public.gateway_signing_key_put(
  p_workspace UUID, p_kid TEXT, p_public_key TEXT, p_ciphertext TEXT, p_rotate_after_seconds INTEGER)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_current JSONB;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('gateway_signing_keys:' || p_workspace::text, 0));
  v_current := public.gateway_signing_key_current(p_workspace, p_rotate_after_seconds);
  IF v_current IS NOT NULL THEN
    RETURN v_current || jsonb_build_object('created', false);
  END IF;
  UPDATE public.gateway_signing_keys SET retired_at = now()
   WHERE workspace_id = p_workspace AND retired_at IS NULL;
  INSERT INTO public.gateway_signing_keys (workspace_id, kid, public_key, private_key_ciphertext)
  VALUES (p_workspace, p_kid, p_public_key, p_ciphertext);
  RETURN jsonb_build_object('kid', p_kid, 'public_key', p_public_key,
                            'private_key_ciphertext', p_ciphertext, 'created_at', now(), 'created', true);
END;
$$;

-- 14e. The reach check (§4, R16): begin (one at a time; the nonce waits for
--      the gateway's next sync) and finish (recorded only if the check is
--      still the running one AND the address is still the one probed — an
--      address changed mid-check is never published by the old check).
CREATE OR REPLACE FUNCTION public.gateway_reach_begin(p_gateway UUID, p_workspace UUID)
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  g        public.gateways%ROWTYPE;
  v_nonce  TEXT;
  v_id     UUID;
  v_switch BOOLEAN;
  v_port   INT;
BEGIN
  SELECT * INTO g FROM public.gateways
   WHERE public.gateways.id = p_gateway AND public.gateways.workspace_id = p_workspace
     AND public.gateways.revoked_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('began', false, 'reason', 'not_found');
  END IF;
  IF g.outside_address IS NULL THEN
    RETURN jsonb_build_object('began', false, 'reason', 'no_address');
  END IF;
  IF g.reach_check_id IS NOT NULL AND g.reach_nonce_at > now() - interval '2 minutes' THEN
    RETURN jsonb_build_object('began', false, 'reason', 'busy');
  END IF;
  v_nonce := encode(extensions.gen_random_bytes(16), 'hex');
  v_id := gen_random_uuid();
  UPDATE public.gateways
     SET reach_check_id = v_id, reach_nonce = v_nonce, reach_nonce_at = now(), reach_nonce_delivered_at = NULL,
         reach_check_auto = false
   WHERE public.gateways.id = g.id;
  SELECT w.remote_viewing_enabled INTO v_switch FROM public.workspaces w WHERE w.id = g.workspace_id;
  SELECT COALESCE(min((e ->> 'port')::int), 8443) INTO v_port FROM jsonb_array_elements(g.inside_addresses) AS e;
  RETURN jsonb_build_object('began', true, 'check_id', v_id, 'nonce', v_nonce, 'address', g.outside_address,
                            'remote_viewing', COALESCE(v_switch, false), 'inside_port', v_port,
                            'last_seen_at', g.last_seen_at);
END;
$$;

CREATE OR REPLACE FUNCTION public.gateway_reach_finish(
  p_gateway UUID, p_check_id UUID, p_address JSONB, p_result JSONB, p_actor UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  g        public.gateways%ROWTYPE;
  v_ok     BOOLEAN;
  v_label  TEXT;
  v_res    JSONB;
  v_no_run BOOLEAN;
BEGIN
  IF p_result IS NULL OR jsonb_typeof(p_result) <> 'object' OR char_length(p_result::text) > 3000 THEN
    RAISE EXCEPTION 'gateway_reach_finish: the result must be a small object' USING ERRCODE = '22023';
  END IF;
  v_ok := COALESCE((p_result -> 'outside' ->> 'ok')::boolean, false)
      AND COALESCE((p_result -> 'outside' ->> 'is_this_gateway')::boolean, false);
  -- GW1 review round 2, finding 8: a check that could not run (the gateway
  -- never took its nonce) proves nothing either way, so it leaves reach_ok,
  -- its time and its detail as they were — the detail carries R6's debt —
  -- and is only written down. While the gateway is silent the view masks
  -- its address anyway (a sync within 60 s).
  v_no_run := (p_result -> 'outside' ->> 'detail') = 'gateway_not_syncing';
  v_res := p_result || jsonb_build_object('checked_at', now());
  UPDATE public.gateways
     SET reach_ok = CASE WHEN v_no_run THEN public.gateways.reach_ok ELSE v_ok END,
         reach_checked_at = CASE WHEN v_no_run THEN public.gateways.reach_checked_at ELSE now() END,
         reach_detail = CASE WHEN v_no_run THEN public.gateways.reach_detail
                             ELSE left(p_result -> 'outside' ->> 'detail', 40) END,
         reach_result = v_res,
         reach_check_id = NULL, reach_nonce = NULL, reach_nonce_delivered_at = NULL, reach_check_auto = false
   WHERE public.gateways.id = p_gateway
     AND public.gateways.reach_check_id = p_check_id
     AND public.gateways.outside_address IS NOT DISTINCT FROM p_address
     AND public.gateways.revoked_at IS NULL
  RETURNING * INTO g;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  IF p_actor IS NOT NULL THEN
    SELECT COALESCE(wm.display_name, wm.username) INTO v_label
      FROM public.workspace_members wm WHERE wm.workspace_id = g.workspace_id AND wm.user_id = p_actor;
  END IF;
  INSERT INTO public.workspace_audit (workspace_id, action, actor_user_id, actor_label, gateway_id, details)
  VALUES (g.workspace_id, 'gateway.reach_checked', p_actor, left(v_label, 200), g.id,
          v_res || jsonb_build_object('address', p_address, 'automatic', p_actor IS NULL));
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.gateway_enrol_apply(TEXT, TEXT, JSONB, INET, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.gateway_sync_apply(UUID, JSONB, INET, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.gateway_events_apply(UUID, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_gateway_try_inet(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.gateway_signing_key_current(UUID, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.gateway_signing_key_put(UUID, TEXT, TEXT, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.gateway_reach_begin(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.gateway_reach_finish(UUID, UUID, JSONB, JSONB, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gateway_enrol_apply(TEXT, TEXT, JSONB, INET, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.gateway_sync_apply(UUID, JSONB, INET, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.gateway_events_apply(UUID, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_gateway_try_inet(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.gateway_signing_key_current(UUID, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.gateway_signing_key_put(UUID, TEXT, TEXT, TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.gateway_reach_begin(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.gateway_reach_finish(UUID, UUID, JSONB, JSONB, UUID) TO service_role;

COMMENT ON FUNCTION public.gateway_enrol_apply(TEXT, TEXT, JSONB, INET, TEXT) IS
  '0093 (§2 step 3; F14): service role only, called by gateway-enrol after it checked the token''s shape. Spends the token in ONE UPDATE … RETURNING (no row, no enrolment: two calls racing on one token enrol one gateway), creates the gateway (its fingerprint computed from the PEM), stores the credential''s SHA-256, writes gateway.enrolled with the admin who made the token. {ok:false, reason:''token''} for a used, expired or unknown token; 54000 (rolled back, the token unspent) past ten live gateways.';
COMMENT ON FUNCTION public.gateway_sync_apply(UUID, JSONB, INET, JSONB) IS
  '0093 (§2, §4, §5; R6, R16, D22): service role only, called by gateway-sync after the credential check. Applies the sanitised report, clears reach_ok when the sync arrives from another public address, hands a waiting reach nonce over (or begins a due check and returns it as background_check), confirms catalogue clips {clip, loc, path} of this company, and answers the switch, the outside address, the office ranges, the live signing keys (current + ten minutes of the previous), the locations, check_update_now and the reach nonce. {revoked:true} for a revoked or unknown gateway.';
COMMENT ON FUNCTION public.gateway_events_apply(UUID, JSONB) IS
  '0093 (§6; F3, F9, F10, R4): service role only, called by gateway-events. Writes one viewed_remote file_events row per viewing, deriving the company, project, clip name and viewer label itself; refuses a clip or viewer not of this company, a jti naming another viewer/clip/gateway, a pair never minted within thirty days and a time outside the gateway''s life; flags a missing or aged-out mint unverified_mint; truncates every string; external_id = gateway_id:viewing_id, so a retry writes nothing twice. Answers {accepted:[viewing_id], rejected:[{viewing_id, reason}]}.';
COMMENT ON FUNCTION public.gateway_signing_key_current(UUID, INTEGER) IS
  '0093: the workspace''s current signing key if younger than the rotation age, else NULL. Service role only.';
COMMENT ON FUNCTION public.gateway_signing_key_put(UUID, TEXT, TEXT, TEXT, INTEGER) IS
  '0093: under an advisory lock per workspace, answers the current key if it is still young enough, else retires it and stores this one. Two first mints make one key. Service role only.';
COMMENT ON FUNCTION public.gateway_reach_begin(UUID, UUID) IS
  '0093 (§4, R16): service role only, for gateway-reach after the live-admin check — one check at a time per gateway (busy within two minutes of the last), a fresh nonce handed to the gateway at its next sync.';
COMMENT ON FUNCTION public.gateway_reach_finish(UUID, UUID, JSONB, JSONB, UUID) IS
  '0093 (§4): records a check''s result only while it is still the running check AND the outside address is still the one probed; reach_ok = reached AND the gateway proved the nonce (nonce_proof, keyed by its reach key; GW1 review rounds 1 and 2); a check that could not run (gateway_not_syncing) leaves reach_ok, its time and its detail as they were (round 2); writes gateway.reach_checked (actor NULL for the daily or address-change check).';


-- =============================================================================
-- 15. THE SWEEP — every five minutes
-- =============================================================================
-- Mints older than thirty days (R4); tokens long expired or long used; the
-- credential of a gateway forgotten more than a minute ago (the forget is
-- final: 'gateway.revoked'); a reach nonce older than ten minutes.

CREATE OR REPLACE FUNCTION public.gateway_sweep()
RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_mints   INT;
  v_tokens  INT;
  v_secrets INT;
  v_nonces  INT;
BEGIN
  DELETE FROM public.gateway_ticket_mints WHERE minted_at < now() - interval '30 days';
  GET DIAGNOSTICS v_mints = ROW_COUNT;
  DELETE FROM public.gateway_enrolment_tokens
   WHERE (used_at IS NULL AND expires_at < now() - interval '7 days')
      OR (used_at IS NOT NULL AND used_at < now() - interval '30 days');
  GET DIAGNOSTICS v_tokens = ROW_COUNT;
  WITH gone AS (
    DELETE FROM public.gateway_secrets s
     USING public.gateways g
     WHERE g.id = s.gateway_id AND g.revoked_at IS NOT NULL AND g.revoked_at < now() - interval '60 seconds'
    RETURNING g.id, g.workspace_id
  )
  INSERT INTO public.workspace_audit (workspace_id, action, gateway_id, details)
  SELECT gone.workspace_id, 'gateway.revoked', gone.id, jsonb_build_object('credential', 'deleted') FROM gone;
  GET DIAGNOSTICS v_secrets = ROW_COUNT;
  UPDATE public.gateways
     SET reach_check_id = NULL, reach_nonce = NULL, reach_nonce_delivered_at = NULL, reach_check_auto = false
   WHERE reach_nonce IS NOT NULL AND reach_nonce_at < now() - interval '10 minutes';
  GET DIAGNOSTICS v_nonces = ROW_COUNT;
  RETURN jsonb_build_object('mints', v_mints, 'tokens', v_tokens, 'revoked', v_secrets, 'nonces', v_nonces);
END;
$$;

REVOKE ALL ON FUNCTION public.gateway_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gateway_sweep() TO service_role;

COMMENT ON FUNCTION public.gateway_sweep() IS
  '0093: housekeeping every five minutes (pg_cron wilson-gateway-sweep) — mints older than thirty days, tokens expired a week or used a month ago, the credential of a gateway forgotten more than a minute ago (gateway.revoked: the forget is final), reach nonces older than ten minutes. Service role and cron only.';

-- Guarded like 0012/0014/0057/0073: the CI local stack ships without
-- pg_cron, and a scheduling hiccup must never fail the migration.
-- cron.schedule() upserts by job name, so a re-run is idempotent.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
    PERFORM cron.schedule(
      'wilson-gateway-sweep',
      '*/5 * * * *',
      $job$ SELECT public.gateway_sweep(); $job$
    );
  ELSE
    RAISE NOTICE 'pg_cron unavailable — the gateway sweep is not scheduled (expected in CI local stack)';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'could not schedule the gateway sweep via pg_cron: %', SQLERRM;
END $$;


-- =============================================================================
-- 16. POST-CONDITIONS — scan the catalogue, do not assume (S22)
-- =============================================================================
DO $$
DECLARE
  t       TEXT;
  v_n     INT;
  v_qual  TEXT;
  v_def   TEXT;
  v_last  TEXT;
BEGIN
  -- 16a. the six tables: RLS enabled AND forced; anon and PUBLIC hold nothing.
  FOREACH t IN ARRAY ARRAY['gateways', 'gateway_secrets', 'gateway_enrolment_tokens',
                           'gateway_signing_keys', 'gateway_ticket_mints', 'workspace_audit'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE EXCEPTION '0093 post-condition failed: table % missing', t;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = ('public.' || t)::regclass
                    AND relrowsecurity AND relforcerowsecurity) THEN
      RAISE EXCEPTION '0093 post-condition failed: % lacks ENABLE+FORCE row level security', t;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.role_table_grants
                WHERE table_schema = 'public' AND table_name = t AND grantee IN ('anon', 'PUBLIC'))
       OR EXISTS (SELECT 1 FROM information_schema.column_privileges
                   WHERE table_schema = 'public' AND table_name = t AND grantee IN ('anon', 'PUBLIC')) THEN
      RAISE EXCEPTION '0093 post-condition failed: anon or PUBLIC holds privileges on %', t;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND cmd = 'ALL') THEN
      RAISE EXCEPTION '0093 post-condition failed: % has a FOR ALL policy', t;
    END IF;
  END LOOP;

  -- 16b. the policies, by name; each names the live-admin check, the
  --      membership and the workspace; the three service-role tables have
  --      none and no client grant at all.
  IF (SELECT array_agg(policyname::text ORDER BY policyname) FROM pg_policies
       WHERE schemaname = 'public' AND tablename = 'gateways') IS DISTINCT FROM ARRAY['gateways_select', 'gateways_update']
     OR (SELECT array_agg(policyname::text ORDER BY policyname) FROM pg_policies
          WHERE schemaname = 'public' AND tablename = 'gateway_enrolment_tokens')
        IS DISTINCT FROM ARRAY['gateway_enrolment_tokens_delete', 'gateway_enrolment_tokens_select']
     OR (SELECT array_agg(policyname::text ORDER BY policyname) FROM pg_policies
          WHERE schemaname = 'public' AND tablename = 'workspace_audit') IS DISTINCT FROM ARRAY['workspace_audit_select'] THEN
    RAISE EXCEPTION '0093 post-condition failed: the gateway policies are not exactly gateways_select/update, the tokens'' select/delete and workspace_audit_select';
  END IF;
  SELECT count(*) INTO v_n FROM pg_policies
   WHERE schemaname = 'public' AND tablename IN ('gateways', 'gateway_enrolment_tokens', 'workspace_audit')
     AND (position('is_live_workspace_admin' IN COALESCE(qual, '') || COALESCE(with_check, '')) = 0
          OR position('has_active_membership' IN COALESCE(qual, '') || COALESCE(with_check, '')) = 0
          OR position('current_workspace_id' IN COALESCE(qual, '') || COALESCE(with_check, '')) = 0
          OR (cmd = 'UPDATE' AND position('is_live_workspace_admin' IN COALESCE(with_check, '')) = 0));
  IF v_n <> 0 THEN
    RAISE EXCEPTION '0093 post-condition failed: % gateway policies lack the live-admin check, the membership or the workspace match', v_n;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'gateway_enrolment_tokens'
                  AND policyname = 'gateway_enrolment_tokens_delete' AND cmd = 'DELETE' AND qual LIKE '%used_at IS NULL%') THEN
    RAISE EXCEPTION '0093 post-condition failed: a used enrolment token could be deleted (the delete policy lacks used_at IS NULL)';
  END IF;
  FOREACH t IN ARRAY ARRAY['gateway_secrets', 'gateway_signing_keys', 'gateway_ticket_mints'] LOOP
    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t) THEN
      RAISE EXCEPTION '0093 post-condition failed: % has a policy — it is the service role''s alone', t;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.role_table_grants
                WHERE table_schema = 'public' AND table_name = t AND grantee = 'authenticated')
       OR EXISTS (SELECT 1 FROM information_schema.column_privileges
                   WHERE table_schema = 'public' AND table_name = t AND grantee = 'authenticated') THEN
      RAISE EXCEPTION '0093 post-condition failed: authenticated holds a privilege on %', t;
    END IF;
  END LOOP;

  -- 16c. the column grants: a client never reads the root certificate, the
  --      nonce or the tokens' hashes, and changes three gateway columns only.
  IF has_column_privilege('authenticated', 'public.gateways', 'root_cert_pem', 'SELECT')
     OR has_column_privilege('authenticated', 'public.gateways', 'reach_nonce', 'SELECT')
     OR has_column_privilege('authenticated', 'public.gateway_enrolment_tokens', 'token_hash', 'SELECT')
     OR NOT has_column_privilege('authenticated', 'public.gateways', 'name', 'SELECT') THEN
    RAISE EXCEPTION '0093 post-condition failed: the gateways / tokens column SELECT grants are wrong (the root, the nonce and the hash must be unreadable to clients)';
  END IF;
  SELECT count(*) INTO v_n FROM information_schema.column_privileges
   WHERE table_schema = 'public' AND table_name = 'gateways' AND grantee = 'authenticated' AND privilege_type = 'UPDATE';
  IF v_n <> 3
     OR NOT has_column_privilege('authenticated', 'public.gateways', 'office_ranges', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.gateways', 'revoked_at', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.gateways', 'INSERT')
     OR has_table_privilege('authenticated', 'public.gateways', 'DELETE')
     OR has_table_privilege('authenticated', 'public.gateway_enrolment_tokens', 'INSERT')
     OR has_table_privilege('authenticated', 'public.gateway_enrolment_tokens', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.workspace_audit', 'INSERT')
     OR has_table_privilege('authenticated', 'public.workspace_audit', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.workspace_audit', 'DELETE') THEN
    RAISE EXCEPTION '0093 post-condition failed: a client could write what only the functions write (gateways beyond its three columns, tokens, the audit)';
  END IF;

  -- 16d. the view: a definer view with a barrier, filtering by membership in
  --      its own body, confirmed and live gateways only, the outside address
  --      behind the switch, the door, the check and the sync; and nothing an
  --      admin keeps to themselves.
  IF to_regclass('public.gateways_visible') IS NULL THEN
    RAISE EXCEPTION '0093 post-condition failed: gateways_visible is missing';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class WHERE oid = 'public.gateways_visible'::regclass
              AND COALESCE(reloptions, '{}') @> ARRAY['security_invoker=true'])
     OR NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = 'public.gateways_visible'::regclass
                     AND COALESCE(reloptions, '{}') @> ARRAY['security_barrier=true']) THEN
    RAISE EXCEPTION '0093 post-condition failed: gateways_visible must be a definer view (security_invoker off) with security_barrier on';
  END IF;
  v_def := pg_get_viewdef('public.gateways_visible'::regclass, true);
  IF position('has_active_membership(g.workspace_id)' IN v_def) = 0
     OR position('current_workspace_id()' IN v_def) = 0
     OR position('revoked_at IS NULL' IN v_def) = 0
     OR position('root_confirmed_at IS NOT NULL' IN v_def) = 0
     OR position('remote_viewing_enabled' IN v_def) = 0
     OR position('outside_open' IN v_def) = 0
     OR position('reach_ok IS TRUE' IN v_def) = 0
     OR position('last_seen_at >' IN v_def) = 0 THEN
    RAISE EXCEPTION '0093 post-condition failed: gateways_visible lost a filter or a mask: %', v_def;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'gateways_visible'
              AND column_name IN ('office_ranges', 'root_cert_pem', 'reach_nonce', 'last_sync_source', 'health', 'created_by', 'hostname')) THEN
    RAISE EXCEPTION '0093 post-condition failed: gateways_visible exposes a column that is an admin''s alone';
  END IF;
  IF has_table_privilege('anon', 'public.gateways_visible', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.gateways_visible', 'SELECT')
     OR has_table_privilege('authenticated', 'public.gateways_visible', 'INSERT')
     OR has_table_privilege('authenticated', 'public.gateways_visible', 'UPDATE') THEN
    RAISE EXCEPTION '0093 post-condition failed: gateways_visible grants are wrong (authenticated SELECT only)';
  END IF;

  -- 16e. the read gate runs AS THE CALLER and answers the switch.
  IF EXISTS (SELECT 1 FROM pg_proc WHERE oid = 'public.gateway_clips_for_tickets(uuid[])'::regprocedure AND prosecdef)
     OR has_function_privilege('anon', 'public.gateway_clips_for_tickets(uuid[])', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.gateway_clips_for_tickets(uuid[])', 'EXECUTE')
     OR position('rabbit_remote_viewing_enabled' IN pg_get_functiondef('public.gateway_clips_for_tickets(uuid[])'::regprocedure)) = 0
     OR position('public.bin_files' IN pg_get_functiondef('public.gateway_clips_for_tickets(uuid[])'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '0093 post-condition failed: gateway_clips_for_tickets must be SECURITY INVOKER over bin_files, executable by authenticated and not anon, and answer the switch';
  END IF;

  -- 16f. the live-admin helper reads the row.
  v_def := pg_get_functiondef('public.is_live_workspace_admin(uuid)'::regprocedure);
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.is_live_workspace_admin(uuid)'::regprocedure)
     OR position('wm.is_active' IN v_def) = 0
     OR position('wm.app_role = ''admin''' IN v_def) = 0
     OR position('auth.uid()' IN v_def) = 0
     OR position('current_app_role' IN v_def) > 0 THEN
    RAISE EXCEPTION '0093 post-condition failed: is_live_workspace_admin must be SECURITY DEFINER over the live row (is_active, app_role = admin, auth.uid()) and never the claim';
  END IF;

  -- 16g. the switch's triggers: both present and enabled; the live-admin one
  --      is the LAST BEFORE UPDATE trigger on workspaces, so it judges the
  --      final row; the policies 0091 pinned still stand.
  IF NOT EXISTS (SELECT 1 FROM pg_trigger tg JOIN pg_proc p ON p.oid = tg.tgfoid
                  WHERE tg.tgrelid = 'public.workspaces'::regclass AND tg.tgname = 'trg_workspaces_remote_viewing_live_admin'
                    AND p.proname = 'fn_workspaces_remote_viewing_live_admin' AND tg.tgenabled = 'O'
                    AND pg_get_triggerdef(tg.oid) LIKE '%BEFORE UPDATE ON public.workspaces%'
                    AND pg_get_triggerdef(tg.oid) LIKE '%remote_viewing_enabled IS DISTINCT FROM%')
     OR NOT EXISTS (SELECT 1 FROM pg_trigger tg JOIN pg_proc p ON p.oid = tg.tgfoid
                     WHERE tg.tgrelid = 'public.workspaces'::regclass AND tg.tgname = 'trg_workspaces_remote_viewing_audit'
                       AND p.proname = 'fn_workspaces_remote_viewing_audit' AND tg.tgenabled = 'O'
                       AND pg_get_triggerdef(tg.oid) LIKE '%AFTER UPDATE ON public.workspaces%') THEN
    RAISE EXCEPTION '0093 post-condition failed: the switch''s live-admin or audit trigger is missing, disabled or mistimed';
  END IF;
  SELECT max(tgname::text) INTO v_last FROM pg_trigger
   WHERE tgrelid = 'public.workspaces'::regclass AND NOT tgisinternal
     AND (tgtype & 2) = 2 AND (tgtype & 16) = 16;   -- BEFORE, UPDATE
  IF v_last IS DISTINCT FROM 'trg_workspaces_remote_viewing_live_admin' THEN
    RAISE EXCEPTION '0093 post-condition failed: % sorts after the live-admin trigger among workspaces'' BEFORE UPDATE triggers — it could change the switch after the check', v_last;
  END IF;
  IF position('is_live_workspace_admin' IN pg_get_functiondef('public.fn_workspaces_remote_viewing_live_admin()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '0093 post-condition failed: the switch''s trigger does not ask is_live_workspace_admin';
  END IF;

  -- 16h. file_events: the vocabulary (one constraint, viewed_remote once,
  --      nothing lost); the shape CHECKs; the unique external_id; the policy
  --      WHOLE — 0092's arms verbatim plus the conjunct; still one policy,
  --      SELECT only; the money trigger still the only trigger.
  SELECT count(*) INTO v_n FROM pg_constraint
   WHERE conrelid = 'public.file_events'::regclass AND contype = 'c'
     AND pg_get_constraintdef(oid) LIKE '%uploaded%';
  IF v_n <> 1 THEN
    RAISE EXCEPTION '0093 post-condition failed: % vocabulary constraints on file_events, expected exactly 1', v_n;
  END IF;
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint WHERE conname = 'file_events_event_check'
     AND conrelid = 'public.file_events'::regclass;
  IF v_def IS NULL
     OR (length(v_def) - length(replace(v_def, 'viewed_remote', ''))) / length('viewed_remote') <> 1
     OR v_def NOT LIKE '%upload_abandoned%' OR v_def NOT LIKE '%downloaded%' OR v_def NOT LIKE '%purged%'
     OR v_def NOT LIKE '%relinked%' OR v_def NOT LIKE '%restored%' OR v_def NOT LIKE '%trashed%'
     OR v_def NOT LIKE '%moved%' THEN
    RAISE EXCEPTION '0093 post-condition failed: the file_events vocabulary must carry viewed_remote exactly once and every earlier term: %', v_def;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'file_events_subject_chk' AND conrelid = 'public.file_events'::regclass)
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'file_events_viewed_remote_shape_chk' AND conrelid = 'public.file_events'::regclass)
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'file_events_external_id_chk' AND conrelid = 'public.file_events'::regclass
                     AND pg_get_constraintdef(oid) LIKE '%gateway_id%')
     OR NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indexrelid = to_regclass('public.file_events_external_id_key') AND i.indisunique) THEN
    RAISE EXCEPTION '0093 post-condition failed: a file_events shape CHECK or the unique external_id index is missing';
  END IF;
  SELECT qual INTO v_qual FROM pg_policies WHERE schemaname = 'public' AND tablename = 'file_events' AND policyname = 'file_events_select';
  IF v_qual IS DISTINCT FROM '((workspace_id = current_workspace_id()) AND has_active_membership(workspace_id) AND (can_read_project_topic(project_id) OR (current_app_role() = ''admin''::text)) AND ((NOT is_financial) OR (current_app_role() = ''admin''::text) OR COALESCE(can_access_project_money(project_id), false) OR (file_event_is_legal(old_path, new_path) AND COALESCE(can_access_project_legal(project_id), false))) AND ((event <> ''viewed_remote''::text) OR is_live_workspace_admin(workspace_id)))' THEN
    RAISE EXCEPTION '0093 post-condition failed: file_events_select reads %', v_qual;
  END IF;
  IF v_qual LIKE '%purged%' THEN
    RAISE EXCEPTION '0093 post-condition failed: file_events_select carries a purged exception again (Legal 1, 0092)';
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'file_events') <> 1
     OR EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'file_events' AND cmd <> 'SELECT') THEN
    RAISE EXCEPTION '0093 post-condition failed: file_events must keep exactly one policy, SELECT only';
  END IF;
  IF (SELECT string_agg(tgname, ', ' ORDER BY tgname) FROM pg_trigger
       WHERE tgrelid = 'public.file_events'::regclass AND NOT tgisinternal)
     IS DISTINCT FROM 'trg_file_events_money' THEN
    RAISE EXCEPTION '0093 post-condition failed: file_events must carry trg_file_events_money and no other trigger (0092''s pin)';
  END IF;

  -- 16i. the RPCs: the admin's are DEFINER, executable by authenticated and
  --      not anon, and ask the live row; the service role's are executable by
  --      service_role alone; no trigger function is executable by a client.
  FOREACH t IN ARRAY ARRAY['public.gateway_make_enrolment_token()', 'public.gateway_confirm_root(uuid,text)',
                           'public.gateway_root_certificate(uuid)', 'public.gateway_forget(uuid)',
                           'public.gateway_unforget(uuid)', 'public.gateway_request_update_check(uuid)',
                           'public.gateway_rotate_signing_key()'] LOOP
    IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = t::regprocedure)
       OR has_function_privilege('anon', t, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', t, 'EXECUTE')
       OR position('fn_gateway_require_admin' IN pg_get_functiondef(t::regprocedure)) = 0 THEN
      RAISE EXCEPTION '0093 post-condition failed: % must be SECURITY DEFINER, executable by authenticated and not anon, and begin with fn_gateway_require_admin', t;
    END IF;
  END LOOP;
  IF position('is_live_workspace_admin' IN pg_get_functiondef('public.fn_gateway_require_admin()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '0093 post-condition failed: fn_gateway_require_admin does not ask the live row';
  END IF;
  FOREACH t IN ARRAY ARRAY['public.gateway_enrol_apply(text,text,jsonb,inet,text)', 'public.gateway_sync_apply(uuid,jsonb,inet,jsonb)',
                           'public.gateway_events_apply(uuid,jsonb)', 'public.gateway_signing_key_current(uuid,integer)',
                           'public.gateway_signing_key_put(uuid,text,text,text,integer)', 'public.gateway_reach_begin(uuid,uuid)',
                           'public.gateway_reach_finish(uuid,uuid,jsonb,jsonb,uuid)', 'public.gateway_sweep()',
                           'public.fn_gateway_require_admin()', 'public.fn_gateway_try_inet(text)',
                           'public.gateway_clean_inside_addresses(jsonb)',
                           'public.fn_workspaces_remote_viewing_live_admin()', 'public.fn_workspaces_remote_viewing_audit()',
                           'public.fn_gateways_client_guard()', 'public.fn_gateways_audit()',
                           'public.fn_gateway_enrolment_tokens_cancel_audit()'] LOOP
    IF has_function_privilege('anon', t, 'EXECUTE') OR has_function_privilege('authenticated', t, 'EXECUTE') THEN
      RAISE EXCEPTION '0093 post-condition failed: % is executable by a client role', t;
    END IF;
  END LOOP;
  FOREACH t IN ARRAY ARRAY['public.gateway_enrol_apply(text,text,jsonb,inet,text)', 'public.gateway_sync_apply(uuid,jsonb,inet,jsonb)',
                           'public.gateway_events_apply(uuid,jsonb)', 'public.gateway_signing_key_put(uuid,text,text,text,integer)',
                           'public.gateway_reach_begin(uuid,uuid)', 'public.gateway_reach_finish(uuid,uuid,jsonb,jsonb,uuid)',
                           'public.gateway_sweep()'] LOOP
    IF NOT has_function_privilege('service_role', t, 'EXECUTE') THEN
      RAISE EXCEPTION '0093 post-condition failed: the service role cannot execute %', t;
    END IF;
  END LOOP;

  -- 16j. the guards on gateways and the shape CHECKs, exercised.
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.gateways'::regclass AND tgname = 'trg_gateways_client_guard' AND tgenabled = 'O')
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.gateways'::regclass AND tgname = 'trg_gateways_audit' AND tgenabled = 'O')
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.gateway_enrolment_tokens'::regclass
                     AND tgname = 'trg_gateway_enrolment_tokens_cancel_audit' AND tgenabled = 'O') THEN
    RAISE EXCEPTION '0093 post-condition failed: a gateway guard or audit trigger is missing or disabled';
  END IF;
  IF position('to_jsonb(NEW) - ARRAY[''name'', ''outside_address'', ''office_ranges'']'
              IN pg_get_functiondef('public.fn_gateways_client_guard()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '0093 post-condition failed: fn_gateways_client_guard no longer pins every column but the three';
  END IF;
  IF position('t.used_at IS NULL AND t.expires_at > now()'
              IN pg_get_functiondef('public.gateway_enrol_apply(text,text,jsonb,inet,text)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '0093 post-condition failed: gateway_enrol_apply does not spend the token in one UPDATE guarded by used_at and the expiry (F14)';
  END IF;
  IF (SELECT prosecdef FROM pg_proc WHERE oid = 'public.fn_gateways_client_guard()'::regprocedure) THEN
    RAISE EXCEPTION '0093 post-condition failed: fn_gateways_client_guard must NOT be SECURITY DEFINER (it reads current_user)';
  END IF;
  IF NOT public.gateway_office_ranges_ok('["10.8.0.0/16", "192.168.20.0/24", "fd12:3456:789a::/48"]'::jsonb)
     OR public.gateway_office_ranges_ok('["8.8.8.0/24"]'::jsonb)
     OR public.gateway_office_ranges_ok('["10.0.0.0/8"]'::jsonb)
     OR public.gateway_office_ranges_ok('["10.8.0.5/16"]'::jsonb)
     OR public.gateway_office_ranges_ok('["10.8.0.0/16", "10.8.0.0/16"]'::jsonb)
     OR public.gateway_office_ranges_ok('["10.1.0.0/16","10.2.0.0/16","10.3.0.0/16","10.4.0.0/16","10.5.0.0/16","10.6.0.0/16","10.7.0.0/16","10.8.0.0/16","10.9.0.0/16"]'::jsonb)
     OR public.gateway_office_ranges_ok('["fd00::/8"]'::jsonb)
     OR public.gateway_office_ranges_ok('{"a": 1}'::jsonb) THEN
    RAISE EXCEPTION '0093 post-condition failed: gateway_office_ranges_ok admits a public, too-wide, non-canonical, duplicate or ninth range';
  END IF;
  IF NOT public.gateway_outside_address_ok('{"host": "gateway.example.com", "port": 8444}'::jsonb)
     OR NOT public.gateway_outside_address_ok('{"host": "8.8.4.4", "port": 443}'::jsonb)
     OR public.gateway_outside_address_ok('{"host": "192.168.1.10", "port": 8444}'::jsonb)
     OR public.gateway_outside_address_ok('{"host": "127.0.0.1", "port": 8444}'::jsonb)
     OR public.gateway_outside_address_ok('{"host": "localhost", "port": 8444}'::jsonb)
     OR public.gateway_outside_address_ok('{"host": "nas.local", "port": 8444}'::jsonb)
     OR public.gateway_outside_address_ok('{"host": "abc.supabase.co", "port": 443}'::jsonb)
     OR public.gateway_outside_address_ok('{"host": "gateway.example.com", "port": 0}'::jsonb)
     OR public.gateway_outside_address_ok('{"host": "gateway.example.com", "port": 8444, "x": 1}'::jsonb)
     OR public.gateway_outside_address_ok('{"host": "::ffff:127.0.0.1", "port": 8444}'::jsonb) THEN
    RAISE EXCEPTION '0093 post-condition failed: gateway_outside_address_ok admits a private, local, Supabase or malformed address, or refuses a public one';
  END IF;
  IF NOT public.gateway_inside_addresses_ok('[{"host": "192.168.1.10", "port": 8443}, {"host": "studio-nas", "port": 8443}, {"host": "studio-nas.local", "port": 8443}]'::jsonb)
     OR public.gateway_inside_addresses_ok('[{"host": "8.8.8.8", "port": 8443}]'::jsonb)
     OR public.gateway_inside_addresses_ok('[{"host": "evil.example.com", "port": 8443}]'::jsonb)
     OR public.gateway_inside_addresses_ok('[{"host": "127.0.0.1", "port": 8443}]'::jsonb) THEN
    RAISE EXCEPTION '0093 post-condition failed: gateway_inside_addresses_ok admits a public, named or loopback inside address, or refuses a private one';
  END IF;
  IF public.gateway_clean_inside_addresses('[{"host": "8.8.8.8", "port": 8443}, {"host": "Studio-NAS", "port": 8443}, {"host": "studio-nas", "port": 8443}, "x", {"host": "10.0.0.5", "port": 1.5}, {"host": "10.0.0.5", "port": 8443}]'::jsonb)
     IS DISTINCT FROM '[{"host": "studio-nas", "port": 8443}, {"host": "10.0.0.5", "port": 8443}]'::jsonb THEN
    RAISE EXCEPTION '0093 post-condition failed: gateway_clean_inside_addresses must keep the private and one-label entries, lower-cased and unique, and drop the rest';
  END IF;
  IF public.gateway_pem_fingerprint('-----BEGIN PRIVATE KEY-----' || chr(10) || 'MC4CAQAwBQYDK2VwBCIEIA==' || chr(10) || '-----END PRIVATE KEY-----') IS NOT NULL
     OR public.gateway_pem_fingerprint('-----BEGIN CERTIFICATE-----' || chr(10)
          || encode(decode('30' || repeat('01', 70), 'hex'), 'base64') || chr(10) || '-----END CERTIFICATE-----')
        IS DISTINCT FROM encode(sha256(decode('30' || repeat('01', 70), 'hex')), 'hex') THEN
    RAISE EXCEPTION '0093 post-condition failed: gateway_pem_fingerprint must refuse a private key and fingerprint one certificate''s DER';
  END IF;

  -- 16k. the switch's own column is unchanged by this file, and 0091's pins hold.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'workspaces'
                    AND column_name = 'remote_viewing_enabled' AND is_nullable = 'NO' AND column_default = 'false') THEN
    RAISE EXCEPTION '0093 post-condition failed: workspaces.remote_viewing_enabled changed shape';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indexrelid = to_regclass('public.gateway_signing_keys_one_current') AND i.indisunique) THEN
    RAISE EXCEPTION '0093 post-condition failed: gateway_signing_keys_one_current (at most one current key per workspace) is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_audit_action_chk'
                  AND pg_get_constraintdef(oid) LIKE '%remote_viewing.on%'
                  AND pg_get_constraintdef(oid) LIKE '%gateway.outside_address_changed%'
                  AND pg_get_constraintdef(oid) LIKE '%gateway.keys_rotated%') THEN
    RAISE EXCEPTION '0093 post-condition failed: workspace_audit''s action vocabulary is missing';
  END IF;

  -- 16l. GW1 review round 2: the reach key is its own column and no client
  --      reads it; a name is held to its cleaned form and a version to a
  --      version's shape; the old enrolment signature is gone.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'gateway_secrets' AND column_name = 'reach_key')
     OR has_column_privilege('authenticated', 'public.gateway_secrets', 'reach_key', 'SELECT')
     OR has_column_privilege('authenticated', 'public.gateways', 'reach_check_auto', 'SELECT')
     OR to_regprocedure('public.gateway_enrol_apply(text,text,jsonb,inet)') IS NOT NULL THEN
    RAISE EXCEPTION '0093 post-condition failed: the reach key, the automatic check''s mark or the enrolment''s signature is wrong';
  END IF;
  IF public.gateway_clean_name(E'Studio\u202e NAS\u200b \n x') <> 'Studio NAS x'
     OR public.gateway_clean_name('  Salt   Hours NAS ') <> 'Salt Hours NAS'
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gateways_name_chk'
                     AND pg_get_constraintdef(oid) LIKE '%gateway_clean_name%')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gateways_version_chk'
                     AND pg_get_constraintdef(oid) LIKE '%{1,40}%') THEN
    RAISE EXCEPTION '0093 post-condition failed: a gateway''s name or version may carry what reads in WILSON''s voice';
  END IF;

  RAISE NOTICE '0093 OK: six gateway tables under forced RLS (admins read gateways, tokens and the audit; secrets and the reach key, keys and mints are the service role''s); the switch''s live-admin and audit triggers; file_events viewed_remote with subject, external_id and file_events_select restated whole with the live-admin conjunct; gateway_clips_for_tickets as the caller; gateways_visible as a masked definer view; the admin and service-role RPCs, Rotate the ticket keys among them; the sweep.';
END $$;
