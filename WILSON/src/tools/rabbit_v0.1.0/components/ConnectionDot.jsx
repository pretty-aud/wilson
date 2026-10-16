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
// sign-in, a sign-out or a refreshed token, the adapter going on- or offline,
// another project opened, the open project's first file in a company bucket.
// One probe at a time; an event during a probe asks once more after it. Quiet
// when nothing changes: an answer equal to the last one is not stored, so
// nothing re-renders and nothing is announced; a refetch of the projects
// list (a new adapterStatus object, same `online`) asks nothing (R1-7).
//
// ── The token (connectionStatus.js rule 3) ──────────────────────────────────
// The cloud checks are plain fetches with the access token the auth EVENTS
// carry — never getSession(), whose abandoned call keeps auth-js's global
// lock. The callback below returns synchronously (RabbitProvider's Session 17
// note: an async auth callback deadlocks auth-js). The first probe waits for
// the first event (INITIAL_SESSION), so a cold start reads "checking", never a
// red "not signed in" that is only the session not read yet.
//
// A token past (or within 30 s of) its expiry is not used for 2 minutes after
// it expired (review round 1, R1-2): auth-js stops refreshing while the page
// is hidden, so a window shown after an hour away holds an expired token
// until its refresh lands — a probe then would read the database's 401 as a
// red, announced, and a green announced again a second later. The dot keeps
// what it last said and asks when TOKEN_REFRESHED brings the new one. A token
// still expired after 2 minutes is asked with (the refresh failed; the red
// is then true).
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

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useRabbit } from '../state/RabbitProvider'
import { StatusDot } from '../../../ui/StatusDot'
import { supabase } from '../../../cloud/auth/supabaseClient'
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

// R1-2: how near its expiry a token is not used, and for how long after.
const TOKEN_MARGIN_MS = 30_000
const TOKEN_GRACE_MS = 120_000
function tokenUnusable(expiresAt, now = Date.now()) {
  if (!expiresAt) return false
  const left = expiresAt * 1000 - now
  return left < TOKEN_MARGIN_MS && left > -TOKEN_GRACE_MS
}

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
  const tokenRef = useRef({ token: null, expiresAt: null, workspace: null })
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
      const workspace = session?.user?.app_metadata?.workspace_id ?? null
      tokenRef.current = { token: session?.access_token || null, expiresAt: session?.expires_at || null, workspace }
      // Another account or workspace: its storage choice is its own (R1-3).
      if (event === 'SIGNED_OUT' || workspace !== was.workspace) choiceRef.current = { row: undefined, at: 0 }
      // The first event starts the schedule (tokenReady); every later one
      // that can change the answer asks at once — a sign-in or sign-out, and
      // a refreshed token (R1-2: the one a hidden page was waiting for).
      if (!readyRef.current) { readyRef.current = true; setTokenReady(true); return }
      if (!!was.token !== !!tokenRef.current.token || event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') setNudge((n) => n + 1)
    })
    return () => data?.subscription?.unsubscribe?.()
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
    if (s.kind === 'cloud' && (!s.tokenReady || tokenUnusable(tokenRef.current.expiresAt))) return
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

  // The events that can change the answer ask at once. Keyed on the adapter's
  // `online`, not its status object, which every projects refetch replaces.
  const adapterOnline = ctx?.adapterStatus?.online
  const asked = useRef(false)
  useEffect(() => {
    if (!asked.current) { asked.current = true; return }
    probeNow()
  }, [nudge, adapterOnline, projectId, bucketFileThere, probeNow])

  const view = connectionView({
    kind,
    result: result?.kind === kind ? result : null,
    realtimeStatus: ctx?.realtimeStatus,
    projectOpen: !!projectId,
    browserOffline,
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
  const parts = view.words.split(' · ')
  return (
    <div className="rb-conn" data-testid="connection-dot" data-state={view.state}>
      <button
        type="button"
        className="rb-conn-cell"
        aria-label={`Connection: ${view.words}`}
        title={view.words}
        aria-expanded={open}
        aria-controls={open ? captionId : undefined}
        onClick={() => setOpen((o) => !o)}
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
