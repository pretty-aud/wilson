import { useState, useEffect, useRef, useCallback } from 'react';
import {
  ChevronDown, ChevronRight, Loader2, Check, AlertCircle,
  CheckCircle2, XCircle, HelpCircle, Search, Play, Square,
  ArrowLeft, RefreshCw
} from 'lucide-react';
import { Button, IconButton, Select, SectionTitle, EmptyState, Card, Panel, Toolbar, StatusBadge, StatusDot, Banner } from '../../ui';
import { VALIDATION_PROMPT, FIX_PROMPT } from './validatorPrompts.js';
// Session 10: content routes go through the adapter seam (see adapters/index.js).
import { otterFetch } from './adapters';
// Session 12 (locked #21): Anthropic access rides the ai-proxy Edge Function.
import { callAI } from '../../cloud/aiProxy';
import { modelFor } from '../../lib/activeModel';

// ── API helper (model-agnostic) ──────────────────────────────────────────────
// Both call sites below omit `model`, so the fallback is what actually runs.
// It is kept as a parameter rather than removed because the continuation
// below passes it back through.
// Bounds the pause_turn continuation below. The previous version recursed with
// no ceiling at all.
const MAX_CONTINUATIONS = 3;

async function callValidatorAPI({ model, systemPrompt, messages, tools, signal, depth = 0 }) {
  const body = {
    model: model || modelFor('otter.validator'),
    max_tokens: 8096,
    system: systemPrompt,
    messages,
    tool: 'validator',
  };
  if (tools) body.tools = tools;

  const data = await callAI(body, { signal });

  // Extract text from response — may contain tool_use blocks from web search
  const textBlock = data.content.find(b => b.type === 'text');
  if (textBlock) return textBlock.text;

  // Continue a server-side tool run that hit its iteration limit.
  //
  // S19 measured the old shape of this branch against claude-sonnet-5 and it
  // returns 400: "This model does not support assistant message prefill. The
  // conversation must end with a user message." It branched on
  // `stop_reason === 'tool_use'`, which is the signal for a CLIENT tool — and
  // the Validator declares none. The only tool here is server-side web search,
  // whose real signal is `pause_turn`. So the branch was both unreachable in
  // practice and invalid if it ever were reached.
  //
  // `pause_turn` is resumed by re-sending with the assistant turn appended and
  // NO trailing user turn — the API recognises the trailing server_tool_use
  // block and continues. That is the documented shape; it is not the same as
  // the text prefill that was measured failing.
  if (data.stop_reason === 'pause_turn' && depth < MAX_CONTINUATIONS) {
    return callValidatorAPI({
      model, systemPrompt,
      messages: [...messages, { role: 'assistant', content: data.content }],
      tools, signal,
      depth: depth + 1,
    });
  }

  if (data.stop_reason === 'pause_turn') {
    throw new Error(`Validator stopped after ${MAX_CONTINUATIONS} continuations without a final answer.`);
  }
  throw new Error(`No text response from API (stop_reason: ${data.stop_reason ?? 'unknown'}).`);
}

// ── Parse JSON from AI response ──────────────────────────────────────────────
function parseJSONResponse(text) {
  // Try direct parse first
  try { return JSON.parse(text); } catch {}
  // Try extracting from markdown code fences
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    try { return JSON.parse(fenced[1].trim()); } catch {}
  }
  // Try finding JSON object
  const objMatch = text.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try { return JSON.parse(objMatch[0]); } catch {}
  }
  throw new Error('Failed to parse JSON from response');
}

// ── Grades and verdicts (review O24) ────────────────────────────────────────
// Two status vocabularies with eleven colours of their own became the kit's
// status tones. A to F is an ordinal scale: success, success, warning,
// danger, danger, the letter doing the precise work (B was the only blue in
// O.T.T.E.R. outside the node badges; C was the signal orange).
function gradeTone(grade) {
  switch (grade) {
    case 'A': case 'B': return 'success';
    case 'C': return 'warning';
    case 'D': case 'F': return 'danger';
    default: return 'neutral';
  }
}

const VERDICT_TONE = { accurate: 'success', inaccurate: 'danger', unverifiable: 'warning' };

function verdictIcon(verdict) {
  const Icon = verdict === 'accurate' ? CheckCircle2
    : verdict === 'inaccurate' ? XCircle
      : verdict === 'unverifiable' ? HelpCircle : null;
  return Icon ? <Icon className="otter-verdict-icon" data-verdict={verdict} aria-hidden="true" /> : null;
}

