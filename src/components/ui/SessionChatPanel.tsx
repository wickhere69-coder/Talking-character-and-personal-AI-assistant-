import React, { useState, useRef, useEffect } from 'react';
import { useSessionStore } from '@/store/sessionStore';
import { useAppStore } from '@/store/appStore';
import { auraController } from '@/services/auraConversationController';
import { voiceManager } from '@/services/voiceManager';
import {
  Send,
  Square,
  Sparkles,
  Brain,
  Pin,
  Archive,
  Trash2,
  Copy,
  Volume2,
  Check,
  Edit2,
  Tag,
  ArrowLeft,
  MessageSquare,
  MoreVertical,
  ArchiveRestore
} from 'lucide-react';

interface SessionChatPanelProps {
  onBackToSessions?: () => void;
  showBackControl?: boolean;
}

export default function SessionChatPanel({ onBackToSessions, showBackControl = false }: SessionChatPanelProps) {
  const {
    activeSessionId,
    activeMessages,
    isLoadingMessages,
    renameSession,
    togglePinSession,
    toggleArchiveSession,
    setDeletingSession,
    setIsMemoryInspectorOpen,
    getActiveSession
  } = useSessionStore();

  const {
    agentStatus,
    isSpeaking,
    playbackState
  } = useAppStore();

  const [inputVal, setInputVal] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const session = getActiveSession();
  const isBusy = agentStatus === 'thinking' || agentStatus === 'planning' || playbackState === 'loading';
  const isCharacterSpeaking = isSpeaking || playbackState === 'playing' || agentStatus === 'speaking';

  // Auto-scroll to bottom of conversation
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeMessages.length, isBusy]);

  const handleSend = () => {
    const trimmed = inputVal.trim();
    if (!trimmed || isBusy) return;
    setInputVal('');
    auraController.ask(trimmed);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1800);
  };

  const handleReadAloud = async (text: string) => {
    const voice = voiceManager.resolveCurrentVoice();
    const key = typeof window !== 'undefined' ? localStorage.getItem('elevenlabs_api_key') || '' : '';
    await voiceManager.speak(text, voice, key);
  };

  const handleSaveTitle = async () => {
    if (session && titleDraft.trim()) {
      await renameSession(session.id, titleDraft.trim());
    }
    setIsEditingTitle(false);
  };

  // Topic-tailored starter prompt suggestions
  const topicStarters = React.useMemo(() => {
    const topic = session?.topic?.toLowerCase() || '';
    if (topic.includes('software') || topic.includes('code') || topic.includes('engineering') || topic.includes('tech')) {
      return [
        'Review my architectural strategy for this project',
        'Help me optimize database querying and latency',
        'What were the system constraints we agreed upon?'
      ];
    }
    if (topic.includes('career') || topic.includes('interview')) {
      return [
        'Run a technical mock interview with me',
        'Critique my answers using the STAR method',
        'What questions should I ask the hiring team?'
      ];
    }
    return [
      'What did we discuss earlier in this session?',
      'Summarize our conversation and key decisions so far',
      'What are our next priority action items?'
    ];
  }, [session?.topic]);

  if (!session) {
    return (
      <div className="flex-1 h-full flex flex-col items-center justify-center p-8 text-center space-y-4">
        <div className="w-12 h-12 rounded-[14px] bg-[#131622] border border-[#2A2C33] flex items-center justify-center text-[#A78BFA]">
          <MessageSquare size={22} strokeWidth={1.75} />
        </div>
        <div className="space-y-1">
          <p className="text-[15px] font-semibold text-[#F2F2F2] font-sans">No Conversation Selected</p>
          <p className="text-xs text-[#A7A9AF] max-w-xs font-sans leading-relaxed">
            Select a session from the history sidebar or create a new conversation to start.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden bg-transparent select-text">
      {/* ── 1. Top Session Header ── */}
      <div className="px-5 py-3.5 border-b border-[#2A2C33] bg-[#0D0F17]/90 backdrop-blur-xl flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          {showBackControl && (
            <button
              type="button"
              onClick={onBackToSessions}
              className="p-1.5 rounded-full bg-white/[0.04] hover:bg-white/[0.08] text-[#A7A9AF] hover:text-[#F2F2F2] transition active:scale-95 shrink-0 border border-white/[0.08]"
              title="Back to Sessions"
            >
              <ArrowLeft size={16} />
            </button>
          )}

          <div className="min-w-0 flex-1">
            {isEditingTitle ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSaveTitle()}
                  className="px-3 py-1 rounded-full bg-[#11131C] border border-[#2A2C33] text-xs text-[#F2F2F2] focus:outline-none focus:border-[#A78BFA]/50 w-full max-w-xs font-sans"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={handleSaveTitle}
                  className="p-1.5 rounded-full bg-[#A78BFA] text-[#0B0D12] hover:bg-[#C4B5FD] shrink-0 transition"
                >
                  <Check size={13} strokeWidth={2.5} />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2 group">
                <h3
                  className="text-[15px] font-semibold text-[#F2F2F2] font-sans truncate cursor-pointer hover:text-[#A78BFA] transition"
                  onClick={() => {
                    setTitleDraft(session.title);
                    setIsEditingTitle(true);
                  }}
                  title="Click to rename session"
                >
                  {session.title}
                </h3>
                <button
                  type="button"
                  onClick={() => {
                    setTitleDraft(session.title);
                    setIsEditingTitle(true);
                  }}
                  className="opacity-0 group-hover:opacity-100 p-0.5 text-[#A7A9AF] hover:text-[#F2F2F2] transition shrink-0"
                  title="Rename"
                >
                  <Edit2 size={12} />
                </button>
              </div>
            )}

            <div className="flex items-center gap-2.5 mt-1">
              <span className="text-[11px] font-mono px-2.5 py-0.5 rounded-full bg-[#131622] text-[#A7A9AF] border border-[#2A2C33] flex items-center gap-1.5">
                <Tag size={10} className="text-[#A78BFA]" />
                {session.topic || 'General'}
              </span>
              <span className="text-[11px] font-mono text-[#A7A9AF]">
                {activeMessages.length} msgs
              </span>
              {session.pinned && (
                <span className="text-[11px] font-mono text-amber-400 flex items-center gap-1">
                  <Pin size={10} fill="currentColor" /> Pinned
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Action Controls: Clean Memory Pill + Single Menu */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Memory Inspector Button */}
          <button
            type="button"
            onClick={() => setIsMemoryInspectorOpen(true)}
            className="px-3 py-1.5 rounded-full bg-[#A78BFA]/10 hover:bg-[#A78BFA]/20 border border-[#A78BFA]/25 text-[#C4B5FD] text-[11px] font-mono font-medium transition flex items-center gap-1.5 active:scale-95 shadow-sm"
            title="Inspect Topic & Contextual Memory for this session"
          >
            <Brain size={13} strokeWidth={2} />
            <span>Memory</span>
          </button>

          {/* Single More Options Dropdown */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setIsMenuOpen(!isMenuOpen)}
              className="p-2 rounded-full border border-white/[0.08] bg-white/[0.04] hover:bg-white/[0.08] text-[#A7A9AF] hover:text-[#F2F2F2] transition active:scale-95"
              title="More session options"
            >
              <MoreVertical size={14} />
            </button>

            {isMenuOpen && (
              <div
                className="absolute right-0 top-10 z-50 w-44 bg-[#0D0F17] border border-[#2A2C33] rounded-[14px] shadow-2xl p-1.5 flex flex-col gap-0.5 animate-in fade-in zoom-in-95 duration-100"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  onClick={() => {
                    togglePinSession(session.id);
                    setIsMenuOpen(false);
                  }}
                  className="w-full px-3 py-2 rounded-lg text-left text-xs text-[#F2F2F2] hover:bg-white/[0.06] flex items-center gap-2.5 transition"
                >
                  <Pin size={13} className={session.pinned ? 'text-amber-400' : 'text-[#A7A9AF]'} />
                  <span>{session.pinned ? 'Unpin Session' : 'Pin Session'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setTitleDraft(session.title);
                    setIsEditingTitle(true);
                    setIsMenuOpen(false);
                  }}
                  className="w-full px-3 py-2 rounded-lg text-left text-xs text-[#F2F2F2] hover:bg-white/[0.06] flex items-center gap-2.5 transition"
                >
                  <Edit2 size={13} className="text-[#A7A9AF]" />
                  <span>Rename Session</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    toggleArchiveSession(session.id);
                    setIsMenuOpen(false);
                  }}
                  className="w-full px-3 py-2 rounded-lg text-left text-xs text-[#F2F2F2] hover:bg-white/[0.06] flex items-center gap-2.5 transition"
                >
                  {session.archived ? (
                    <>
                      <ArchiveRestore size={13} className="text-[#A78BFA]" />
                      <span>Unarchive Session</span>
                    </>
                  ) : (
                    <>
                      <Archive size={13} className="text-[#A7A9AF]" />
                      <span>Archive Session</span>
                    </>
                  )}
                </button>

                <div className="h-px bg-white/[0.08] my-1" />

                <button
                  type="button"
                  onClick={() => {
                    setIsMenuOpen(false);
                    setDeletingSession(session);
                  }}
                  className="w-full px-3 py-2 rounded-lg text-left text-xs text-rose-400 hover:bg-rose-500/10 flex items-center gap-2.5 transition"
                >
                  <Trash2 size={13} />
                  <span>Delete Session</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── 2. Message History Stream ── */}
      <div className="flex-1 overflow-y-auto p-5 md:p-6 space-y-5 custom-scrollbar">
        {isLoadingMessages ? (
          <div className="py-16 text-center text-xs text-[#A7A9AF] font-sans">
            Loading conversation...
          </div>
        ) : activeMessages.length === 0 ? (
          /* Empty State */
          <div className="py-12 flex flex-col items-center justify-center text-center space-y-5 px-4 max-w-lg mx-auto">
            <div className="w-12 h-12 rounded-[14px] bg-[#131622] border border-[#2A2C33] flex items-center justify-center text-[#A78BFA] shadow-sm">
              <Sparkles size={20} strokeWidth={1.75} />
            </div>

            <div className="space-y-1">
              <h4 className="text-[15px] font-semibold text-[#F2F2F2] font-sans">
                {session.title}
              </h4>
              <p className="text-xs text-[#A7A9AF] font-sans leading-relaxed">
                Focused on <span className="text-[#C4B5FD] font-medium">{session.topic}</span>. Conversations in this session maintain persistent contextual memory.
              </p>
            </div>

            {/* Prompt Starter Chips */}
            <div className="space-y-2 w-full pt-1">
              <span className="text-[11px] font-mono uppercase tracking-wider text-[#A7A9AF]">
                Suggested Questions
              </span>
              <div className="flex flex-col gap-2">
                {topicStarters.map((starter, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => auraController.ask(starter)}
                    className="w-full text-left px-4 py-2.5 rounded-full bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] hover:border-[#A78BFA]/40 text-xs text-[#F2F2F2] transition flex items-center justify-between group active:scale-[0.99]"
                  >
                    <span className="font-sans truncate">{starter}</span>
                    <Send size={12} className="text-[#A7A9AF] group-hover:text-[#A78BFA] shrink-0 transition" />
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          /* Message Bubbles */
          activeMessages.map((msg) => {
            const isUser = msg.role === 'user';

            return (
              <div
                key={msg.id}
                className={`flex flex-col gap-1.5 group ${isUser ? 'items-end' : 'items-start'}`}
              >
                <div className="flex items-center gap-2 px-1">
                  <span className="text-[11px] font-mono text-[#A7A9AF] font-medium">
                    {isUser ? 'You' : 'Aura'}
                  </span>
                  <span className="text-[11px] font-mono text-[#A7A9AF]/60">
                    {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>

                <div
                  className={`relative max-w-[85%] rounded-[14px] px-4 py-3 text-[13px] leading-relaxed font-sans shadow-sm whitespace-pre-wrap ${
                    isUser
                      ? 'bg-[#202126] border border-white/[0.08] text-[#F2F2F2] rounded-br-sm'
                      : 'bg-[#131622] border border-[#2A2C33] border-l-2 border-l-[#6E8BFF] text-[#F2F2F2] rounded-bl-sm'
                  }`}
                >
                  {msg.content}

                  {/* Bubble Action Bar on hover */}
                  <div
                    className={`absolute -bottom-3 ${
                      isUser ? 'left-2' : 'right-2'
                    } opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 bg-[#0D0F17] border border-[#2A2C33] rounded-full px-2 py-0.5 shadow-md z-10`}
                  >
                    <button
                      type="button"
                      onClick={() => handleCopy(msg.id, msg.content)}
                      className="p-1 text-[#A7A9AF] hover:text-[#F2F2F2] transition"
                      title="Copy text"
                    >
                      {copiedId === msg.id ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
                    </button>
                    {!isUser && (
                      <button
                        type="button"
                        onClick={() => handleReadAloud(msg.content)}
                        className="p-1 text-[#A7A9AF] hover:text-[#A78BFA] transition"
                        title="Read aloud"
                      >
                        <Volume2 size={11} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}

        {/* Thinking Indicator */}
        {isBusy && (
          <div className="flex items-center gap-2.5 p-3 rounded-[14px] bg-[#131622] border border-[#2A2C33] text-xs text-[#A7A9AF] font-sans animate-pulse max-w-sm">
            <Sparkles size={14} className="text-[#A78BFA] animate-spin" />
            <span>Aura is formulating the response...</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* ── 3. Embedded Chat Composer ── */}
      <div className="p-4 border-t border-[#2A2C33] bg-[#0D0F17]/90 backdrop-blur-xl shrink-0">
        <div className="relative flex items-center gap-2 bg-[#11131C] border border-[#2A2C33] hover:border-white/[0.15] focus-within:border-[#A78BFA]/50 focus-within:ring-1 focus-within:ring-[#A78BFA]/20 rounded-full px-4 py-2 transition shadow-inner">
          <input
            type="text"
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isBusy}
            placeholder={`Ask Aura anything in this session...`}
            className="flex-1 bg-transparent border-none outline-none ring-0 focus:ring-0 text-xs md:text-sm text-[#F2F2F2] placeholder-[#A7A9AF] font-sans disabled:opacity-50"
            style={{ outline: 'none', border: 'none', boxShadow: 'none', background: 'transparent' }}
          />

          {isCharacterSpeaking ? (
            <button
              type="button"
              onClick={() => auraController.stopConversation()}
              className="p-2 rounded-full bg-rose-500/15 text-rose-300 hover:bg-rose-500/25 border border-rose-500/20 transition active:scale-95 shrink-0"
              title="Stop speaking"
            >
              <Square size={13} fill="currentColor" />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSend}
              disabled={!inputVal.trim() || isBusy}
              className="p-2 rounded-full bg-[#A78BFA] text-[#0B0D12] hover:bg-[#C4B5FD] disabled:opacity-30 disabled:hover:bg-[#A78BFA] transition active:scale-95 shrink-0"
              title="Send message"
            >
              <Send size={13} strokeWidth={2.5} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
