import React from 'react';
import { useAppStore } from '@/store/appStore';
import { X, FileText } from 'lucide-react';

export default function FullResponseModal() {
  const { isFullResponseModalOpen, setIsFullResponseModalOpen, lastFullResponse } = useAppStore();

  if (!isFullResponseModalOpen || !lastFullResponse) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-fade-in">
      <div 
        className="w-full max-w-2xl bg-[#111113]/95 border border-white/[0.08] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06] bg-[#151518]/50">
          <div className="flex items-center gap-2.5">
            <FileText size={16} strokeWidth={1.5} className="text-[#8B5CF6]" />
            <h2 className="text-sm font-semibold text-[#F5F5F7] tracking-wide uppercase">
              Full AI Assistant Response
            </h2>
          </div>
          <button
            type="button"
            onClick={() => setIsFullResponseModalOpen(false)}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-[#9898A3] hover:text-[#F5F5F7] hover:bg-white/[0.06] transition-all"
            title="Close modal"
          >
            <X size={15} strokeWidth={1.5} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
          <div className="text-sm text-[#F5F5F7]/90 leading-relaxed select-text whitespace-pre-wrap font-sans">
            {lastFullResponse}
          </div>
        </div>

        <div className="px-6 py-3 border-t border-white/[0.06] bg-[#151518]/50 flex items-center justify-end">
          <button
            type="button"
            onClick={() => setIsFullResponseModalOpen(false)}
            className="px-4 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-[#F5F5F7] text-xs font-medium transition-all"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
