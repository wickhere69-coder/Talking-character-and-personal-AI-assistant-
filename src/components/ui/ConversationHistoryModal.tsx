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
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#2A2C33] bg-[#181818]">
          <div className="flex items-center gap-2.5">
            <MessageSquare size={16} strokeWidth={1.5} className="text-[#6E8BFF]" />
            <h2 className={TYPO.title}>
              Conversation Memory & History
            </h2>
            <span className="px-2 py-0.5 rounded-full font-mono text-[11px] bg-[#202126] text-[#A7A9AF] border border-[#2A2C33]">
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
        <div className="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar bg-[#181818]">
          {loading ? (
            <div className="py-16 text-center text-[#A7A9AF]/60 text-xs font-sans">
              Loading conversation history...
            </div>
          ) : history.length === 0 ? (
            <div className="py-16 text-center space-y-2 flex flex-col items-center justify-center">
              <div className="w-10 h-10 rounded-full bg-[#202126] border border-[#2A2C33] flex items-center justify-center mb-1">
                <MessageSquare size={18} strokeWidth={1.5} className="text-[#A7A9AF]" />
              </div>
              <p className="text-xs text-[#F2F2F2]/90 font-medium font-sans">No conversation history yet.</p>
              <p className="text-[11px] text-[#A7A9AF]/70 max-w-xs font-sans">
                Ask the AI Assistant a question or speak into the microphone to start a session.
              </p>
            </div>
          ) : (
            history.map((msg, idx) => (
              <div
                key={idx}
                className={`flex flex-col gap-1.5 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
              >
                <span className={`${TYPO.label} px-1 flex items-center gap-1.5 text-[#A7A9AF]`}>
                  {msg.role === 'user' ? (
                    <>
                      <User size={10} strokeWidth={1.5} />
                      <span>You</span>
                    </>
                  ) : (
                    <>
                      <Bot size={10} strokeWidth={1.5} className="text-[#6E8BFF]" />
                      <span>Aura AI Assistant</span>
                    </>
                  )}
                </span>
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-3 text-[13px] leading-relaxed select-text whitespace-pre-wrap font-sans ${
                    msg.role === 'user'
                      ? 'bg-[#202126] border border-[#2A2C33] text-[#F2F2F2] font-medium rounded-br-sm shadow-sm'
                      : 'bg-[#202126] border border-[#2A2C33] border-l-2 border-l-[#6E8BFF] text-[#F2F2F2]/90 rounded-bl-sm'
                  }`}
                >
                  {msg.content}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3 border-t border-[#2A2C33] bg-[#181818] flex items-center justify-between text-[11px] text-[#A7A9AF]">
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
