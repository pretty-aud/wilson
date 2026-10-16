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
// sign-in or sign-out, the adapter's own status, another project opened. One
// probe at a time; an event during a probe asks once more after it. Quiet when
// nothing changes: an answer equal to the last one is not stored, so nothing
// re-renders and nothing is announced.
//
// ── The token (connectionStatus.js rule 3) ──────────────────────────────────
// The cloud checks are plain fetches with the access token the auth EVENTS
// carry — never getSession(), whose abandoned call keeps auth-js's global
// lock. The callback below returns synchronously (RabbitProvider's Session 17
// note: an async auth callback deadlocks auth-js). The first probe waits for
// the first event (INITIAL_SESSION), so a cold start reads "checking", never a
// red "not signed in" that is only the session not read yet.
//
// ── The look ────────────────────────────────────────────────────────────────
// The kit's StatusDot (8px, the status tones, role="img", the words as its
// name and its title: the title is the tooltip, no tooltip component, plan
// §3.3), centred in the 24px gutter square at the shell's bottom-left corner
// (rabbitShell.css, `.rb-conn`). Laws of UX: Jakob's (a status light in the
// window's corner, where editors and IDEs keep theirs), Von Restorff (one dot,
// not three greens), Selective attention and Cognitive load (colour at a
// glance, the words on hover), Doherty (the answer is bounded at 6 s; until
// then it says "checking").

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRabbit } from '../state/RabbitProvider'
import { StatusDot } from '../../../ui/StatusDot'
import { supabase } from '../../../cloud/auth/supabaseClient'
import { presignStorage } from '../../../cloud/storageApi'
import { localFetch } from '../../../lib/localServerFetch'
import { hasLocalServer } from '../../../lib/localData'
import {
  adapterKindOf, probeConnection, connectionView, isSettled, bucketProbeKey,
  CONNECTION_EVERY_MS, CONNECTION_FRESH_MS, STORAGE_CHOICE_FRESH_MS,
} from '../state/connectionStatus'
import '../rabbitShell.css'

const sameAnswers = (a, b) => !!a && !!b && JSON.stringify(a) === JSON.stringify(b)

/** The dot's state: { view, announcement }. Exported for its test. */
export function useConnection({ active = true } = {}) {
  const ctx = useRabbit()
  const adapter = ctx?.getAdapter?.() || null
  const kind = adapterKindOf(ctx?.adapterMode, adapter)
  const projectId = ctx?.activeProjectId || null
  const firstProjectId = Object.keys(ctx?.projectsIndex || {})[0] || null

  const [result, setResult] = useState(null)
  const [browserOffline, setBrowserOffline] = useState(() => typeof navigator !== 'undefined' && navigator.onLine === false)
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || document.visibilityState !== 'hidden')
  const [tokenReady, setTokenReady] = useState(false)
  const [nudge, setNudge] = useState(0)
  const tokenRef = useRef(null)
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
      const next = session?.access_token || null
      const had = !!tokenRef.current
      tokenRef.current = next
      if (event === 'SIGNED_OUT') choiceRef.current = { row: undefined, at: 0 }
      setTokenReady(true)
      if (had !== !!next) setNudge((n) => n + 1)
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
    if (s.kind === 'cloud' && !s.tokenReady) return
    if (flightRef.current) { againRef.current = true; return }
    const ctl = new AbortController()
    flightRef.current = ctl
    try {
      const deps = {
        adapter: s.adapter,
        fetch: (input, init) => fetch(input, init),
        localFetch,
        token: () => tokenRef.current,
        supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
        anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        storageChoice: () => (Date.now() - choiceRef.current.at < STORAGE_CHOICE_FRESH_MS ? choiceRef.current.row : undefined),
        rememberStorageChoice: (row) => { choiceRef.current = { row, at: Date.now() } },
        bucketKey: () => bucketProbeKey({ files: s.files, projectId: s.projectId, projectIds: s.firstProjectId ? [s.firstProjectId] : [] }),
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

  // The events that can change the answer ask at once.
  const adapterStatus = ctx?.adapterStatus
  const asked = useRef(false)
  useEffect(() => {
    if (!asked.current) { asked.current = true; return }
    probeNow()
  }, [nudge, adapterStatus, projectId, probeNow])

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
  return (
    <div className="rb-conn" data-testid="connection-dot" data-state={view.state}>
      <StatusDot tone={view.tone} label={view.words} title={view.words} />
      <span className="sr-only" role="status" aria-live="polite" data-testid="connection-dot-live">{announcement}</span>
    </div>
  )
}
