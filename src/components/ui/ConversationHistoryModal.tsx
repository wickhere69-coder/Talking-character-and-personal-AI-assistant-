import React, { useEffect, useState } from 'react';
import { useAppStore } from '@/store/appStore';
import { getAgentHistory, clearAgentHistory } from '@/services/agentService';
import { X, Trash2, Bot, User, MessageSquare } from 'lucide-react';

export default function ConversationHistoryModal() {
  const { isHistoryModalOpen, setIsHistoryModalOpen } = useAppStore();
  const [history, setHistory] = useState<Array<{ role: string; content: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    if (isHistoryModalOpen) {
      setLoading(true);
      getAgentHistory()
        .then((items) => setHistory(items || []))
        .finally(() => setLoading(false));
    }
  }, [isHistoryModalOpen]);

  const handleClear = async () => {
    setClearing(true);
    await clearAgentHistory();
    setHistory([]);
    setClearing(false);
  };

  if (!isHistoryModalOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-fade-in">
      <div 
        className="w-full max-w-2xl bg-[#111113]/95 border border-white/[0.08] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06] bg-[#151518]/50">
          <div className="flex items-center gap-2.5">
            <MessageSquare size={16} strokeWidth={1.5} className="text-[#8B5CF6]" />
            <h2 className="text-sm font-semibold text-[#F5F5F7] tracking-wide uppercase">
              Conversation Memory & History
            </h2>
            <span className="text-[11px] text-[#9898A3] px-2 py-0.5 rounded-full bg-white/[0.04]">
              {history.length} turns
            </span>
          </div>

          <div className="flex items-center gap-2">
            {history.length > 0 && (
              <button
                type="button"
                onClick={handleClear}
                disabled={clearing}
                className="text-xs text-rose-400 hover:text-rose-300 px-3 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 transition-all flex items-center gap-1.5"
              >
                <Trash2 size={12} strokeWidth={1.5} />
                <span>{clearing ? 'Clearing...' : 'Clear History'}</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setIsHistoryModalOpen(false)}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-[#9898A3] hover:text-[#F5F5F7] hover:bg-white/[0.06] transition-all"
              title="Close modal"
            >
              <X size={15} strokeWidth={1.5} />
            </button>
          </div>
        </div>

        {/* Message List */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar">
          {loading ? (
            <div className="py-12 text-center text-[#686873] text-sm">
              Loading conversation history...
            </div>
          ) : history.length === 0 ? (
            <div className="py-12 text-center text-[#686873] text-sm space-y-1">
              <p>No conversation history yet.</p>
              <p className="text-xs text-[#686873]/70">Ask the AI Assistant a question or speak into the microphone to start.</p>
            </div>
          ) : (
            history.map((msg, idx) => (
              <div 
                key={idx} 
                className={`flex flex-col gap-1 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
              >
                <span className="text-[10px] uppercase tracking-wider text-[#686873] font-medium px-1 flex items-center gap-1">
                  {msg.role === 'user' ? (
                    <>
                      <User size={10} strokeWidth={1.5} />
                      <span>You</span>
                    </>
                  ) : (
                    <>
                      <Bot size={10} strokeWidth={1.5} className="text-[#8B5CF6]" />
                      <span>Studio AI Assistant</span>
                    </>
                  )}
                </span>
                <div 
                  className={`max-w-[85%] rounded-2xl px-4 py-3 text-xs leading-relaxed select-text whitespace-pre-wrap ${
                    msg.role === 'user' 
                      ? 'bg-gradient-to-r from-[#7C3AED] to-[#6D28D9] text-[#F5F5F7] rounded-br-sm shadow-md' 
                      : 'bg-[#1A1A1F] border border-white/[0.06] text-[#F5F5F7]/90 rounded-bl-sm'
                  }`}
                >
                  {msg.content}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3 border-t border-white/[0.06] bg-[#151518]/50 flex items-center justify-between text-[11px] text-[#686873]">
          <span>Stored locally in private session memory</span>
          <button
            type="button"
            onClick={() => setIsHistoryModalOpen(false)}
            className="px-4 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-[#F5F5F7] font-medium transition-all"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
