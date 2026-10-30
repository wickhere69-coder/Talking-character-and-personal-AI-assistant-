import React, { useState, useRef } from 'react';
import { useAppStore } from '@/store/appStore';
import { Plus, ArrowUp, Mic, Square } from 'lucide-react';
import { auraController } from '@/services/auraConversationController';
import { isComplexReasoning } from '@/utils/reasoningDetector';

export default function ConversationBar() {
  const [inputText, setInputText] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const {
    isListening,
    isSpeaking,
    playbackState,
    agentStatus,
    scriptText,
    setScriptText,
    setCustomGlbUrl,
    agentSpeed,
    setAgentSpeed,
    setAgentModelName,
    isAlwaysOnMic
  } = useAppStore();

  const isBusy = agentStatus === 'thinking' || agentStatus === 'planning' || playbackState === 'loading';
  const isCharacterSpeaking = isSpeaking || playbackState === 'playing' || agentStatus === 'speaking';

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend(inputText || (isListening ? scriptText : ''));
    }
  };

  const handleSend = (textToSend?: string) => {
    const raw = typeof textToSend === 'string' ? textToSend : inputText;
    const trimmed = raw.trim();
    if (!trimmed || isBusy) return;

    setInputText('');
    setScriptText('');

    // Intelligently auto-switch to Deep Think (LangGraph) for complex problems / reasoning
    const requiresDeepReasoning = isComplexReasoning(trimmed);
    if (requiresDeepReasoning) {
      setAgentModelName('Deep Think');
      setAgentSpeed('langgraph');
    } else if (agentSpeed !== 'langgraph' && agentSpeed !== 'instant') {
      setAgentModelName('Balanced');
      setAgentSpeed('gemini');
    }

    auraController.ask(trimmed);
  };

  const handleToggleMic = () => {
    if (isCharacterSpeaking) {
      auraController.stopConversation();
    } else {
      auraController.toggleListening();
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.name.endsWith('.glb') || file.name.endsWith('.gltf')) {
      const url = URL.createObjectURL(file);
      setCustomGlbUrl(url);
    } else {
      setInputText((prev) => `${prev ? prev + ' ' : ''}[Attached: ${file.name}] `);
    }
    e.target.value = '';
  };

  const placeholder = isListening
    ? (scriptText ? scriptText : "Listening to your voice...")
    : isBusy
    ? "Thinking & analyzing..."
    : isCharacterSpeaking
    ? "Aura is speaking..."
    : isAlwaysOnMic
    ? "Always-on mic active — speak or type..."
    : "Ask Aura anything or speak...";

  return (
    <div
      className="relative z-30 w-full max-w-2xl lg:max-w-3xl mx-auto px-4 pb-6 md:pb-8 pointer-events-auto flex flex-col items-center"
      data-purpose="primary-conversation-bar"
    >
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept=".glb,.gltf,.txt,.json,.md,.png,.jpg"
        className="hidden"
      />

      {/* ── Capsule Input Bar ── */}
      <div className="relative w-full flex items-center justify-between h-14 md:h-[60px] px-3.5 rounded-full bg-[#0D0F17]/95 backdrop-blur-2xl border border-white/[0.08] hover:border-white/[0.15] focus-within:border-[#A78BFA]/50 focus-within:ring-1 focus-within:ring-[#A78BFA]/20 shadow-[0_16px_48px_rgba(0,0,0,0.8),inset_0_1px_1px_rgba(255,255,255,0.08)] transition-all duration-200 gap-2.5 group">

        {/* Left: Attachment (+) Button */}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="w-8 h-8 rounded-full text-[#A7A9AF] hover:text-[#F2F2F2] hover:bg-white/[0.06] transition flex items-center justify-center shrink-0 active:scale-95"
          title="Attach 3D model or document"
        >
          <Plus size={16} strokeWidth={2} />
        </button>

        {/* Center: Clean Text Input */}
        <input
          type="text"
          value={inputText || (isListening ? scriptText : '')}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isBusy}
          placeholder={placeholder}
          className="flex-1 bg-transparent border-none outline-none ring-0 focus:ring-0 focus:outline-none focus:border-none shadow-none text-xs md:text-sm text-[#F2F2F2] placeholder-[#A7A9AF] px-2 font-sans font-normal disabled:opacity-50"
          style={{ outline: 'none', border: 'none', boxShadow: 'none', background: 'transparent' }}
        />

        {/* Right Controls */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Send button (appears when input or spoken transcript is non-empty) */}
          {(inputText.trim().length > 0 || (isListening && scriptText.trim().length > 0)) && !isBusy && (
            <button
              type="button"
              onClick={() => handleSend(inputText || scriptText)}
              className="w-8 h-8 rounded-full bg-[#A78BFA] text-[#0B0D12] hover:bg-[#C4B5FD] active:scale-95 transition flex items-center justify-center shadow-sm font-semibold shrink-0"
              title="Send message"
            >
              <ArrowUp size={15} strokeWidth={2.5} />
            </button>
          )}

          {/* Unified Mic / Stop Action Button */}
          {isCharacterSpeaking ? (
            <button
              type="button"
              onClick={() => auraController.stopConversation()}
              className="w-9 h-9 rounded-full bg-rose-500/15 text-rose-300 hover:bg-rose-500/25 flex items-center justify-center transition active:scale-95 shrink-0 border border-rose-500/25"
              title="Stop speaking"
            >
              <Square size={12} strokeWidth={2.5} fill="currentColor" />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleToggleMic}
              className={`w-9 h-9 rounded-full flex items-center justify-center transition active:scale-95 shrink-0 relative ${
                isListening
                  ? 'bg-[#A78BFA] text-[#0B0D12] shadow-sm'
                  : isAlwaysOnMic
                  ? 'text-[#A78BFA] bg-[#A78BFA]/15 hover:bg-[#A78BFA]/25 border border-[#A78BFA]/30'
                  : 'text-[#A7A9AF] hover:text-[#F2F2F2] hover:bg-white/[0.06]'
              }`}
              title={
                isListening
                  ? 'Listening — tap to stop'
                  : isAlwaysOnMic
                  ? 'Always-on mic active — tap to mute'
                  : 'Click to speak'
              }
            >
              <Mic size={17} strokeWidth={2} />
              {isListening && (
                <span className="absolute inset-0 rounded-full border border-[#A78BFA] animate-ping opacity-60" />
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
