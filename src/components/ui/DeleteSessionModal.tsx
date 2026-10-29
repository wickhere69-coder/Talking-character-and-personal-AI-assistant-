import React from 'react';
import { useSessionStore } from '@/store/sessionStore';
import { Trash2, AlertTriangle, X } from 'lucide-react';
import { BUTTONS } from './designSystem';

export default function DeleteSessionModal() {
  const { deletingSession, setDeletingSession, confirmDeleteSession } = useSessionStore();

  if (!deletingSession) return null;

  const handleDelete = async () => {
    await confirmDeleteSession(deletingSession.id);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
      <div 
        className="relative w-full max-w-md bg-[#0D0F17]/95 border border-white/[0.1] rounded-3xl p-6 shadow-[0_24px_80px_rgba(0,0,0,0.9)] overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-session-title"
      >
        {/* Subtle red warning hairline */}
        <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-rose-500/80 to-transparent" />

        <div className="flex items-start justify-between gap-4">
          <div className="w-10 h-10 rounded-2xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-rose-400 shrink-0">
            <AlertTriangle size={20} strokeWidth={2} />
          </div>

          <button
            type="button"
            onClick={() => setDeletingSession(null)}
            className="w-8 h-8 rounded-full bg-white/[0.04] hover:bg-white/[0.08] text-[#A7A9AF] hover:text-[#F2F2F2] flex items-center justify-center transition active:scale-95"
            title="Cancel"
          >
            <X size={16} />
          </button>
        </div>

        <div className="mt-4 space-y-2">
          <h3 id="delete-session-title" className="text-base font-semibold text-[#F2F2F2] font-sans">
            Delete Chat Session?
          </h3>
          <p className="text-xs text-[#A7A9AF] leading-relaxed font-sans">
            Are you sure you want to delete <span className="text-[#F2F2F2] font-medium">"{deletingSession.title}"</span>? All messages, transcripts, and contextual memories in this session will be permanently removed.
          </p>
        </div>

        <div className="mt-6 flex items-center justify-end gap-3 pt-4 border-t border-white/[0.08]">
          <button
            type="button"
            onClick={() => setDeletingSession(null)}
            className={`px-4 py-2 ${BUTTONS.secondary} text-xs font-medium`}
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={handleDelete}
            className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold shadow-[0_2px_12px_rgba(225,29,72,0.35)] transition-all duration-150 flex items-center gap-1.5 active:scale-95"
          >
            <Trash2 size={13} strokeWidth={2} />
            <span>Delete Session</span>
          </button>
        </div>
      </div>
    </div>
  );
}

