import { createContext, useContext, useState, useCallback, useRef } from 'react'
import DiffView from './DiffView'
import LessonOutlinePopup from './LessonOutlinePopup'
import { AGENT_SYSTEM_PROMPT, AGENT_EDIT_CONTEXT } from './agentPrompts'

const AgentContext = createContext(null)

export function useAgent() {
  return useContext(AgentContext)
}

// ── Toast notification component ──
function AgentToast({ message, onDone }) {
  return (
    <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 bg-stone-800 border border-orange-500 text-orange-400 px-4 py-2 rounded-sm text-xs font-mono shadow-lg animate-fade-in-up"
      onAnimationEnd={onDone}>
      {message}
    </div>
  )
}

/**
 * AgentProvider — tool-agnostic agent system
 *
 * Each tool registers itself via a standard interface:
 * {
 *   toolName: string,
 *   currentContext: { activeSoftwareSlug, activeSubjectSlug, selectedLessonId, ... },
 *   getContent: (targetId) => content string,
 *   applyChange: (targetId, changes) => Promise<void>,
 *   getCorrections: () => corrections[],
 *   saveCorrection: (correction) => Promise<void>,
 *   getSubjectData: (slug) => subject object,
 *   generateSingleSubjectFromAgent: (topic, overrideSlug) => Promise<void>,
 *   generateCourseFromAgent: (softwareName, description) => Promise<void>,
 *   getActiveSoftwareMeta: () => Promise<{ name, type } | null>,
 * }
 */
