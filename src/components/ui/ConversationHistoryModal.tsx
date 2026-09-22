import React, { useEffect, useState } from 'react';
import { useAppStore } from '@/store/appStore';
import { getAgentHistory, clearAgentHistory } from '@/services/agentService';
import { TYPO, BUTTONS, SURFACES } from './designSystem';
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xl animate-fade-in">
      <div
        className={`w-full max-w-2xl ${SURFACES.modalShell} overflow-hidden flex flex-col max-h-[80vh]`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06] bg-[#0F0F12]">
          <div className="flex items-center gap-2.5">
            <MessageSquare size={16} strokeWidth={1.5} className="text-[#8B5CF6]" />
            <h2 className={TYPO.title}>
              Conversation Memory & History
            </h2>
            <span className={`px-2 py-0.5 rounded-lg ${TYPO.mono} bg-white/[0.04] border border-white/[0.06]`}>
              {history.length} {history.length === 1 ? 'turn' : 'turns'}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {history.length > 0 && (
              <button
                type="button"
                onClick={handleClear}
                disabled={clearing}
                className={`text-xs px-3 py-1.5 ${BUTTONS.destructive} flex items-center gap-1.5`}
              >
                <Trash2 size={12} strokeWidth={1.5} />
                <span>{clearing ? 'Clearing...' : 'Clear History'}</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setIsHistoryModalOpen(false)}
              className={BUTTONS.icon}
              title="Close modal"
            >
              <X size={15} strokeWidth={1.5} />
            </button>
          </div>
        </div>

        {/* Message List */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar">
          {loading ? (
            <div className="py-16 text-center text-white/40 text-xs">
              Loading conversation history...
            </div>
          ) : history.length === 0 ? (
            <div className="py-16 text-center space-y-2 flex flex-col items-center justify-center">
              <div className="w-10 h-10 rounded-xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center mb-1">
                <MessageSquare size={18} strokeWidth={1.5} className="text-white/40" />
              </div>
              <p className="text-xs text-white/80 font-medium">No conversation history yet.</p>
              <p className="text-[11px] text-white/40 max-w-xs">
                Ask the AI Assistant a question or speak into the microphone to start a session.
              </p>
            </div>
          ) : (
            history.map((msg, idx) => (
              <div
                key={idx}
                className={`flex flex-col gap-1.5 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
              >
                <span className={`${TYPO.label} px-1 flex items-center gap-1.5`}>
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
                  className={`max-w-[85%] rounded-2xl px-4 py-3 text-[13px] leading-relaxed select-text whitespace-pre-wrap ${
                    msg.role === 'user'
                      ? 'bg-gradient-to-br from-[#8B5CF6] to-[#7C3AED] text-white rounded-br-sm shadow-[0_2px_12px_rgba(139,92,246,0.25)]'
                      : 'bg-[#141417] border border-white/[0.06] text-white/90 rounded-bl-sm'
                  }`}
                >
                  {msg.content}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3 border-t border-white/[0.06] bg-[#0F0F12] flex items-center justify-between text-[11px] text-white/40">
          <span>Stored locally in private session memory</span>
          <button
            type="button"
            onClick={() => setIsHistoryModalOpen(false)}
            className={`px-4 py-1.5 text-xs ${BUTTONS.secondary}`}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
