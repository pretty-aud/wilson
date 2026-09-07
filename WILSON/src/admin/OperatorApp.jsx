// =============================================================================
// OperatorApp — Session 15: the Platform Operator Console shell
// (/wilsonadmin, locked #18).
//
// Deliberately tiny. This surface can create and destroy companies, so the
// design goal is "nothing here that does not need to be here" rather than
// feature parity with the company Admin Terminal. Two sections, no router,
// no tools, no pet.
//
// Access is checked three times, and only the third one counts:
//   1. here, by reading public.platform_operators through the caller's own
//      RLS (0002's self-SELECT arm) — presentation only;
//   2. in operatorGuard, against the live table with service role;
//   3. in the policies themselves, for anything read directly.
// The gate below exists so an ordinary user who finds the URL gets a plain
// sentence instead of a broken console, NOT because it protects anything.
//
// UX laws applied (≥5): Jakob's Law (the shell copies the Admin Terminal's
// grammar exactly — 190px left nav, light tables, dark amber buttons — so
// an operator who knows WILSON already knows this); Miller's Law (two nav
// items, and the count is the point: every extra surface here is a new way
// to destroy a tenant); Von Restorff (the operator identity strip is amber
// on dark, permanently visible, because "which console am I in" is the one
// thing that must never be ambiguous when one of them can delete a
// company); Selective Attention (a suspended company is dimmed and badged
// in the list rather than merely sorted differently); Cognitive Load (no
// dashboard, no charts, no counts anyone has to interpret — just the rows
// and what can be done to them).
//
// B2 part 2 (Track B, 2026-09-06): this surface now has the same session
// discipline as /wilson — its own sign_in / sign_out / idle_timeout /
// session_cap rows in auth_events, the 25/30-minute idle warning and
// sign-out, the 4-hour cap, the connection-lost banner — and a fourth nav
// item, Sign-ins, which is the operator-tier mirror of the Admin Terminal's
// Sign-ins tab (TPN-LOG-007). Its clocks live under `wilson.operator.session`,
// never the app's key, so the two surfaces cannot keep each other alive.
// =============================================================================

import { useCallback, useEffect, useState } from 'react'
import { Building2, ScrollText, LogOut, Cpu, KeyRound } from 'lucide-react'
import { supabase, hydrateSupabase } from '../cloud/auth/supabaseClient'
import { loadSession, clearSession } from '../cloud/auth/sessionStorage'
import { recordAuthEvent } from '../cloud/auth/authEvents'
import { useSessionTimeouts, sessionIdOf, EXPIRE_REASONS } from '../cloud/auth/sessionTimeouts'
import SessionWarning, { describeSessionExpiry } from '../cloud/auth/SessionWarning'
import ConnectionLostBanner from '../cloud/ConnectionLostBanner'
import OperatorLogin from './OperatorLogin'
import CompaniesSection from './CompaniesSection'
import AuditSection from './AuditSection'
import ModelsSection from './ModelsSection'
import SignInsSection from './SignInsSection'

// Four now, not two. The Miller's Law note in the header still holds — the
// count is deliberate — but each earns its place: Models is the only surface
// in WILSON where a model can be added, and D4 makes it the source every
// company's picker reads from; Sign-ins (B2) is the only place operator
// access is visible at all. Neither destroys anything, which is why both sit
// below Companies.
const NAV = [
  { key: 'companies', label: 'Companies', icon: Building2 },
  { key: 'models', label: 'Models', icon: Cpu },
  { key: 'audit', label: 'Audit', icon: ScrollText },
  { key: 'signins', label: 'Sign-ins', icon: KeyRound },
]

