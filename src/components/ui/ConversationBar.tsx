import React, { useState, useRef } from 'react';
import { useAppStore } from '@/store/appStore';
import { Plus, ArrowRight, Mic, Square } from 'lucide-react';
import { auraController } from '@/services/auraConversationController';
import { isComplexReasoning } from '@/utils/reasoningDetector';

/**
 * ConversationBar — Figma Aura Frame 1:2 Exact Specification
 * Dimensions: Height 64px, Width ~1096px (max-w-3xl), Radius 32px
 * Surface: #1C1F2A with #2A2E3B border
 * Controls: Circular (+) #262A38, Input "Message Aura…", Mic #262A38, Send (40x40 #8B7CFF with →)
 * Strictly matches Figma Frame 1:2 (No extra chip buttons or text clutter)
 */
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

    // Always maintain Deep Think mode for highest quality intelligence
    setAgentModelName('Deep Think');
    setAgentSpeed('langgraph');

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
    : "Message Aura…";

  return (
    <div
      className="relative z-30 w-full max-w-xl md:max-w-2xl mx-auto px-4 pb-6 pointer-events-auto flex flex-col items-center font-sans"
      data-purpose="primary-conversation-bar"
    >
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept=".glb,.gltf,.txt,.json,.md,.png,.jpg"
        className="hidden"
      />

      {/* ── Figma Frame 1:2 Composer Capsule: 1096x64 at #1C1F2A, Border #2A2E3B, Radius 32px ── */}
      <div className="relative w-full flex items-center justify-between h-[64px] px-3.5 rounded-[32px] bg-[#1C1F2A] border border-[#2A2E3B] hover:border-[#8B7CFF]/50 focus-within:border-[#8B7CFF] shadow-[0_12px_40px_rgba(0,0,0,0.6)] transition-all duration-200 gap-2.5 group">

        {/* Left: Circular (+) Button (Figma: Ellipse 36x36 #262A38) */}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="w-9 h-9 rounded-full bg-[#262A38] hover:bg-[#32374A] text-[#FFFFFF] transition flex items-center justify-center shrink-0 active:scale-95 cursor-pointer"
          title="Attach file or 3D model"
        >
          <Plus size={18} strokeWidth={2.5} />
        </button>

        {/* Center: Clean Text Input with Placeholder "Message Aura…" */}
        <input
          type="text"
          value={inputText || (isListening ? scriptText : '')}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isBusy}
          placeholder={placeholder}
          className="flex-1 bg-transparent border-none outline-none ring-0 focus:ring-0 focus:outline-none focus:border-none shadow-none text-[15px] text-[#F2F2F2] placeholder-[#7A7D86] px-2 font-sans font-normal disabled:opacity-50"
          style={{ outline: 'none', border: 'none', boxShadow: 'none', background: 'transparent' }}
        />

        {/* Right Controls: Mic (36x36 #262A38) + Send (40x40 #8B7CFF with →) */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Mic / Stop Action Button */}
          {isCharacterSpeaking ? (
            <button
              type="button"
              onClick={() => auraController.stopConversation()}
              className="w-9 h-9 rounded-full bg-rose-500/20 text-rose-300 hover:bg-rose-500/30 flex items-center justify-center transition active:scale-95 shrink-0 border border-rose-500/30 cursor-pointer"
              title="Stop speaking"
            >
              <Square size={12} strokeWidth={2.5} fill="currentColor" />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleToggleMic}
              className={`w-9 h-9 rounded-full flex items-center justify-center transition active:scale-95 shrink-0 relative cursor-pointer ${
                isListening
                  ? 'bg-[#8B7CFF] text-white shadow-[0_0_12px_rgba(139,124,255,0.6)]'
                  : isAlwaysOnMic
                  ? 'bg-[#2A2350] text-[#8B7CFF] border border-[#8B7CFF]/40'
                  : 'bg-[#262A38] text-[#FFFFFF] hover:bg-[#32374A]'
              }`}
              title={
                isListening
                  ? 'Listening — tap to stop'
                  : isAlwaysOnMic
                  ? 'Always-on mic active — tap to mute'
                  : 'Voice input'
              }
            >
              <Mic size={16} strokeWidth={2} />
              {isListening && (
                <span className="absolute inset-0 rounded-full border border-[#8B7CFF] animate-ping opacity-60" />
              )}
            </button>
          )}

          {/* Send Action (Figma: Ellipse 40x40 #8B7CFF, text →) */}
          <button
            type="button"
            onClick={() => handleSend(inputText || scriptText)}
            disabled={(!inputText.trim() && !(isListening && scriptText.trim())) || isBusy}
            className="w-10 h-10 rounded-full bg-[#8B7CFF] hover:bg-[#9E91FF] active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed transition flex items-center justify-center shadow-[0_2px_12px_rgba(139,124,255,0.4)] text-[#FFFFFF] font-bold shrink-0 cursor-pointer"
            title="Send message"
          >
            <ArrowRight size={18} strokeWidth={2.5} />
          </button>
        </div>
      </div>
    </div>
  );
}