// ══════════════════════════════════════════════════════════════════════════════
// VALIDATOR COMPONENT
// ══════════════════════════════════════════════════════════════════════════════
export default function Validator({ softwareList, activeSoftwareSlug, softwareCacheRef, subjectCacheRef }) {

  // ── Phase: 'setup' = full-page lesson picker, 'results' = sidebar+detail ──
  const [phase, setPhase] = useState('setup');

  // ── Validation scope ───────────────────────────────────────────────────────
  const [scope, setScope] = useState('full');            // 'full' | 'targeted'
  const [expandedSubjects, setExpandedSubjects] = useState({});
  const [expandedSections, setExpandedSections] = useState({});
  const [selectedLessons, setSelectedLessons] = useState(new Set());

  // ── Queue & results ────────────────────────────────────────────────────────
  const [validationQueue, setValidationQueue] = useState([]);
  const [auditResults, setAuditResults] = useState([]);
  const [selectedAuditId, setSelectedAuditId] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);

  // ── Fix state ──────────────────────────────────────────────────────────────
  const [fixLoading, setFixLoading] = useState(false);
  // Session 30: keyed BY AUDIT.
  //
  // This was two flat Sets of fix INDICES shared across every audit in the run.
  // An index carries no identity of its own, so the obvious hazard is one
  // lesson's outcomes showing up on another's — and that was NOT reachable,
  // because selecting an audit in the sidebar cleared both Sets (the reset that
  // used to sit in that onClick). The defect was the cure: outcomes were
  // DISCARDED on every audit switch. Accept a fix on lesson A, look at lesson
  // B, come back — A's fix reads unhandled and invites a second Accept, which
  // then cannot match `fix.original` because the first one already replaced it.
  // Silently, under the old code.
  //
  // Keying by audit keeps each lesson's outcomes across navigation and removes
  // the need for the reset, so the hazard cannot come back either.
  //
  //   { [auditId]: { [fixIndex]: { status: 'accepted' | 'declined' | 'failed',
  //                                error?: string } } }
  const [fixState, setFixState] = useState({});

  const setFixOutcome = useCallback((auditId, index, outcome) => {
    setFixState(prev => ({
      ...prev,
      [auditId]: { ...(prev[auditId] ?? {}), [index]: outcome },
    }));
  }, []);

  // ── Refs ────────────────────────────────────────────────────────────────────
  const abortRef = useRef(null);
  const processingRef = useRef(false);

  // ── Force re-render after fetching subjects into cache ─────────────────────
  const [cacheVersion, setCacheVersion] = useState(0);

  const selectedAudit = auditResults.find(a => a.id === selectedAuditId) || null;
  const auditFixState = fixState[selectedAuditId] ?? {};

  // ── Fetch ALL subjects across ALL software into cache ────────────────────
  const [loadingSubjects, setLoadingSubjects] = useState(false);

  useEffect(() => {
    if (!softwareList || softwareList.length === 0) return;

    let cancelled = false;
    const fetchAll = async () => {
      setLoadingSubjects(true);
      let fetched = false;
      for (const sw of softwareList) {
        const swCached = softwareCacheRef.current[sw.slug];
        if (!swCached?.subjects) continue;
        for (const sub of swCached.subjects) {
          const cacheKey = `${sw.slug}/${sub.slug}`;
          if (!subjectCacheRef.current[cacheKey]) {
            try {
              const fullSub = await otterFetch(`/api/software/${sw.slug}/subjects/${sub.slug}`).then(r => r.json());
              if (!cancelled) {
                subjectCacheRef.current[cacheKey] = fullSub;
                fetched = true;
              }
            } catch {}
          }
        }
      }
      if (!cancelled) {
        if (fetched) setCacheVersion(v => v + 1);
        setLoadingSubjects(false);
      }
    };
    fetchAll();
    return () => { cancelled = true; };
  }, [softwareList, softwareCacheRef, subjectCacheRef]);

  // ── Build lesson tree across ALL software ──────────────────────────────────
  // eslint-disable-next-line no-unused-vars
  const _cv = cacheVersion; // reference to trigger recalc when cache updates
  const lessonTree = (() => {
    if (!softwareList || softwareList.length === 0) return [];
    return softwareList.map(sw => {
      const swCached = softwareCacheRef.current[sw.slug];
      if (!swCached?.subjects) return null;
      const subjects = swCached.subjects.map(sub => {
        const fullSub = subjectCacheRef.current[`${sw.slug}/${sub.slug}`];
        return {
          slug: sub.slug,
          title: sub.title,
          sections: fullSub?.sections?.map(sec => ({
            title: sec.title,
            lessons: sec.lessons?.map(l => ({
              id: l.id,
              title: l.title,
            })) || [],
          })) || [],
        };
      }).filter(s => s.sections.length > 0);
      if (subjects.length === 0) return null;
      return { slug: sw.slug, name: sw.name, subjects };
    }).filter(Boolean);
  })();

  // Lesson IDs are now globally unique: softwareSlug/subjectSlug/lessonId
  const allLessonIds = lessonTree.flatMap(sw =>
    sw.subjects.flatMap(sub =>
      sub.sections.flatMap(sec => sec.lessons.map(l => `${sw.slug}/${sub.slug}/${l.id}`))
    )
  );

  // ── Toggle helpers ─────────────────────────────────────────────────────────
  const [expandedSoftware, setExpandedSoftware] = useState({});
  const toggleSoftwareExpand = (slug) => setExpandedSoftware(p => ({ ...p, [slug]: !p[slug] }));
  const toggleSubject = (slug) => setExpandedSubjects(p => ({ ...p, [slug]: !p[slug] }));
  const toggleSection = (key) => setExpandedSections(p => ({ ...p, [key]: !p[key] }));

  const toggleLesson = (id) => {
    setSelectedLessons(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelectedLessons(new Set(allLessonIds));
  const deselectAll = () => setSelectedLessons(new Set());

  // ── Build queue ────────────────────────────────────────────────────────────
  const startValidation = useCallback(() => {
    if (!softwareList || softwareList.length === 0) return;

    const items = [];

    for (const sw of softwareList) {
      const swCached = softwareCacheRef.current[sw.slug];
      if (!swCached?.subjects) continue;

      for (const sub of swCached.subjects) {
        const fullSub = subjectCacheRef.current[`${sw.slug}/${sub.slug}`];
        if (!fullSub?.sections) continue;

        for (const sec of fullSub.sections) {
          if (!sec.lessons) continue;
          for (const lesson of sec.lessons) {
            const lessonKey = `${sw.slug}/${sub.slug}/${lesson.id}`;
            if (scope === 'targeted' && !selectedLessons.has(lessonKey)) continue;

            items.push({
              id: lessonKey,
              softwareSlug: sw.slug,
              subjectSlug: sub.slug,
              subjectTitle: sub.title,
              sectionTitle: sec.title,
              lessonId: lesson.id,
              lessonTitle: lesson.title,
              status: 'queued',
            });
          }
        }
      }
    }

    if (items.length === 0) return;

    // Cancel any in-progress validation
    if (abortRef.current) abortRef.current.abort();

    setValidationQueue(items);
    setAuditResults([]);
    setSelectedAuditId(null);
    setIsProcessing(true);
    processingRef.current = true;
    setPhase('results');
  }, [softwareList, scope, selectedLessons, softwareCacheRef, subjectCacheRef]);

  // ── Process queue ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isProcessing) return;

    const next = validationQueue.find(q => q.status === 'queued');
    const hasActive = validationQueue.some(q => q.status === 'in-progress');
    if (!next || hasActive) {
      // Queue finished
      if (!next && !hasActive) {
        setIsProcessing(false);
        processingRef.current = false;
      }
      return;
    }

    // Mark next as in-progress
    setValidationQueue(prev => prev.map(q =>
      q.id === next.id ? { ...q, status: 'in-progress' } : q
    ));

    const controller = new AbortController();
    abortRef.current = controller;

    (async () => {
      try {
        // Get lesson content
        const cacheKey = `${next.softwareSlug}/${next.subjectSlug}`;
        let fullSub = subjectCacheRef.current[cacheKey];
        if (!fullSub) {
          fullSub = await otterFetch(`/api/software/${next.softwareSlug}/subjects/${next.subjectSlug}`).then(r => r.json());
          subjectCacheRef.current[cacheKey] = fullSub;
        }

        let lesson = null;
        for (const sec of fullSub.sections || []) {
          const found = sec.lessons?.find(l => l.id === next.lessonId);
          if (found) { lesson = found; break; }
        }

        if (!lesson) throw new Error('Lesson not found');

        const userMessage = `Validate the following lesson:\n\nTitle: ${lesson.title}\n\nContent:\n${lesson.content}\n\nKey Takeaways:\n${(lesson.key_takeaways || []).map((t, i) => `${i + 1}. ${t}`).join('\n')}\n\nPractice Prompt:\n${lesson.practice_prompt || 'N/A'}`;

        const responseText = await callValidatorAPI({
          systemPrompt: VALIDATION_PROMPT,
          messages: [{ role: 'user', content: userMessage }],
          tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
          signal: controller.signal,
        });

        const parsed = parseJSONResponse(responseText);

        const result = {
          id: next.id,
          lessonTitle: next.lessonTitle,
          subjectTitle: next.subjectTitle,
          sectionTitle: next.sectionTitle,
          softwareSlug: next.softwareSlug,
          subjectSlug: next.subjectSlug,
          lessonId: next.lessonId,
          grade: parsed.grade || 'C',
          accuracyPct: parsed.accuracyPct ?? 50,
          summary: parsed.summary || 'No summary provided.',
          findings: parsed.findings || [],
          fixes: null,
        };

        setAuditResults(prev => {
          const filtered = prev.filter(r => r.id !== result.id);
          return [...filtered, result];
        });

        setValidationQueue(prev => prev.map(q =>
          q.id === next.id ? { ...q, status: 'completed' } : q
        ));
      } catch (err) {
        if (err.name === 'AbortError') return;
        // S30: keep the REASON. A red dot with the message in the console is
        // the same defect as the green tick over a failed save — the screen
        // shows a state and withholds the only thing that explains it. Audrey
        // hit this on her first real audit: three lessons validated, one went
        // red, and nothing on the page said why.
        console.error('Validation error:', err);
        setValidationQueue(prev => prev.map(q =>
          q.id === next.id
            ? { ...q, status: 'failed', error: err?.message || 'Validation failed.' }
            : q
        ));
      }
    })();

    return () => {
      // Don't abort on cleanup — let background processing continue
    };
  }, [validationQueue, isProcessing, subjectCacheRef]);

  // ── Stop validation ────────────────────────────────────────────────────────
  const stopValidation = () => {
    if (abortRef.current) abortRef.current.abort();
    setIsProcessing(false);
    processingRef.current = false;
    setValidationQueue(prev => prev.map(q =>
      q.status === 'queued' || q.status === 'in-progress'
        ? { ...q, status: 'failed', error: 'Stopped before this lesson finished.' }
        : q
    ));
  };

  // ── Request fixes ──────────────────────────────────────────────────────────
  const requestFixes = useCallback(async () => {
    if (!selectedAudit) return;

    const inaccurate = selectedAudit.findings.filter(f => f.verdict === 'inaccurate');
    if (inaccurate.length === 0) return;

    setFixLoading(true);
    // Only THIS audit's outcomes are cleared. Wiping the whole map would
    // re-introduce the cross-audit bleed from the other direction.
    setFixState(prev => ({ ...prev, [selectedAudit.id]: {} }));

    try {
      const cacheKey = `${selectedAudit.softwareSlug}/${selectedAudit.subjectSlug}`;
      let fullSub = subjectCacheRef.current[cacheKey];
      if (!fullSub) {
        fullSub = await otterFetch(`/api/software/${selectedAudit.softwareSlug}/subjects/${selectedAudit.subjectSlug}`).then(r => r.json());
        subjectCacheRef.current[cacheKey] = fullSub;
      }

      let lesson = null;
      for (const sec of fullSub.sections || []) {
        const found = sec.lessons?.find(l => l.id === selectedAudit.lessonId);
        if (found) { lesson = found; break; }
      }
      if (!lesson) throw new Error('Lesson not found');

      const userMessage = `Here is the lesson content:\n\n${lesson.content}\n\nHere are the inaccurate findings that need to be fixed:\n\n${JSON.stringify(inaccurate, null, 2)}`;

      const responseText = await callValidatorAPI({
        systemPrompt: FIX_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
      });

      const parsed = parseJSONResponse(responseText);

      setAuditResults(prev => prev.map(a =>
        a.id === selectedAudit.id ? { ...a, fixes: parsed.fixes || [] } : a
      ));
    } catch (err) {
      console.error('Fix generation error:', err);
    } finally {
      setFixLoading(false);
    }
  }, [selectedAudit, subjectCacheRef]);

  // ── Apply a single fix ─────────────────────────────────────────────────────
  //
  // 🚨 THE DEFECT THIS SESSION EXISTS TO FIX. Every failure path below used to
  // end in a bare `return` or a console.error, and the ONLY path that reported
  // anything to the user was the success one — which ran whether or not the
  // save had happened. `otterFetch` resolves for every HTTP status (it is
  // fetch's contract, and in cloud mode it manufactures the Response itself,
  // adapters/index.js:127), so `await otterFetch(...)` succeeded on a 404 and on
  // a 403 alike and the fix was ticked green. Against Local Server, where all
  // of Audrey's courses live, there was no PUT route at all — so EVERY accepted
  // fix 404ed and every one of them displayed as applied.
  //
  // The same trap is already recorded one file away, about a different write:
  // supabaseOtterAdapter.js:253-255, "because no O.T.T.E.R. call site checks
  // res.ok the UI would have reported every generated subject as saved while
  // nothing at all was written."
  //
  // Returns true only when the corrected lesson is actually stored, so
  // acceptAllFixes can stop instead of stacking identical refusals.
  const applyFix = useCallback(async (fix, fixIndex) => {
    if (!selectedAudit) return false;
    const auditId = selectedAudit.id;
    const fail = (error) => {
      setFixOutcome(auditId, fixIndex, { status: 'failed', error });
      return false;
    };

    const cacheKey = `${selectedAudit.softwareSlug}/${selectedAudit.subjectSlug}`;
    const fullSub = subjectCacheRef.current[cacheKey];
    if (!fullSub) {
      return fail('This lesson is no longer loaded. Reopen the audit and try again.');
    }

    // Deep clone the subject
    const updated = JSON.parse(JSON.stringify(fullSub));
    let applied = false;

    for (const sec of updated.sections || []) {
      const lesson = sec.lessons?.find(l => l.id === selectedAudit.lessonId);
      if (lesson && lesson.content.includes(fix.original)) {
        lesson.content = lesson.content.replace(fix.original, fix.proposed);
        applied = true;
        break;
      }
    }

    if (!applied) {
      return fail('The original wording is no longer in this lesson — it may have been edited, or this fix may already have been applied.');
    }

    let res;
    try {
      res = await otterFetch(`/api/software/${selectedAudit.softwareSlug}/subjects/${selectedAudit.subjectSlug}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      });
    } catch (err) {
      return fail(err?.message || 'The correction could not be sent.');
    }

    if (!res.ok) {
      // Both backends answer JSON on refusal — cloud through otterFetch's error
      // shape, local through the Express handlers — but a bare 404 from Express
      // is HTML, so the parse has to be allowed to fail.
      const detail = await res.json().then(b => b?.error).catch(() => null);
      return fail(detail || `The correction was refused (HTTP ${res.status}) and has NOT been saved.`);
    }

    subjectCacheRef.current[cacheKey] = updated;
    setFixOutcome(auditId, fixIndex, { status: 'accepted' });
    return true;
  }, [selectedAudit, subjectCacheRef, setFixOutcome]);

  // ── Accept all fixes ───────────────────────────────────────────────────────
  const acceptAllFixes = useCallback(async () => {
    if (!selectedAudit?.fixes) return;
    const current = fixState[selectedAudit.id] ?? {};

    for (let i = 0; i < selectedAudit.fixes.length; i++) {
      const status = current[i]?.status;
      if (status === 'accepted' || status === 'declined') continue;
      const saved = await applyFix(selectedAudit.fixes[i], i);
      // Stop at the first refusal. Every fix here writes the SAME subject
      // through the same route, so whatever refused one refuses all of them;
      // carrying on would stack identical errors and spend the round trips to
      // earn them.
      if (!saved) break;
    }
  }, [selectedAudit, fixState, applyFix]);


  // ══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════════════════════════════════

  const queuedCount = validationQueue.filter(q => q.status === 'queued').length;
  const activeItem = validationQueue.find(q => q.status === 'in-progress');
  const completedQueue = validationQueue.filter(q => q.status === 'completed' || q.status === 'failed');
  const inaccurateCount = selectedAudit?.findings?.filter(f => f.verdict === 'inaccurate').length || 0;
  // 'failed' deliberately counts as UNHANDLED, so "Accept All Fixes" stays
  // available to retry a refusal once the cause is dealt with.
  const hasUnhandledFixes = selectedAudit?.fixes?.some((_, i) => {
    const status = auditFixState[i]?.status;
    return status !== 'accepted' && status !== 'declined';
  });

  // ── Toggle lessons by group (software / subject / section) ───────────────
  const toggleSoftwareLessons = (sw) => {
    const ids = sw.subjects.flatMap(sub =>
      sub.sections.flatMap(sec => sec.lessons.map(l => `${sw.slug}/${sub.slug}/${l.id}`))
    );
    const allSelected = ids.every(id => selectedLessons.has(id));
    setSelectedLessons(prev => {
      const next = new Set(prev);
      ids.forEach(id => allSelected ? next.delete(id) : next.add(id));
      return next;
    });
  };

  const toggleSubjectLessons = (sw, sub) => {
    const ids = sub.sections.flatMap(sec => sec.lessons.map(l => `${sw.slug}/${sub.slug}/${l.id}`));
    const allSelected = ids.every(id => selectedLessons.has(id));
    setSelectedLessons(prev => {
      const next = new Set(prev);
      ids.forEach(id => allSelected ? next.delete(id) : next.add(id));
      return next;
    });
  };

  const toggleSectionLessons = (sw, sub, sec) => {
    const ids = sec.lessons.map(l => `${sw.slug}/${sub.slug}/${l.id}`);
    const allSelected = ids.every(id => selectedLessons.has(id));
    setSelectedLessons(prev => {
      const next = new Set(prev);
      ids.forEach(id => allSelected ? next.delete(id) : next.add(id));
      return next;
    });
  };

  // ══════════════════════════════════════════════════════════════════════════
  // PHASE: SETUP — full-page lesson picker
  // ══════════════════════════════════════════════════════════════════════════
  if (phase === 'setup') {
    const cannotStart = allLessonIds.length === 0 || (scope === 'targeted' && selectedLessons.size === 0);
    return (
      <div className="otter-val">
        {/* Header: the view title every O.T.T.E.R. view wears (A3's
            SectionTitle), held above the tree as the bar was. */}
        <div className="otter-val-head">
          <SectionTitle
            rule={false}
            className="otter-view-title"
            description={scope === 'targeted' ? 'Select lessons to validate' : 'Validate all lessons across all software'}
            actions={(
              <>
                {loadingSubjects && (
                  <span className="otter-val-loading">
                    <Loader2 className="otter-val-spin animate-spin" aria-hidden="true" /> Loading lessons...
                  </span>
                )}
                <Select
                  value={scope}
                  onChange={(v) => setScope(v)}
                  options={[{ value: 'full', label: 'Full validation' }, { value: 'targeted', label: 'Targeted validation' }]}
                  aria-label="Validation scope"
                  className="otter-val-scope"
                />
                <Button variant="primary" icon={Play} onClick={startValidation} disabled={cannotStart}>
                  {scope === 'full' ? `Validate all (${allLessonIds.length})` : `Validate selected (${selectedLessons.size})`}
                </Button>
              </>
            )}
          >
            Lesson validator
          </SectionTitle>
        </div>

        {/* Lesson tree — full page */}
        {scope === 'targeted' ? (
          <div className="otter-val-body wilson-dark-scroll">
            {/* Bulk actions */}
            <div className="otter-val-bulk">
              <span className="otter-val-count">
                {selectedLessons.size} of {allLessonIds.length} lesson{allLessonIds.length !== 1 ? 's' : ''} selected
              </span>
              <Button size="sm" onClick={selectAll}>Select all</Button>
              <Button size="sm" onClick={deselectAll}>Deselect all</Button>
            </div>

            {lessonTree.length === 0 ? (
              <EmptyState icon={Search} title={loadingSubjects ? 'Loading lessons...' : 'No lessons found'} />
            ) : (
              <div className="otter-val-courses">
                {lessonTree.map(sw => {
                  const swLessonIds = sw.subjects.flatMap(sub =>
                    sub.sections.flatMap(sec => sec.lessons.map(l => `${sw.slug}/${sub.slug}/${l.id}`))
                  );
                  const swAllSelected = swLessonIds.length > 0 && swLessonIds.every(id => selectedLessons.has(id));
                  const swSomeSelected = swLessonIds.some(id => selectedLessons.has(id));

                  return (
                    <Card key={sw.slug} pad={false} className="otter-val-course">
                      {/* Software header */}
                      <div className="otter-val-row" data-level="course">
                        <input
                          type="checkbox"
                          checked={swAllSelected}
                          ref={el => { if (el) el.indeterminate = swSomeSelected && !swAllSelected; }}
                          onChange={() => toggleSoftwareLessons(sw)}
                          aria-label={`Every lesson in ${sw.name}`}
                          className="otter-check"
                        />
                        <button
                          type="button"
                          onClick={() => toggleSoftwareExpand(sw.slug)}
                          aria-expanded={!!expandedSoftware[sw.slug]}
                          className="otter-val-toggle"
                        >
                          {expandedSoftware[sw.slug] ? <ChevronDown className="otter-val-chevron" aria-hidden="true" /> : <ChevronRight className="otter-val-chevron" aria-hidden="true" />}
                          <span className="otter-val-name">{sw.name}</span>
                          <span className="otter-val-num">({swLessonIds.length} lessons)</span>
                        </button>
                      </div>

                      {/* Subjects within this software */}
                      {expandedSoftware[sw.slug] && sw.subjects.map(sub => {
                        const subKey = `${sw.slug}/${sub.slug}`;
                        const subLessonIds = sub.sections.flatMap(sec => sec.lessons.map(l => `${sw.slug}/${sub.slug}/${l.id}`));
                        const subAllSelected = subLessonIds.length > 0 && subLessonIds.every(id => selectedLessons.has(id));
                        const subSomeSelected = subLessonIds.some(id => selectedLessons.has(id));

                        return (
                          <div key={subKey}>
                            {/* Subject header */}
                            <div className="otter-val-row" data-level="subject">
                              <input
                                type="checkbox"
                                checked={subAllSelected}
                                ref={el => { if (el) el.indeterminate = subSomeSelected && !subAllSelected; }}
                                onChange={() => toggleSubjectLessons(sw, sub)}
                                aria-label={`Every lesson in ${sub.title}`}
                                className="otter-check"
                              />
                              <button
                                type="button"
                                onClick={() => toggleSubject(subKey)}
                                aria-expanded={!!expandedSubjects[subKey]}
                                className="otter-val-toggle"
                              >
                                {expandedSubjects[subKey] ? <ChevronDown className="otter-val-chevron" aria-hidden="true" /> : <ChevronRight className="otter-val-chevron" aria-hidden="true" />}
                                <span className="otter-val-name">{sub.title}</span>
                                <span className="otter-val-num">({subLessonIds.length})</span>
                              </button>
                            </div>

                            {/* Sections & lessons */}
                            {expandedSubjects[subKey] && sub.sections.map((sec, si) => {
                              const secKey = `${sw.slug}/${sub.slug}/${si}`;
                              const secLessonIds = sec.lessons.map(l => `${sw.slug}/${sub.slug}/${l.id}`);
                              const secAllSelected = secLessonIds.length > 0 && secLessonIds.every(id => selectedLessons.has(id));
                              const secSomeSelected = secLessonIds.some(id => selectedLessons.has(id));

                              return (
                                <div key={secKey}>
                                  <div className="otter-val-row" data-level="section">
                                    <input
                                      type="checkbox"
                                      checked={secAllSelected}
                                      ref={el => { if (el) el.indeterminate = secSomeSelected && !secAllSelected; }}
                                      onChange={() => toggleSectionLessons(sw, sub, sec)}
                                      aria-label={`Every lesson in ${sec.title}`}
                                      className="otter-check"
                                    />
                                    <button
                                      type="button"
                                      onClick={() => toggleSection(secKey)}
                                      aria-expanded={!!expandedSections[secKey]}
                                      className="otter-val-toggle"
                                    >
                                      {expandedSections[secKey] ? <ChevronDown className="otter-val-chevron" aria-hidden="true" /> : <ChevronRight className="otter-val-chevron" aria-hidden="true" />}
                                      <span className="otter-val-name">{sec.title}</span>
                                      <span className="otter-val-num">({sec.lessons.length})</span>
                                    </button>
                                  </div>

                                  {expandedSections[secKey] && (
                                    <div className="otter-val-lessons">
                                      {sec.lessons.map(l => {
                                        const lid = `${sw.slug}/${sub.slug}/${l.id}`;
                                        return (
                                          <label
                                            key={lid}
                                            className="otter-val-row"
                                            data-level="lesson"
                                            data-selected={selectedLessons.has(lid)}
                                          >
                                            <input
                                              type="checkbox"
                                              checked={selectedLessons.has(lid)}
                                              onChange={() => toggleLesson(lid)}
                                              className="otter-check"
                                            />
                                            <span className="otter-val-name">{l.title}</span>
                                          </label>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        );
                      })}
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          /* Full validation — show summary */
          <div className="otter-val-summary">
            <div className="otter-val-summary-inner">
              <div className="otter-val-total">{allLessonIds.length}</div>
              <p className="otter-val-summary-line">
                lessons across {lessonTree.reduce((n, sw) => n + sw.subjects.length, 0)} subject{lessonTree.reduce((n, sw) => n + sw.subjects.length, 0) !== 1 ? 's' : ''} will be validated
              </p>
              <p className="otter-val-summary-hint">Switch to &quot;Targeted validation&quot; to pick specific lessons</p>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PHASE: RESULTS — sidebar + detail panel
  // ══════════════════════════════════════════════════════════════════════════
  return (
    <div className="otter-val-results">

      {/* ── LEFT SIDEBAR — the kit's Panel (lg, 300; it was 290) ── */}
      <Panel width="lg" side="left" className="otter-val-side">

        {/* Back to setup + controls */}
        <Toolbar
          className="otter-val-controls"
          right={isProcessing ? <IconButton size="sm" icon={Square} danger title="Stop validation" onClick={stopValidation} /> : null}
        >
          <Button variant="ghost" size="sm" icon={ArrowLeft} onClick={() => { if (!isProcessing) setPhase('setup'); }} disabled={isProcessing} className="otter-val-new">
            New validation
          </Button>
        </Toolbar>

        {/* Validation Queue */}
        {validationQueue.length > 0 && (
          <div className="otter-val-queue wilson-dark-scroll">
            <div className="otter-val-section-head">
              Queue {queuedCount > 0 && `(${queuedCount} remaining)`}
            </div>
            {validationQueue.map(item => (
              <div key={item.id} className="otter-val-queue-row" data-status={item.status}>
                <div className="otter-val-queue-line">
                  {item.status === 'queued' && <StatusDot tone="neutral" label="Queued" />}
                  {item.status === 'in-progress' && <Loader2 className="otter-val-status-icon animate-spin" role="img" aria-label="Validating" />}
                  {item.status === 'completed' && <Check className="otter-val-status-icon" role="img" aria-label="Done" />}
                  {item.status === 'failed' && <AlertCircle className="otter-val-status-icon" role="img" aria-label="Failed" />}
                  <span className="otter-val-queue-title">{item.lessonTitle}</span>
                </div>
                {/* S30: the reason, on the row that failed. It used to go to
                    the console only, so a red dot was the whole explanation. */}
                {item.status === 'failed' && item.error && (
                  <div className="otter-val-queue-error">{item.error}</div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Completed Audits */}
        <div className="otter-val-audits wilson-dark-scroll">
          <div className="otter-val-section-head">Completed audits ({auditResults.length})</div>
          {auditResults.length === 0 ? (
            <p className="otter-val-audits-empty">Audits will appear here as they complete</p>
          ) : (
            auditResults.map(audit => (
              // Selecting an audit no longer resets the accepted/declined
              // state: fixState is keyed by audit id, so switching lessons
              // keeps what you already decided rather than throwing it away.
              <button
                key={audit.id}
                type="button"
                onClick={() => setSelectedAuditId(audit.id)}
                className="otter-val-audit"
                data-active={selectedAuditId === audit.id}
              >
                <StatusBadge tone={gradeTone(audit.grade)} label={`Grade ${audit.grade}`}>{audit.grade}</StatusBadge>
                <span className="otter-val-audit-text">
                  <span className="otter-val-audit-title">{audit.lessonTitle}</span>
                  <span className="otter-val-audit-meta">{audit.accuracyPct}% accurate</span>
                </span>
              </button>
            ))
          )}
        </div>
      </Panel>

      {/* ── RIGHT DETAIL PANEL ── */}
      <div className="otter-val-detail wilson-dark-scroll">
        {!selectedAudit ? (
          <EmptyState icon={Search} title="Select an audit from the list to view details" />
        ) : (
          <div className="otter-val-page">

            {/* Header */}
            <div className="otter-val-audit-head">
              <div className="otter-val-crumb">
                {selectedAudit.softwareSlug} &rsaquo; {selectedAudit.subjectTitle} &rsaquo; {selectedAudit.sectionTitle}
              </div>
              <h2 className="otter-val-title">{selectedAudit.lessonTitle}</h2>
              <div className="otter-val-score">
                <StatusBadge tone={gradeTone(selectedAudit.grade)} label={`Grade ${selectedAudit.grade}`} />
                <div>
                  <div className="otter-val-accuracy">{selectedAudit.accuracyPct}% accurate</div>
                  <div className="otter-val-claims">
                    {selectedAudit.findings.filter(f => f.verdict === 'inaccurate').length} issue{selectedAudit.findings.filter(f => f.verdict === 'inaccurate').length !== 1 ? 's' : ''} found &middot; {selectedAudit.findings.length} claims checked
                  </div>
                </div>
              </div>
              <p className="otter-val-audit-summary">{selectedAudit.summary}</p>
            </div>

            {/* Findings */}
            <section className="otter-val-section">
              <h3 className="otter-val-h3">Findings</h3>
              <div className="otter-val-list">
                {selectedAudit.findings.map((finding, fi) => (
                  <FindingCard key={fi} finding={finding} />
                ))}
              </div>
            </section>

            {/* Fix section */}
            {inaccurateCount > 0 && (
              <section className="otter-val-section">
                <div className="otter-val-fix-head">
                  <h3 className="otter-val-h3">Fixes</h3>
                  {!selectedAudit.fixes && (
                    <Button variant="primary" size="sm" icon={RefreshCw} onClick={requestFixes} loading={fixLoading} loadingLabel="Generating fixes...">
                      Fix issues
                    </Button>
                  )}
                  {selectedAudit.fixes && hasUnhandledFixes && (
                    <Button variant="primary" size="sm" icon={Check} onClick={acceptAllFixes}>
                      Accept all fixes
                    </Button>
                  )}
                </div>

                {selectedAudit.fixes && (
                  <div className="otter-val-list">
                    {selectedAudit.fixes.map((fix, fi) => (
                      <FixCard
                        key={fi}
                        fix={fix}
                        index={fi}
                        outcome={auditFixState[fi]}
                        onAccept={() => applyFix(fix, fi)}
                        onDecline={() => setFixOutcome(selectedAudit.id, fi, { status: 'declined' })}
                      />
                    ))}
                  </div>
                )}
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Finding Card ─────────────────────────────────────────────────────────────
// A4: one neutral card; the verdict is the kit's StatusBadge and its icon, in
// the verdict's tone, and a wrong or unverifiable claim's card takes that
// tone on its edge (it was a red or yellow wash over the whole card).
function FindingCard({ finding }) {
  const [collapsed, setCollapsed] = useState(finding.verdict === 'accurate');

  return (
    <div className="otter-finding" data-verdict={finding.verdict}>
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        aria-expanded={!collapsed}
        className="otter-finding-head"
      >
        {verdictIcon(finding.verdict)}
        <span className="otter-finding-text">
          <span className="otter-finding-claim">{finding.claim}</span>
          {collapsed && (
            <span className="otter-finding-hint">Click to expand</span>
          )}
        </span>
        <StatusBadge tone={VERDICT_TONE[finding.verdict] || 'neutral'} label={finding.verdict} />
      </button>
      {!collapsed && (
        <div className="otter-finding-body">
          <p className="otter-finding-explanation">{finding.explanation}</p>
          {finding.source && finding.source !== 'N/A' && (
            <div className="otter-finding-source">
              Source: <span className="otter-finding-link">{finding.source}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}


// ── Fix Card ─────────────────────────────────────────────────────────────────
function FixCard({ fix, index, outcome, onAccept, onDecline }) {
  const accepted = outcome?.status === 'accepted';
  const declined = outcome?.status === 'declined';
  const failed   = outcome?.status === 'failed';

  if (accepted) {
    return (
      <Banner tone="success" icon={CheckCircle2} className="otter-fix-note">
        Fix #{index + 1} applied
      </Banner>
    );
  }

  if (declined) {
    // The third ink, not opacity 50% (§3.1).
    return (
      <div className="otter-fix-declined">
        <XCircle className="otter-fix-declined-icon" aria-hidden="true" />
        <span>Fix #{index + 1} declined</span>
      </div>
    );
  }

  return (
    <Card pad={false} className="otter-fix">
      <div className="otter-fix-head">
        <span className="otter-fix-name">Fix #{index + 1}</span>
        <span className="otter-fix-why">{fix.explanation}</span>
      </div>
      <div className="otter-fix-cols">
        {/* Current */}
        <div className="otter-fix-col">
          <div className="otter-fix-label">Current</div>
          <div className="otter-fix-text" data-side="current">{fix.original}</div>
        </div>
        {/* Proposed */}
        <div className="otter-fix-col">
          <div className="otter-fix-label">Proposed</div>
          <div className="otter-fix-text" data-side="proposed">{fix.proposed}</div>
        </div>
      </div>
      {/* Session 30: a refused save says so, here, next to the fix it refused.
          Before this the same click produced a green "Fix #n applied" whether
          the correction reached the course or not. */}
      {failed && (
        <Banner tone="danger" icon={AlertCircle} className="otter-fix-failed">
          <span className="otter-fix-failed-lead">Not saved.</span> {outcome.error}
        </Banner>
      )}
      <div className="otter-fix-foot">
        <Button size="sm" onClick={onDecline}>Decline fix</Button>
        <Button variant="primary" size="sm" onClick={onAccept}>{failed ? 'Try again' : 'Accept fix'}</Button>
      </div>
    </Card>
  );
}
