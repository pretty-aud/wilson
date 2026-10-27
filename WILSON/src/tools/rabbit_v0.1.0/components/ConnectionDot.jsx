// ============================================================
// RABBIT — ConnectionDot (post-overhaul FX11, 2026-10-16)
// ============================================================
//
// One dot in the bottom-left corner of every R.A.B.B.I.T. tab, just above the
// orange bar: green when the WILSON database AND the place the company's
// files are kept both answer, amber when only the database answers (files
// cannot open or save), red when offline. Its hover text and accessible name
// say each part in words — "Database: connected · Files: Petal cloud,
// connected · Live updates: on" — and a change of state is announced once,
// politely. What it asks, and every word it says: state/connectionStatus.js.
//
// It replaces the project bar's adapter dot and LIVE pill (Audrey: "the
// project bar has three green dots and its confusing. remove the live and
// additional green dot"). The faces of who else has the project open stay on
// the bar.
//
// ── When it asks ────────────────────────────────────────────────────────────
// Only while R.A.B.B.I.T. is the page on screen (`active`; every page stays
// mounted) and the window is visible: on arriving, when the last answer is
// older than CONNECTION_FRESH_MS; then every CONNECTION_EVERY_MS; and at once
// on the events that can change the answer — the browser going online, a
// token arriving or going, a refreshed token, another account or workspace,
// the adapter's `online` disagreeing with what the dot last measured, another
// project opened (once it has loaded), the open project's first file in a
// company bucket. One probe at a time; an event during a probe asks once more
// after it. Quiet when nothing changes: an answer equal to the last one is
// not stored, so nothing re-renders and nothing is announced; a refetch of
// the projects list (a new adapterStatus object, same `online`) asks nothing
// (R1-7); nor does the SIGNED_IN auth-js sends on every return to the window
// (R2-3), nor the adapter's own boot status agreeing with the dot (R2-4).
//
// ── The token (connectionStatus.js rule 3) ──────────────────────────────────
// The cloud checks are plain fetches with the access token the auth EVENTS
// carry — never getSession(), whose abandoned call keeps auth-js's global
// lock. The callback below returns synchronously (RabbitProvider's Session 17
// note: an async auth callback deadlocks auth-js). The first probe waits for
// the first event (INITIAL_SESSION), so a cold start reads "checking", never a
// red "not signed in" that is only the session not read yet.
//
// A token past (or within 30 s of) its expiry is not used for 2 minutes from
// the moment the dot first finds it so (review rounds 1 and 2, R1-2 / R2-1):
// auth-js stops refreshing while the page is hidden, so a window shown after
// an hour — or a day — away holds an expired token until its refresh lands;
// a probe then would read the database's 401 as a red, announced, and a green
// announced again a second later. The dot keeps what it last said and asks
// when TOKEN_REFRESHED brings the new one. A token still unusable 2 minutes
// after the dot first met it is asked with (the refresh failed; the red is
// then true). The grace counts from that first meeting, not from the token's
// expiry, which can be long past by the time the window is seen again.
// Leaving the cloud forgets the token: coming back waits for a fresh one
// (R2-10).
//
// ── The look, and the keyboard ──────────────────────────────────────────────
// A cell of its own in the 24px gutter square at the shell's bottom-left
// corner (rabbitShell.css `.rb-conn`), the kit's 8px StatusDot centred in it.
// The cell is a BUTTON — a toggletip (review round 1, R1-4): its name is the
// words, its title the same words for the mouse (the title is the tooltip,
// no tooltip component, plan §3.3), and Enter / Space / a click shows the
// words in a caption above it (Escape, a second press or leaving it hides
// them), so a keyboard-only reader sees what a mouse sees. The caption opens
// only when asked (WCAG 1.4.13 covers content shown on hover or focus; this
// is shown on a press). The state is never colour alone (WCAG 1.4.1): green
// is a circle, amber a diamond, red a square.
//
// Laws of UX: Jakob's (a status light in the window's corner, where editors
// and IDEs keep theirs), Von Restorff (one dot, not three greens), Common
// Region (its own cell, not a bullet of the row beside it), Selective
// attention and Cognitive load (colour and shape at a glance, the words on
// demand), Doherty (the answer is bounded at 6 s; until then it says
// "checking").

