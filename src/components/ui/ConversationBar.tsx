import React, { useState, useRef } from 'react';
import { Plus } from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import { auraController } from '@/services/auraConversationController';
import ComposerBar from './ComposerBar';

/**
 * ConversationBar — Primary Home Floating Composer
 * Wraps the shared ComposerBar pill with optional attachment/3D model upload.
 */
export default function ConversationBar() {
  const [inputText, setInputText] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { setCustomGlbUrl } = useAppStore();

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

      <ComposerBar
        value={inputText}
        onChange={setInputText}
        onSubmit={(trimmed) => auraController.ask(trimmed)}
        leftSlot={
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            aria-label="Attach file or 3D model"
            className="w-9 h-9 rounded-full bg-[#262A38] hover:bg-[#32374A] text-[#FFFFFF] transition flex items-center justify-center shrink-0 active:scale-95 cursor-pointer"
            title="Attach file or 3D model"
          >
            <Plus size={18} strokeWidth={2.5} aria-hidden="true" />
          </button>
        }
      />
    </div>
  );
}