export default function OperatorApp() {
  const [booted, setBooted] = useState(false)
  const [session, setSession] = useState(null)
  const [isOperator, setIsOperator] = useState(false)
  const [section, setSection] = useState('companies')
  // B2 part 2: why the operator is back at the login screen, if a timeout
  // put them there. Cleared by the next sign-in.
  const [notice, setNotice] = useState('')

  // Confirm operator status against the table, not the JWT claim. The claim
  // is stamped at token mint and can be up to a full TTL stale; the row is
  // current. (The server makes the same call for real — this one only
  // decides which screen to draw.)
  // Returns true | false | 'unknown'. The third value matters: supabase-js
  // reports a transient PostgREST failure on the `error` channel rather than
  // throwing, so treating "no row" and "could not ask" the same way would tell
  // a genuine operator they are not one — and the remedy it offers (sign out)
  // is exactly wrong for a network blip.
  const checkOperator = useCallback(async (uid) => {
    if (!uid) return false
    const { data, error } = await supabase
      .from('platform_operators')
      .select('user_id')
      .eq('user_id', uid)
      .maybeSingle()
    if (error) return 'unknown'
    return !!data
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const stored = await loadSession()
        const live = stored ? await hydrateSupabase(stored) : null
        if (cancelled) return
        if (live?.user?.id) {
          const ok = await checkOperator(live.user.id)
          if (cancelled) return
          setSession(live)
          setIsOperator(ok)
        }
      } catch { /* fall through to the login screen */ }
      if (!cancelled) setBooted(true)
    })()
    return () => { cancelled = true }
  }, [checkOperator])

  const handleSignedIn = useCallback(async (next) => {
    const ok = await checkOperator(next?.user?.id)
    setSession(next)
    setIsOperator(ok)
    setNotice('')
    // B2 part 2: the console's own sign_in row (surface 'admin' in context).
    // The password hook's row has no address and no surface; this one has
    // both. Fire-and-forget; it never gates the sign-in.
    recordAuthEvent('sign_in')
  }, [checkOperator])

  // scope: 'local' — signing out of the console must NOT sign the same person
  // out of /wilson. supabase-js defaults to a GLOBAL sign-out, which revokes
  // every refresh token the user holds; since Audrey is both an operator and a
  // workspace admin, closing the console would have dropped her out of the
  // product app in another tab. 'local' clears this surface only, which is
  // what a separate session is for.
  //
  // B2 part 2: `event` names the auth_events row written BEFORE the revoke
  // ('sign_out' by default; 'idle_timeout' / 'session_cap' from the
  // timeouts). No WIL-1002 here on purpose: reportAppEvent writes to the
  // caller's COMPANY log, and an operator's console session is not company
  // business — auth_events (operator-readable) is the record on this surface.
  const handleSignOut = useCallback(async (opts) => {
    const event = opts && (typeof opts.event === 'string' || opts.event === null) ? opts.event : 'sign_out'
    const expiry = EXPIRE_REASONS.includes(event) ? event : null
    if (event) await recordAuthEvent(event)
    setNotice(expiry ? describeSessionExpiry(expiry) : '')
    try { await supabase.auth.signOut({ scope: 'local' }) } catch { /* best effort */ }
    await clearSession()
    setSession(null)
    setIsOperator(false)
  }, [])

  // B2 part 2: idle warning at 25 minutes, sign-out at 30, the 4-hour cap.
  // Enabled for any session on this surface, operator or not — a signed-in
  // non-operator looking at "Not a platform operator" still holds a session.
  const sessionTimeouts = useSessionTimeouts({
    enabled: !!session,
    sessionId: sessionIdOf(session),
    onExpire: (reason) => { handleSignOut({ event: reason }) },
  })

  const chrome = (
    <>
      <ConnectionLostBanner />
      {session && (
        <SessionWarning
          phase={sessionTimeouts.phase}
          deadline={sessionTimeouts.deadline}
          onStay={sessionTimeouts.stay}
        />
      )}
    </>
  )

  if (!booted) return null
  if (!session) return <>{chrome}<OperatorLogin onSignedIn={handleSignedIn} notice={notice} /></>

  if (isOperator === 'unknown') {
    return (
      <>
        {chrome}
        <div className="min-h-screen flex items-center justify-center px-4" style={{ backgroundColor: '#1c1917' }}>
          <div style={{ maxWidth: '380px' }}>
            <h1 className="text-sm font-bold uppercase tracking-widest mb-2" style={{ color: '#f4a261' }}>
              Could not verify operator status
            </h1>
            <p className="text-xs leading-relaxed mb-4" style={{ color: '#a8a29e' }}>
              The check failed to reach the database. This is almost certainly
              temporary — it does not mean your access has been revoked.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider rounded-sm"
              style={{ backgroundColor: '#ea580c', color: '#fff' }}
            >
              Retry
            </button>
          </div>
        </div>
      </>
    )
  }

  if (!isOperator) {
    return (
      <>
        {chrome}
        <div className="min-h-screen flex items-center justify-center px-4" style={{ backgroundColor: '#1c1917' }}>
          <div style={{ maxWidth: '380px' }}>
            <h1 className="text-sm font-bold uppercase tracking-widest mb-2" style={{ color: '#f4a261' }}>
              Not a platform operator
            </h1>
            <p className="text-xs leading-relaxed mb-4" style={{ color: '#a8a29e' }}>
              This account is signed in, but it does not hold platform operator
              status. If you are looking for your company&rsquo;s admin tools,
              they live in WILSON under Admin Terminal.
            </p>
            <button
              onClick={() => handleSignOut()}
              className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider rounded-sm"
              style={{ backgroundColor: '#ea580c', color: '#fff' }}
            >
              Sign out
            </button>
          </div>
        </div>
      </>
    )
  }

  const email = session?.user?.email ?? ''

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: '#faf8f5' }}>
      {chrome}
      {/* Identity strip. Permanently visible and visually unlike the app's
          chrome: this console can destroy a company, so "which surface am I
          in, as whom" is never a thing the operator has to go and check. */}
      <header
        className="flex items-center justify-between px-6 py-2 flex-shrink-0"
        style={{ backgroundColor: '#1c1917' }}
      >
        <span className="text-[11px] font-bold uppercase tracking-widest" style={{ color: '#f4a261' }}>
          WILSON Operator Console
        </span>
        <div className="flex items-center gap-3">
          <span className="text-[11px] font-mono" style={{ color: '#a8a29e' }}>{email}</span>
          <button
            onClick={() => handleSignOut()}
            className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-bold uppercase tracking-wider rounded-sm transition-colors"
            style={{ backgroundColor: 'rgba(255,255,255,0.08)', color: '#f4a261' }}
          >
            <LogOut size={12} /> Sign out
          </button>
        </div>
      </header>

      <div
        className="flex-1 min-h-0 flex flex-col"
        style={{ maxWidth: '1240px', margin: '0 auto', width: '100%', padding: '2rem' }}
      >
        <div className="flex-1 min-h-0 flex">
          <nav className="flex-shrink-0 flex flex-col gap-1 pr-4" style={{ width: '190px' }}>
            {NAV.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setSection(key)}
                className="flex items-center gap-2 px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-left transition-colors"
                style={section === key
                  ? { backgroundColor: 'rgba(234, 88, 12, 0.18)', color: '#1c1917', borderLeft: '3px solid #ea580c' }
                  : { backgroundColor: 'transparent', color: '#57534e', borderLeft: '3px solid transparent' }}
              >
                <Icon size={14} /> {label}
              </button>
            ))}
          </nav>

          {/* All sections stay mounted with display toggling (the app-wide
              pattern) so filter and scroll state survive a hop; each
              lazy-fetches on its first activation via isActive. */}
          <div className="flex-1 min-w-0 min-h-0 pl-4" style={{ borderLeft: '1px solid #e7e5e4' }}>
            <div
              className="h-full min-h-0 overflow-y-auto wilson-light-scroll"
              style={{ display: section === 'companies' ? 'block' : 'none' }}
            >
              <CompaniesSection isActive={section === 'companies'} />
            </div>
            <div
              className="h-full min-h-0 overflow-y-auto wilson-light-scroll"
              style={{ display: section === 'models' ? 'block' : 'none' }}
            >
              <ModelsSection isActive={section === 'models'} />
            </div>
            <div
              className="h-full min-h-0 overflow-y-auto wilson-light-scroll"
              style={{ display: section === 'audit' ? 'block' : 'none' }}
            >
              <AuditSection isActive={section === 'audit'} />
            </div>
            <div
              className="h-full min-h-0 overflow-y-auto wilson-light-scroll"
              style={{ display: section === 'signins' ? 'block' : 'none' }}
            >
              <SignInsSection
                isActive={section === 'signins'}
                selfUserId={session?.user?.id ?? null}
                selfEmail={email}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
