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
  ArchiveRestore,
  Lightbulb,
  Shirt,
  BookOpen
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
    playbackState,
    agentSpeed
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
    if (!trimmed) return;
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

  // Curated suggested follow-ups
  const curatedSuggestions = [
    { text: "What is happening in Israel today?", icon: Sparkles },
    { text: "Summarize latest developments", icon: Lightbulb },
    { text: "Help me analyze a complex problem", icon: BookOpen },
    { text: "Explain your tools and capabilities", icon: Shirt }
  ];

  if (!session) {
    return (
      <div className="flex-1 h-full flex flex-col items-center justify-center p-8 text-center space-y-4 select-none font-sans">
        <div className="w-12 h-12 rounded-[16px] bg-[#1A1D27] border border-[#2A2E3B] flex items-center justify-center text-[#8B7CFF]">
          <MessageSquare size={22} strokeWidth={1.75} />
        </div>
        <div className="space-y-1">
          <p className="text-[15px] font-bold text-[#F2F2F2]">No Conversation Selected</p>
          <p className="text-xs text-[#7A7D86] max-w-xs leading-relaxed">
            Select a session from the history sidebar or create a new conversation to start.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden bg-transparent select-text font-sans">
      {/* ── 1. Top Session Header ── */}
      <div className="px-5 py-3.5 border-b border-[#23252F] bg-[#14161E]/95 backdrop-blur-xl flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          {showBackControl && (
            <button
              type="button"
              onClick={onBackToSessions}
              className="p-1.5 rounded-full bg-[#1A1D27] hover:bg-[#202431] text-[#C9CBD3] hover:text-[#FFFFFF] transition active:scale-95 shrink-0 border border-[#2A2E3B]"
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
                  className="px-3 py-1 rounded-[12px] bg-[#1A1D27] border border-[#8B7CFF] text-xs text-[#F2F2F2] focus:outline-none w-full max-w-xs font-sans"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={handleSaveTitle}
                  className="p-1.5 rounded-full bg-[#8B7CFF] text-white hover:bg-[#9E91FF] shrink-0 transition"
                >
                  <Check size={13} strokeWidth={2.5} />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2 group">
                <h3
                  className="text-[16px] font-bold text-[#FFFFFF] tracking-tight truncate cursor-pointer hover:text-[#8B7CFF] transition"
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
                  className="opacity-0 group-hover:opacity-100 p-0.5 text-[#7A7D86] hover:text-[#FFFFFF] transition shrink-0"
                  title="Rename"
                >
                  <Edit2 size={12} />
                </button>
              </div>
            )}

            <div className="flex items-center gap-2.5 mt-1">
              <span className="text-[11px] px-2.5 py-0.5 rounded-[12px] bg-[#1A1D27] text-[#C9CBD3] border border-[#2A2E3B] flex items-center gap-1.5">
                <Tag size={10} className="text-[#8B7CFF]" />
                {session.topic || 'General'}
              </span>
              <span className="text-[11px] text-[#7A7D86]">
                {activeMessages.length} msgs • Today
              </span>
              {session.pinned && (
                <span className="text-[11px] text-[#8B7CFF] flex items-center gap-1">
                  <Pin size={10} fill="currentColor" /> Pinned
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Action Controls: Memory Pill + Menu */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Memory Inspector Button */}
          <button
            type="button"
            onClick={() => setIsMemoryInspectorOpen(true)}
            className="px-3 py-1.5 rounded-[19px] bg-[#1A1D27] hover:bg-[#202431] border border-[#2A2E3B] text-[#C9CBD3] hover:text-[#FFFFFF] text-[11px] font-medium transition flex items-center gap-1.5 active:scale-95 shadow-sm cursor-pointer"
            title="Inspect Topic & Contextual Memory for this session"
          >
            <Brain size={13} strokeWidth={2} className="text-[#8B7CFF]" />
            <span>Memory</span>
          </button>

          {/* Direct Delete Session Button */}
          <button
            type="button"
            onClick={() => setDeletingSession(session)}
            className="p-2 rounded-full border border-[#2A2E3B] bg-[#1A1D27] hover:bg-rose-500/15 text-[#7A7D86] hover:text-rose-400 hover:border-rose-500/30 transition active:scale-95 cursor-pointer"
            title="Delete this session"
          >
            <Trash2 size={14} />
          </button>

          {/* Single More Options Dropdown */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setIsMenuOpen(!isMenuOpen)}
              className="p-2 rounded-full border border-[#2A2E3B] bg-[#1A1D27] hover:bg-[#202431] text-[#7A7D86] hover:text-[#FFFFFF] transition active:scale-95"
              title="More session options"
            >
              <MoreVertical size={14} />
            </button>

            {isMenuOpen && (
              <div
                className="absolute right-0 top-10 z-50 w-44 bg-[#14161E] border border-[#23252F] rounded-[16px] shadow-2xl p-1.5 flex flex-col gap-0.5"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  onClick={() => {
                    togglePinSession(session.id);
                    setIsMenuOpen(false);
                  }}
                  className="w-full px-3 py-2 rounded-lg text-left text-xs text-[#F2F2F2] hover:bg-[#1A1D27] flex items-center gap-2.5 transition"
                >
                  <Pin size={13} className={session.pinned ? 'text-[#8B7CFF]' : 'text-[#7A7D86]'} />
                  <span>{session.pinned ? 'Unpin Session' : 'Pin Session'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setTitleDraft(session.title);
                    setIsEditingTitle(true);
                    setIsMenuOpen(false);
                  }}
                  className="w-full px-3 py-2 rounded-lg text-left text-xs text-[#F2F2F2] hover:bg-[#1A1D27] flex items-center gap-2.5 transition"
                >
                  <Edit2 size={13} className="text-[#7A7D86]" />
                  <span>Rename Session</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    toggleArchiveSession(session.id);
                    setIsMenuOpen(false);
                  }}
                  className="w-full px-3 py-2 rounded-lg text-left text-xs text-[#F2F2F2] hover:bg-[#1A1D27] flex items-center gap-2.5 transition"
                >
                  {session.archived ? (
                    <>
                      <ArchiveRestore size={13} className="text-[#8B7CFF]" />
                      <span>Unarchive Session</span>
                    </>
                  ) : (
                    <>
                      <Archive size={13} className="text-[#7A7D86]" />
                      <span>Archive Session</span>
                    </>
                  )}
                </button>

                <div className="h-px bg-[#23252F] my-1" />

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

      {/* ── Mode Pill (Figma Frame 13:28: Deep Think • Voice) ── */}
      <div className="px-5 pt-3 pb-1 flex items-center justify-between shrink-0">
        <div className="h-[34px] px-3.5 rounded-[19px] bg-[#1A1D27] border border-[#2A2E3B] text-[12px] text-[#C9CBD3] flex items-center gap-2">
          <span className="text-[#8B7CFF] font-bold">◉</span>
          <span>{agentSpeed === 'langgraph' ? 'Deep Think' : 'Balanced'} • Voice</span>
        </div>
        <span className="text-[11px] text-[#7A7D86]">
          {activeMessages.length} messages • Today
        </span>
      </div>

      {/* ── 2. Message History Stream ── */}
      <div className="flex-1 overflow-y-auto p-5 space-y-4 custom-scrollbar">
        {isLoadingMessages ? (
          <div className="py-16 text-center text-xs text-[#7A7D86] font-sans">
            Loading conversation...
          </div>
        ) : activeMessages.length === 0 ? (
          /* Empty State (Figma Style) */
          <div className="py-8 flex flex-col items-center justify-center text-center space-y-5 px-4 max-w-lg mx-auto">
            <div className="w-12 h-12 rounded-[16px] bg-[#1A1D27] border border-[#8B7CFF]/30 flex items-center justify-center text-[#8B7CFF] shadow-sm">
              <Sparkles size={22} />
            </div>

            <div className="space-y-1">
              <h4 className="text-[17px] font-bold text-[#F2F2F2] tracking-tight">
                {session.title}
              </h4>
              <p className="text-xs text-[#A7A9AF] leading-relaxed">
                Focused on <span className="text-[#8B7CFF] font-medium">{session.topic}</span>. Conversations in this session maintain persistent memory.
              </p>
            </div>

            {/* Suggested Follow-ups Chips */}
            <div className="space-y-2.5 w-full pt-2">
              <p className="text-[11px] tracking-wider font-semibold text-[#7A7D86] uppercase text-center">
                SUGGESTED PROMPTS
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {curatedSuggestions.map((item, i) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => auraController.ask(item.text)}
                      className="group flex items-center gap-3 p-3 rounded-[14px] bg-[#1A1D27] hover:bg-[#202431] border border-[#2A2E3B] hover:border-[#8B7CFF]/50 text-left transition-all duration-200 active:scale-[0.99] cursor-pointer"
                    >
                      <div className="w-7 h-7 rounded-lg bg-[#14161E] border border-[#23252F] flex items-center justify-center shrink-0 text-[#8B7CFF]">
                        <Icon size={14} />
                      </div>
                      <span className="text-xs leading-snug font-medium text-[#F2F2F2] flex-1">
                        {item.text}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
          /* Message Bubbles matching Figma Frame 13:28 */
          activeMessages.map((msg) => {
            const isUser = msg.role === 'user';

            return (
              <div
                key={msg.id}
                className={`flex flex-col gap-1.5 group ${isUser ? 'items-end' : 'items-start'}`}
              >
                <div className="flex items-center gap-2 px-1">
                  <span className="text-[11px] text-[#7A7D86] font-medium">
                    {isUser ? 'You' : 'Aura'}
                  </span>
                  <span className="text-[10px] text-[#7A7D86]/60">
                    {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>

                <div
                  className={`relative max-w-[85%] rounded-[16px] px-4 py-3 text-[13px] md:text-[14px] leading-relaxed whitespace-pre-wrap ${
                    isUser
                      ? 'bg-[#1A1D27] border border-[#2A2E3B] text-[#F2F2F2]'
                      : 'bg-[#232845] border border-[#8B7CFF] text-[#F2F2F2] shadow-[0_4px_20px_rgba(139,124,255,0.1)]'
                  }`}
                >
                  <p>{msg.content}</p>

                  {/* Actions for messages */}
                  <div className="flex items-center gap-2 mt-2 pt-1 border-t border-white/5 opacity-0 group-hover:opacity-100 transition-opacity justify-end">
                    <button
                      type="button"
                      onClick={() => handleCopy(msg.id, msg.content)}
                      className="p-1 rounded text-[#7A7D86] hover:text-[#FFFFFF] transition"
                      title="Copy text"
                    >
                      {copiedId === msg.id ? <Check size={12} className="text-[#34D399]" /> : <Copy size={12} />}
                    </button>
                    {!isUser && (
                      <button
                        type="button"
                        onClick={() => handleReadAloud(msg.content)}
                        className="p-1 rounded text-[#7A7D86] hover:text-[#8B7CFF] transition"
                        title="Read aloud"
                      >
                        <Volume2 size={12} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* ── 3. Bottom Composer Pill (Figma: Height 64px, Fill #1C1F2A, Border #2A2E3B, Radius 33px) ── */}
      <div className="p-4 border-t border-[#23252F] bg-[#14161E]">
        <div className="flex items-center gap-2 h-12 px-3.5 rounded-[33px] bg-[#1C1F2A] border border-[#2A2E3B] focus-within:border-[#8B7CFF] transition">
          <input
            type="text"
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isBusy ? "Thinking..." : "Message Aura…"}
            className="flex-1 bg-transparent border-none outline-none text-xs md:text-sm text-[#F2F2F2] placeholder-[#7A7D86]"
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={!inputVal.trim()}
            className="w-8 h-8 rounded-full bg-[#8B7CFF] hover:bg-[#9E91FF] disabled:opacity-40 text-white flex items-center justify-center transition active:scale-95 cursor-pointer disabled:cursor-not-allowed"
            title="Send"
          >
            <Send size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}