import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import { useRabbit } from '../state/RabbitProvider'
import { StatusDot } from '../../../ui/StatusDot'
import { supabase } from '../../../cloud/auth/supabaseClient'
import { connectionWatchdog } from '../../../cloud/connectionWatchdog'
import { presignStorage } from '../../../cloud/storageApi'
import { peekWorkspaceStorageCached } from '../../../cloud/workspaceStorage'
import { localFetch } from '../../../lib/localServerFetch'
import { hasLocalServer } from '../../../lib/localData'
import {
  adapterKindOf, probeConnection, connectionView, isSettled, bucketProbeKey, petalProbePath,
  CONNECTION_EVERY_MS, CONNECTION_FRESH_MS, STORAGE_CHOICE_FRESH_MS,
} from '../state/connectionStatus'
import '../rabbitShell.css'

const sameAnswers = (a, b) => !!a && !!b && JSON.stringify(a) === JSON.stringify(b)

// R1-2 / R2-1: how near its expiry a token is not used, and for how long
// from the moment the dot first finds it so (header).
const TOKEN_MARGIN_MS = 30_000
const TOKEN_GRACE_MS = 120_000
function tokenNearExpiry(expiresAt, now = Date.now()) {
  return !!expiresAt && expiresAt * 1000 - now < TOKEN_MARGIN_MS
}
const NO_TOKEN = Object.freeze({ token: null, expiresAt: null, user: null, workspace: null, staleSince: null })

// S1 (night 2, 2026-10-27): the connection watchdog's word. While the cloud
// client is reconnecting (a request hung, was aborted, the service is asked
// again every 10 s) the dot says so — the strip's words — instead of what
// its last probe found; on the clear it asks at once, so green follows the
// strip within the dot's own 6 s bound.
const subscribeWatchdog = (listener) => connectionWatchdog.subscribe(listener)
const readWatchdog = () => connectionWatchdog.getSnapshot()

