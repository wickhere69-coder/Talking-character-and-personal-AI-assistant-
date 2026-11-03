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
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
      <div
        className="relative w-full max-w-lg bg-[#14161E]/95 border border-[#23252F] rounded-[24px] p-6 shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="session-memory-title"
      >
        {/* Top antique gold hairline */}
        <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-[#8B7CFF]/60 to-transparent" />

        {/* Modal Header */}
        <div className="flex items-center justify-between pb-4 border-b border-[#23252F]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-[#8B7CFF]/15 border border-[#8B7CFF]/30 flex items-center justify-center text-[#8B7CFF]">
              <Brain size={18} strokeWidth={2} />
            </div>
            <div>
              <h3 id="session-memory-title" className="text-sm font-semibold text-[#F2F2F2] font-sans">
                Archival Contextual Memory
              </h3>
              <p className="text-[11px] text-[#7A7D86] font-sans">
                Topic & rolling memory state for "{session.title}"
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setIsMemoryInspectorOpen(false)}
            className="w-8 h-8 rounded-full bg-[#1A1D27] hover:bg-[#202431] text-[#7A7D86] hover:text-[#F2F2F2] flex items-center justify-center transition active:scale-95 border border-[#23252F]"
            title="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto py-4 space-y-4 custom-scrollbar pr-1">
          {/* Metadata Row */}
          <div className="grid grid-cols-3 gap-2 p-3 rounded-[16px] bg-[#1A1D27] border border-[#23252F] text-xs">
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] uppercase font-sans text-[#7A7D86] flex items-center gap-1 font-semibold">
                <Clock size={11} /> Created
              </span>
              <span className="text-[11px] font-sans text-[#F2F2F2]">{createdDateStr}</span>
            </div>

            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] uppercase font-sans text-[#7A7D86] flex items-center gap-1 font-semibold">
                <MessageSquare size={11} /> Messages
              </span>
              <span className="text-[11px] font-sans text-[#F2F2F2]">{session.messageCount} turns</span>
            </div>

            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] uppercase font-sans text-[#7A7D86] flex items-center gap-1 font-semibold">
                <Clock size={11} /> Last Active
              </span>
              <span className="text-[11px] font-sans text-[#F2F2F2]">{updatedDateStr}</span>
            </div>
          </div>

          {/* Primary Topic */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-sans uppercase tracking-[0.12em] text-[#7A7D86] font-semibold flex items-center gap-1.5">
                <Tag size={12} className="text-[#8B7CFF]" /> Primary Session Topic
              </label>
              {!isEditingTopic && (
                <button
                  type="button"
                  onClick={() => {
                    setTopicInput(session.topic);
                    setIsEditingTopic(true);
                  }}
                  className="text-[11px] text-[#8B7CFF] hover:underline font-sans"
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
                  placeholder="e.g. Editorial Synthesis, Studio Setup"
                  className="flex-1 px-3 py-1.5 rounded-full bg-[#1A1D27] border border-[#8B7CFF]/50 text-xs text-[#F2F2F2] focus:outline-none"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={handleSaveTopic}
                  className="px-3 py-1.5 rounded-full bg-[#8B7CFF] text-[#FFFFFF] text-xs font-semibold flex items-center gap-1"
                >
                  <Check size={12} strokeWidth={2.5} /> Save
                </button>
                <button
                  type="button"
                  onClick={() => setIsEditingTopic(false)}
                  className="px-2 py-1.5 text-xs text-[#7A7D86] hover:text-[#F2F2F2]"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="px-3.5 py-2.5 rounded-[16px] bg-[#1A1D27] border border-[#23252F] text-xs text-[#F2F2F2] font-medium flex items-center justify-between">
                <span>{session.topic || 'General Assistant'}</span>
                <span className="text-[10px] font-sans px-2.5 py-0.5 rounded-full bg-[#8B7CFF]/15 text-[#8B7CFF] border border-[#8B7CFF]/25 font-semibold">
                  Active Scope
                </span>
              </div>
            )}
          </div>

          {/* Rolling Summary */}
          <div className="space-y-1.5">
            <span className="text-[11px] font-sans uppercase tracking-[0.12em] text-[#7A7D86] font-semibold flex items-center gap-1.5">
              <span className="text-[#8B7CFF] text-xs">✦</span> Rolling Archival Summary
            </span>
            <div className="p-3.5 rounded-[16px] bg-[#1A1D27] border border-[#23252F] text-xs text-[#F2F2F2]/90 leading-relaxed font-sans min-h-[60px] whitespace-pre-wrap">
              {session.summary?.trim() || (
                <span className="text-[#7A7D86] italic font-normal">
                  No summary generated yet. Aura automatically compiles an archival summary as conversation turns progress.
                </span>
              )}
            </div>
          </div>

          {/* Established Facts & Decisions */}
          <div className="space-y-1.5">
            <span className="text-[11px] font-sans uppercase tracking-[0.12em] text-[#7A7D86] font-semibold flex items-center gap-1.5">
              <Brain size={12} className="text-[#8B7CFF]" /> Established Facts, Decisions & Preferences
            </span>
            {session.establishedFacts && session.establishedFacts.length > 0 ? (
              <ul className="space-y-1.5 p-3 rounded-[16px] bg-[#1A1D27] border border-[#23252F]">
                {session.establishedFacts.map((fact, idx) => (
                  <li key={idx} className="text-xs text-[#F2F2F2]/85 flex items-start gap-2 leading-relaxed">
                    <span className="text-[#8B7CFF] font-bold mt-0.5">•</span>
                    <span>{fact}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="p-3.5 rounded-[16px] bg-[#1A1D27] border border-[#23252F] text-xs text-[#7A7D86] italic">
                No specific decisions or facts recorded in this session yet.
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="pt-4 border-t border-[#23252F] flex items-center justify-between">
          <button
            type="button"
            onClick={handleRefresh}
            disabled={isRefreshing || session.messageCount < 2}
            className="px-3.5 py-2 rounded-full bg-[#1A1D27] hover:bg-[#202431] text-[#F2F2F2] text-xs font-medium border border-[#23252F] transition flex items-center gap-2 disabled:opacity-50 active:scale-95"
            title="Synthesize and update rolling summary from latest messages"
          >
            <RefreshCw size={13} className={isRefreshing ? 'animate-spin text-[#8B7CFF]' : 'text-[#7A7D86]'} />
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
