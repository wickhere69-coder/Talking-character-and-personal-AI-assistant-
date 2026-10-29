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
      className={`w-full max-w-2xl lg:max-w-3xl mx-auto px-4 z-30 transition-[transform,opacity] duration-200 ease-out transform-gpu pointer-events-none mb-3 ${
        isVisible ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0 pointer-events-none'
      }`}
    >
      {/* ── Cinematic Teleprompter Glass Capsule ── */}
      <div className="relative overflow-hidden bg-[#0D0F17]/88 backdrop-blur-2xl rounded-2xl px-5 py-4 border border-white/[0.1] shadow-[0_24px_64px_rgba(0,0,0,0.85),inset_0_1px_1px_rgba(255,255,255,0.1)] pointer-events-auto flex flex-col gap-2.5 transition-all duration-200">
        
        {/* Subtle Iridescent Top Accent Hairline */}
        <div className="absolute top-0 left-0 right-0 h-[1.5px] bg-gradient-to-r from-transparent via-[#6E8BFF]/70 to-transparent" />

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
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-[0_2px_12px_rgba(5,150,105,0.35)] transition-all duration-150 ease-out flex items-center gap-1.5 active:scale-95"
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
                          ? 'text-white font-semibold drop-shadow-[0_0_12px_rgba(110,139,255,0.8)] bg-[#6E8BFF]/25 border border-[#6E8BFF]/50 px-1.5 py-0.5 rounded-lg shadow-sm scale-[1.03]'
                          : i < currentWordIndex
                          ? 'text-[#F2F2F2]/40'
                          : 'text-[#F2F2F2]/85'
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
              {/* Animated Speaking Waveform Indicator */}
              {(isSpeaking || playbackState === 'playing') && (
                <div className="flex items-center gap-0.5 px-2 py-0.5 rounded-full bg-[#6E8BFF]/15 border border-[#6E8BFF]/30 text-[#6E8BFF]">
                  <span className="w-[2px] h-2.5 bg-[#6E8BFF] rounded-full animate-[pulse_0.6s_ease-in-out_infinite]" />
                  <span className="w-[2px] h-3.5 bg-[#6E8BFF] rounded-full animate-[pulse_0.4s_ease-in-out_infinite]" />
                  <span className="w-[2px] h-2 bg-[#6E8BFF] rounded-full animate-[pulse_0.8s_ease-in-out_infinite]" />
                  <span className="w-[2px] h-3 bg-[#6E8BFF] rounded-full animate-[pulse_0.5s_ease-in-out_infinite]" />
                </div>
              )}

              {currentEmotion.primary !== 'neutral' && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-[#6E8BFF]/15 text-[#6E8BFF] border border-[#6E8BFF]/25 capitalize">
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