/** The dot's state: { view, announcement }. */
function useConnection({ active = true } = {}) {
  const ctx = useRabbit()
  const adapter = ctx?.getAdapter?.() || null
  const kind = adapterKindOf(ctx?.adapterMode, adapter)
  const projectId = ctx?.activeProjectId || null
  const firstProjectId = Object.keys(ctx?.projectsIndex || {})[0] || null
  // Whether the open project has a file in a company bucket: the bucket's
  // check moves from a key nobody writes (which a key without ListBucket
  // cannot answer either way) to that file the moment it is there (R1-1).
  const bucketFileThere = !!bucketProbeKey({ files: ctx?.files, projectId })?.real

  const [result, setResult] = useState(null)
  const [browserOffline, setBrowserOffline] = useState(() => typeof navigator !== 'undefined' && navigator.onLine === false)
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || document.visibilityState !== 'hidden')
  const [tokenReady, setTokenReady] = useState(false)
  const [nudge, setNudge] = useState(0)
  const tokenRef = useRef({ ...NO_TOKEN })
  const readyRef = useRef(false)
  const choiceRef = useRef({ row: undefined, at: 0 })
  const lastRef = useRef({ at: 0, kind: null })
  const flightRef = useRef(null)
  const againRef = useRef(false)

  const live = useRef({})
  live.current = { kind, adapter, files: ctx?.files, projectId, firstProjectId, active, visible, tokenReady }

  // The access token, from auth events only (header).
  useEffect(() => {
    if (kind !== 'cloud') return undefined
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      const was = tokenRef.current
      const token = session?.access_token || null
      const user = session?.user?.id ?? null
      const workspace = session?.user?.app_metadata?.workspace_id ?? null
      // The same token again (auth-js's SIGNED_IN on every return to the
      // window) keeps when the dot first found it stale; a new one starts clean.
      tokenRef.current = { token, expiresAt: session?.expires_at || null, user, workspace, staleSince: token === was.token ? was.staleSince : null }
      const otherOwner = user !== was.user || workspace !== was.workspace
      // Another account or workspace: its storage choice is its own (R1-3).
      if (event === 'SIGNED_OUT' || otherOwner) choiceRef.current = { row: undefined, at: 0 }
      // The first event starts the schedule (tokenReady); every later one
      // that can change the answer asks at once — a token arriving or going,
      // a refreshed one (R1-2: the one a hidden page was waiting for), another
      // account or workspace. Not SIGNED_IN as such: auth-js sends it on
      // every return to a visible window with the same session (R2-3).
      if (!readyRef.current) { readyRef.current = true; setTokenReady(true); return }
      if (!!was.token !== !!token || event === 'TOKEN_REFRESHED' || otherOwner) setNudge((n) => n + 1)
    })
    return () => {
      data?.subscription?.unsubscribe?.()
      // Leaving the cloud forgets the token: coming back waits for a fresh
      // INITIAL_SESSION rather than asking with this one (R2-10).
      tokenRef.current = { ...NO_TOKEN }
      readyRef.current = false
      setTokenReady(false)
    }
  }, [kind])

  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const on = () => { setBrowserOffline(false); setNudge((n) => n + 1) }
    const off = () => setBrowserOffline(true)
    const seen = () => setVisible(document.visibilityState !== 'hidden')
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    document.addEventListener('visibilitychange', seen)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
      document.removeEventListener('visibilitychange', seen)
    }
  }, [])

  const probeNow = useCallback(async () => {
    const s = live.current
    if (!s.kind || s.kind === 'pending' || !s.active || !s.visible) return
    if (s.kind === 'cloud') {
      if (!s.tokenReady) return
      const t = tokenRef.current
      if (tokenNearExpiry(t.expiresAt)) {
        if (t.staleSince == null) t.staleSince = Date.now()
        if (Date.now() - t.staleSince < TOKEN_GRACE_MS) return
      }
    }
    if (flightRef.current) { againRef.current = true; return }
    const ctl = new AbortController()
    flightRef.current = ctl
    try {
      const deps = {
        adapter: s.adapter,
        fetch: (input, init) => fetch(input, init),
        localFetch,
        token: () => tokenRef.current.token,
        supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
        anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        // The upload path's own cached choice first, so the dot asks the
        // store a new file would go to (R1-3); else the dot's own read.
        storageChoice: () => {
          const held = peekWorkspaceStorageCached()
          if (held !== undefined) return held
          return Date.now() - choiceRef.current.at < STORAGE_CHOICE_FRESH_MS ? choiceRef.current.row : undefined
        },
        rememberStorageChoice: (row) => { choiceRef.current = { row, at: Date.now() } },
        bucketKey: () => bucketProbeKey({ files: s.files, projectId: s.projectId, projectIds: s.firstProjectId ? [s.firstProjectId] : [] }),
        petalPath: () => petalProbePath({ files: s.files, projectId: s.projectId }),
        presign: presignStorage,
        desktop: hasLocalServer(),
      }
      const r = await probeConnection(s.kind, deps, { signal: ctl.signal })
      if (ctl.signal.aborted || live.current.kind !== s.kind) return
      lastRef.current = { at: Date.now(), kind: s.kind }
      const answered = { kind: s.kind, database: r.database, files: r.files }
      setResult((prev) => (sameAnswers(prev, answered) ? prev : answered))
    } finally {
      if (flightRef.current === ctl) flightRef.current = null
      if (againRef.current && !ctl.signal.aborted) { againRef.current = false; probeNow() }
    }
  }, [])

  // Unmounting stops the probe in flight (its fetches are aborted).
  useEffect(() => () => { flightRef.current?.abort(); flightRef.current = null }, [])

  // On screen: ask on arrival if the answer is stale, then every minute.
  useEffect(() => {
    if (!active || !visible || !kind || kind === 'pending' || (kind === 'cloud' && !tokenReady)) return undefined
    if (Date.now() - lastRef.current.at > CONNECTION_FRESH_MS || lastRef.current.kind !== kind) probeNow()
    const id = setInterval(probeNow, CONNECTION_EVERY_MS)
    return () => clearInterval(id)
  }, [active, visible, kind, tokenReady, probeNow])

  // The events that can change the answer ask at once (each effect skips its
  // own first run: the schedule above asks on arrival).
  const asked = useRef({ nudge: false, online: false, project: false })
  useEffect(() => {
    if (!asked.current.nudge) { asked.current.nudge = true; return }
    probeNow()
  }, [nudge, probeNow])

  // The adapter's `online` — not its status object, which every projects
  // refetch replaces (R1-7) — and only when it disagrees with what the dot
  // measured or is measuring: the provider's own boot status() flips
  // false → true just after the dot's first probe, and that is not news (R2-4).
  const adapterOnline = ctx?.adapterStatus?.online
  const measured = result?.kind === kind ? result : null
  const measuredRef = useRef(null)
  measuredRef.current = measured
  useEffect(() => {
    if (!asked.current.online) { asked.current.online = true; return }
    if (flightRef.current) return
    const dbOk = measuredRef.current?.database?.ok
    if (typeof adapterOnline === 'boolean' && (dbOk === true) === adapterOnline && dbOk != null) return
    probeNow()
  }, [adapterOnline, probeNow])

  // Another project, once it has loaded (R2-9: asked while the previous
  // project's files are still in the bundle, a company bucket read "no file
  // here" and flashed grey), and the open project's first file in a company
  // bucket arriving (R1-1). One effect, so a load that brings the file asks once.
  const loading = !!ctx?.loadingProject
  useEffect(() => {
    if (!asked.current.project) { asked.current.project = true; return }
    if (loading) return
    probeNow()
  }, [projectId, loading, bucketFileThere, probeNow])

  // S1: the watchdog outranks the last probe while it is reconnecting the
  // cloud client; the clear asks again at once (the header note above).
  const reconnecting = useSyncExternalStore(subscribeWatchdog, readWatchdog, readWatchdog)
  const wasReconnecting = useRef(false)
  useEffect(() => {
    if (wasReconnecting.current && !reconnecting) setNudge((n) => n + 1)
    wasReconnecting.current = reconnecting
  }, [reconnecting])

  const view = connectionView({
    kind,
    result: measured,
    realtimeStatus: ctx?.realtimeStatus,
    projectOpen: !!projectId,
    browserOffline,
    reconnecting: kind === 'cloud' && reconnecting,
  })

  // Announced once per change between settled states — never the first
  // answer (nothing changed), never "checking", and never the first answer
  // of another backend (a switch is not a change of the connection).
  const [announcement, setAnnouncement] = useState('')
  const settledRef = useRef(null)
  useEffect(() => { settledRef.current = null }, [kind])
  useEffect(() => {
    if (!isSettled(view.state)) return
    const was = settledRef.current
    settledRef.current = view.state
    if (was && was !== view.state) setAnnouncement(`${view.summary}.`)
  }, [view.state, view.summary])

  return { view, announcement }
}

