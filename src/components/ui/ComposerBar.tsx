import React, { useEffect, useId } from 'react';
import { ArrowRight, Mic, Square, X } from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import { auraController } from '@/services/auraConversationController';
import { voiceManager } from '@/services/voiceManager';
import { nativeLiveAudioPlayer } from '@/services/nativeLiveAudioPlayer';

interface ComposerBarProps {
  /** Controlled text value in the composer input. */
  value: string;
  /** Callback invoked whenever text changes or live transcript updates. */
  onChange: (value: string) => void;
  /** Called with trimmed text when the user submits a message. */
  onSubmit: (trimmedText: string) => void;
  /** Optional leading action slot (e.g. attachment button on the home bar). */
  leftSlot?: React.ReactNode;
  /** Horizontal padding override for the text input. */
  inputPaddingClass?: string;
}

/**
 * Shared Aura composer pill matching the home searchbar specification.
 * Renders an outer focus-within ring with zero inner box around the input.
 */
export default function ComposerBar({
  value,
  onChange,
  onSubmit,
  leftSlot,
  inputPaddingClass = 'px-2',
}: ComposerBarProps) {
  const inputId = useId();
  const {
    isListening,
    isSpeaking,
    playbackState,
    agentStatus,
    scriptText,
    setScriptText,
    setAgentSpeed,
    setAgentModelName,
    isAlwaysOnMic,
    liveUserCaption,
    isUserSpeaking,
  } = useAppStore();

  const inLiveCall = isListening && auraController.isLiveConversation();
  const isBusy = agentStatus === 'thinking' || agentStatus === 'planning' || playbackState === 'loading';
  const isCharacterSpeaking = isSpeaking || playbackState === 'playing' || agentStatus === 'speaking';

  // Mirror browser-recognition transcript into the input when not in a full-duplex live call.
  useEffect(() => {
    if (isListening && scriptText && !auraController.isLiveConversation()) {
      onChange(scriptText);
    }
  }, [isListening, scriptText, onChange]);

  const handleClear = () => {
    onChange('');
    setScriptText('');
    auraController.clearTranscript();
  };

  const submitCurrentText = () => {
    const trimmed = value.trim();
    if (!trimmed) return;

    voiceManager.getEngine().scheduler.ensureContext().catch(() => {});
    nativeLiveAudioPlayer.ensureContext().catch(() => {});

    onChange('');
    setScriptText('');
    auraController.clearTranscript();

    setAgentModelName('Deep Think');
    setAgentSpeed('langgraph');

    onSubmit(trimmed);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (e.nativeEvent.isComposing || e.keyCode === 229) return;
      submitCurrentText();
    }
  };

  const handleToggleMic = () => {
    voiceManager.getEngine().scheduler.ensureContext().catch(() => {});
    nativeLiveAudioPlayer.ensureContext().catch(() => {});

    if (isCharacterSpeaking) {
      auraController.stopConversation();
    } else {
      auraController.toggleListening();
    }
  };

  const placeholder = inLiveCall
    ? (liveUserCaption
        ? liveUserCaption
        : isCharacterSpeaking
        ? 'Aura is talking — just speak to interrupt'
        : isUserSpeaking
        ? 'Listening…'
        : 'Live — talk to Aura anytime')
    : isListening
    ? (scriptText || 'Listening to your voice...')
    : isBusy
    ? 'Thinking & analyzing...'
    : isCharacterSpeaking
    ? 'Aura is speaking...'
    : isAlwaysOnMic
    ? 'Always-on mic active — speak or type...'
    : 'Message Aura…';

  return (
    <form
      className="w-full"
      onSubmit={(e) => {
        e.preventDefault();
        submitCurrentText();
      }}
    >
      <div className="relative w-full flex items-center justify-between h-[64px] px-3.5 rounded-[32px] bg-[#1C1F2A] border border-[#2A2E3B] hover:border-[#8B7CFF]/50 focus-within:border-[#8B7CFF] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[#8B7CFF]/40 shadow-[0_12px_40px_rgba(0,0,0,0.6)] transition-all duration-200 gap-2.5 group">
        {leftSlot}

        <label htmlFor={inputId} className="sr-only">
          Message Aura
        </label>
        <input
          id={inputId}
          name="message"
          type="text"
          value={value}
          onChange={(e) => {
            const val = e.target.value;
            onChange(val);
            if (!val) {
              setScriptText('');
              auraController.clearTranscript();
            }
          }}
          onKeyDown={handleKeyDown}
          disabled={isBusy}
          placeholder={placeholder}
          className={`flex-1 min-w-0 bg-transparent border-none appearance-none outline-none ring-0 focus:ring-0 focus:outline-none focus-visible:outline-none focus:border-none shadow-none text-[15px] text-[#F2F2F2] placeholder-[#7A7D86] ${inputPaddingClass} font-sans font-normal disabled:opacity-50`}
          style={{ outline: 'none', border: 'none', boxShadow: 'none', background: 'transparent' }}
        />

        {value && (
          <button
            type="button"
            onClick={handleClear}
            aria-label="Clear text"
            className="w-6 h-6 rounded-full flex items-center justify-center text-[#7A7D86] hover:text-[#FFFFFF] hover:bg-[#262A38] transition active:scale-90 cursor-pointer shrink-0"
            title="Clear text"
          >
            <X size={14} strokeWidth={2} aria-hidden="true" />
          </button>
        )}

        <div className="flex items-center gap-2 shrink-0">
          {isCharacterSpeaking && (
            <button
              type="button"
              onClick={() => (inLiveCall ? auraController.interrupt() : auraController.stopConversation())}
              aria-label={inLiveCall ? 'Interrupt Aura' : 'Stop speaking'}
              className="w-9 h-9 rounded-full bg-rose-500/20 text-rose-300 hover:bg-rose-500/30 flex items-center justify-center transition active:scale-95 shrink-0 border border-rose-500/30 cursor-pointer"
              title={inLiveCall ? 'Interrupt Aura (or just start talking)' : 'Stop speaking'}
            >
              <Square size={12} strokeWidth={2.5} fill="currentColor" aria-hidden="true" />
            </button>
          )}
          {(!isCharacterSpeaking || inLiveCall) && (
            <button
              type="button"
              onClick={handleToggleMic}
              aria-label={
                inLiveCall
                  ? 'End live conversation'
                  : isListening
                  ? 'Stop voice input'
                  : isAlwaysOnMic
                  ? 'Mute always-on microphone'
                  : 'Start voice input'
              }
              className={`w-9 h-9 rounded-full flex items-center justify-center transition active:scale-95 shrink-0 relative cursor-pointer ${
                isListening
                  ? 'bg-[#8B7CFF] text-white shadow-[0_0_12px_rgba(139,124,255,0.6)]'
                  : isAlwaysOnMic
                  ? 'bg-[#2A2350] text-[#8B7CFF] border border-[#8B7CFF]/40'
                  : 'bg-[#262A38] text-[#FFFFFF] hover:bg-[#32374A]'
              }`}
              title={
                inLiveCall
                  ? 'Live conversation — tap to end'
                  : isListening
                  ? 'Listening — tap to stop'
                  : isAlwaysOnMic
                  ? 'Always-on mic active — tap to mute'
                  : 'Voice input'
              }
            >
              <Mic size={16} strokeWidth={2} aria-hidden="true" />
              {isListening && (isUserSpeaking || !inLiveCall) && (
                <span
                  className="absolute inset-0 rounded-full border border-[#8B7CFF] animate-ping opacity-60"
                  aria-hidden="true"
                />
              )}
            </button>
          )}

          <button
            type="submit"
            disabled={!value.trim()}
            aria-label="Send message"
            className="w-10 h-10 rounded-full bg-[#8B7CFF] hover:bg-[#9E91FF] active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed transition flex items-center justify-center shadow-[0_2px_12px_rgba(139,124,255,0.4)] text-[#FFFFFF] font-bold shrink-0 cursor-pointer"
            title="Send message"
          >
            <ArrowRight size={18} strokeWidth={2.5} aria-hidden="true" />
          </button>
        </div>
      </div>
    </form>
  );
}
