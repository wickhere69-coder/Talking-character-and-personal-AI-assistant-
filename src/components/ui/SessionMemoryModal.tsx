import React, { useState } from 'react';
import { useSessionStore } from '@/store/sessionStore';
import { Brain, X, Sparkles, RefreshCw, Check, Clock, MessageSquare, Tag } from 'lucide-react';
import { BUTTONS } from './designSystem';

export default function SessionMemoryModal() {
  const {
    isMemoryInspectorOpen,
    setIsMemoryInspectorOpen,
    getActiveSession,
    triggerSummarize,
    updateTopic
  } = useSessionStore();

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isEditingTopic, setIsEditingTopic] = useState(false);
  const [topicInput, setTopicInput] = useState('');

  const session = getActiveSession();
  if (!isMemoryInspectorOpen || !session) return null;

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await triggerSummarize(session.id);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleSaveTopic = async () => {
    if (topicInput.trim()) {
      await updateTopic(session.id, topicInput.trim());
    }
    setIsEditingTopic(false);
  };

  const createdDateStr = new Date(session.createdAt).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
  const updatedDateStr = new Date(session.updatedAt).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit'
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
      <div
        className="relative w-full max-w-lg bg-[#0D0F17]/95 border border-white/[0.08] rounded-[16px] p-6 shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="session-memory-title"
      >
        {/* Top cyan/blue hairline */}
        <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-[#A78BFA]/50 to-transparent" />

        {/* Modal Header */}
        <div className="flex items-center justify-between pb-4 border-b border-white/[0.08]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-[#A78BFA]/15 border border-[#A78BFA]/25 flex items-center justify-center text-[#A78BFA]">
              <Brain size={20} strokeWidth={2} />
            </div>
            <div>
              <h3 id="session-memory-title" className="text-sm font-semibold text-[#F2F2F2] font-sans">
                Session Contextual Memory
              </h3>
              <p className="text-[11px] text-[#A7A9AF] font-sans">
                Topic & rolling memory state for "{session.title}"
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setIsMemoryInspectorOpen(false)}
            className="w-8 h-8 rounded-full bg-white/[0.04] hover:bg-white/[0.08] text-[#A7A9AF] hover:text-[#F2F2F2] flex items-center justify-center transition active:scale-95"
            title="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto py-4 space-y-4 custom-scrollbar pr-1">
          {/* Metadata Row */}
          <div className="grid grid-cols-3 gap-2 p-3 rounded-[14px] bg-[#131622] border border-[#2A2C33] text-xs">
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] uppercase font-mono text-[#A7A9AF]/70 flex items-center gap-1">
                <Clock size={11} /> Created
              </span>
              <span className="text-[11px] font-sans text-[#F2F2F2]">{createdDateStr}</span>
            </div>

            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] uppercase font-mono text-[#A7A9AF]/70 flex items-center gap-1">
                <MessageSquare size={11} /> Messages
              </span>
              <span className="text-[11px] font-sans text-[#F2F2F2]">{session.messageCount} turns</span>
            </div>

            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] uppercase font-mono text-[#A7A9AF]/70 flex items-center gap-1">
                <Clock size={11} /> Last Active
              </span>
              <span className="text-[11px] font-sans text-[#F2F2F2]">{updatedDateStr}</span>
            </div>
          </div>

          {/* Primary Topic */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-mono uppercase tracking-wider text-[#A7A9AF] flex items-center gap-1.5">
                <Tag size={12} className="text-[#A78BFA]" /> Primary Session Topic
              </label>
              {!isEditingTopic && (
                <button
                  type="button"
                  onClick={() => {
                    setTopicInput(session.topic);
                    setIsEditingTopic(true);
                  }}
                  className="text-[11px] text-[#A78BFA] hover:underline font-mono"
                >
                  Edit Topic
                </button>
              )}
            </div>

            {isEditingTopic ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={topicInput}
                  onChange={(e) => setTopicInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSaveTopic()}
                  placeholder="e.g. React Architecture, Career Prep"
                  className="flex-1 px-3 py-1.5 rounded-xl bg-white/[0.05] border border-[#A78BFA]/50 text-xs text-[#F2F2F2] focus:outline-none"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={handleSaveTopic}
                  className="px-3 py-1.5 rounded-full bg-[#A78BFA] text-[#0B0D12] text-xs font-semibold flex items-center gap-1"
                >
                  <Check size={12} strokeWidth={2.5} /> Save
                </button>
                <button
                  type="button"
                  onClick={() => setIsEditingTopic(false)}
                  className="px-2 py-1.5 text-xs text-[#A7A9AF] hover:text-[#F2F2F2]"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="px-3.5 py-2.5 rounded-[14px] bg-[#131622] border border-[#2A2C33] text-xs text-[#F2F2F2] font-medium flex items-center justify-between">
                <span>{session.topic || 'General Assistant'}</span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[#A78BFA]/15 text-[#C4B5FD] border border-[#A78BFA]/25">
                  Active Scope
                </span>
              </div>
            )}
          </div>

          {/* Rolling Summary */}
          <div className="space-y-1.5">
            <span className="text-[11px] font-mono uppercase tracking-wider text-[#A7A9AF] flex items-center gap-1.5">
              <Sparkles size={12} className="text-[#A78BFA]" /> Rolling Conversation Summary
            </span>
            <div className="p-3.5 rounded-[14px] bg-[#131622] border border-[#2A2C33] text-xs text-[#F2F2F2]/90 leading-relaxed font-sans min-h-[60px] whitespace-pre-wrap">
              {session.summary?.trim() || (
                <span className="text-[#A7A9AF]/60 italic font-normal">
                  No summary generated yet. The AI automatically compiles a rolling summary as conversation turns progress.
                </span>
              )}
            </div>
          </div>

          {/* Established Facts & Decisions */}
          <div className="space-y-1.5">
            <span className="text-[11px] font-mono uppercase tracking-wider text-[#A7A9AF] flex items-center gap-1.5">
              <Brain size={12} className="text-emerald-400" /> Established Facts, Decisions & Preferences
            </span>
            {session.establishedFacts && session.establishedFacts.length > 0 ? (
              <ul className="space-y-1.5 p-3 rounded-[14px] bg-[#131622] border border-[#2A2C33]">
                {session.establishedFacts.map((fact, idx) => (
                  <li key={idx} className="text-xs text-[#F2F2F2]/85 flex items-start gap-2 leading-relaxed">
                    <span className="text-emerald-400 font-bold mt-0.5">•</span>
                    <span>{fact}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="p-3.5 rounded-[14px] bg-[#131622] border border-[#2A2C33] text-xs text-[#A7A9AF]/60 italic">
                No specific decisions or facts recorded in this session yet.
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="pt-4 border-t border-white/[0.08] flex items-center justify-between">
          <button
            type="button"
            onClick={handleRefresh}
            disabled={isRefreshing || session.messageCount < 2}
            className="px-3.5 py-2 rounded-full bg-white/[0.04] hover:bg-white/[0.08] text-[#F2F2F2] text-xs font-medium border border-white/[0.08] transition flex items-center gap-2 disabled:opacity-50 active:scale-95"
            title="Synthesize and update rolling summary from latest messages"
          >
            <RefreshCw size={13} className={isRefreshing ? 'animate-spin text-[#A78BFA]' : 'text-[#A7A9AF]'} />
            <span>{isRefreshing ? 'Updating Summary...' : 'Refresh Memory'}</span>
          </button>

          <button
            type="button"
            onClick={() => setIsMemoryInspectorOpen(false)}
            className={`px-4 py-2 ${BUTTONS.primary} text-xs font-semibold`}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

