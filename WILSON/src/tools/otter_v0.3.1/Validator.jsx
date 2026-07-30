import { useState, useEffect, useRef, useCallback } from 'react';
import {
  ChevronDown, ChevronRight, Loader2, Check, AlertCircle,
  CheckCircle2, XCircle, HelpCircle, Search, Play, Square,
  ArrowRight, RefreshCw
} from 'lucide-react';
import { VALIDATION_PROMPT, FIX_PROMPT } from './validatorPrompts.js';
// Session 10: content routes go through the adapter seam (see adapters/index.js).
import { otterFetch } from './adapters';
// Session 12 (locked #21): Anthropic access rides the ai-proxy Edge Function.
import { callAI } from '../../cloud/aiProxy';

// ── API helper (model-agnostic) ──────────────────────────────────────────────
async function callValidatorAPI({ model, systemPrompt, messages, tools, signal }) {
  const body = {
    model: model || 'claude-sonnet-4-20250514',
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

  // If stop_reason is 'tool_use', we need to continue the conversation
  // so the model can use web search results and produce a final answer
  if (data.stop_reason === 'tool_use') {
    // Collect all tool_use blocks and create tool_result messages
    const toolUses = data.content.filter(b => b.type === 'tool_use');
    // For server-side tools like web_search, the results are handled automatically
    // We need to send another request with the assistant's response to continue
    const continuedMessages = [
      ...messages,
      { role: 'assistant', content: data.content },
    ];

    // Recurse to get the final text response
    return callValidatorAPI({
      model, systemPrompt,
      messages: continuedMessages,
      tools, signal,
    });
  }

  throw new Error('No text response from API');
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

// ── Grade colors ─────────────────────────────────────────────────────────────
function gradeColor(grade) {
  switch (grade) {
    case 'A': return { bg: 'bg-green-600', text: 'text-green-400', border: 'border-green-500' };
    case 'B': return { bg: 'bg-blue-600', text: 'text-blue-400', border: 'border-blue-500' };
    case 'C': return { bg: 'bg-orange-600', text: 'text-orange-400', border: 'border-orange-500' };
    case 'D': return { bg: 'bg-red-600', text: 'text-red-400', border: 'border-red-500' };
    case 'F': return { bg: 'bg-red-700', text: 'text-red-400', border: 'border-red-500' };
    default: return { bg: 'bg-stone-600', text: 'text-stone-400', border: 'border-stone-500' };
  }
}

function verdictIcon(verdict) {
  switch (verdict) {
    case 'accurate': return <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0" />;
    case 'inaccurate': return <XCircle className="w-4 h-4 text-red-400 shrink-0" />;
    case 'unverifiable': return <HelpCircle className="w-4 h-4 text-yellow-400 shrink-0" />;
    default: return null;
  }
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
  const [acceptedFixes, setAcceptedFixes] = useState(new Set());
  const [declinedFixes, setDeclinedFixes] = useState(new Set());

  // ── Refs ────────────────────────────────────────────────────────────────────
  const abortRef = useRef(null);
  const processingRef = useRef(false);

  // ── Force re-render after fetching subjects into cache ─────────────────────
  const [cacheVersion, setCacheVersion] = useState(0);

  const selectedAudit = auditResults.find(a => a.id === selectedAuditId) || null;

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
        console.error('Validation error:', err);
        setValidationQueue(prev => prev.map(q =>
          q.id === next.id ? { ...q, status: 'failed' } : q
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
      q.status === 'queued' || q.status === 'in-progress' ? { ...q, status: 'failed' } : q
    ));
  };

  // ── Request fixes ──────────────────────────────────────────────────────────
  const requestFixes = useCallback(async () => {
    if (!selectedAudit) return;

    const inaccurate = selectedAudit.findings.filter(f => f.verdict === 'inaccurate');
    if (inaccurate.length === 0) return;

    setFixLoading(true);
    setAcceptedFixes(new Set());
    setDeclinedFixes(new Set());

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
  const applyFix = useCallback(async (fix, fixIndex) => {
    if (!selectedAudit) return;

    const cacheKey = `${selectedAudit.softwareSlug}/${selectedAudit.subjectSlug}`;
    let fullSub = subjectCacheRef.current[cacheKey];
    if (!fullSub) return;

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
      console.warn('Could not find original text to replace');
      return;
    }

    try {
      await otterFetch(`/api/software/${selectedAudit.softwareSlug}/subjects/${selectedAudit.subjectSlug}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      });
      subjectCacheRef.current[cacheKey] = updated;
      setAcceptedFixes(prev => new Set([...prev, fixIndex]));
    } catch (err) {
      console.error('Failed to apply fix:', err);
    }
  }, [selectedAudit, subjectCacheRef]);

  // ── Accept all fixes ───────────────────────────────────────────────────────
  const acceptAllFixes = useCallback(async () => {
    if (!selectedAudit?.fixes) return;

    for (let i = 0; i < selectedAudit.fixes.length; i++) {
      if (acceptedFixes.has(i) || declinedFixes.has(i)) continue;
      await applyFix(selectedAudit.fixes[i], i);
    }
  }, [selectedAudit, acceptedFixes, declinedFixes, applyFix]);


  // ══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════════════════════════════════

  const queuedCount = validationQueue.filter(q => q.status === 'queued').length;
  const activeItem = validationQueue.find(q => q.status === 'in-progress');
  const completedQueue = validationQueue.filter(q => q.status === 'completed' || q.status === 'failed');
  const inaccurateCount = selectedAudit?.findings?.filter(f => f.verdict === 'inaccurate').length || 0;
  const hasUnhandledFixes = selectedAudit?.fixes?.some((_, i) => !acceptedFixes.has(i) && !declinedFixes.has(i));

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
    return (
      <div className="flex flex-col h-full bg-stone-900">
        {/* Header bar */}
        <div className="shrink-0 px-6 py-4 border-b-2 border-stone-600 bg-stone-800 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-stone-200">Lesson Validator</h2>
            <p className="text-xs text-stone-500 mt-0.5">
              {scope === 'targeted' ? 'Select lessons to validate' : 'Validate all lessons across all software'}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {loadingSubjects && (
              <span className="flex items-center gap-1.5 text-xs text-stone-500">
                <Loader2 className="w-3 h-3 animate-spin" /> Loading lessons...
              </span>
            )}
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              className="bg-stone-700 text-stone-200 text-sm border border-stone-600 rounded-sm px-3 py-1.5 focus:outline-none focus:border-orange-500"
            >
              <option value="full">Full Validation</option>
              <option value="targeted">Targeted Validation</option>
            </select>
            <button
              onClick={startValidation}
              disabled={allLessonIds.length === 0 || (scope === 'targeted' && selectedLessons.size === 0)}
              className={`flex items-center gap-1.5 px-4 py-1.5 text-sm font-bold rounded-sm transition-colors ${
                allLessonIds.length === 0 || (scope === 'targeted' && selectedLessons.size === 0)
                  ? 'bg-stone-700 text-stone-500 cursor-not-allowed'
                  : 'bg-orange-600 text-white hover:bg-orange-500'
              }`}
            >
              <Play className="w-3.5 h-3.5" />
              {scope === 'full' ? `Validate All (${allLessonIds.length})` : `Validate Selected (${selectedLessons.size})`}
            </button>
          </div>
        </div>

        {/* Lesson tree — full page */}
        {scope === 'targeted' ? (
          <div className="flex-1 overflow-y-auto p-6">
            {/* Bulk actions */}
            <div className="flex items-center gap-3 mb-4">
              <span className="text-sm text-stone-400">
                {selectedLessons.size} of {allLessonIds.length} lesson{allLessonIds.length !== 1 ? 's' : ''} selected
              </span>
              <button onClick={selectAll} className="text-xs font-bold text-orange-400 hover:text-orange-300 px-2 py-1 bg-stone-800 rounded-sm border border-stone-700">Select All</button>
              <button onClick={deselectAll} className="text-xs font-bold text-stone-400 hover:text-stone-300 px-2 py-1 bg-stone-800 rounded-sm border border-stone-700">Deselect All</button>
            </div>

            {lessonTree.length === 0 ? (
              <div className="text-center py-16">
                <Search className="w-10 h-10 text-stone-600 mx-auto mb-3" />
                <p className="text-stone-500 text-sm">
                  {loadingSubjects ? 'Loading lessons...' : 'No lessons found'}
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {lessonTree.map(sw => {
                  const swLessonIds = sw.subjects.flatMap(sub =>
                    sub.sections.flatMap(sec => sec.lessons.map(l => `${sw.slug}/${sub.slug}/${l.id}`))
                  );
                  const swAllSelected = swLessonIds.length > 0 && swLessonIds.every(id => selectedLessons.has(id));
                  const swSomeSelected = swLessonIds.some(id => selectedLessons.has(id));

                  return (
                    <div key={sw.slug} className="border-2 border-stone-600 rounded-sm overflow-hidden">
                      {/* Software header */}
                      <div className="flex items-center gap-2 px-4 py-2.5 bg-stone-700 border-b-2 border-stone-600">
                        <input
                          type="checkbox"
                          checked={swAllSelected}
                          ref={el => { if (el) el.indeterminate = swSomeSelected && !swAllSelected; }}
                          onChange={() => toggleSoftwareLessons(sw)}
                          className="accent-orange-500 w-4 h-4"
                        />
                        <button
                          onClick={() => toggleSoftwareExpand(sw.slug)}
                          className="flex items-center gap-1.5 flex-1 min-w-0"
                        >
                          {expandedSoftware[sw.slug] ? <ChevronDown className="w-4 h-4 text-orange-400" /> : <ChevronRight className="w-4 h-4 text-orange-400" />}
                          <span className="text-sm font-bold text-stone-100 truncate">{sw.name}</span>
                          <span className="text-xs text-stone-400 ml-1">({swLessonIds.length} lessons)</span>
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
                            <div className="flex items-center gap-2 px-4 py-2 pl-8 bg-stone-800 border-b border-stone-700">
                              <input
                                type="checkbox"
                                checked={subAllSelected}
                                ref={el => { if (el) el.indeterminate = subSomeSelected && !subAllSelected; }}
                                onChange={() => toggleSubjectLessons(sw, sub)}
                                className="accent-orange-500 w-3.5 h-3.5"
                              />
                              <button
                                onClick={() => toggleSubject(subKey)}
                                className="flex items-center gap-1.5 flex-1 min-w-0"
                              >
                                {expandedSubjects[subKey] ? <ChevronDown className="w-3.5 h-3.5 text-stone-400" /> : <ChevronRight className="w-3.5 h-3.5 text-stone-400" />}
                                <span className="text-sm font-medium text-stone-200 truncate">{sub.title}</span>
                                <span className="text-xs text-stone-500 ml-1">({subLessonIds.length})</span>
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
                                  <div className="flex items-center gap-2 px-4 py-1.5 pl-14 bg-stone-800/30 border-b border-stone-700/50">
                                    <input
                                      type="checkbox"
                                      checked={secAllSelected}
                                      ref={el => { if (el) el.indeterminate = secSomeSelected && !secAllSelected; }}
                                      onChange={() => toggleSectionLessons(sw, sub, sec)}
                                      className="accent-orange-500 w-3.5 h-3.5"
                                    />
                                    <button
                                      onClick={() => toggleSection(secKey)}
                                      className="flex items-center gap-1 flex-1 min-w-0"
                                    >
                                      {expandedSections[secKey] ? <ChevronDown className="w-3 h-3 text-stone-500" /> : <ChevronRight className="w-3 h-3 text-stone-500" />}
                                      <span className="text-xs font-medium text-stone-300 truncate">{sec.title}</span>
                                      <span className="text-xs text-stone-600 ml-1">({sec.lessons.length})</span>
                                    </button>
                                  </div>

                                  {expandedSections[secKey] && (
                                    <div className="border-b border-stone-700/50">
                                      {sec.lessons.map(l => {
                                        const lid = `${sw.slug}/${sub.slug}/${l.id}`;
                                        return (
                                          <label
                                            key={lid}
                                            className={`flex items-center gap-2.5 px-4 py-2 pl-20 cursor-pointer transition-colors ${
                                              selectedLessons.has(lid) ? 'bg-orange-600/5' : 'hover:bg-stone-800'
                                            }`}
                                          >
                                            <input
                                              type="checkbox"
                                              checked={selectedLessons.has(lid)}
                                              onChange={() => toggleLesson(lid)}
                                              className="accent-orange-500 w-3.5 h-3.5"
                                            />
                                            <span className="text-sm text-stone-300">{l.title}</span>
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
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          /* Full validation — show summary */
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center max-w-md">
              <div className="text-5xl font-bold text-stone-600 mb-2">{allLessonIds.length}</div>
              <p className="text-stone-400 text-sm mb-1">
                lessons across {lessonTree.reduce((n, sw) => n + sw.subjects.length, 0)} subject{lessonTree.reduce((n, sw) => n + sw.subjects.length, 0) !== 1 ? 's' : ''} will be validated
              </p>
              <p className="text-stone-500 text-xs">Switch to "Targeted Validation" to pick specific lessons</p>
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
    <div className="flex h-full">

      {/* ── LEFT SIDEBAR ── */}
      <div className="w-[290px] shrink-0 border-r-2 border-stone-600 bg-stone-800 flex flex-col overflow-hidden">

        {/* Back to setup + controls */}
        <div className="p-3 border-b border-stone-700 flex items-center gap-2">
          <button
            onClick={() => { if (!isProcessing) setPhase('setup'); }}
            disabled={isProcessing}
            className={`flex items-center gap-1 text-xs font-bold transition-colors ${
              isProcessing ? 'text-stone-600 cursor-not-allowed' : 'text-orange-400 hover:text-orange-300'
            }`}
          >
            <ArrowRight className="w-3 h-3 rotate-180" /> New Validation
          </button>
          <div className="ml-auto flex gap-1.5">
            {isProcessing && (
              <button
                onClick={stopValidation}
                className="px-2 py-1 bg-red-700 text-white text-xs font-bold rounded-sm hover:bg-red-600 transition-colors"
                title="Stop validation"
              >
                <Square className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>

        {/* Validation Queue */}
        {validationQueue.length > 0 && (
          <div className="border-b border-stone-700 max-h-[200px] overflow-y-auto">
            <div className="px-3 py-1.5 border-b border-stone-700 sticky top-0 bg-stone-800 z-10">
              <span className="text-xs font-bold text-stone-400 uppercase tracking-wider">
                Queue {queuedCount > 0 && `(${queuedCount} remaining)`}
              </span>
            </div>
            {validationQueue.map(item => (
              <div
                key={item.id}
                className="flex items-center gap-2 px-3 py-1.5 text-xs border-b border-stone-700/50"
              >
                {item.status === 'queued' && <div className="w-3 h-3 rounded-full bg-stone-600 shrink-0" />}
                {item.status === 'in-progress' && <Loader2 className="w-3 h-3 text-orange-400 animate-spin shrink-0" />}
                {item.status === 'completed' && <Check className="w-3 h-3 text-green-400 shrink-0" />}
                {item.status === 'failed' && <AlertCircle className="w-3 h-3 text-red-400 shrink-0" />}
                <span className={`truncate ${item.status === 'in-progress' ? 'text-orange-300' : 'text-stone-400'}`}>
                  {item.lessonTitle}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Completed Audits */}
        <div className="flex-1 overflow-y-auto">
          <div className="px-3 py-1.5 border-b border-stone-700 sticky top-0 bg-stone-800 z-10">
            <span className="text-xs font-bold text-stone-400 uppercase tracking-wider">
              Completed Audits ({auditResults.length})
            </span>
          </div>
          {auditResults.length === 0 ? (
            <div className="p-3 text-xs text-stone-500 italic">
              Audits will appear here as they complete
            </div>
          ) : (
            auditResults.map(audit => {
              const gc = gradeColor(audit.grade);
              return (
                <button
                  key={audit.id}
                  onClick={() => {
                    setSelectedAuditId(audit.id);
                    setAcceptedFixes(new Set());
                    setDeclinedFixes(new Set());
                  }}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-left border-b border-stone-700/50 transition-colors ${
                    selectedAuditId === audit.id ? 'bg-stone-700' : 'hover:bg-stone-700/50'
                  }`}
                >
                  <span className={`${gc.bg} text-white text-xs font-bold w-6 h-6 rounded-sm flex items-center justify-center shrink-0`}>
                    {audit.grade}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs text-stone-200 truncate font-medium">{audit.lessonTitle}</div>
                    <div className="text-xs text-stone-500">{audit.accuracyPct}% accurate</div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* ── RIGHT DETAIL PANEL ── */}
      <div className="flex-1 overflow-y-auto bg-stone-900">
        {!selectedAudit ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <Search className="w-10 h-10 text-stone-600 mx-auto mb-3" />
              <p className="text-stone-500 text-sm">Select an audit from the list to view details</p>
            </div>
          </div>
        ) : (
          <div className="p-5 max-w-[900px] mx-auto">

            {/* Header */}
            <div className="mb-5">
              <div className="text-xs text-stone-500 mb-1">
                {selectedAudit.softwareSlug} &rsaquo; {selectedAudit.subjectTitle} &rsaquo; {selectedAudit.sectionTitle}
              </div>
              <h2 className="text-lg font-bold text-stone-200 mb-2">{selectedAudit.lessonTitle}</h2>
              <div className="flex items-center gap-3 mb-3">
                <span className={`${gradeColor(selectedAudit.grade).bg} text-white text-2xl font-bold w-12 h-12 rounded-sm flex items-center justify-center shadow-[4px_4px_0px_0px_rgba(0,0,0,0.3)]`}>
                  {selectedAudit.grade}
                </span>
                <div>
                  <div className="text-sm text-stone-300 font-medium">
                    {selectedAudit.accuracyPct}% accurate
                  </div>
                  <div className="text-xs text-stone-500">
                    {selectedAudit.findings.filter(f => f.verdict === 'inaccurate').length} issue{selectedAudit.findings.filter(f => f.verdict === 'inaccurate').length !== 1 ? 's' : ''} found &middot; {selectedAudit.findings.length} claims checked
                  </div>
                </div>
              </div>
              <p className="text-sm text-stone-400 leading-relaxed">{selectedAudit.summary}</p>
            </div>

            {/* Findings */}
            <div className="mb-5">
              <h3 className="text-sm font-bold text-stone-300 uppercase tracking-wider mb-2">Findings</h3>
              <div className="space-y-2">
                {selectedAudit.findings.map((finding, fi) => (
                  <FindingCard key={fi} finding={finding} />
                ))}
              </div>
            </div>

            {/* Fix section */}
            {inaccurateCount > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <h3 className="text-sm font-bold text-stone-300 uppercase tracking-wider">Fixes</h3>
                  {!selectedAudit.fixes && (
                    <button
                      onClick={requestFixes}
                      disabled={fixLoading}
                      className={`flex items-center gap-1.5 px-3 py-1 text-xs font-bold rounded-sm transition-colors ${
                        fixLoading ? 'bg-stone-700 text-stone-500' : 'bg-orange-600 text-white hover:bg-orange-500'
                      }`}
                    >
                      {fixLoading ? (
                        <><Loader2 className="w-3 h-3 animate-spin" /> Generating Fixes...</>
                      ) : (
                        <><RefreshCw className="w-3 h-3" /> Fix Issues</>
                      )}
                    </button>
                  )}
                  {selectedAudit.fixes && hasUnhandledFixes && (
                    <button
                      onClick={acceptAllFixes}
                      className="flex items-center gap-1.5 px-3 py-1 text-xs font-bold rounded-sm bg-green-700 text-white hover:bg-green-600 transition-colors"
                    >
                      <Check className="w-3 h-3" /> Accept All Fixes
                    </button>
                  )}
                </div>

                {selectedAudit.fixes && (
                  <div className="space-y-3">
                    {selectedAudit.fixes.map((fix, fi) => (
                      <FixCard
                        key={fi}
                        fix={fix}
                        index={fi}
                        accepted={acceptedFixes.has(fi)}
                        declined={declinedFixes.has(fi)}
                        onAccept={() => applyFix(fix, fi)}
                        onDecline={() => setDeclinedFixes(prev => new Set([...prev, fi]))}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}


// ── Finding Card ─────────────────────────────────────────────────────────────
function FindingCard({ finding }) {
  const [collapsed, setCollapsed] = useState(finding.verdict === 'accurate');

  return (
    <div className={`border rounded-sm ${
      finding.verdict === 'inaccurate' ? 'border-red-700/50 bg-red-950/20' :
      finding.verdict === 'unverifiable' ? 'border-yellow-700/50 bg-yellow-950/20' :
      'border-stone-700 bg-stone-800/50'
    }`}>
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-start gap-2 p-3 text-left"
      >
        {verdictIcon(finding.verdict)}
        <div className="flex-1 min-w-0">
          <div className="text-xs text-stone-300 leading-relaxed">{finding.claim}</div>
          {collapsed && (
            <div className="text-xs text-stone-500 mt-0.5">Click to expand</div>
          )}
        </div>
        <span className={`text-xs font-bold uppercase shrink-0 ${
          finding.verdict === 'accurate' ? 'text-green-500' :
          finding.verdict === 'inaccurate' ? 'text-red-400' : 'text-yellow-500'
        }`}>
          {finding.verdict}
        </span>
      </button>
      {!collapsed && (
        <div className="px-3 pb-3 pt-0 pl-8">
          <p className="text-xs text-stone-400 leading-relaxed mb-1">{finding.explanation}</p>
          {finding.source && finding.source !== 'N/A' && (
            <div className="text-xs text-stone-500">
              Source: <span className="text-orange-400/70 break-all">{finding.source}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}


// ── Fix Card ─────────────────────────────────────────────────────────────────
function FixCard({ fix, index, accepted, declined, onAccept, onDecline }) {
  if (accepted) {
    return (
      <div className="border border-green-700/50 bg-green-950/20 rounded-sm p-3 flex items-center gap-2">
        <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0" />
        <span className="text-xs text-green-400 font-medium">Fix #{index + 1} applied</span>
      </div>
    );
  }

  if (declined) {
    return (
      <div className="border border-stone-700 bg-stone-800/30 rounded-sm p-3 flex items-center gap-2 opacity-50">
        <XCircle className="w-4 h-4 text-stone-500 shrink-0" />
        <span className="text-xs text-stone-500 font-medium">Fix #{index + 1} declined</span>
      </div>
    );
  }

  return (
    <div className="border border-stone-700 rounded-sm overflow-hidden">
      <div className="px-3 py-2 bg-stone-800 border-b border-stone-700 flex items-center justify-between">
        <span className="text-xs font-bold text-stone-300">Fix #{index + 1}</span>
        <span className="text-xs text-stone-500">{fix.explanation}</span>
      </div>
      <div className="grid grid-cols-2 divide-x divide-stone-700">
        {/* Current */}
        <div className="p-3">
          <div className="text-xs font-bold text-stone-500 uppercase tracking-wider mb-1">Current</div>
          <div className="text-xs text-stone-300 leading-relaxed bg-red-500/10 p-2 rounded-sm border border-red-800/30">
            {fix.original}
          </div>
        </div>
        {/* Proposed */}
        <div className="p-3">
          <div className="text-xs font-bold text-stone-500 uppercase tracking-wider mb-1">Proposed</div>
          <div className="text-xs text-stone-300 leading-relaxed bg-green-500/10 p-2 rounded-sm border border-green-800/30">
            {fix.proposed}
          </div>
        </div>
      </div>
      <div className="px-3 py-2 bg-stone-800 border-t border-stone-700 flex items-center gap-2 justify-end">
        <button
          onClick={onDecline}
          className="px-3 py-1 text-xs font-bold text-stone-400 bg-stone-700 rounded-sm hover:bg-stone-600 hover:text-stone-200 transition-colors"
        >
          Decline Fix
        </button>
        <button
          onClick={onAccept}
          className="px-3 py-1 text-xs font-bold text-white bg-green-700 rounded-sm hover:bg-green-600 transition-colors"
        >
          Accept Fix
        </button>
      </div>
    </div>
  );
}
