import React, { useMemo } from 'react';
import { useAppStore } from '@/store/appStore';
import { resolveAgentConfirmation } from '@/services/agentService';
import { voiceManager } from '@/services/voiceManager';
import { BUTTONS } from './designSystem';
import { AlertCircle, ExternalLink, Check, X } from 'lucide-react';

export default function LowerThird() {
  const {
    speechText,
    currentWordIndex,
    playbackState,
    isSpeaking,
    pendingConfirmation,
    setPendingConfirmation,
    setAgentStatus,
    setSpeechText,
    setLastFullResponse,
    setIsFullResponseModalOpen,
    currentEmotion,
    agentStatus
  } = useAppStore();

  // Box appears while character is actively speaking, loading speech, or has speech text
  const isAnswering = (isSpeaking || playbackState === 'playing' || playbackState === 'loading' || agentStatus === 'speaking') && !!speechText?.trim();
  const isVisible = isAnswering || !!pendingConfirmation;

  const activeText = speechText || '';
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
      const activeVoice = store.voices.find(v => v.id === store.selectedVoice) || store.voices[0];
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

  if (!isVisible) return null;

  return (
    <div 
      className={`w-full max-w-xl md:max-w-2xl mx-auto px-4 z-30 transition-[transform,opacity] duration-200 ease-out transform-gpu pointer-events-none mb-3 ${
        isVisible ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0 pointer-events-none'
      }`}
    >
      {/* ── Aura Teleprompter Warm Mocha Glass Capsule ── */}
      <div className="relative overflow-hidden bg-[#14161E]/95 backdrop-blur-2xl rounded-[20px] px-5 py-4 border border-[#23252F] shadow-[0_24px_60px_-12px_rgba(0,0,0,0.8),0_0_40px_0_rgba(200,168,130,0.06)] pointer-events-auto flex flex-col gap-2.5 transition-all duration-200">
        
        {/* Subtle Antique Gold Top Accent Hairline */}
        <div className="absolute top-0 left-0 right-0 h-[1.5px] bg-gradient-to-r from-transparent via-[#8B7CFF]/60 to-transparent" />

        {/* Confirmation Banner */}
        {pendingConfirmation ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-1.5">
              <AlertCircle size={13} strokeWidth={1.5} className="text-amber-400" />
              <span className="text-[11px] font-medium uppercase tracking-wider text-amber-300 font-mono">
                Action Confirmation Required
              </span>
            </div>
            <div className="bg-amber-500/[0.08] border border-amber-500/20 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="text-xs text-amber-100/90 leading-relaxed font-sans">
                <span className="font-semibold text-amber-300">Action: {pendingConfirmation.toolName}</span>
                <p className="text-[11px] text-amber-200/70 mt-0.5">{pendingConfirmation.description}</p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <button type="button" onClick={() => handleConfirmAction(true)}
                  className="px-4 py-2 rounded-full bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/30 text-xs font-semibold transition-all duration-150 ease-out flex items-center gap-1.5 active:scale-95"
                >
                  <Check size={13} strokeWidth={2} /><span>Approve</span>
                </button>
                <button type="button" onClick={() => handleConfirmAction(false)}
                  className={`px-4 py-2 ${BUTTONS.secondary} text-xs font-medium flex items-center gap-1.5`}
                >
                  <X size={13} strokeWidth={2} /><span>Cancel</span>
                </button>
              </div>
            </div>
          </div>
        ) : (
          /* Spoken subtitle words with karaoke illumination */
          <div className="flex items-start justify-between gap-3">
            <div className="text-[#F2F2F2] text-[13px] md:text-[14px] font-normal leading-relaxed flex-1 max-h-24 overflow-y-auto custom-scrollbar select-text font-sans">
              <p className="m-0 p-0 whitespace-normal">
                {words.map((word, i) => {
                  const isCurrent = i === currentWordIndex;
                  return (
                    <React.Fragment key={i}>
                      <span className={`transition-all duration-150 inline-block ${
                        isCurrent
                          ? 'text-[#141110] font-semibold bg-[#8B7CFF] border border-[#8B7CFF] px-1.5 py-0.5 rounded-lg shadow-sm'
                          : i < currentWordIndex
                          ? 'text-[#F2F2F2]/40'
                          : 'text-[#F2F2F2]/90'
                      }`}>
                        {word}
                      </span>
                      {' '}
                    </React.Fragment>
                  );
                })}
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0 pt-0.5">
              {/* Animated Speaking Waveform Indicator (Antique Gold) */}
              {(isSpeaking || playbackState === 'playing') && (
                <div className="flex items-center gap-0.5 px-2 py-0.5 rounded-full bg-[#8B7CFF]/15 border border-[#8B7CFF]/30 text-[#8B7CFF]">
                  <span className="w-[2px] h-2.5 bg-[#8B7CFF] rounded-full animate-[pulse_0.6s_ease-in-out_infinite]" />
                  <span className="w-[2px] h-3.5 bg-[#8B7CFF] rounded-full animate-[pulse_0.4s_ease-in-out_infinite]" />
                  <span className="w-[2px] h-2 bg-[#8B7CFF] rounded-full animate-[pulse_0.8s_ease-in-out_infinite]" />
                  <span className="w-[2px] h-3 bg-[#8B7CFF] rounded-full animate-[pulse_0.5s_ease-in-out_infinite]" />
                </div>
              )}

              {currentEmotion.primary !== 'neutral' && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-[#8B7CFF]/15 text-[#E7C08E] border border-[#8B7CFF]/25 capitalize">
                  {currentEmotion.primary}
                </span>
              )}
              {words.length > 25 && (
                <button type="button" onClick={handleOpenFullResponse}
                  className={`text-xs px-2.5 py-1 ${BUTTONS.secondary} flex items-center gap-1.5`}
                >
                  <span>Full</span>
                  <ExternalLink size={11} strokeWidth={1.5} />
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