export default function AgentProvider({ children, apiKey }) {
  // Agent mode state
  const [agentEnabled, setAgentEnabled] = useState(true)
  const [agentMode, setAgentMode] = useState(false) // false = chat, true = agent/work
  const [agentMessages, setAgentMessages] = useState([])
  const [agentInput, setAgentInput] = useState('')
  const agentInputRef = useRef('')
  const [agentLoading, setAgentLoading] = useState(false)
  const [autoApprove, setAutoApprove] = useState('always_ask') // 'always_ask' | 'minor' | 'all'
  const [lockedSubjects, setLockedSubjects] = useState([]) // slugs of locked subjects
  const [agentSystemPrompt, setAgentSystemPrompt] = useState(AGENT_SYSTEM_PROMPT)

  // Tool registration
  const toolInterfaceRef = useRef(null)

  // UI state for diff popup
  const [diffData, setDiffData] = useState(null)
  const [toast, setToast] = useState(null)
  const [undoStack, setUndoStack] = useState([]) // { subjectSlug, previousData }

  // Bulk edit state
  const [bulkEdits, setBulkEdits] = useState(null) // array of edits
  const [bulkIndex, setBulkIndex] = useState(0)

  // Unified proposal popup state (replaces outlineData + subjectOutlineData)
  const [proposalData, setProposalData] = useState(null)

  // Register a tool's interface
  const registerTool = useCallback((toolInterface) => {
    toolInterfaceRef.current = toolInterface
  }, [])

  const unregisterTool = useCallback(() => {
    toolInterfaceRef.current = null
  }, [])

  // Show toast notification
  const showToast = useCallback((message) => {
    setToast(message)
    setTimeout(() => setToast(null), 3000)
  }, [])

  // Parse agent response for <agent_action> tags
  const parseAgentResponse = (text) => {
    const actionMatch = text.match(/<agent_action>\s*([\s\S]*?)\s*<\/agent_action>/)
    if (!actionMatch) return { message: text, action: null }

    try {
      const action = JSON.parse(actionMatch[1])
      // Extract message from outside the tag, or from action.message
      const msgOutside = text.replace(/<agent_action>[\s\S]*?<\/agent_action>/, '').trim()
      return { message: msgOutside || action.message || '', action }
    } catch {
      return { message: text, action: null }
    }
  }

  // Check if a subject is locked
  const isSubjectLocked = useCallback((subjectSlug) => {
    return lockedSubjects.includes(subjectSlug)
  }, [lockedSubjects])

  // Handle applying a single edit
  const applyEdit = useCallback(async (edit) => {
    const tool = toolInterfaceRef.current
    if (!tool) return

    const { target, changes, correction_category } = edit
    if (isSubjectLocked(target.subject_slug)) {
      showToast('Subject is locked — edit rejected')
      return false
    }

    try {
      // Store undo data
      const subjectData = await tool.getSubjectData(target.subject_slug)
      if (subjectData) {
        setUndoStack(prev => [...prev.slice(-5), { subjectSlug: target.subject_slug, previousData: JSON.parse(JSON.stringify(subjectData)) }])
      }

      await tool.applyChange(target, changes)

      // Save correction
      for (const change of changes) {
        const correction = {
          id: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          subject_slug: target.subject_slug,
          lesson_id: target.lesson_id,
          description: `${change.field}: changed "${change.original.slice(0, 60)}..." to "${change.proposed.slice(0, 60)}..."`,
          original: change.original,
          corrected: change.proposed,
          category: correction_category || 'other',
        }
        await tool.saveCorrection(correction)
      }

      showToast(`Updated lesson in ${target.subject_slug}`)
      return true
    } catch (e) {
      showToast(`Error applying changes: ${e.message}`)
      return false
    }
  }, [isSubjectLocked, showToast])

  // Handle agent action from parsed response
  const handleAgentAction = useCallback(async (action) => {
    if (!action) return

    if (action.type === 'edit') {
      // Check auto-approve
      const totalChars = action.changes.reduce((sum, c) => sum + Math.abs(c.proposed.length - c.original.length), 0)
      if (autoApprove === 'all' || (autoApprove === 'minor' && totalChars < 20)) {
        applyEdit(action)
        return
      }
      // Show diff view
      setDiffData({
        changes: action.changes,
        edit: action,
        lessonTitle: action.target?.lesson_id,
        subjectTitle: action.target?.subject_slug,
      })
    } else if (action.type === 'bulk_edit') {
      setBulkEdits(action.edits)
      setBulkIndex(0)
      // Show first edit
      const first = action.edits[0]
      setDiffData({
        changes: first.changes,
        edit: first,
        lessonTitle: first.target?.lesson_id,
        subjectTitle: first.target?.subject_slug,
      })
    } else if (action.type === 'generate_subject') {
      // Show unified proposal popup for single subject generation
      setProposalData({
        mode: 'single_subject',
        topic: action.subject?.topic || 'Untitled Subject',
        description: action.subject?.description || '',
      })
    } else if (action.type === 'generate_course') {
      // Show unified proposal popup for full course generation
      setProposalData({
        mode: 'full_course',
        softwareName: action.course?.software_name || 'Untitled Course',
        description: action.course?.description || '',
      })
    }
  }, [autoApprove, applyEdit])

  // Send message to agent
  const sendAgentMessage = useCallback(async (overrideInput) => {
    const currentInput = overrideInput || agentInputRef.current
    if (!currentInput.trim() || !apiKey) return

    const userMsg = { role: 'user', content: currentInput }
    const newMessages = [...agentMessages, userMsg]
    setAgentMessages(newMessages)
    setAgentInput('')
    agentInputRef.current = ''
    setAgentLoading(true)

    const tool = toolInterfaceRef.current

    // Build context
    let context = '\n\n--- CURRENT CONTEXT ---'
    if (tool) {
      const ctx = tool.currentContext
      context += `\nTool: ${tool.toolName}`
      if (ctx.activeSoftwareSlug) context += `\nCourse: ${ctx.activeSoftwareSlug}`
      if (ctx.activeSubjectSlug) context += `\nSubject: ${ctx.activeSubjectSlug}`
      if (ctx.selectedLessonId) context += `\nLesson: ${ctx.selectedLessonId}`

      // Add software metadata so agent knows the active course name/type
      if (tool.getActiveSoftwareMeta) {
        try {
          const meta = await tool.getActiveSoftwareMeta()
          if (meta) {
            context += `\nCourse Name: ${meta.name}`
            if (meta.type) context += `\nCourse Type: ${meta.type}`
          }
        } catch { /* ignore */ }
      }

      // Inject available subjects list so agent uses correct slugs
      if (tool.getAvailableSubjects) {
        try {
          const allSubs = await tool.getAvailableSubjects()
          if (allSubs && allSubs.length > 0) {
            context += `\n\nAVAILABLE SUBJECTS (use exact slugs): ${allSubs.map(s => `"${s.slug}" (${s.title || s.slug})`).join(', ')}`
          }
        } catch { /* ignore */ }
      }

      // Inject subject structure and optionally lesson content
      let lessonContent = null
      let subjectStructure = null
      const corrections = await tool.getCorrections()

      if (ctx.activeSubjectSlug) {
        // Get subject structure so agent knows what sections/lessons exist
        const subjectData = await tool.getSubjectData(ctx.activeSubjectSlug)
        if (subjectData?.sections) {
          subjectStructure = subjectData.sections.map(s =>
            `Section "${s.title}" (${s.id}): ${(s.lessons || []).map(l => `${l.id}: ${l.title}`).join(', ') || 'no lessons'}`
          ).join('\n')
        }

        if (ctx.selectedLessonId) {
          lessonContent = tool.getContent(ctx.selectedLessonId)
        }
      }

      context += AGENT_EDIT_CONTEXT(lessonContent, corrections, subjectStructure)

      // Locked subjects
      if (lockedSubjects.length > 0) {
        context += `\n\nLOCKED SUBJECTS (refuse edits): ${lockedSubjects.join(', ')}`
      }
    } else {
      context += '\nNo tool is currently active. Ask the user what they want to work on.'
    }

    try {
      // Use the custom or default system prompt
      const systemPrompt = agentSystemPrompt + context

      // Truncate history
      const MAX_HISTORY = 30
      const MAX_MSG_CHARS = 3000
      let trimmedMessages = newMessages.map(m => ({
        role: m.role,
        content: m.content.length > MAX_MSG_CHARS ? m.content.slice(0, MAX_MSG_CHARS) + '...' : m.content,
      }))
      if (trimmedMessages.length > MAX_HISTORY) {
        const first2 = trimmedMessages.slice(0, 2)
        const recent = trimmedMessages.slice(-MAX_HISTORY + 2)
        trimmedMessages = [...first2, { role: 'user', content: '[Earlier conversation trimmed]' }, { role: 'assistant', content: 'Understood, continuing.' }, ...recent]
      }

      let data
      let lastError
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt > 0) await new Promise(r => setTimeout(r, 2000 * attempt))
        try {
          const res = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': apiKey,
              'anthropic-version': '2023-06-01',
              'anthropic-dangerous-direct-browser-access': 'true',
            },
            body: JSON.stringify({
              model: 'claude-sonnet-4-20250514',
              max_tokens: 4096,
              system: systemPrompt,
              messages: trimmedMessages,
            }),
          })
          data = await res.json()
          if (data.error) {
            const errMsg = data.error?.message || JSON.stringify(data.error)
            const isRetryable = res.status === 429 || res.status === 529 || res.status === 503 || /overloaded|rate.?limit|capacity/i.test(errMsg)
            if (isRetryable && attempt < 2) { lastError = errMsg; continue }
            throw new Error(errMsg)
          }
          break
        } catch (fetchErr) {
          lastError = fetchErr.message || 'Network error'
          if (attempt < 2 && !/invalid|auth|key|permission/i.test(lastError)) continue
          throw fetchErr
        }
      }

      const replyText = data.content?.[0]?.text || 'Sorry, I had trouble processing that.'
      const parsed = parseAgentResponse(replyText)

      // Show the message part in chat
      const displayMessage = parsed.message || (parsed.action?.message) || replyText
      setAgentMessages(prev => [...prev, { role: 'assistant', content: displayMessage }])

      // Handle the action if any
      if (parsed.action) {
        handleAgentAction(parsed.action)
      }
    } catch (e) {
      const msg = e.message || 'Unknown error'
      setAgentMessages(prev => [...prev, { role: 'assistant', content: `Error: ${msg}` }])
    } finally {
      setAgentLoading(false)
    }
  }, [agentMessages, apiKey, agentSystemPrompt, lockedSubjects, handleAgentAction])

  // Undo last edit
  const undoLastEdit = useCallback(async () => {
    if (undoStack.length === 0) return
    const tool = toolInterfaceRef.current
    if (!tool) return

    const last = undoStack[undoStack.length - 1]
    try {
      // Re-save the previous subject data
      await fetch(`/api/software/${tool.currentContext.activeSoftwareSlug}/subjects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(last.previousData),
      })
      setUndoStack(prev => prev.slice(0, -1))
      showToast('Reverted last change')
    } catch (e) {
      showToast(`Undo failed: ${e.message}`)
    }
  }, [undoStack, showToast])

  // Diff view handlers
  const handleDiffApply = useCallback(async () => {
    if (!diffData) return
    const success = await applyEdit(diffData.edit)
    if (success && bulkEdits) {
      // Move to next bulk edit
      const nextIdx = bulkIndex + 1
      if (nextIdx < bulkEdits.length) {
        setBulkIndex(nextIdx)
        const next = bulkEdits[nextIdx]
        setDiffData({
          changes: next.changes,
          edit: next,
          lessonTitle: next.target?.lesson_id,
          subjectTitle: next.target?.subject_slug,
        })
      } else {
        setBulkEdits(null)
        setBulkIndex(0)
        setDiffData(null)
      }
    } else {
      setDiffData(null)
    }
  }, [diffData, applyEdit, bulkEdits, bulkIndex])

  const handleDiffReject = useCallback(() => {
    if (bulkEdits) {
      const nextIdx = bulkIndex + 1
      if (nextIdx < bulkEdits.length) {
        setBulkIndex(nextIdx)
        const next = bulkEdits[nextIdx]
        setDiffData({
          changes: next.changes,
          edit: next,
          lessonTitle: next.target?.lesson_id,
          subjectTitle: next.target?.subject_slug,
        })
      } else {
        setBulkEdits(null)
        setBulkIndex(0)
        setDiffData(null)
      }
    } else {
      setDiffData(null)
    }
  }, [bulkEdits, bulkIndex])

  const handleDiffEdit = useCallback((instruction) => {
    setDiffData(null)
    setBulkEdits(null)
    sendAgentMessage(instruction)
  }, [sendAgentMessage])

  const handleApplyAllRemaining = useCallback(async () => {
    if (!bulkEdits) return
    for (let i = bulkIndex; i < bulkEdits.length; i++) {
      await applyEdit(bulkEdits[i])
    }
    setBulkEdits(null)
    setBulkIndex(0)
    setDiffData(null)
    showToast(`Applied all remaining changes`)
  }, [bulkEdits, bulkIndex, applyEdit, showToast])

  // ── Unified proposal popup handlers ──

  const handleProposalGenerate = useCallback(() => {
    if (!proposalData) return
    const tool = toolInterfaceRef.current
    if (!tool) {
      showToast('No tool is currently active')
      return
    }

    // Close popup immediately — generation runs in the background via the queue
    const data = { ...proposalData }
    setProposalData(null)

    if (data.mode === 'single_subject') {
      if (!tool.generateSingleSubjectFromAgent) {
        showToast('Subject generation not available')
        return
      }
      showToast(`Generating subject: ${data.topic} — check queue for progress`)
      tool.generateSingleSubjectFromAgent(data.topic)
    } else if (data.mode === 'full_course') {
      if (!tool.generateCourseFromAgent) {
        showToast('Course generation not available')
        return
      }
      showToast(`Generating course: ${data.softwareName} — check queue for progress`)
      tool.generateCourseFromAgent(data.softwareName, data.description)
    }
  }, [proposalData, showToast])

  const handleProposalRefresh = useCallback(() => {
    const mode = proposalData?.mode
    setProposalData(null)
    if (mode === 'single_subject') {
      sendAgentMessage('Please regenerate the subject proposal with a different approach.')
    } else if (mode === 'full_course') {
      sendAgentMessage('Please regenerate the course proposal with a different approach.')
    }
  }, [proposalData, sendAgentMessage])

  const handleAgentInputChange = useCallback((val) => {
    agentInputRef.current = val
    setAgentInput(val)
  }, [])

  const value = {
    // State
    agentEnabled, setAgentEnabled,
    agentMode, setAgentMode,
    agentMessages, setAgentMessages,
    agentInput, handleAgentInputChange,
    agentLoading,
    autoApprove, setAutoApprove,
    lockedSubjects, setLockedSubjects,
    agentSystemPrompt, setAgentSystemPrompt,

    // Tool registration
    registerTool, unregisterTool,

    // Actions
    sendAgentMessage,
    undoLastEdit,
    isSubjectLocked,
    showToast,
    undoStack,
  }

  return (
    <AgentContext.Provider value={value}>
      {children}

      {/* Diff View Modal */}
      {diffData && (
        <DiffView
          changes={diffData.changes}
          lessonTitle={diffData.lessonTitle}
          subjectTitle={diffData.subjectTitle}
          bulkIndex={bulkEdits ? bulkIndex : null}
          bulkTotal={bulkEdits ? bulkEdits.length : null}
          onApply={handleDiffApply}
          onReject={handleDiffReject}
          onEdit={handleDiffEdit}
          onApplyAll={handleApplyAllRemaining}
          onSkip={handleDiffReject}
          onClose={() => { setDiffData(null); setBulkEdits(null); }}
        />
      )}

      {/* Unified Proposal Popup (subject or course generation) */}
      {proposalData && (
        <LessonOutlinePopup
          proposalData={proposalData}
          onGenerate={handleProposalGenerate}
          onRefresh={handleProposalRefresh}
          onCancel={() => setProposalData(null)}
        />
      )}

      {/* Toast */}
      {toast && <AgentToast message={toast} onDone={() => setToast(null)} />}
    </AgentContext.Provider>
  )
}
