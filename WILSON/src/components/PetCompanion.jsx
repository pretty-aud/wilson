import { useState, useRef, useEffect, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import {
  X, RotateCcw, Send, ThumbsUp, ThumbsDown, Heart, Utensils, AlertTriangle,
  Wrench, MessageCircle, Undo2
} from 'lucide-react'
import { PetSprite, EggSprite, DreamCloud, PET_BREEDS } from './sprites/index'

export default function PetCompanion({
  petData, companionOpen, onCompanionToggle,
  chatMessages, chatInput, onChatInputChange, onSendChat, onClearChat,
  chatLoading, chatThinking,
  feedbackJustRated, thumbFlash,
  onThumbRating, onFeed, onPetAction,
  flashFeed, flashPet, eggWobble,
  sleepZCycle, cloudVisible, attentionJump,
  showHatchModal, hatchNameInput, onHatchNameChange, onHatchConfirm,
  isDarkPage, onNavigateLink,
  bottomOffset = 48, petVisible = true,
  // Session 12 (locked #21): AI rides the authenticated ai-proxy, so the
  // only unavailable state is "not signed in" — there is no API key anymore.
  aiUnavailable = false,
  // S30: non-null when the last attempt to save the pet failed. Until this
  // existed a failed save looked exactly like a successful one — the pet is
  // still on screen, still correct-looking, and only a reload reveals that the
  // state went nowhere. Cleared by the next save that works.
  petSaveError = null,
  // Agent props
  agentEnabled = false,
  agentMode = false,
  onAgentModeToggle,
  agentMessages = [],
  agentInput = '',
  onAgentInputChange,
  onSendAgent,
  onClearAgent,
  agentLoading = false,
  canUndo = false,
  onUndo,
}) {
  const chatEndRef = useRef(null)

  // Determine which messages/input to use based on mode
  const activeMessages = agentMode ? agentMessages : chatMessages
  const activeInput = agentMode ? agentInput : chatInput
  const activeOnInputChange = agentMode ? onAgentInputChange : onChatInputChange
  const activeOnSend = agentMode ? onSendAgent : onSendChat
  const activeOnClear = agentMode ? onClearAgent : onClearChat
  const activeLoading = agentMode ? agentLoading : chatLoading

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [activeMessages])

  const name = petData?.name || 'Ollie'
  const form = petData?.form || 'egg'
  const state = petData?.state || 'content'
  const pm = petData?.petMode !== false
  const isEgg = form === 'egg'
  const isAlive = form === 'baby' || form === 'adult'
  const isGhost = form === 'ghost'
  const isCorpse = form === 'corpse'
  const showStats = companionOpen && pm && isAlive && !agentMode
  const canChat = !isEgg
  const canFeed = pm && isAlive && !petData?.sleepingSince
  const canPet = pm && (isEgg || isAlive)
  const canThumb = !agentMode && (isAlive || isGhost || !pm) && chatMessages.some(m => m.role === 'assistant') && !feedbackJustRated

  const effectiveState = flashFeed || flashPet ? 'happy' : state

  // Sprite color: dark pages use orange, light pages use dark/black
  const spriteColor = isDarkPage ? '#f97316' : '#1c1917'

  // Color theme: dark pages use orange (#f97316), light pages use dark (#1c1917)
  const accent = isDarkPage ? '#f97316' : '#1c1917'
  const accentDim = isDarkPage ? '#f97316' : '#292524'
  const bgPanel = isDarkPage ? 'bg-stone-950' : 'bg-[#f4a261]'
  const bgHeader = isDarkPage ? 'bg-[#f97316]' : 'bg-[#9a6438]'
  const headerText = isDarkPage ? '#1c1917' : '#1c1917'
  const bgInput = isDarkPage ? 'bg-stone-900' : 'bg-[#d4802e]'
  const textMain = isDarkPage ? 'text-stone-200' : 'text-stone-900'
  const userBubbleBg = isDarkPage ? 'bg-[#f97316] text-stone-950' : 'bg-[#1c1917] text-white'
  const botBubbleBg = isDarkPage ? 'bg-stone-900 border-[#f97316]/30' : 'bg-[#e8924e] border-[#1c1917]/30'
  const botBubbleText = isDarkPage ? 'text-[#f97316]' : 'text-stone-900'

  // Parse [[nav:...]] links in chat messages
  function renderChatContent(content) {
    const navPattern = /\[\[nav:([^\]|]+?)(?:\|([^\]]+?))?\]\]/g
    const parts = []
    let lastIdx = 0
    let match
    while ((match = navPattern.exec(content)) !== null) {
      if (match.index > lastIdx) parts.push({ type: 'text', value: content.slice(lastIdx, match.index) })
      parts.push({ type: 'link', nav: `nav:${match[1]}`, label: match[2] || match[1].split(':').pop() })
      lastIdx = match.index + match[0].length
    }
    if (lastIdx < content.length) parts.push({ type: 'text', value: content.slice(lastIdx) })
    if (parts.length === 1 && parts[0].type === 'text') return null
    return parts
  }

  const mdComponents = {
    code({ node, inline, className, children, ...props }) {
      const match = /language-(\w+)/.exec(className || '')
      return !inline && match ? (
        <SyntaxHighlighter style={oneDark} language={match[1]} PreTag="div" customStyle={{ fontSize: '0.75rem', padding: '0.5rem', margin: '0.25rem 0' }} {...props}>
          {String(children).replace(/\n$/, '')}
        </SyntaxHighlighter>
      ) : (
        <code className="bg-stone-800 px-1 rounded text-orange-400 text-xs" {...props}>{children}</code>
      )
    }
  }

  // Header title based on mode
  const headerTitle = agentMode ? `Work with ${name}` : `Chat with ${name}`

  return (
    <>
      {/* Chat popup — hidden while egg */}
      {companionOpen && !isEgg && (
        <div className={`fixed right-[5.5rem] w-[350px] h-[450px] ${bgPanel} border-2 rounded-sm shadow-[4px_4px_0px_0px_rgba(0,0,0,0.3)] z-30 flex flex-col slide-in-right`} style={{ borderColor: accent, bottom: `${bottomOffset + 72}px` }}>
          <div className={`${bgHeader} border-b-2 px-3 py-2 flex items-center justify-between shrink-0 rounded-t-sm`} style={{ borderColor: accent }}>
            <span className="text-sm font-bold font-mono" style={{ color: headerText }}>{headerTitle}</span>
            <div className="flex items-center gap-1">
              <button onClick={activeOnClear} className="p-1 hover:opacity-70 rounded-sm" title="New session"><RotateCcw className="w-3 h-3" style={{ color: headerText }} /></button>
              <button onClick={() => onCompanionToggle(false)} className="p-1 hover:opacity-70 rounded-sm" title="Close"><X className="w-3 h-3" style={{ color: headerText }} /></button>
            </div>
          </div>
          <div className={`flex-1 overflow-y-auto p-3 space-y-3 ${bgPanel}`}>
            {petSaveError && (
              <div className="flex items-start gap-2 px-3 py-2.5 rounded-sm border text-xs font-mono" style={{ background: isDarkPage ? '#450a0a' : '#fee2e2', borderColor: isDarkPage ? '#991b1b' : '#ef4444', color: isDarkPage ? '#fca5a5' : '#991b1b' }}>
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span><strong>{name} isn’t being saved.</strong> {petSaveError}</span>
              </div>
            )}
            {aiUnavailable && !isEgg && (
              <div className="flex items-start gap-2 px-3 py-2.5 rounded-sm border text-xs font-mono" style={{ background: isDarkPage ? '#451a03' : '#fef3c7', borderColor: isDarkPage ? '#92400e' : '#f59e0b', color: isDarkPage ? '#fbbf24' : '#92400e' }}>
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>Sign in to your workspace to {agentMode ? 'use the agent' : `chat with ${name}`}.</span>
              </div>
            )}
            {!isEgg && activeMessages.length === 0 && !aiUnavailable && (
              <div className="text-center py-6 text-sm font-mono" style={{ color: accent, opacity: 0.3 }}>
                {agentMode ? `Tell ${name} what to edit or create` : `Say hello to ${name}!`}
              </div>
            )}
            {!isEgg && activeMessages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] px-3 py-2 rounded-sm text-sm ${
                  msg.role === 'user' ? `${userBubbleBg} font-mono` : `${botBubbleBg} border ${botBubbleText}`
                }`}>
                  {msg.role === 'user' ? msg.content : (() => {
                    const navParts = renderChatContent(msg.content)
                    if (!navParts) {
                      return (
                        <div className="companion-chat-md">
                          <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{msg.content}</ReactMarkdown>
                        </div>
                      )
                    }
                    return (
                      <div className="companion-chat-md">
                        {navParts.map((part, pi) =>
                          part.type === 'link' ? (
                            <span key={pi}>{' '}<button onClick={() => onNavigateLink?.(part.nav)} className="underline underline-offset-2 hover:opacity-70 transition-colors font-bold cursor-pointer inline" style={{ color: isDarkPage ? '#fb923c' : '#7c2d12' }}>{part.label}</button>{' '}</span>
                          ) : (
                            <ReactMarkdown key={pi} remarkPlugins={[remarkGfm]} components={{ ...mdComponents, p: ({ children }) => <span>{children}</span> }}>{part.value}</ReactMarkdown>
                          )
                        )}
                      </div>
                    )
                  })()}
                </div>
              </div>
            ))}
            {activeLoading && (
              <div className="flex justify-start">
                <div className={`${botBubbleBg} border px-3 py-2 rounded-sm dot-pulse`} style={{ borderColor: `${accent}40` }}>
                  <span className="inline-block w-1.5 h-1.5 rounded-full mx-0.5" style={{ background: accent }} />
                  <span className="inline-block w-1.5 h-1.5 rounded-full mx-0.5" style={{ background: accent }} />
                  <span className="inline-block w-1.5 h-1.5 rounded-full mx-0.5" style={{ background: accent }} />
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>
          {/* Input bar */}
          {canChat && (
            <div className="p-2 border-t-2 shrink-0 flex gap-2" style={{ borderColor: accent }}>
              <input
                value={activeInput}
                onChange={e => activeOnInputChange(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.stopPropagation(); activeOnSend(); } }}
                placeholder={agentMode ? `Tell ${name} what to fix...` : `Ask ${name} anything...`}
                className={`flex-1 ${bgInput} ${textMain} border-2 rounded-sm px-3 py-1.5 text-sm font-mono focus:outline-none transition-colors`}
                style={{ borderColor: `${accent}40` }}
                disabled={activeLoading}
              />
              <button onClick={activeOnSend} disabled={activeLoading || !activeInput?.trim() || aiUnavailable} className="p-2 rounded-sm hover:opacity-80 disabled:opacity-40 transition-colors" style={{ background: accent, color: isDarkPage ? '#1c1917' : '#fff' }}>
                <Send className="w-4 h-4" />
              </button>
            </div>
          )}
          {/* Action buttons bar */}
          <div className="px-2 py-1.5 border-t shrink-0 flex items-center gap-1.5" style={{ borderColor: `${accent}30` }}>
            {/* Agent toggle — left side */}
            {agentEnabled && canChat && (
              <button
                onClick={() => onAgentModeToggle?.(!agentMode)}
                className="p-1.5 rounded-sm border-2 transition-colors"
                style={{
                  borderColor: agentMode ? accent : `${accent}40`,
                  background: agentMode ? accent : 'transparent',
                  color: agentMode ? (isDarkPage ? '#1c1917' : '#fff') : accent,
                }}
                title={agentMode ? 'Switch to Chat' : 'Switch to Agent'}
              >
                {agentMode ? <MessageCircle className="w-3.5 h-3.5" /> : <Wrench className="w-3.5 h-3.5" />}
              </button>
            )}
            {/* Undo button — only in agent mode with undo available */}
            {agentMode && canUndo && (
              <button
                onClick={onUndo}
                className="p-1.5 rounded-sm border-2 transition-colors"
                style={{ borderColor: `${accent}40`, background: 'transparent', color: accent }}
                title="Undo last agent edit"
              >
                <Undo2 className="w-3.5 h-3.5" />
              </button>
            )}
            <div className="flex-1" />
            {/* Thumbs — only in chat mode */}
            {!agentMode && (canThumb || isGhost || !pm) && (
              <button onClick={() => onThumbRating('up')} disabled={!canThumb} className={`p-1.5 rounded-sm border-2 transition-colors disabled:opacity-30 disabled:cursor-not-allowed`} style={{ borderColor: thumbFlash === 'up' ? accent : `${accent}40`, background: thumbFlash === 'up' ? accent : 'transparent', color: thumbFlash === 'up' ? (isDarkPage ? '#1c1917' : '#fff') : accent }}>
                <ThumbsUp className="w-3.5 h-3.5" />
              </button>
            )}
            {!agentMode && (canThumb || isGhost || !pm) && (
              <button onClick={() => onThumbRating('down')} disabled={!canThumb} className={`p-1.5 rounded-sm border-2 transition-colors disabled:opacity-30 disabled:cursor-not-allowed`} style={{ borderColor: thumbFlash === 'down' ? accent : `${accent}40`, background: thumbFlash === 'down' ? accent : 'transparent', color: thumbFlash === 'down' ? (isDarkPage ? '#1c1917' : '#fff') : accent }}>
                <ThumbsDown className="w-3.5 h-3.5" />
              </button>
            )}
            {canFeed && (
              <button onClick={onFeed} disabled={petData?.hunger >= 100} className="p-1.5 rounded-sm border-2 transition-colors disabled:opacity-30 disabled:cursor-not-allowed" style={{ borderColor: accent, color: accent }} title="Feed">
                <Utensils className="w-3.5 h-3.5" />
              </button>
            )}
            {canPet && (
              <button onClick={onPetAction} className={`p-1.5 rounded-sm border-2 transition-colors ${flashPet ? 'otter-happy' : ''}`} style={{ borderColor: accent, color: accent }} title={isEgg ? 'Pet Egg' : (petData?.sleepingSince ? 'Wake Up' : 'Pet')}>
                <Heart className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Stats card — left of sprite, only when chat open + pet mode + alive + not in agent mode */}
      {showStats && (
        <div className="fixed right-[5.5rem] z-30 flex flex-col gap-1 slide-up font-mono" style={{ bottom: `${bottomOffset}px` }}>
          <div className="rounded-sm shadow-[4px_4px_0px_0px_rgba(0,0,0,0.3)] px-2.5 py-1 border-2" style={{ background: isDarkPage ? '#1c1917' : '#f4a261', borderColor: accent }}>
            <div className="text-[11px] uppercase font-bold tracking-wider leading-none" style={{ color: accent }}>Status: {state}</div>
          </div>
          <div className="rounded-sm shadow-[4px_4px_0px_0px_rgba(0,0,0,0.3)] px-2.5 py-1.5 border-2" style={{ background: isDarkPage ? '#1c1917' : '#f4a261', borderColor: accent }}>
            <div className={`h-1.5 rounded-none border overflow-hidden ${petData?.hunger <= 15 ? 'hunger-critical' : ''}`} style={{ background: isDarkPage ? '#292524' : '#d4802e', borderColor: `${accent}30` }}>
              <div className="h-full transition-all duration-500" style={{ width: `${Math.round(petData?.hunger || 0)}%`, background: accent }} />
            </div>
          </div>
        </div>
      )}

      {/* Sprite — fixed bottom-right, slides in/out during transitions */}
      <div
        className={`fixed right-4 z-30 cursor-pointer hover:scale-110 transition-transform ${attentionJump ? 'attention-jump' : ''} ${petVisible ? 'pet-slide-in' : 'pet-slide-out'}`}
        style={{ bottom: `${bottomOffset}px` }}
        onClick={() => isEgg ? onPetAction() : onCompanionToggle(!companionOpen)}
      >
        <div className="relative">
          {pm && !isEgg && !isCorpse && !isGhost && (
            <DreamCloud petState={effectiveState} sleepCycle={sleepZCycle} visible={cloudVisible || effectiveState === 'sleeping'} color={spriteColor} />
          )}
          {isEgg ? (
            <EggSprite wobble={eggWobble} color={spriteColor} />
          ) : (
            <PetSprite breed={petData?.breed || 'otter'} petState={effectiveState} form={form} isThinking={chatThinking || agentLoading} color={spriteColor} />
          )}
        </div>
      </div>

      {/* Hatch Modal */}
      {showHatchModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
          <div className="bg-stone-800 border-2 border-stone-600 rounded-sm p-6 w-[340px] shadow-[4px_4px_0px_0px_rgba(0,0,0,0.3)]">
            <h3 className="text-white font-bold text-lg mb-2 hatch-burst">Your egg hatched!</h3>
            {petData?.breed === 'demon' && <p className="text-red-400 text-xs font-bold mb-1 uppercase tracking-wider">Extremely Rare!</p>}
            <p className="text-stone-400 text-sm mb-3">
              It's a {petData?.gender === 'female' ? 'girl' : 'boy'} {PET_BREEDS[petData?.breed]?.label || 'Otter'}!
            </p>
            <div className="flex justify-center mb-4">
              <PetSprite breed={petData?.breed} petState="happy" form="baby" />
            </div>
            <label className="block text-stone-400 text-xs mb-1">Give your {(PET_BREEDS[petData?.breed]?.label || 'otter').toLowerCase()} a name:</label>
            <input
              value={hatchNameInput}
              onChange={e => onHatchNameChange(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') onHatchConfirm() }}
              autoFocus
              className="w-full bg-stone-950 text-white border-2 border-stone-600 rounded-sm px-3 py-1.5 text-sm focus:border-orange-500 focus:outline-none transition-colors mb-4"
            />
            <button onClick={onHatchConfirm} className="w-full bg-orange-600 text-white border-2 border-orange-700 py-2 rounded-sm hover:bg-orange-700 transition-colors text-sm font-bold">
              Confirm
            </button>
          </div>
        </div>
      )}
    </>
  )
}
