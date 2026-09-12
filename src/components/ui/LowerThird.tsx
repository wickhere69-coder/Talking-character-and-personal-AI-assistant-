import React, { useMemo } from 'react';
import { useAppStore } from '@/store/appStore';
import { resolveAgentConfirmation } from '@/services/agentService';
import { voiceManager } from '@/services/voiceManager';
import { 
  AlertCircle, 
  Loader2, 
  Zap, 
  Mic, 
  Volume2, 
  CheckCircle2, 
  XCircle, 
  Sparkles, 
  ExternalLink, 
  Check, 
  X 
} from 'lucide-react';

export default function LowerThird() {
  const { 
    scriptText, 
    speechText,
    currentWordIndex, 
    playbackState, 
    isListening, 
    isSpeaking,
    agentModeType,
    agentStatus,
    currentAgentAction,
    pendingConfirmation,
    setPendingConfirmation,
    setAgentStatus,
    setSpeechText,
    setLastFullResponse,
    setIsFullResponseModalOpen
  } = useAppStore();

  const isVisible = 
    playbackState === 'playing' || 
    isListening || 
    isSpeaking || 
    agentStatus === 'thinking' || 
    agentStatus === 'planning' || 
    agentStatus === 'executing_tool' || 
    agentStatus === 'completed' ||
    !!pendingConfirmation;

  const activeText = speechText || scriptText;
  const words = useMemo(() => activeText.split(/\s+/).filter(Boolean), [activeText]);

  const handleConfirmAction = async (approved: boolean) => {
    if (!pendingConfirmation) return;
    const confId = pendingConfirmation.id;
    setPendingConfirmation(null);
    setAgentStatus('thinking');

    try {
      const res = await resolveAgentConfirmation(confId, approved);
      setAgentStatus('speaking');
      setSpeechText(res.response);
      const store = useAppStore.getState();
      const activeVoice = store.voices.find(v => v.id === store.selectedVoice)
        || store.voices.find(v => v.id === 'en-US-JennyNeural')
        || store.voices[0];
      await voiceManager.speak(res.response, activeVoice);
    } catch {
      setAgentStatus('error');
    }
  };

  const handleOpenFullResponse = () => {
    if (activeText) {
      setLastFullResponse(activeText);
      setIsFullResponseModalOpen(true);
    }
  };

  if (!isVisible && !scriptText.trim()) return null;

  return (
    <div 
      className={`fixed bottom-6 left-6 right-[410px] max-md:right-6 max-md:bottom-6 z-40 transition-transform transition-opacity duration-300 transform-gpu pointer-events-none ${
        isVisible ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0'
      }`}
    >
      <div className="bg-[#111113] rounded-2xl px-6 py-4 border-l-[3px] border-l-[#7C3AED] border border-white/[0.08] shadow-[0_16px_36px_rgba(0,0,0,0.55),0_0_40px_rgba(124,58,237,0.06)] pointer-events-auto flex flex-col gap-2.5">
        
        {/* Dynamic Real Agent State Header */}
        <div className="flex items-center justify-between border-b border-white/[0.04] pb-2">
          <div className="flex items-center gap-2">
            {pendingConfirmation ? (
              <>
                <AlertCircle size={13} strokeWidth={1.5} className="text-amber-400" />
                <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-amber-300">
                  Action Confirmation Required
                </span>
              </>
            ) : agentStatus === 'thinking' ? (
              <>
                <Loader2 size={13} strokeWidth={1.5} className="text-[#A78BFA] animate-spin" />
                <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-[#A78BFA]">
                  Thinking & Analyzing...
                </span>
              </>
            ) : agentStatus === 'planning' ? (
              <>
                <Loader2 size={13} strokeWidth={1.5} className="text-indigo-400 animate-spin" />
                <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-indigo-300">
                  Planning Multi-Step Task...
                </span>
              </>
            ) : agentStatus === 'executing_tool' ? (
              <>
                <Zap size={13} strokeWidth={1.5} className="text-cyan-400" />
                <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-cyan-300">
                  {currentAgentAction || 'Executing Local Tool...'}
                </span>
              </>
            ) : isListening ? (
              <>
                <Mic size={13} strokeWidth={1.5} className="text-rose-400" />
                <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-rose-400">
                  Listening to Microphone...
                </span>
              </>
            ) : isSpeaking || playbackState === 'playing' ? (
              <>
                <Volume2 size={13} strokeWidth={1.5} className="text-emerald-400" />
                <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-emerald-300">
                  Speaking Response...
                </span>
              </>
            ) : agentStatus === 'completed' ? (
              <>
                <CheckCircle2 size={13} strokeWidth={1.5} className="text-emerald-400" />
                <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-emerald-300">
                  Task Completed
                </span>
              </>
            ) : agentStatus === 'error' ? (
              <>
                <XCircle size={13} strokeWidth={1.5} className="text-rose-400" />
                <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-rose-400">
                  Action Issue
                </span>
              </>
            ) : (
              <>
                <Sparkles size={13} strokeWidth={1.5} className="text-[#8B5CF6]" />
                <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-[#9898A3]">
                  AI Agent Ready • {agentModeType === 'chat' ? 'Chat Mode' : agentModeType === 'repeat' ? 'Repeat Mode' : 'Agent Mode'}
                </span>
              </>
            )}
          </div>

          {words.length > 25 && (
            <button
              type="button"
              onClick={handleOpenFullResponse}
              className="text-[10px] text-[#A78BFA] hover:text-white bg-[#7C3AED]/15 hover:bg-[#7C3AED]/25 border border-[#8B5CF6]/20 px-2.5 py-1 rounded-lg transition-all flex items-center gap-1"
            >
              <span>Full Response</span>
              <ExternalLink size={10} strokeWidth={1.5} />
            </button>
          )}
        </div>

        {/* Confirmation Banner */}
        {pendingConfirmation && (
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 mt-1">
            <div className="text-xs text-amber-100/90 leading-relaxed">
              <span className="font-semibold text-amber-300">Action: {pendingConfirmation.toolName}</span>
              <p className="text-[11px] text-amber-200/70 mt-0.5">{pendingConfirmation.description}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => handleConfirmAction(true)}
                className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium shadow-md transition-all flex items-center gap-1"
              >
                <Check size={12} strokeWidth={1.5} />
                <span>Approve</span>
              </button>
              <button
                type="button"
                onClick={() => handleConfirmAction(false)}
                className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white/70 hover:text-white text-xs font-medium transition-all flex items-center gap-1"
              >
                <X size={12} strokeWidth={1.5} />
                <span>Cancel</span>
              </button>
            </div>
          </div>
        )}

        {/* Subtitle Words with Natural Spacing */}
        {!pendingConfirmation && (
          <div className="text-[#F5F5F7] text-[14px] md:text-[15px] font-normal leading-relaxed max-h-24 overflow-y-auto custom-scrollbar select-text">
            {words.length > 0 ? (
              <p className="m-0 p-0 whitespace-normal">
                {words.map((word, i) => {
                  const isCurrent = i === currentWordIndex;
                  return (
                    <React.Fragment key={i}>
                      <span 
                        className={`transition-colors duration-150 ${
                          isCurrent 
                            ? 'text-[#F5F5F7] font-semibold bg-[#7C3AED]/30 px-1 py-0.5 rounded-[4px]' 
                            : i < currentWordIndex 
                              ? 'text-[#686873]' 
                              : 'text-[#9898A3]'
                        }`}
                      >
                        {word}
                      </span>
                      {' '}
                    </React.Fragment>
                  );
                })}
              </p>
            ) : (
              <span className="text-[#686873] italic text-[12px]">
                {agentStatus === 'thinking' ? 'Analyzing your request...' : 'Ready for voice or text prompt...'}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
