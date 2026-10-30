import React from 'react';
import { useAppStore } from '@/store/appStore';
import { TYPO, BUTTONS, SURFACES } from './designSystem';
import { X, FileText } from 'lucide-react';

export default function FullResponseModal() {
  const { isFullResponseModalOpen, setIsFullResponseModalOpen, lastFullResponse } = useAppStore();

  if (!isFullResponseModalOpen || !lastFullResponse) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xl animate-fade-in">
      <div
        className={`w-full max-w-2xl ${SURFACES.modalShell} overflow-hidden flex flex-col max-h-[80vh]`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#2A2C33] bg-[#181818]">
          <div className="flex items-center gap-2.5">
            <FileText size={16} strokeWidth={1.5} className="text-[#A78BFA]" />
            <h2 className={TYPO.title}>
              Full AI Assistant Response
            </h2>
          </div>
          <button
            type="button"
            onClick={() => setIsFullResponseModalOpen(false)}
            className={BUTTONS.icon}
            title="Close modal"
          >
            <X size={15} strokeWidth={1.5} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 custom-scrollbar bg-[#0D0F17]">
          <div className="text-[13px] text-[#F2F2F2]/90 leading-relaxed select-text whitespace-pre-wrap font-sans">
            {lastFullResponse}
          </div>
        </div>

        <div className="px-6 py-3 border-t border-[#2A2C33] bg-[#181818] flex items-center justify-end">
          <button
            type="button"
            onClick={() => setIsFullResponseModalOpen(false)}
            className={`px-4 py-1.5 text-xs ${BUTTONS.secondary}`}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
