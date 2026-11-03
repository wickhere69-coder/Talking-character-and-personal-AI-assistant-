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
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-xl animate-fade-in">
      <div
        className={`w-full max-w-2xl ${SURFACES.modalShell} overflow-hidden flex flex-col max-h-[80vh] border border-[#23252F]`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#23252F] bg-[#14161E]/90">
          <div className="flex items-center gap-2.5">
            <span className="text-[#8B7CFF] text-sm">✦</span>
            <h2 className="font-sans text-[15px] font-semibold tracking-tight text-[#F2F2F2]">
              Archival Conversation Memory
            </h2>
            <span className="px-2.5 py-0.5 rounded-full font-sans text-[11px] bg-[#1A1D27] text-[#C9CBD3] border border-[#23252F]">
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
        <div className="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar bg-[#14161E]">
          {loading ? (
            <div className="py-16 text-center text-[#7A7D86] text-xs font-sans">
              Loading archival conversation history...
            </div>
          ) : history.length === 0 ? (
            <div className="py-16 text-center space-y-2 flex flex-col items-center justify-center">
              <div className="w-10 h-10 rounded-full bg-[#1A1D27] border border-[#23252F] flex items-center justify-center mb-1">
                <MessageSquare size={18} strokeWidth={1.5} className="text-[#7A7D86]" />
              </div>
              <p className="text-xs text-[#F2F2F2] font-medium font-sans">No conversation history yet.</p>
              <p className="text-[11px] text-[#7A7D86] max-w-xs font-sans">
                Ask Aura a question or speak into the microphone to begin.
              </p>
            </div>
          ) : (
            history.map((msg, idx) => (
              <div
                key={idx}
                className={`flex flex-col gap-1.5 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
              >
                <span className={`${TYPO.label} px-1 flex items-center gap-1.5 text-[#7A7D86]`}>
                  {msg.role === 'user' ? (
                    <>
                      <User size={10} strokeWidth={1.5} />
                      <span>You</span>
                    </>
                  ) : (
                    <>
                      <Bot size={10} strokeWidth={1.5} className="text-[#8B7CFF]" />
                      <span>Aura</span>
                    </>
                  )}
                </span>
                <div
                  className={`max-w-[85%] rounded-[16px] px-4 py-3 text-[13px] leading-relaxed select-text whitespace-pre-wrap font-sans shadow-sm ${
                    msg.role === 'user'
                      ? 'bg-[#202431] border border-[#23252F] text-[#F2F2F2] font-medium rounded-br-sm'
                      : 'bg-[#1A1D27] border border-[#23252F] border-l-2 border-l-[#8B7CFF] text-[#F2F2F2] rounded-bl-sm'
                  }`}
                >
                  {msg.content}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3 border-t border-[#23252F] bg-[#14161E]/90 flex items-center justify-between text-[11px] text-[#7A7D86]">
          <span>Stored in private archival session memory</span>
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