export default function ConnectionDot({ active = true } = {}) {
  const { view, announcement } = useConnection({ active })
  const [open, setOpen] = useState(false)
  const captionId = useId()
  const rootRef = useRef(null)
  const parts = view.words.split(' · ')

  // Open words close on a press anywhere else, and on Escape, even where a
  // click did not focus the button (Safari and Firefox on macOS do not focus
  // a clicked button, so leaving it and its own Escape never fire: R2-5).
  useEffect(() => {
    if (!open) return undefined
    const away = (e) => { if (!rootRef.current?.contains(e.target)) setOpen(false) }
    const escape = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', away, true)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', away, true)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  return (
    <div className="rb-conn" data-testid="connection-dot" data-state={view.state} ref={rootRef}>
      {/* The name and the title are the one sentence (R2-7: a title that
          differs from the name is read again as the description). */}
      <button
        type="button"
        className="rb-conn-cell"
        aria-label={view.words}
        title={view.words}
        aria-expanded={open}
        aria-controls={open ? captionId : undefined}
        onClick={(e) => { e.currentTarget.focus(); setOpen((o) => !o) }}
        onKeyDown={(e) => { if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false) } }}
        onBlur={() => setOpen(false)}
      >
        {/* The kit's dot, hidden from the accessibility tree (the button is
            named). Its own title is the same words: the browser shows the
            nearest title, and an empty one would hide the button's (the
            kit's StatusBadge test pins that trap). */}
        <StatusDot tone={view.tone} aria-hidden="true" role={undefined} aria-label={undefined} title={view.words} />
      </button>
      {open && (
        <div id={captionId} className="rb-conn-caption text-caption" data-testid="connection-dot-words">
          {parts.map((p) => <span key={p} className="block">{p}</span>)}
        </div>
      )}
      <span className="sr-only" role="status" aria-live="polite" data-testid="connection-dot-live">{announcement}</span>
    </div>
  )
}
